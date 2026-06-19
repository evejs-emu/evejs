const path = require("path");
const fs = require("fs");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  resolveCharacterCreationSchoolProfile,
} = require(path.join(__dirname, "../character/characterCreationData"));
const {
  createWarRecord,
} = require(path.join(__dirname, "./warRuntimeState"));
const {
  cloneValue,
  ensureCharacterMemberState,
  getCorporationMember,
  getCorporationRuntime,
  normalizeInteger,
  normalizePositiveInteger,
  normalizeText,
  syncMemberStateToCharacterRecord,
  updateCorporationRecord,
  updateCorporationRuntime,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  getCorporationRecord,
  setCharacterAffiliation,
} = require(path.join(__dirname, "./corporationState"));
const {
  findItemById,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildCorporationMemberSnapshot,
  buildCorporationSnapshot,
  notifyCorporationChanged,
  notifyCorporationMemberChanged,
  notifyLockedItemChange,
} = require(path.join(__dirname, "./corporationNotifications"));

const VOTES_TABLE = "corporationVotes";
const VOTES_TABLE_FILE = path.join(
  __dirname,
  "../../newDatabase/data",
  VOTES_TABLE,
  "data.json",
);
const DEFAULT_NPC_CORPORATION_ID = 1000044;
const FILETIME_TICKS_PER_DAY = 864000000000n;
let voteTableCache = null;
let voteTableBootstrapComplete = false;

const VOTECASE_STATUS_ALL = 0;
const VOTECASE_STATUS_CLOSED = 1;
const VOTECASE_STATUS_OPEN = 2;

const voteCEO = 0;
const voteWar = 1;
const voteShares = 2;
const voteKickMember = 3;
const voteGeneral = 4;
const voteItemLockdown = 5;
const voteItemUnlock = 6;

function cloneDefaultCorporationVoteState() {
  return {
    voteCases: {},
    optionsByVoteCaseID: {},
    votesByVoteCaseID: {},
    actionStatesByVoteCaseID: {},
  };
}

function buildDefaultVoteTable() {
  return {
    _meta: {
      nextVoteCaseID: 1,
    },
    corporations: {},
  };
}

function normalizeVoteTable(table) {
  const nextTable =
    table && typeof table === "object" ? cloneValue(table) : buildDefaultVoteTable();
  nextTable._meta =
    nextTable._meta && typeof nextTable._meta === "object" ? nextTable._meta : {};
  nextTable._meta.nextVoteCaseID =
    normalizePositiveInteger(nextTable._meta.nextVoteCaseID, 1) || 1;
  nextTable.corporations =
    nextTable.corporations && typeof nextTable.corporations === "object"
      ? nextTable.corporations
      : {};
  return nextTable;
}

function readTable() {
  if (voteTableBootstrapComplete && voteTableCache) {
    return cloneValue(voteTableCache);
  }
  const result = database.read(VOTES_TABLE, "/");
  const nextTable =
    result.success && result.data && typeof result.data === "object"
      ? normalizeVoteTable(result.data)
      : buildDefaultVoteTable();
  voteTableCache = cloneValue(nextTable);
  voteTableBootstrapComplete = true;
  return cloneValue(nextTable);
}

function writeTable(table) {
  const nextTable = normalizeVoteTable(table);
  const writeResult = database.write(VOTES_TABLE, "/", nextTable);
  if (writeResult && writeResult.success) {
    voteTableCache = cloneValue(nextTable);
    voteTableBootstrapComplete = true;
  }
  return writeResult;
}

function ensureTable() {
  if (!voteTableBootstrapComplete && !fs.existsSync(VOTES_TABLE_FILE)) {
    fs.mkdirSync(path.dirname(VOTES_TABLE_FILE), { recursive: true });
    fs.writeFileSync(
      VOTES_TABLE_FILE,
      JSON.stringify(buildDefaultVoteTable(), null, 2),
      "utf8",
    );
  }
  const table = readTable();
  voteTableCache = cloneValue(table);
  voteTableBootstrapComplete = true;
  return voteTableCache;
}

function updateVoteTable(updater) {
  const table = ensureTable();
  const nextTable =
    typeof updater === "function" ? updater(table) || table : table;
  writeTable(nextTable);
  return nextTable;
}

