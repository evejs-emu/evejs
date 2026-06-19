const path = require("path");
const explorationAuthority = require(path.join(
  __dirname,
  "../../explorationAuthority",
));
const dungeonSiteAdapter = require(path.join(
  __dirname,
  "../../../dungeon/dungeonSiteAdapter",
));
const { resolveScene } = require(path.join(
  __dirname,
  "./sceneProviderRuntime",
));
const targetIdRuntime = require(path.join(
  __dirname,
  "../targetIdRuntime",
));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(vector = null) {
  return {
    x: toFiniteNumber(vector && vector.x, 0),
    y: toFiniteNumber(vector && vector.y, 0),
    z: toFiniteNumber(vector && vector.z, 0),
  };
}

function getScene(systemID, options = {}) {
  return resolveScene(systemID, options);
}

function listGeneratedMiningAnchorEntities(scene) {
  return (Array.isArray(scene && scene.staticEntities) ? scene.staticEntities : [])
    .filter((entity) => (
      entity &&
      entity.generatedMiningSiteAnchor === true &&
      toInt(entity.itemID, 0) > 0
    ))
    .sort((left, right) => toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0));
}

function listGeneratedMiningSiteChildEntities(scene, siteIndex, family) {
  const normalizedSiteIndex = toInt(siteIndex, -1);
  const normalizedFamily = String(family || "").trim().toLowerCase();
  return (Array.isArray(scene && scene.staticEntities) ? scene.staticEntities : [])
    .filter((entity) => (
      entity &&
      entity.generatedMiningSite === true &&
      entity.generatedMiningSiteAnchor !== true &&
      toInt(entity.generatedMiningSiteIndex, -2) === normalizedSiteIndex &&
      (String(entity.generatedMiningSiteKind || "").trim().toLowerCase() || "mining") === normalizedFamily
    ))
    .sort((left, right) => toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0));
}

function buildTargetID(systemID, siteID) {
  return targetIdRuntime.encodeTargetID(
    "mining-anomaly",
    systemID,
    siteID,
  );
}

function listAnomalySites(systemID, options = {}) {
  const scene = getScene(systemID, options);
  const numericSystemID = toInt(systemID, 0);
  if (!scene || numericSystemID <= 0) {
    return [];
  }

  return listGeneratedMiningAnchorEntities(scene).map((entity) => {
    const siteID = toInt(entity && entity.itemID, 0);
    const family = String(entity && entity.generatedMiningSiteKind || "")
      .trim()
      .toLowerCase() || "mining";
    if (family !== "ice") {
      return null;
    }
    const childEntities = listGeneratedMiningSiteChildEntities(
      scene,
      entity && entity.generatedMiningSiteIndex,
      family,
    );
    const oreTypeIDs = [...new Set(childEntities
      .map((entry) => toInt(entry && entry.miningYieldTypeID, 0))
      .filter((entry) => entry > 0 && family !== "gas"))].sort((left, right) => left - right);
    const gasTypeIDs = [...new Set(childEntities
      .map((entry) => toInt(entry && entry.miningYieldTypeID, 0))
      .filter((entry) => entry > 0 && family === "gas"))].sort((left, right) => left - right);
    const iceTypeIDs = [...new Set(childEntities
      .map((entry) => toInt(entry && entry.miningYieldTypeID, 0))
      .filter((entry) => entry > 0 && family === "ice"))].sort((left, right) => left - right);
    const scanStrengthAttribute = family === "gas"
      ? explorationAuthority.getScanStrengthAttribute("gas")
      : explorationAuthority.getScanStrengthAttribute("ore");
    return dungeonSiteAdapter.enrichSiteWithDungeonRuntime({
      siteID,
      targetID: buildTargetID(numericSystemID, siteID),
      siteKind: "anomaly",
      family,
      label: String(entity && (entity.itemName || entity.slimName) || "").trim() || "Mining Site",
      difficulty: 1,
      dungeonID: null,
      archetypeID: null,
      instanceID: siteID,
      dungeonNameID: null,
      factionID: null,
      scanStrengthAttribute: scanStrengthAttribute || null,
      allowedTypes: [],
      entryObjectTypeID: toInt(entity && entity.typeID, 0) || null,
      solarSystemID: numericSystemID,
      typeID: toInt(entity && entity.typeID, 0),
      actualPosition: cloneVector(entity && entity.position),
      position: [
        toFiniteNumber(entity && entity.position && entity.position.x, 0),
        toFiniteNumber(entity && entity.position && entity.position.y, 0),
        toFiniteNumber(entity && entity.position && entity.position.z, 0),
      ],
      generatedMiningSiteIndex: toInt(entity && entity.generatedMiningSiteIndex, 0),
    }, {
      providerID: "generatedMining",
      solarSystemID: numericSystemID,
      oreTypeIDs,
      gasTypeIDs,
      iceTypeIDs,
    });
  }).filter(Boolean);
}

module.exports = {
  providerID: "generatedMining",
  siteKind: "anomaly",
  listAnomalySites,
};
