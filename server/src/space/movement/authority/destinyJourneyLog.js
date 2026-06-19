const path = require("path");

const log = require(path.join(__dirname, "../../../utils/logger"));
const rotatingLog = require(path.join(__dirname, "../../../utils/rotatingLog"));

const DESTINY_JOURNEY_LOG_PATH = path.join(
  __dirname,
  "../../../../logs/space-destiny-journey.log",
);
const DESTINY_RESTAMP_LOG_PATH = path.join(
  __dirname,
  "../../../../logs/space-destiny-restamp.log",
);
const DESTINY_ENGINE_LOG_PATH = path.join(
  __dirname,
  "../../../../logs/space-destiny-engine.log",
);
const DESTINY_DROP_LOG_PATH = path.join(
  __dirname,
  "../../../../logs/space-destiny-drop.log",
);
const MICHELLE_CONTRACT_LOG_PATH = path.join(
  __dirname,
  "../../../../logs/space-michelle-contract.log",
);

function fallbackRoundNumber(value, digits = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  return Number(numeric.toFixed(digits));
}

function fallbackNormalizeTraceValue(value, depth = 0) {
  if (depth >= 8) {
    return "[depth-limit]";
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? fallbackRoundNumber(value, Number.isInteger(value) ? 0 : 6)
      : String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => fallbackNormalizeTraceValue(entry, depth + 1));
  }
  if (value instanceof Map) {
    return fallbackNormalizeTraceValue([...value.entries()], depth + 1);
  }
  if (value instanceof Set) {
    return fallbackNormalizeTraceValue([...value.values()], depth + 1);
  }
  if (typeof value === "object") {
    const normalized = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "function") {
        continue;
      }
      normalized[key] = fallbackNormalizeTraceValue(entry, depth + 1);
    }
    return normalized;
  }
  return String(value);
}

function appendDestinyJourneyLog(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(DESTINY_JOURNEY_LOG_PATH, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[DestinyJourneyLog] Failed to write journey log: ${error.message}`);
  }
}

function appendNamedDebugLog(targetPath, prefix, entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(targetPath, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[${prefix}] Failed to write debug log: ${error.message}`);
  }
}

function buildStructuredLogRecord(event, details = {}) {
  return {
    event,
    recordedAtIso: new Date().toISOString(),
    recordedAtMs: Date.now(),
    ...details,
  };
}

function createDestinyJourneyLog(deps = {}) {
  const normalizeTraceValue =
    typeof deps.normalizeTraceValue === "function"
      ? deps.normalizeTraceValue
      : fallbackNormalizeTraceValue;

  let nextJourneyID = 1;

  function allocateJourneyID(prefix = "journey") {
    const id = `${String(prefix || "journey").trim() || "journey"}:${nextJourneyID}`;
    nextJourneyID += 1;
    return id;
  }

  function logJourney(event, details = {}) {
    appendDestinyJourneyLog(JSON.stringify(normalizeTraceValue(
      buildStructuredLogRecord(event, details),
    )));
  }

  function logRestamp(event, details = {}) {
    appendNamedDebugLog(
      DESTINY_RESTAMP_LOG_PATH,
      "DestinyRestampLog",
      JSON.stringify(normalizeTraceValue(
        buildStructuredLogRecord(event, details),
      )),
    );
  }

  function logEngine(event, details = {}) {
    appendNamedDebugLog(
      DESTINY_ENGINE_LOG_PATH,
      "DestinyEngineLog",
      JSON.stringify(normalizeTraceValue(
        buildStructuredLogRecord(event, details),
      )),
    );
  }

  function logDrop(event, details = {}) {
    appendNamedDebugLog(
      DESTINY_DROP_LOG_PATH,
      "DestinyDropLog",
      JSON.stringify(normalizeTraceValue(
        buildStructuredLogRecord(event, details),
      )),
    );
  }

  function logMichelle(event, details = {}) {
    appendNamedDebugLog(
      MICHELLE_CONTRACT_LOG_PATH,
      "MichelleContractLog",
      JSON.stringify(normalizeTraceValue(
        buildStructuredLogRecord(event, details),
      )),
    );
  }

  return {
    DESTINY_JOURNEY_LOG_PATH,
    DESTINY_RESTAMP_LOG_PATH,
    DESTINY_ENGINE_LOG_PATH,
    DESTINY_DROP_LOG_PATH,
    MICHELLE_CONTRACT_LOG_PATH,
    allocateJourneyID,
    logJourney,
    logRestamp,
    logEngine,
    logDrop,
    logMichelle,
  };
}

module.exports = {
  DESTINY_JOURNEY_LOG_PATH,
  DESTINY_RESTAMP_LOG_PATH,
  DESTINY_ENGINE_LOG_PATH,
  DESTINY_DROP_LOG_PATH,
  MICHELLE_CONTRACT_LOG_PATH,
  createDestinyJourneyLog,
};