function ensureCorporationVoteState(table, corporationID) {
  const corporationKey = String(corporationID);
  if (!table.corporations[corporationKey]) {
    table.corporations[corporationKey] = cloneDefaultCorporationVoteState();
  }
  const state = table.corporations[corporationKey];
  state.voteCases =
    state.voteCases && typeof state.voteCases === "object" ? state.voteCases : {};
  state.optionsByVoteCaseID =
    state.optionsByVoteCaseID && typeof state.optionsByVoteCaseID === "object"
      ? state.optionsByVoteCaseID
      : {};
  state.votesByVoteCaseID =
    state.votesByVoteCaseID && typeof state.votesByVoteCaseID === "object"
      ? state.votesByVoteCaseID
      : {};
  state.actionStatesByVoteCaseID =
    state.actionStatesByVoteCaseID &&
    typeof state.actionStatesByVoteCaseID === "object"
      ? state.actionStatesByVoteCaseID
      : {};
  return state;
}

function normalizeOptionText(rawValue) {
  if (Array.isArray(rawValue)) {
    if (typeof rawValue[0] === "string") {
      return rawValue[0];
    }
    return rawValue
      .map((entry) => normalizeOptionText(entry))
      .filter(Boolean)
      .join(" ");
  }
  return normalizeText(rawValue, "");
}

function normalizeDurationDays(rawValue) {
  return Math.max(1, Math.min(30, normalizeInteger(rawValue, 1)));
}

function addFiletimeDays(filetimeValue, days) {
  return (
    BigInt(String(filetimeValue || currentFileTime())) +
    BigInt(normalizeDurationDays(days)) * FILETIME_TICKS_PER_DAY
  ).toString();
}

function getVoteCaseStatus(voteCase, nowFiletime = currentFileTime()) {
  if (!voteCase) {
    return VOTECASE_STATUS_CLOSED;
  }
  const endDateTime = BigInt(String(voteCase.endDateTime || "0"));
  return endDateTime > nowFiletime ? VOTECASE_STATUS_OPEN : VOTECASE_STATUS_CLOSED;
}

function normalizeOptionRows(voteType, rawOptions = []) {
  if (voteType === voteGeneral) {
    return rawOptions.map((optionText, optionID) => ({
      optionID,
      optionText: normalizeOptionText(optionText) || `Option ${optionID + 1}`,
      parameter: 0,
      parameter1: 0,
      parameter2: 0,
    }));
  }

  const optionTexts = Array.isArray(rawOptions) ? rawOptions : [];
  const yesText = normalizeOptionText(optionTexts[0]);
  const noText = normalizeOptionText(optionTexts[1]);
  const parameter = normalizePositiveInteger(optionTexts[2], 0) || 0;
  const parameter1 = normalizePositiveInteger(optionTexts[3], 0) || 0;
  const parameter2 = normalizePositiveInteger(optionTexts[4], 0) || 0;

  return [
    {
      optionID: 0,
      optionText: yesText,
      parameter,
      parameter1,
      parameter2,
    },
    {
      optionID: 1,
      optionText: noText,
      parameter: 0,
      parameter1,
      parameter2,
    },
  ];
}

function normalizeVoteCaseRow(voteCase) {
  if (!voteCase || typeof voteCase !== "object") {
    return null;
  }
  return {
    voteCaseID: normalizePositiveInteger(voteCase.voteCaseID, 0) || 0,
    corporationID: normalizePositiveInteger(voteCase.corporationID, 0) || 0,
    voteType: normalizeInteger(voteCase.voteType, voteGeneral),
    voteCaseText: normalizeText(voteCase.voteCaseText, ""),
    description: normalizeText(voteCase.description, ""),
    startDateTime: String(voteCase.startDateTime || currentFileTime()),
    endDateTime: String(voteCase.endDateTime || currentFileTime()),
    createdByCharacterID:
      normalizePositiveInteger(voteCase.createdByCharacterID, 0) || 0,
  };
}

function getCorporationVoteState(corporationID) {
  const table = ensureTable();
  const state = table.corporations[String(corporationID)];
  return state ? cloneValue(state) : cloneDefaultCorporationVoteState();
}

