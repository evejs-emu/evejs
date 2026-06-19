const path = require("path");

const logger = require(path.join(__dirname, "../../utils/logger"));
const rotatingLog = require(path.join(__dirname, "../../utils/rotatingLog"));

const LOG_DIR = path.join(__dirname, "../../../logs");
const UPWELL_LOG_PATH = path.join(LOG_DIR, "upwell.log");

function appendUpwellLog(level, message) {
  try {
    rotatingLog.append(UPWELL_LOG_PATH, `[${new Date().toISOString()}] [${String(level || "LOG").toUpperCase()}] ${String(message || "").trim()}\n`);
  } catch (error) {
    logger.warn(`[UpwellLog] Failed to write upwell.log: ${error.message}`);
  }
}

function normalizeSessionContext(session) {
  if (!session || typeof session !== "object") {
    return "user=? char=?";
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
  appendUpwellLog("INF", normalized);
  logger.writeServerLog("UPW", normalized);
}

function warn(message) {
  const normalized = String(message || "").trim();
  appendUpwellLog("WRN", normalized);
  logger.writeServerLog("UPW", normalized);
}

function error(message) {
  const normalized = String(message || "").trim();
  appendUpwellLog("ERR", normalized);
  logger.writeServerLog("UPW", normalized);
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
  const structureID = job && job.structureID ? job.structureID : "?";
  const prefix = `job=${jobID} mode=${mode} structure=${structureID}`;
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
  UPWELL_LOG_PATH,
  info,
  warn,
  error,
  logCommand,
  logAutomationEvent,
};
