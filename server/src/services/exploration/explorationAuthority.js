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

function normalizeMapByTypeID(mapLike = {}) {
  return Object.fromEntries(
    Object.entries(mapLike || {})
      .map(([typeID, definition]) => [String(toInt(typeID, 0)), definition])
      .filter(([typeID]) => Number(typeID) > 0),
  );
}

function normalizePayload(payload = {}) {
  return {
    version: toInt(payload.version, 0),
    generatedAt: String(payload.generatedAt || "").trim(),
    source: payload && typeof payload.source === "object" ? payload.source : {},
    counts: payload && typeof payload.counts === "object" ? payload.counts : {},
    meta: payload && typeof payload.meta === "object" ? payload.meta : {},
    scanContracts:
      payload && typeof payload.scanContracts === "object" ? payload.scanContracts : {},
    probeDefinitionsByTypeID: normalizeMapByTypeID(payload.probeDefinitionsByTypeID),
    probeLauncherDefinitionsByTypeID: normalizeMapByTypeID(payload.probeLauncherDefinitionsByTypeID),
    probeChargeDefinitionsByTypeID: normalizeMapByTypeID(payload.probeChargeDefinitionsByTypeID),
    probeLauncherChargeCompatibility:
      payload && typeof payload.probeLauncherChargeCompatibility === "object"
        ? payload.probeLauncherChargeCompatibility
        : {},
    probeLauncherDogmaProfilesByTypeID:
      payload && typeof payload.probeLauncherDogmaProfilesByTypeID === "object"
        ? payload.probeLauncherDogmaProfilesByTypeID
        : {},
    probeFormations:
      payload && typeof payload.probeFormations === "object" ? payload.probeFormations : {},
    probeScanGroups:
      payload && typeof payload.probeScanGroups === "object" ? payload.probeScanGroups : {},
    scanStrengthAttributes:
      payload && typeof payload.scanStrengthAttributes === "object"
        ? payload.scanStrengthAttributes
        : {},
    signatureTypeDefinitions:
      payload && typeof payload.signatureTypeDefinitions === "object"
        ? payload.signatureTypeDefinitions
        : {},
    wormholeAuthority:
      payload && typeof payload.wormholeAuthority === "object" ? payload.wormholeAuthority : {},
    gmAliases: payload && typeof payload.gmAliases === "object" ? payload.gmAliases : {},
  };
}

function ensureCache() {
  if (!cache) {
    cache = normalizePayload(readStaticTable(TABLE.EXPLORATION_AUTHORITY));
  }
  return cache;
}

function clearCache() {
  cache = null;
}

function getPayload() {
  return ensureCache();
}

function getScanContracts() {
  return ensureCache().scanContracts || {};
}

function getScanStrengthAttribute(name) {
  const normalizedName = String(name || "").trim().toLowerCase();
  const value = ensureCache().scanStrengthAttributes[normalizedName];
  return toInt(value, 0);
}

function getSignatureTypeDefinition(name) {
  const normalizedName = String(name || "").trim().toLowerCase();
  return ensureCache().signatureTypeDefinitions[normalizedName] || null;
}

function getProbeDefinition(typeID) {
  return ensureCache().probeDefinitionsByTypeID[String(toInt(typeID, 0))] || null;
}

function getProbeChargeDefinition(typeID) {
  return ensureCache().probeChargeDefinitionsByTypeID[String(toInt(typeID, 0))] || null;
}

function getProbeLauncherDefinition(typeID) {
  return ensureCache().probeLauncherDefinitionsByTypeID[String(toInt(typeID, 0))] || null;
}

function getProbeLauncherDogmaProfile(typeID) {
  return ensureCache().probeLauncherDogmaProfilesByTypeID[String(toInt(typeID, 0))] || null;
}

function getCompatibleProbeChargeTypeIDs(typeID) {
  const compatible = ensureCache().probeLauncherChargeCompatibility[String(toInt(typeID, 0))];
  return Array.isArray(compatible) ? [...compatible] : [];
}

function getWormholeAuthorityPayload() {
  return ensureCache().wormholeAuthority || {};
}

module.exports = {
  clearCache,
  getCompatibleProbeChargeTypeIDs,
  getPayload,
  getProbeChargeDefinition,
  getProbeDefinition,
  getProbeLauncherDefinition,
  getProbeLauncherDogmaProfile,
  getScanContracts,
  getScanStrengthAttribute,
  getSignatureTypeDefinition,
  getWormholeAuthorityPayload,
};
