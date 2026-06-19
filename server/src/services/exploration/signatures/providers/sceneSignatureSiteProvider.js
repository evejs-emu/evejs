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
  return targetIdRuntime.encodeTargetID("scene-signature", systemID, siteID);
}

function listSignatureSites(systemID, options = {}) {
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
        entity.signalTrackerSignatureSite === true ||
        String(entity.signalTrackerSiteKind || "").trim().toLowerCase() === "signature"
      ) &&
      toInt(entity.itemID, 0) > 0
    ))
    .map((entity) => {
      const siteID = toInt(entity && entity.itemID, 0);
      const family = String(
        entity && (
          entity.signalTrackerSiteFamily ||
          entity.signalTrackerSignatureSiteFamily
        ) || "unknown"
      ).trim().toLowerCase() || "unknown";
      const typeID = toInt(
        entity && (
          entity.signalTrackerSiteTypeID ??
          entity.typeID
        ),
        0,
      ) || null;
      const scanGroupID = toInt(
        entity && entity.signalTrackerSiteScanGroupID,
        toInt(
          explorationAuthority.getScanContracts() &&
          explorationAuthority.getScanContracts().probeScanGroups &&
          explorationAuthority.getScanContracts().probeScanGroups.signatures,
          3,
        ),
      );
      const signatureTypeDefinition = explorationAuthority.getSignatureTypeDefinition(family) || null;
      return dungeonSiteAdapter.enrichSiteWithDungeonRuntime({
        siteID,
        targetID: buildTargetID(numericSystemID, siteID),
        siteKind: "signature",
        family,
        label: String(
          entity && (
            entity.signalTrackerSiteLabel ||
            entity.itemName ||
            entity.slimName
          ) || `Signature Site ${siteID}`
        ).trim(),
        difficulty: Math.max(1, toInt(entity && entity.signalTrackerSiteDifficulty, 1)),
        dungeonID: toInt(entity && entity.dungeonID, 0) || null,
        dungeonNameID: toInt(entity && entity.dungeonNameID, 0) || null,
        archetypeID: toInt(entity && entity.archetypeID, 0) || null,
        factionID: toInt(entity && entity.factionID, 0) || null,
        typeID,
        groupID: toInt(
          entity && entity.signalTrackerSiteGroupID,
          toInt(signatureTypeDefinition && signatureTypeDefinition.inventoryGroupID, 0),
        ) || null,
        scanGroupID,
        strengthAttributeID: toInt(
          entity && entity.signalTrackerStrengthAttributeID,
          explorationAuthority.getScanStrengthAttribute(family),
        ) || null,
        itemID: siteID,
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
        providerID: "sceneSignatureSite",
        solarSystemID: numericSystemID,
        templateID: entity && entity.signalTrackerSiteTemplateID,
      });
    })
    .sort((left, right) => left.siteID - right.siteID);
}

module.exports = {
  providerID: "sceneSignatureSite",
  siteKind: "signature",
  listSignatureSites,
};