function getVoteCase(corporationID, voteCaseID) {
  const state = getCorporationVoteState(corporationID);
  return normalizeVoteCaseRow(
    state.voteCases[String(normalizePositiveInteger(voteCaseID, 0) || 0)],
  );
}

function updateVoteCase(corporationID, voteCaseID, updater) {
  const numericCorporationID =
    normalizePositiveInteger(corporationID, null) || null;
  const numericVoteCaseID = normalizePositiveInteger(voteCaseID, null) || null;
  if (!numericCorporationID || !numericVoteCaseID) {
    return null;
  }

  updateVoteTable((table) => {
    const corporationState = ensureCorporationVoteState(table, numericCorporationID);
    const currentVoteCase = corporationState.voteCases[String(numericVoteCaseID)];
    if (!currentVoteCase) {
      return table;
    }
    corporationState.voteCases[String(numericVoteCaseID)] =
      typeof updater === "function"
        ? updater(cloneValue(currentVoteCase)) || currentVoteCase
        : currentVoteCase;
    return table;
  });

  return getVoteCase(numericCorporationID, numericVoteCaseID);
}

function listVoteCasesByCorporation(corporationID) {
  const state = getCorporationVoteState(corporationID);
  return Object.values(state.voteCases || {})
    .map((voteCase) => normalizeVoteCaseRow(voteCase))
    .filter(Boolean)
    .sort((left, right) => Number(right.voteCaseID) - Number(left.voteCaseID));
}

function listVoteCaseOptions(corporationID, voteCaseID) {
  const state = getCorporationVoteState(corporationID);
  const voteCase = getVoteCase(corporationID, voteCaseID);
  if (!voteCase) {
    return [];
  }
  const votesByCharacter =
    state.votesByVoteCaseID[String(voteCase.voteCaseID)] || {};
  const voteWeightsByOptionID = new Map();
  for (const vote of Object.values(votesByCharacter)) {
    const optionID = normalizeInteger(vote && vote.optionID, 0);
    const weight = normalizeInteger(vote && vote.voteWeight, 0);
    voteWeightsByOptionID.set(optionID, (voteWeightsByOptionID.get(optionID) || 0) + weight);
  }

  return (state.optionsByVoteCaseID[String(voteCase.voteCaseID)] || [])
    .map((option) => ({
      optionID: normalizeInteger(option && option.optionID, 0),
      optionText: normalizeText(option && option.optionText, ""),
      parameter: normalizePositiveInteger(option && option.parameter, 0) || 0,
      parameter1: normalizePositiveInteger(option && option.parameter1, 0) || 0,
      parameter2: normalizePositiveInteger(option && option.parameter2, 0) || 0,
      votesFor:
        normalizeInteger(
          voteWeightsByOptionID.get(normalizeInteger(option && option.optionID, 0)),
          0,
        ) || 0,
    }))
    .sort((left, right) => left.optionID - right.optionID);
}

function listVotesByVoteCase(corporationID, voteCaseID) {
  const state = getCorporationVoteState(corporationID);
  return Object.values(state.votesByVoteCaseID[String(voteCaseID)] || {})
    .map((vote) => ({
      voteCaseID,
      characterID: normalizePositiveInteger(vote && vote.characterID, 0) || 0,
      optionID: normalizeInteger(vote && vote.optionID, 0),
      castDateTime: String(vote && vote.castDateTime ? vote.castDateTime : currentFileTime()),
      voteWeight: normalizeInteger(vote && vote.voteWeight, 0),
    }))
    .sort((left, right) => Number(left.characterID) - Number(right.characterID));
}

function resolveFallbackCorporationID(characterID) {
  const characterRecord = getCharacterRecord(characterID) || {};
  const schoolProfile = resolveCharacterCreationSchoolProfile(
    characterRecord.schoolID,
    {
      raceID: characterRecord.raceID,
      corporationID: DEFAULT_NPC_CORPORATION_ID,
    },
  );
  const schoolCorporationID = normalizePositiveInteger(
    schoolProfile.corporationID,
    null,
  );
  if (schoolCorporationID && getCorporationRecord(schoolCorporationID)) {
    return schoolCorporationID;
  }
  return DEFAULT_NPC_CORPORATION_ID;
}

