const path = require("path");

const database = require(path.join(__dirname, "../../../newDatabase"));
const {
  currentFileTime,
  normalizeBigInt,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));

const SKILL_TRADING_STATE_TABLE = "skillTradingState";

const stateCache = new Map();
let stateMutationVersion = 1;

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeTradingState(state = {}) {
  const normalized = state && typeof state === "object" ? { ...state } : {};
  return {
    nextAlphaInjectionAt: normalizeBigInt(
      normalized.nextAlphaInjectionAt,
      0n,
    ).toString(),
    nonDiminishingInjectionsRemaining: Math.max(
      0,
      toInt(normalized.nonDiminishingInjectionsRemaining, 0),
    ),
    updatedAt: normalizeBigInt(normalized.updatedAt, currentFileTime()).toString(),
  };
}

function readStateTable() {
  const result = database.read(SKILL_TRADING_STATE_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function writeStateTable(nextTable) {
  const writeResult = database.write(SKILL_TRADING_STATE_TABLE, "/", nextTable);
  if (writeResult && writeResult.success) {
    stateCache.clear();
    stateMutationVersion += 1;
  }
  return writeResult;
}

function getSkillTradingStateMutationVersion() {
  return stateMutationVersion;
}

function getCharacterSkillTradingState(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return normalizeTradingState({});
  }

  if (stateCache.has(numericCharacterID)) {
    return cloneValue(stateCache.get(numericCharacterID));
  }

  const table = readStateTable();
  const normalized = normalizeTradingState(table[String(numericCharacterID)] || {});
  stateCache.set(numericCharacterID, cloneValue(normalized));
  return normalized;
}

function updateCharacterSkillTradingState(characterID, updater) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const table = readStateTable();
  const currentState = normalizeTradingState(table[String(numericCharacterID)] || {});
  const nextValue =
    typeof updater === "function" ? updater(cloneValue(currentState)) : updater;
  const normalized = normalizeTradingState({
    ...(nextValue && typeof nextValue === "object" ? nextValue : {}),
    updatedAt: currentFileTime().toString(),
  });

  table[String(numericCharacterID)] = normalized;
  const writeResult = writeStateTable(table);
  if (!writeResult || !writeResult.success) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: cloneValue(normalized),
  };
}

function clearCharacterSkillTradingState(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const table = readStateTable();
  const characterKey = String(numericCharacterID);
  stateCache.delete(numericCharacterID);

  if (!Object.prototype.hasOwnProperty.call(table, characterKey)) {
    return {
      success: true,
      removed: false,
    };
  }

  delete table[characterKey];
  const writeResult = writeStateTable(table);
  return {
    ...(writeResult || { success: false, errorMsg: "WRITE_ERROR" }),
    removed: Boolean(writeResult && writeResult.success),
  };
}

module.exports = {
  SKILL_TRADING_STATE_TABLE,
  clearCharacterSkillTradingState,
  getCharacterSkillTradingState,
  getSkillTradingStateMutationVersion,
  updateCharacterSkillTradingState,
};
