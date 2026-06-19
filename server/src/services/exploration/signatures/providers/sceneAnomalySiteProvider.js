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

function getScene(systemID, options = {}) {
  return resolveScene(systemID, options);
}

function collectSceneEntities(scene) {
  const staticEntities = Array.isArray(scene && scene.staticEntities)
    ? scene.staticEntities
    : [];
  const dynamicEntities =
    scene && scene.dynamicEntities instanceof Map
      ? [...scene.dynamicEntities.values()]
      : Array.isArray(scene && scene.dynamicEntities)
        ? scene.dynamicEntities
        : [];
  return [...staticEntities, ...dynamicEntities];
}

function buildTargetID(systemID, siteID) {
  return targetIdRuntime.encodeTargetID("scene-anomaly", systemID, siteID);
}

function listAnomalySites(systemID, options = {}) {
  const scene = getScene(systemID, options);
  const numericSystemID = toInt(systemID, 0);
  if (!scene || numericSystemID <= 0) {
    return [];
  }

  return collectSceneEntities(scene)
    .filter((entity) => (
      entity &&
      entity.signalTrackerStaticSite !== true &&
      (
        entity.signalTrackerAnomalySite === true ||
        String(entity.signalTrackerSiteKind || "").trim().toLowerCase() === "anomaly"
      ) &&
      toInt(entity.itemID, 0) > 0
    ))
    .map((entity) => {
      const siteID = toInt(entity && entity.itemID, 0);
      const family = String(
        entity && (
          entity.signalTrackerSiteFamily ||
          entity.signalTrackerAnomalySiteFamily
        ) || "unknown"
      ).trim().toLowerCase() || "unknown";
      const typeID = toInt(
        entity && (
          entity.signalTrackerSiteTypeID ??
          entity.typeID
        ),
        0,
      ) || null;
      return dungeonSiteAdapter.enrichSiteWithDungeonRuntime({
        siteID,
        targetID: buildTargetID(numericSystemID, siteID),
        siteKind: "anomaly",
        family,
        label: String(
          entity && (
            entity.signalTrackerSiteLabel ||
            entity.itemName ||
            entity.slimName
          ) || `Anomaly Site ${siteID}`
        ).trim(),
        difficulty: Math.max(1, toInt(entity && entity.signalTrackerSiteDifficulty, 1)),
        dungeonID: toInt(entity && entity.dungeonID, 0) || null,
        dungeonNameID: toInt(entity && entity.dungeonNameID, 0) || null,
        archetypeID: toInt(entity && entity.archetypeID, 0) || null,
        factionID: toInt(entity && entity.factionID, 0) || null,
        scanStrengthAttribute: toInt(
          entity && entity.signalTrackerStrengthAttributeID,
          explorationAuthority.getScanStrengthAttribute(family),
        ) || null,
        allowedTypes: Array.isArray(entity && entity.signalTrackerAllowedTypes)
          ? [...entity.signalTrackerAllowedTypes]
          : [],
        entryObjectTypeID: toInt(
          entity && (
            entity.signalTrackerEntryObjectTypeID ??
            entity.entryObjectTypeID ??
            entity.typeID
          ),
          0,
        ) || null,
        solarSystemID: numericSystemID,
        typeID,
        groupID: toInt(entity && entity.signalTrackerSiteGroupID, 0) || null,
        actualPosition: {
          x: toFiniteNumber(entity && entity.position && entity.position.x, 0),
          y: toFiniteNumber(entity && entity.position && entity.position.y, 0),
          z: toFiniteNumber(entity && entity.position && entity.position.z, 0),
        },
        position: [
          toFiniteNumber(entity && entity.position && entity.position.x, 0),
          toFiniteNumber(entity && entity.position && entity.position.y, 0),
          toFiniteNumber(entity && entity.position && entity.position.z, 0),
        ],
      }, {
        providerID: "sceneAnomalySite",
        solarSystemID: numericSystemID,
        templateID: entity && entity.signalTrackerSiteTemplateID,
      });
    })
    .sort((left, right) => left.siteID - right.siteID);
}

module.exports = {
  providerID: "sceneAnomalySite",
  siteKind: "anomaly",
  listAnomalySites,
};
