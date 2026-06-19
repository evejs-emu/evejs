const path = require("path");

const logger = require(path.join(__dirname, "../../utils/logger"));
const rotatingLog = require(path.join(__dirname, "../../utils/rotatingLog"));

const LOG_DIR = path.join(__dirname, "../../../logs");
const SOV_LOG_PATH = path.join(LOG_DIR, "sovereignty.log");

function appendSovLog(level, message) {
  try {
    rotatingLog.append(SOV_LOG_PATH, `[${new Date().toISOString()}] [${String(level || "LOG").toUpperCase()}] ${String(message || "").trim()}\n`);
  } catch (error) {
    logger.warn(`[SovLog] Failed to write sovereignty.log: ${error.message}`);
  }
}

function normalizeSessionContext(session) {
  if (!session || typeof session !== "object") {
    return "user=? char=? system=?";
  }
  const userID = session.userid || session.userID || "?";
  const characterID = session.characterID || session.charid || "?";
  const solarSystemID =
    (session._space && session._space.systemID) ||
    session.solarsystemid2 ||
    session.solarsystemid ||
    "?";
  return `user=${userID} char=${characterID} system=${solarSystemID}`;
}

function info(message) {
  const normalized = String(message || "").trim();
  appendSovLog("INF", normalized);
  logger.writeServerLog("SOV", normalized);
}

function warn(message) {
  const normalized = String(message || "").trim();
  appendSovLog("WRN", normalized);
  logger.writeServerLog("SOV", normalized);
}

function error(message) {
  const normalized = String(message || "").trim();
  appendSovLog("ERR", normalized);
  logger.writeServerLog("SOV", normalized);
}

function logCommand(session, commandText, result) {
  const normalizedCommand = String(commandText || "").trim();
  const status = result && result.success === false ? "FAIL" : "OK";
  const normalizedMessage = result && result.message
    ? String(result.message).replace(/\s+/g, " ").trim()
    : "";
  info(
    `${normalizeSessionContext(session)} command=${JSON.stringify(normalizedCommand)} status=${status}${normalizedMessage ? ` message=${JSON.stringify(normalizedMessage)}` : ""}`,
  );
}

function logAutomationEvent(job, message, level = "INF") {
  const jobID = job && job.jobID ? job.jobID : "?";
  const mode = job && job.mode ? job.mode : "?";
  const solarSystemID = job && job.solarSystemID ? job.solarSystemID : "?";
  const prefix = `job=${jobID} mode=${mode} system=${solarSystemID}`;
  if (String(level || "").toUpperCase() === "WRN") {
    warn(`${prefix} ${message}`);
    return;
  }
  if (String(level || "").toUpperCase() === "ERR") {
    error(`${prefix} ${message}`);
    return;
  }
  info(`${prefix} ${message}`);
}

module.exports = {
  SOV_LOG_PATH,
  info,
  warn,
  error,
  logCommand,
  logAutomationEvent,
};
