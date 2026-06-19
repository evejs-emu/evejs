const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));

let cache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizePayload(payload = {}) {
  return {
    version: toInt(payload.version, 0),
    generatedAt: String(payload.generatedAt || "").trim(),
    source: normalizeObject(payload.source),
    counts: normalizeObject(payload.counts),
    missionPoolsByKindAndLevel: normalizeObject(payload.missionPoolsByKindAndLevel),
    agentsByID: normalizeObject(payload.agentsByID),
    indexes: normalizeObject(payload.indexes),
  };
}

function buildCache() {
  const payload = normalizePayload(readStaticTable(TABLE.AGENT_AUTHORITY));
  const agentsByID = new Map();
  for (const [agentID, record] of Object.entries(payload.agentsByID || {})) {
    agentsByID.set(toInt(agentID, 0), {
      ...clone(record),
      agentID: toInt(record && record.agentID, toInt(agentID, 0)),
    });
  }

  return {
    payload,
    agentsByID,
  };
}

function ensureCache() {
  if (!cache) {
    cache = buildCache();
  }
  return cache;
}

function clearCache() {
  cache = null;
}

function getPayload() {
  return clone(ensureCache().payload);
}

function getAgentByID(agentID) {
  const record = ensureCache().agentsByID.get(toInt(agentID, 0));
  return record ? clone(record) : null;
}

function listAgents() {
  return [...ensureCache().agentsByID.values()]
    .map((record) => clone(record))
    .sort((left, right) => left.agentID - right.agentID);
}

function listAgentIDsByIndex(indexName, key) {
  const payload = ensureCache().payload;
  const index = payload.indexes && payload.indexes[indexName];
  if (!index || typeof index !== "object") {
    return [];
  }
  return Array.isArray(index[String(key)]) ? clone(index[String(key)]) : [];
}

function listAgentsByStationID(stationID) {
  return listAgentIDsByIndex("stationIDToAgentIDs", stationID)
    .map((agentID) => getAgentByID(agentID))
    .filter(Boolean);
}

function listAgentsByCorporationID(corporationID) {
  return listAgentIDsByIndex("corporationIDToAgentIDs", corporationID)
    .map((agentID) => getAgentByID(agentID))
    .filter(Boolean);
}

function listAgentsByFactionID(factionID) {
  return listAgentIDsByIndex("factionIDToAgentIDs", factionID)
    .map((agentID) => getAgentByID(agentID))
    .filter(Boolean);
}

function listAgentsBySolarSystemID(solarSystemID) {
  return listAgentIDsByIndex("solarSystemIDToAgentIDs", solarSystemID)
    .map((agentID) => getAgentByID(agentID))
    .filter(Boolean);
}

function listMissionTemplateIDsForAgent(agentID) {
  const agent = getAgentByID(agentID);
  return Array.isArray(agent && agent.missionTemplateIDs)
    ? clone(agent.missionTemplateIDs)
    : [];
}

function getMissionPoolForAgent(agentID) {
  const agent = getAgentByID(agentID);
  if (!agent) {
    return [];
  }
  return listMissionTemplateIDsForAgent(agentID);
}

module.exports = {
  clearCache,
  getAgentByID,
  getMissionPoolForAgent,
  getPayload,
  listAgents,
  listAgentsByCorporationID,
  listAgentsByFactionID,
  listAgentsBySolarSystemID,
  listAgentsByStationID,
  listMissionTemplateIDsForAgent,
};