function moveCharacterToCorporation(characterID, fromCorporationID, toCorporationID) {
  const targetCorporation = getCorporationRecord(toCorporationID);
  if (!targetCorporation) {
    return { success: false, errorMsg: "TARGET_CORPORATION_NOT_FOUND" };
  }
  const previousFromMember = buildCorporationMemberSnapshot(
    fromCorporationID,
    characterID,
  );
  const previousFromCorporation = buildCorporationSnapshot(fromCorporationID);
  const previousToMember = buildCorporationMemberSnapshot(
    targetCorporation.corporationID,
    characterID,
  );
  const previousToCorporation = buildCorporationSnapshot(targetCorporation.corporationID);

  updateCorporationRuntime(fromCorporationID, (runtime) => {
    if (runtime && runtime.members) {
      delete runtime.members[String(characterID)];
    }
    return runtime;
  });

  const affiliationResult = setCharacterAffiliation(
    characterID,
    targetCorporation.corporationID,
    targetCorporation.allianceID || null,
  );
  if (!affiliationResult.success) {
    return affiliationResult;
  }

  ensureCharacterMemberState(targetCorporation.corporationID, characterID);
  syncMemberStateToCharacterRecord(targetCorporation.corporationID, characterID);
  notifyCorporationMemberChanged(
    fromCorporationID,
    characterID,
    previousFromMember,
  );
  notifyCorporationChanged(fromCorporationID, previousFromCorporation);
  notifyCorporationMemberChanged(
    targetCorporation.corporationID,
    characterID,
    previousToMember,
  );
  notifyCorporationChanged(
    targetCorporation.corporationID,
    previousToCorporation,
  );
  return { success: true };
}

function resolveVoteWeight(session, corporationID) {
  const runtime = getCorporationRuntime(corporationID) || {};
  const characterID =
    normalizePositiveInteger(session && (session.characterID || session.charid), 0) || 0;
  const callerCorporationID =
    normalizePositiveInteger(session && (session.corporationID || session.corpid), 0) || 0;
  const corporationRecord = getCorporationRecord(corporationID);
  let voteWeight = normalizeInteger(
    runtime.shares && runtime.shares[String(characterID)],
    0,
  );

  if (
    corporationRecord &&
    normalizePositiveInteger(corporationRecord.ceoID, 0) === characterID
  ) {
    voteWeight += normalizeInteger(runtime.shares && runtime.shares[String(corporationID)], 0);
  }

  if (callerCorporationID && callerCorporationID !== corporationID) {
    const callerCorporation = getCorporationRecord(callerCorporationID);
    if (
      callerCorporation &&
      normalizePositiveInteger(callerCorporation.ceoID, 0) === characterID
    ) {
      voteWeight += normalizeInteger(
        runtime.shares && runtime.shares[String(callerCorporationID)],
        0,
      );
    }
  }

  return voteWeight;
}

function chooseWinningOption(corporationID, voteCaseID) {
  const options = listVoteCaseOptions(corporationID, voteCaseID);
  if (options.length === 0) {
    return null;
  }
  return options.sort((left, right) => {
    const voteDelta = Number(right.votesFor || 0) - Number(left.votesFor || 0);
    if (voteDelta !== 0) {
      return voteDelta;
    }
    return Number(left.optionID || 0) - Number(right.optionID || 0);
  })[0];
}

function ensureLockedItemRecord(corporationID, locationID, itemID, typeID) {
  let created = false;
  updateCorporationRuntime(corporationID, (runtime) => {
    runtime.lockedItemsByLocation =
      runtime.lockedItemsByLocation &&
      typeof runtime.lockedItemsByLocation === "object"
        ? runtime.lockedItemsByLocation
        : {};
    const locationKey = String(locationID);
    const currentLocationState = runtime.lockedItemsByLocation[locationKey];
    const nextLocationState =
      currentLocationState && typeof currentLocationState === "object" && !Array.isArray(currentLocationState)
        ? currentLocationState
        : {};
    created = !Object.prototype.hasOwnProperty.call(nextLocationState, String(itemID));
    nextLocationState[String(itemID)] = {
      itemID,
      typeID,
      locationID,
      ownerID: corporationID,
    };
    runtime.lockedItemsByLocation[locationKey] = nextLocationState;
    return runtime;
  });
  if (created) {
    notifyLockedItemChange(itemID, corporationID, locationID, true);
  }
}

