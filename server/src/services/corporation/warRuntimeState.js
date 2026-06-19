const path = require("path");

const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  cloneValue,
  ensureRuntimeInitialized,
  normalizeBoolean,
  normalizePositiveInteger,
  updateRuntimeState,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  notifyWarChanged,
} = require(path.join(__dirname, "./corporationNotifications"));

const FILETIME_TICKS_PER_HOUR = 36000000000n;
const WAR_SPOOLUP = 24n * FILETIME_TICKS_PER_HOUR;
let warIndexesDirty = true;
let warIndexesCache = null;

function appendWarIndexEntry(indexMap, key, war) {
  if (!key) {
    return;
  }
  if (!indexMap.has(key)) {
    indexMap.set(key, []);
  }
  indexMap.get(key).push(war);
}

function markWarIndexesDirty() {
  warIndexesDirty = true;
  warIndexesCache = null;
}

function ensureWarIndexes() {
  if (!warIndexesDirty && warIndexesCache) {
    return warIndexesCache;
  }

  const runtimeTable = ensureRuntimeInitialized();
  const warsAsc = Object.values(runtimeTable.wars || {})
    .map((war) => cloneValue(war))
    .sort((left, right) => Number(left.warID) - Number(right.warID));
  const warsDesc = warsAsc.slice().sort((left, right) => Number(right.warID) - Number(left.warID));
  const byOwner = new Map();
  const byStructure = new Map();

  for (const war of warsAsc) {
    appendWarIndexEntry(byOwner, normalizePositiveInteger(war && war.declaredByID, null), war);
    appendWarIndexEntry(byOwner, normalizePositiveInteger(war && war.againstID, null), war);
    appendWarIndexEntry(byStructure, normalizePositiveInteger(war && war.warHQID, null), war);
    for (const allyID of Object.keys((war && war.allies) || {})) {
      appendWarIndexEntry(byOwner, normalizePositiveInteger(allyID, null), war);
    }
  }

  warIndexesCache = {
    warsAsc,
    warsDesc,
    byOwner,
    byStructure,
  };
  warIndexesDirty = false;
  return warIndexesCache;
}

function getWarRecord(warID) {
  const runtimeTable = ensureRuntimeInitialized();
  const record = runtimeTable.wars && runtimeTable.wars[String(warID)];
  return record ? cloneValue(record) : null;
}

function listAllWars() {
  return cloneValue(ensureWarIndexes().warsAsc);
}

function listAllWarsDescending() {
  return cloneValue(ensureWarIndexes().warsDesc);
}

function listWarsForOwner(ownerID) {
  const numericOwnerID = normalizePositiveInteger(ownerID, null);
  if (!numericOwnerID) {
    return [];
  }
  return cloneValue(ensureWarIndexes().byOwner.get(numericOwnerID) || []);
}

function listWarsForStructure(structureID) {
  const numericStructureID = normalizePositiveInteger(structureID, null);
  if (!numericStructureID) {
    return [];
  }
  return cloneValue(ensureWarIndexes().byStructure.get(numericStructureID) || []);
}

function createWarRecord({
  declaredByID,
  againstID,
  warHQ = null,
  mutual = false,
  reward = 0,
  createdFromWarID = null,
  billID = null,
  openForAllies = false,
  timeDeclared = null,
  timeStarted = null,
  timeFinished = null,
} = {}) {
  const attackerID = normalizePositiveInteger(declaredByID, null);
  const defenderID = normalizePositiveInteger(againstID, null);
  if (!attackerID || !defenderID || attackerID === defenderID) {
    return null;
  }

  let nextWarID = null;
  const writeResult = updateRuntimeState((runtimeTable) => {
    nextWarID = normalizePositiveInteger(runtimeTable._meta.nextWarID, 1) || 1;
    runtimeTable._meta.nextWarID = nextWarID + 1;
    const declaredAt = timeDeclared ? BigInt(String(timeDeclared)) : currentFileTime();
    const startedAt =
      timeStarted !== null && timeStarted !== undefined
        ? BigInt(String(timeStarted))
        : normalizeBoolean(mutual, false)
          ? declaredAt
          : declaredAt + WAR_SPOOLUP;
    runtimeTable.wars[String(nextWarID)] = {
      warID: nextWarID,
      declaredByID: attackerID,
      againstID: defenderID,
      warHQID: normalizePositiveInteger(warHQ, null),
      timeDeclared: declaredAt.toString(),
      timeStarted: startedAt.toString(),
      timeFinished:
        timeFinished !== null && timeFinished !== undefined
          ? String(timeFinished)
          : null,
      retracted: null,
      retractedBy: null,
      billID: normalizePositiveInteger(billID, null),
      mutual: normalizeBoolean(mutual, false) ? 1 : 0,
      openForAllies: normalizeBoolean(openForAllies, false) ? 1 : 0,
      allies: {},
      createdFromWarID: normalizePositiveInteger(createdFromWarID, null),
      reward: Number(reward || 0),
    };
    return runtimeTable;
  });
  if (writeResult && writeResult.success) {
    markWarIndexesDirty();
  }
  const nextRecord = getWarRecord(nextWarID);
  if (nextRecord) {
    notifyWarChanged(null, cloneValue(nextRecord));
  }
  return nextRecord;
}

function updateWarRecord(warID, updater) {
  const numericWarID = normalizePositiveInteger(warID, null);
  if (!numericWarID) {
    return null;
  }
  const previousRecord = getWarRecord(numericWarID);
  const writeResult = updateRuntimeState((runtimeTable) => {
    const currentRecord = runtimeTable.wars && runtimeTable.wars[String(numericWarID)];
    if (!currentRecord) {
      return runtimeTable;
    }
    const nextRecord =
      typeof updater === "function"
        ? updater(cloneValue(currentRecord)) || currentRecord
        : currentRecord;
    runtimeTable.wars[String(numericWarID)] = nextRecord;
    return runtimeTable;
  });
  if (writeResult && writeResult.success) {
    markWarIndexesDirty();
  }
  const nextRecord = getWarRecord(numericWarID);
  if (previousRecord || nextRecord) {
    notifyWarChanged(cloneValue(previousRecord), cloneValue(nextRecord));
  }
  return nextRecord;
}

module.exports = {
  createWarRecord,
  getWarRecord,
  listAllWars,
  listAllWarsDescending,
  listWarsForStructure,
  listWarsForOwner,
  updateWarRecord,
};
