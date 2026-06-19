const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const signatureRuntime = require(path.join(
  __dirname,
  "../exploration/signatures/signatureRuntime",
));
const {
  buildDict,
  buildKeyVal,
  buildList,
} = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildDungeonInstanceEntry(site) {
  return buildKeyVal([
    ["instanceID", Math.max(0, toInt(site && site.instanceID, 0))],
    ["signatureID", Math.max(0, toInt(site && site.siteID, 0))],
    ["dungeonID", Math.max(0, toInt(site && site.dungeonID, 0))],
    ["dungeonNameID", Math.max(0, toInt(site && site.dungeonNameID, 0)) || null],
    ["archetypeID", Math.max(0, toInt(site && site.archetypeID, 0)) || null],
    ["factionID", Math.max(0, toInt(site && site.factionID, 0)) || null],
    ["entryObjectTypeID", Math.max(0, toInt(site && site.entryObjectTypeID, 0)) || null],
    ["scanStrengthAttribute", Math.max(0, toInt(site && site.scanStrengthAttribute, 0)) || null],
    ["scanStrengthValue", Math.max(1, toFiniteNumber(site && site.scanStrengthValue, 10))],
    ["signatureRadius", Math.max(1, toFiniteNumber(site && site.signatureRadius, 100))],
    ["isScannable", true],
    ["solarSystemID", Math.max(0, toInt(site && site.solarSystemID, 0))],
    ["siteKind", String(site && site.siteKind || "").trim().toLowerCase() || "unknown"],
    ["family", String(site && site.family || "").trim().toLowerCase() || "unknown"],
    ["siteKey", String(site && site.siteKey || "").trim() || null],
    ["templateID", String(site && site.templateID || "").trim() || null],
    ["allowedTypes", Array.isArray(site && site.allowedTypes) ? site.allowedTypes : []],
  ]);
}

function listRuntimeDungeonSitesForSystem(systemID) {
  const numericSystemID = Math.max(0, toInt(systemID, 0));
  if (numericSystemID <= 0) {
    return [];
  }

  return [
    ...signatureRuntime.listSystemAnomalySites(numericSystemID),
    ...signatureRuntime.listSystemSignatureSites(numericSystemID),
  ]
    .filter((site) => (
      Math.max(0, toInt(site && site.instanceID, 0)) > 0 &&
      Math.max(0, toInt(site && site.dungeonID, 0)) > 0 &&
      String(site && site.family || "").trim().toLowerCase() !== "wormhole"
    ))
    .sort((left, right) => (
      Math.max(0, toInt(left && left.instanceID, 0)) -
      Math.max(0, toInt(right && right.instanceID, 0))
    ));
}

class DungeonExplorationMgrService extends BaseService {
  constructor() {
    super("dungeonExplorationMgr");
  }

  buildEscalatingPathDetails() {
    log.debug("[DungeonExplorationMgr] GetMyEscalatingPathDetails");
    return buildList([]);
  }

  Handle_GetMyEscalatingPathDetails() {
    return this.buildEscalatingPathDetails();
  }

  GetMyEscalatingPathDetails() {
    return this.buildEscalatingPathDetails();
  }

  buildInstancesForSolarSystem(systemID) {
    const numericSystemID = Math.max(0, toInt(systemID, 0));
    log.debug("[DungeonExplorationMgr] GetInstancesForSolarsystem", {
      solarSystemID: numericSystemID,
    });
    return buildDict(
      listRuntimeDungeonSitesForSystem(numericSystemID).map((site) => [
        String(Math.max(0, toInt(site && site.instanceID, 0))),
        buildDungeonInstanceEntry(site),
      ]),
    );
  }

  Handle_GetInstancesForSolarsystem(args = []) {
    return this.buildInstancesForSolarSystem(Array.isArray(args) ? args[0] : 0);
  }

  GetInstancesForSolarsystem(systemID) {
    return this.buildInstancesForSolarSystem(systemID);
  }
}

module.exports = DungeonExplorationMgrService;