function removeLockedItemRecord(corporationID, locationID, itemID) {
  let removed = false;
  updateCorporationRuntime(corporationID, (runtime) => {
    runtime.lockedItemsByLocation =
      runtime.lockedItemsByLocation &&
      typeof runtime.lockedItemsByLocation === "object"
        ? runtime.lockedItemsByLocation
        : {};
    const locationKey = String(locationID);
    const currentLocationState = runtime.lockedItemsByLocation[locationKey];
    if (!currentLocationState) {
      return runtime;
    }
    if (Array.isArray(currentLocationState)) {
      const originalLength = currentLocationState.length;
      runtime.lockedItemsByLocation[locationKey] = currentLocationState.filter(
        (entry) => Number(entry && entry.itemID ? entry.itemID : entry) !== Number(itemID),
      );
      removed = runtime.lockedItemsByLocation[locationKey].length !== originalLength;
      return runtime;
    }
    removed = Object.prototype.hasOwnProperty.call(currentLocationState, String(itemID));
    delete currentLocationState[String(itemID)];
    if (Object.keys(currentLocationState).length === 0) {
      delete runtime.lockedItemsByLocation[locationKey];
    }
    return runtime;
  });
  if (removed) {
    notifyLockedItemChange(itemID, corporationID, locationID, false);
  }
}

function createVoteCase(corporationID, creatorCharacterID, voteCaseText, description, voteType, options, durationDays) {
  let createdVoteCaseID = null;
  updateVoteTable((table) => {
    const corporationState = ensureCorporationVoteState(table, corporationID);
    createdVoteCaseID = table._meta.nextVoteCaseID;
    table._meta.nextVoteCaseID += 1;
    const startDateTime = currentFileTime().toString();
    corporationState.voteCases[String(createdVoteCaseID)] = {
      voteCaseID: createdVoteCaseID,
      corporationID,
      voteType: normalizeInteger(voteType, voteGeneral),
      voteCaseText: normalizeText(voteCaseText, ""),
      description: normalizeText(description, ""),
      startDateTime,
      endDateTime: addFiletimeDays(startDateTime, durationDays),
      createdByCharacterID:
        normalizePositiveInteger(creatorCharacterID, 0) || 0,
    };
    corporationState.optionsByVoteCaseID[String(createdVoteCaseID)] = normalizeOptionRows(
      normalizeInteger(voteType, voteGeneral),
      Array.isArray(options) ? options : [],
    );
    corporationState.votesByVoteCaseID[String(createdVoteCaseID)] = {};
    return table;
  });

  // Lockdown votes lock the blueprint immediately for the duration of the vote.
  const createdVoteCase = getVoteCase(corporationID, createdVoteCaseID);
  const winningOption = chooseWinningOption(corporationID, createdVoteCaseID);
  if (
    createdVoteCase &&
    createdVoteCase.voteType === voteItemLockdown &&
    winningOption &&
    winningOption.parameter
  ) {
    ensureLockedItemRecord(
      corporationID,
      winningOption.parameter2,
      winningOption.parameter,
      winningOption.parameter1,
    );
  }

  return createdVoteCase;
}

function createOrUpdateActionState(corporationID, voteCaseID, updater) {
  updateVoteTable((table) => {
    const corporationState = ensureCorporationVoteState(table, corporationID);
    const currentState =
      corporationState.actionStatesByVoteCaseID[String(voteCaseID)] || {};
    corporationState.actionStatesByVoteCaseID[String(voteCaseID)] =
      typeof updater === "function"
        ? updater(cloneValue(currentState)) || currentState
        : currentState;
    return table;
  });
}

