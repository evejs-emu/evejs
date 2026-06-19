const path = require("path");

const targetIdRuntime = require(path.join(
  __dirname,
  "../targetIdRuntime",
));
const dungeonSiteAdapter = require(path.join(
  __dirname,
  "../../../dungeon/dungeonSiteAdapter",
));
const { resolveScene } = require(path.join(
  __dirname,
  "./sceneProviderRuntime",
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
  return targetIdRuntime.encodeTargetID(
    "static-site",
    systemID,
    siteID,
  );
}

function listStaticSites(systemID, options = {}) {
  const scene = getScene(systemID, options);
  const numericSystemID = toInt(systemID, 0);
  if (!scene || numericSystemID <= 0) {
    return [];
  }

  return collectSceneEntities(scene)
    .filter((entity) => (
      entity &&
      entity.signalTrackerStaticSite === true &&
      toInt(entity.itemID, 0) > 0 &&
      toInt(
        entity.signalTrackerStaticSiteNameID ?? entity.dungeonNameID,
        0,
      ) > 0
    ))
    .map((entity) => {
      const siteID = toInt(entity && entity.itemID, 0);
      return dungeonSiteAdapter.enrichSiteWithDungeonRuntime({
        siteID,
        targetID: buildTargetID(numericSystemID, siteID),
        siteKind: "static",
        family: String(
          entity && (
            entity.signalTrackerStaticSiteFamily ||
            entity.signalTrackerSiteFamily
          ) || "landmark"
        ).trim().toLowerCase() || "landmark",
        label: String(
          entity && (
            entity.signalTrackerStaticSiteLabel ||
            entity.itemName ||
            entity.slimName
          ) || `Static Site ${siteID}`
        ).trim(),
        dungeonNameID: toInt(
          entity && (
            entity.signalTrackerStaticSiteNameID ??
            entity.dungeonNameID
          ),
          0,
        ) || null,
        factionID: toInt(
          entity && (
            entity.signalTrackerStaticSiteFactionID ??
            entity.factionID
          ),
          0,
        ) || null,
        solarSystemID: numericSystemID,
        position: [
          toFiniteNumber(entity && entity.position && entity.position.x, 0),
          toFiniteNumber(entity && entity.position && entity.position.y, 0),
          toFiniteNumber(entity && entity.position && entity.position.z, 0),
        ],
      }, {
        providerID: "sceneStaticSite",
        solarSystemID: numericSystemID,
        templateID: entity && entity.signalTrackerStaticSiteTemplateID,
      });
    })
    .sort((left, right) => left.siteID - right.siteID);
}

module.exports = {
  providerID: "sceneStaticSite",
  siteKind: "static",
  listStaticSites,
};
