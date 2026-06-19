const path = require("path");

const database = require(path.join(__dirname, "../../../newDatabase"));
const {
  buildFiletimeString,
  cloneValue,
} = require("./skillTrainingMath");

const SKILL_QUEUE_TABLE = "skillQueues";

let queueMutationVersion = 1;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function readQueueTable() {
  const result = database.read(SKILL_QUEUE_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function writeQueueTable(table) {
  const result = database.write(SKILL_QUEUE_TABLE, "/", table);
  if (result && result.success) {
    queueMutationVersion += 1;
  }
  return result;
}

function normalizeQueueEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const typeID = toInt(entry.typeID ?? entry.trainingTypeID, 0);
  const toLevel = toInt(entry.toLevel ?? entry.trainingToLevel, 0);
  if (typeID <= 0 || toLevel <= 0) {
    return null;
  }

  return {
    typeID,
    toLevel,
  };
}

function normalizeQueueState(rawState = {}) {
  const queueEntries = Array.isArray(rawState.queue)
    ? rawState.queue
    : Array.isArray(rawState.entries)
      ? rawState.entries
      : [];

  return {
    queue: queueEntries.map(normalizeQueueEntry).filter(Boolean),
    active: Boolean(rawState.active),
    activeStartTime:
      rawState.activeStartTime !== undefined && rawState.activeStartTime !== null
        ? String(rawState.activeStartTime)
        : null,
    updatedAt: buildFiletimeString(rawState.updatedAt),
  };
}

function getCharacterQueueState(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return normalizeQueueState({});
  }

  const table = readQueueTable();
  return cloneValue(normalizeQueueState(table[String(numericCharacterID)]));
}

function setCharacterQueueState(characterID, nextState) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_CHARACTER",
    };
  }

  const table = readQueueTable();
  table[String(numericCharacterID)] = normalizeQueueState({
    ...nextState,
    updatedAt: buildFiletimeString(nextState && nextState.updatedAt),
  });
  return writeQueueTable(table);
}

function clearCharacterQueueState(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_CHARACTER",
    };
  }

  const table = readQueueTable();
  const characterKey = String(numericCharacterID);
  if (!Object.prototype.hasOwnProperty.call(table, characterKey)) {
    return {
      success: true,
      removed: false,
    };
  }

  delete table[characterKey];
  const writeResult = writeQueueTable(table);
  return {
    ...(writeResult || { success: false, errorMsg: "WRITE_ERROR" }),
    removed: Boolean(writeResult && writeResult.success),
  };
}

function getQueueMutationVersion() {
  return queueMutationVersion;
}

function getAllQueueStates() {
  return cloneValue(readQueueTable());
}

module.exports = {
  SKILL_QUEUE_TABLE,
  clearCharacterQueueState,
  getAllQueueStates,
  getCharacterQueueState,
  getQueueMutationVersion,
  setCharacterQueueState,
};