function applyAutomaticVoteEffects(voteCase) {
  if (!voteCase || getVoteCaseStatus(voteCase) !== VOTECASE_STATUS_CLOSED) {
    return;
  }
  const winningOption = chooseWinningOption(voteCase.corporationID, voteCase.voteCaseID);
  if (!winningOption) {
    return;
  }
  const existingVoteState = getCorporationVoteState(voteCase.corporationID);
  const existingActionState =
    (existingVoteState.actionStatesByVoteCaseID || {})[String(voteCase.voteCaseID)] || {};
  const alreadyActedUpon = normalizeInteger(existingActionState.actedUpon, 0) === 1;
  const actionStillInEffect = normalizeInteger(existingActionState.inEffect, 0) === 1;

  if (voteCase.voteType === voteCEO && winningOption.parameter) {
    if (alreadyActedUpon) {
      return;
    }
    const corporationRecord = getCorporationRecord(voteCase.corporationID);
    const previousCorporation = buildCorporationSnapshot(voteCase.corporationID);
    const previousCandidateMember = buildCorporationMemberSnapshot(
      voteCase.corporationID,
      winningOption.parameter,
    );
    const previousCurrentCeoMember = buildCorporationMemberSnapshot(
      voteCase.corporationID,
      corporationRecord && corporationRecord.ceoID,
    );
    if (
      corporationRecord &&
      normalizePositiveInteger(corporationRecord.ceoID, 0) !==
        normalizePositiveInteger(winningOption.parameter, 0)
    ) {
      updateCorporationRecord(voteCase.corporationID, {
        ceoID: normalizePositiveInteger(winningOption.parameter, corporationRecord.ceoID),
      });
      ensureCharacterMemberState(
        voteCase.corporationID,
        normalizePositiveInteger(winningOption.parameter, 0) || 0,
      );
      ensureCharacterMemberState(
        voteCase.corporationID,
        normalizePositiveInteger(corporationRecord.ceoID, 0) || 0,
      );
      syncMemberStateToCharacterRecord(
        voteCase.corporationID,
        normalizePositiveInteger(winningOption.parameter, 0) || 0,
      );
      syncMemberStateToCharacterRecord(
        voteCase.corporationID,
        normalizePositiveInteger(corporationRecord.ceoID, 0) || 0,
      );
      notifyCorporationChanged(voteCase.corporationID, previousCorporation);
      if (previousCurrentCeoMember) {
        notifyCorporationMemberChanged(
          voteCase.corporationID,
          previousCurrentCeoMember.characterID,
          previousCurrentCeoMember,
        );
      }
      notifyCorporationMemberChanged(
        voteCase.corporationID,
        normalizePositiveInteger(winningOption.parameter, 0) || 0,
        previousCandidateMember,
      );
    }
    createOrUpdateActionState(voteCase.corporationID, voteCase.voteCaseID, (actionState) => ({
      ...actionState,
      actedUpon: 1,
      inEffect: 1,
      timeActedUpon: actionState.timeActedUpon || currentFileTime().toString(),
      expires: actionState.expires || addFiletimeDays(voteCase.endDateTime, 3650),
    }));
  }

  if (voteCase.voteType === voteItemLockdown && winningOption.parameter) {
    if (alreadyActedUpon && !actionStillInEffect) {
      return;
    }
    ensureLockedItemRecord(
      voteCase.corporationID,
      winningOption.parameter2,
      winningOption.parameter,
      winningOption.parameter1,
    );
    createOrUpdateActionState(voteCase.corporationID, voteCase.voteCaseID, (actionState) => ({
      ...actionState,
      actedUpon: 1,
      inEffect: 1,
      timeActedUpon: actionState.timeActedUpon || currentFileTime().toString(),
      expires: actionState.expires || addFiletimeDays(voteCase.endDateTime, 3650),
    }));
  }
}

function buildActionState(voteCase) {
  if (!voteCase || getVoteCaseStatus(voteCase) !== VOTECASE_STATUS_CLOSED) {
    return null;
  }

  applyAutomaticVoteEffects(voteCase);

  const state = getCorporationVoteState(voteCase.corporationID);
  const winningOption = chooseWinningOption(voteCase.corporationID, voteCase.voteCaseID);
  if (!winningOption) {
    return null;
  }

  const storedState =
    state.actionStatesByVoteCaseID[String(voteCase.voteCaseID)] || {};
  return {
    voteCaseID: voteCase.voteCaseID,
    voteType: voteCase.voteType,
    optionID: normalizeInteger(
      storedState.optionID !== undefined ? storedState.optionID : winningOption.optionID,
      winningOption.optionID,
    ),
    parameter: normalizePositiveInteger(
      storedState.parameter !== undefined ? storedState.parameter : winningOption.parameter,
      0,
    ) || 0,
    parameter1: normalizePositiveInteger(
      storedState.parameter1 !== undefined ? storedState.parameter1 : winningOption.parameter1,
      0,
    ) || 0,
    parameter2: normalizePositiveInteger(
      storedState.parameter2 !== undefined ? storedState.parameter2 : winningOption.parameter2,
      0,
    ) || 0,
    expires: String(storedState.expires || addFiletimeDays(voteCase.endDateTime, 3650)),
    actedUpon: normalizeInteger(storedState.actedUpon, 0) ? 1 : 0,
    inEffect: normalizeInteger(storedState.inEffect, 0) ? 1 : 0,
    timeActedUpon: storedState.timeActedUpon ? String(storedState.timeActedUpon) : null,
    timeRescended: storedState.timeRescended ? String(storedState.timeRescended) : null,
  };
}

function listSanctionedActions(corporationID) {
  return listVoteCasesByCorporation(corporationID)
    .map((voteCase) => buildActionState(voteCase))
    .filter(Boolean)
    .sort((left, right) => Number(right.voteCaseID) - Number(left.voteCaseID));
}

function canViewVotes(corporationID, session) {
  const characterID =
    normalizePositiveInteger(session && (session.characterID || session.charid), 0) || 0;
  const corporationRecord = getCorporationRecord(corporationID);
  const member = getCorporationMember(corporationID, characterID);
  const runtime = getCorporationRuntime(corporationID) || {};
  if (
    corporationRecord &&
    normalizePositiveInteger(corporationRecord.ceoID, 0) === characterID
  ) {
    return 1;
  }
  if (member && normalizeInteger(member.roles, 0) !== 0) {
    return 1;
  }
  if (normalizeInteger(runtime.shares && runtime.shares[String(characterID)], 0) > 0) {
    return 1;
  }
  return 0;
}

function canRunForCEO(corporationID, session) {
  const characterID =
    normalizePositiveInteger(session && (session.characterID || session.charid), 0) || 0;
  const corporationRecord = getCorporationRecord(corporationID);
  if (!corporationRecord) {
    return 0;
  }
  if (normalizePositiveInteger(corporationRecord.ceoID, 0) === characterID) {
    return 0;
  }
  const runtime = getCorporationRuntime(corporationID) || {};
  return normalizeInteger(runtime.shares && runtime.shares[String(characterID)], 0) > 0
    ? 1
    : 0;
}

function castVote(corporationID, voteCaseID, session, optionID) {
  const voteCase = getVoteCase(corporationID, voteCaseID);
  if (!voteCase || getVoteCaseStatus(voteCase) !== VOTECASE_STATUS_OPEN) {
    return { success: false, errorMsg: "VOTE_CASE_NOT_OPEN" };
  }

  const characterID =
    normalizePositiveInteger(session && (session.characterID || session.charid), 0) || 0;
  if (!characterID) {
    return { success: false, errorMsg: "CHARACTER_NOT_FOUND" };
  }

  const voteWeight = resolveVoteWeight(session, corporationID);
  if (voteWeight <= 0) {
    return { success: false, errorMsg: "NO_VOTING_SHARES" };
  }

  updateVoteTable((table) => {
    const corporationState = ensureCorporationVoteState(table, corporationID);
    corporationState.votesByVoteCaseID[String(voteCaseID)] =
      corporationState.votesByVoteCaseID[String(voteCaseID)] || {};
    corporationState.votesByVoteCaseID[String(voteCaseID)][String(characterID)] = {
      voteCaseID,
      characterID,
      optionID: normalizeInteger(optionID, 0),
      castDateTime: currentFileTime().toString(),
      voteWeight,
    };
    return table;
  });
  return { success: true };
}

function activateSanctionedAction(corporationID, voteCaseID) {
  const voteCase = getVoteCase(corporationID, voteCaseID);
  if (!voteCase || getVoteCaseStatus(voteCase) !== VOTECASE_STATUS_CLOSED) {
    return { success: false, errorMsg: "VOTE_CASE_NOT_READY" };
  }
  const actionState = buildActionState(voteCase);
  if (!actionState) {
    return { success: false, errorMsg: "ACTION_NOT_FOUND" };
  }
  if (actionState.actedUpon) {
    return { success: true };
  }

  const nowFiletime = currentFileTime().toString();
  const parameter = normalizePositiveInteger(actionState.parameter, 0) || 0;

  if (voteCase.voteType === voteShares && parameter > 0) {
    const runtime = getCorporationRuntime(corporationID) || {};
    const currentCorpShares =
      normalizeInteger(runtime.shares && runtime.shares[String(corporationID)], 0) || 0;
    const corporationRecord = getCorporationRecord(corporationID);
    const previousCorporation = buildCorporationSnapshot(corporationID);
    updateCorporationRuntime(corporationID, (nextRuntime) => {
      nextRuntime.shares[String(corporationID)] = currentCorpShares + parameter;
      return nextRuntime;
    });
    if (corporationRecord) {
      updateCorporationRecord(corporationID, {
        shares: normalizeInteger(corporationRecord.shares, 0) + parameter,
      });
    }
    notifyCorporationChanged(corporationID, previousCorporation);
  } else if (voteCase.voteType === voteKickMember && parameter > 0) {
    moveCharacterToCorporation(
      parameter,
      corporationID,
      resolveFallbackCorporationID(parameter),
    );
  } else if (voteCase.voteType === voteItemUnlock && parameter > 0) {
    removeLockedItemRecord(corporationID, actionState.parameter2, parameter);
  } else if (voteCase.voteType === voteWar && parameter > 0) {
    createWarRecord({
      declaredByID: corporationID,
      againstID: parameter,
      mutual: false,
    });
  }

  createOrUpdateActionState(corporationID, voteCaseID, (storedState) => ({
    ...storedState,
    optionID: actionState.optionID,
    parameter: actionState.parameter,
    parameter1: actionState.parameter1,
    parameter2: actionState.parameter2,
    actedUpon: 1,
    inEffect: 1,
    timeActedUpon: nowFiletime,
    expires: storedState.expires || addFiletimeDays(voteCase.endDateTime, 3650),
  }));

  if (voteCase.voteType === voteItemUnlock && parameter > 0) {
    const allVoteCases = listVoteCasesByCorporation(corporationID);
    for (const otherVoteCase of allVoteCases) {
      if (otherVoteCase.voteType !== voteItemLockdown) {
        continue;
      }
      const otherAction = buildActionState(otherVoteCase);
      if (
        otherAction &&
        normalizePositiveInteger(otherAction.parameter, 0) === parameter &&
        normalizeInteger(otherAction.inEffect, 0) === 1
      ) {
        createOrUpdateActionState(corporationID, otherVoteCase.voteCaseID, (storedState) => ({
          ...storedState,
          actedUpon: 1,
          inEffect: 0,
          timeRescended: nowFiletime,
          expires: nowFiletime,
        }));
        removeLockedItemRecord(
          corporationID,
          normalizePositiveInteger(otherAction.parameter2, 0) || actionState.parameter2,
          parameter,
        );
      }
    }
  }

  return { success: true };
}

function buildVoteCaseAndOptionsForItem(corporationID, itemID) {
  const numericItemID = normalizePositiveInteger(itemID, 0) || 0;
  if (!numericItemID) {
    return null;
  }
  const item = findItemById(numericItemID);
  if (!item) {
    return null;
  }
  return {
    itemID: numericItemID,
    typeID: normalizePositiveInteger(item.typeID, 0) || 0,
    locationID: normalizePositiveInteger(item.locationID, 0) || 0,
  };
}

module.exports = {
  VOTES_TABLE,
  VOTECASE_STATUS_ALL,
  VOTECASE_STATUS_CLOSED,
  VOTECASE_STATUS_OPEN,
  voteCEO,
  voteWar,
  voteShares,
  voteKickMember,
  voteGeneral,
  voteItemLockdown,
  voteItemUnlock,
  buildActionState,
  buildVoteCaseAndOptionsForItem,
  canRunForCEO,
  canViewVotes,
  castVote,
  createVoteCase,
  getVoteCase,
  getVoteCaseStatus,
  listSanctionedActions,
  listVoteCaseOptions,
  listVoteCasesByCorporation,
  listVotesByVoteCase,
  activateSanctionedAction,
  updateVoteCase,
};
