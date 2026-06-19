const path = require("path");

const {
  buildDict,
  buildKeyVal,
  buildMarshalReal,
  buildMarshalRealVectorList,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const miningAnomalyProvider = require(path.join(
  __dirname,
  "./providers/miningAnomalyProvider",
));
const sceneAnomalySiteProvider = require(path.join(
  __dirname,
  "./providers/sceneAnomalySiteProvider",
));
const sceneSignatureSiteProvider = require(path.join(
  __dirname,
  "./providers/sceneSignatureSiteProvider",
));
const structureOverlayProvider = require(path.join(
  __dirname,
  "./providers/structureOverlayProvider",
));
const sceneStaticSiteProvider = require(path.join(
  __dirname,
  "./providers/sceneStaticSiteProvider",
));
const targetIdRuntime = require(path.join(
  __dirname,
  "./targetIdRuntime",
));
const wormholeSignatureProvider = require(path.join(
  __dirname,
  "./providers/wormholeSignatureProvider",
));

const SIGNATURE_PROVIDERS = Object.freeze([
  sceneSignatureSiteProvider,
  wormholeSignatureProvider,
]);
const ANOMALY_PROVIDERS = Object.freeze([
  miningAnomalyProvider,
  sceneAnomalySiteProvider,
]);
const STATIC_SITE_PROVIDERS = Object.freeze([
  sceneStaticSiteProvider,
]);
const STRUCTURE_PROVIDERS = Object.freeze([
  structureOverlayProvider,
]);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSiteCollection(sites) {
  return (Array.isArray(sites) ? sites : [])
    .map((site) => ({
      ...site,
      siteID: toInt(site && site.siteID, 0),
      targetID: String(site && site.targetID || "").trim().toUpperCase(),
      family: String(site && site.family || "").trim().toLowerCase() || "unknown",
      siteKind: String(site && site.siteKind || "").trim().toLowerCase() || "signature",
    }))
    .filter((site) => site.siteID > 0 && site.targetID)
    .sort((left, right) => left.siteID - right.siteID);
}

function listSystemSignatureSites(systemID, options = {}) {
  return normalizeSiteCollection(
    SIGNATURE_PROVIDERS.flatMap((provider) => (
      provider && typeof provider.listSignatureSites === "function"
        ? provider.listSignatureSites(systemID, options).map((site) => ({
          ...site,
          provider,
        }))
        : []
    )),
  );
}

function listSystemAnomalySites(systemID, options = {}) {
  return normalizeSiteCollection(
    ANOMALY_PROVIDERS.flatMap((provider) => (
      provider && typeof provider.listAnomalySites === "function"
        ? provider.listAnomalySites(systemID, options).map((site) => ({
          ...site,
          provider,
        }))
        : []
    )),
  );
}

function listSystemStaticSites(systemID, options = {}) {
  return normalizeSiteCollection(
    STATIC_SITE_PROVIDERS.flatMap((provider) => (
      provider && typeof provider.listStaticSites === "function"
        ? provider.listStaticSites(systemID, options).map((site) => ({
          ...site,
          provider,
        }))
        : []
    )),
  );
}

function normalizeStructureCollection(sites) {
  return (Array.isArray(sites) ? sites : [])
    .map((site) => ({
      ...site,
      siteID: toInt(site && site.siteID, 0),
      targetID: String(site && site.targetID || "").trim().toUpperCase(),
      family: String(site && site.family || "").trim().toLowerCase() || "structure",
      siteKind: "structure",
      typeID: toInt(site && site.typeID, 0),
      groupID: toInt(site && site.groupID, 0),
      categoryID: toInt(site && site.categoryID, 65),
    }))
    .filter((site) => site.siteID > 0 && site.targetID && site.typeID > 0)
    .sort((left, right) => left.siteID - right.siteID);
}

function listSystemStructureSites(systemID, options = {}) {
  return normalizeStructureCollection(
    STRUCTURE_PROVIDERS.flatMap((provider) => (
      provider && typeof provider.listStructureSites === "function"
        ? provider.listStructureSites(systemID, options).map((site) => ({
          ...site,
          provider,
        }))
        : []
    )),
  );
}

function buildSystemSignatureViews(systemID, options = {}) {
  return listSystemSignatureSites(systemID, options).map((site) => ({
    siteID: toInt(site && site.siteID, 0),
    targetID: String(site && site.targetID || "").trim().toUpperCase(),
    family: String(site && site.family || "").trim().toLowerCase() || "unknown",
    label:
      String(site && site.label || "").trim() ||
      String(site && site.targetID || "").trim().toUpperCase(),
    wormholeCode: String(site && site.wormholeCode || "").trim().toUpperCase() || null,
    pairKind: String(site && site.pairKind || "").trim().toLowerCase() || null,
    typeID: toInt(site && site.typeID, 0),
    difficulty: toInt(site && site.difficulty, 1),
  }));
}

function buildSystemScannableViews(systemID, options = {}) {
  return listAllScannableSites(systemID, options).map((site) => ({
    siteID: toInt(site && site.siteID, 0),
    targetID: String(site && site.targetID || "").trim().toUpperCase(),
    siteKind: String(site && site.siteKind || "").trim().toLowerCase() || "signature",
    family: String(site && site.family || "").trim().toLowerCase() || "unknown",
    label:
      String(site && site.label || "").trim() ||
      String(site && site.targetID || "").trim().toUpperCase(),
    wormholeCode: String(site && site.wormholeCode || "").trim().toUpperCase() || null,
    pairKind: String(site && site.pairKind || "").trim().toLowerCase() || null,
    typeID: toInt(site && site.typeID, 0),
    difficulty: toInt(site && site.difficulty, 1),
  }));
}

function buildSignatureSiteInfo(site) {
  const defaultDeviation = Math.max(
    0,
    toFiniteNumber(
      site &&
        site.provider &&
        site.provider.DEFAULT_SIGNATURE_DEVIATION_METERS,
      wormholeSignatureProvider.DEFAULT_SIGNATURE_DEVIATION_METERS,
    ),
  );
  return buildKeyVal([
    [
      "position",
      buildMarshalRealVectorList(
        Array.isArray(site && site.position) ? site.position : [0, 0, 0],
      ),
    ],
    ["targetID", String(site && site.targetID || "")],
    ["difficulty", toInt(site && site.difficulty, 1)],
    ["dungeonID", site && site.dungeonID == null ? null : site.dungeonID],
    ["archetypeID", site && site.archetypeID == null ? null : site.archetypeID],
    [
      "deviation",
      buildMarshalReal(
        Math.max(
          0,
          toFiniteNumber(site && site.deviation, defaultDeviation),
        ),
        defaultDeviation,
      ),
    ],
  ]);
}

function buildAnomalySiteInfo(site) {
  return buildKeyVal([
    [
      "position",
      buildMarshalRealVectorList(
        Array.isArray(site && site.position) ? site.position : [0, 0, 0],
      ),
    ],
    ["targetID", String(site && site.targetID || "")],
    ["difficulty", toInt(site && site.difficulty, 1)],
    // Packaged anomalyTracker does int(dungeonID) during overlay bootstrap.
    // Keep anomalies on a numeric contract even for generated placeholder sites.
    ["dungeonID", site && site.dungeonID == null ? 0 : site.dungeonID],
    ["archetypeID", site && site.archetypeID == null ? null : site.archetypeID],
    ["instanceID", site && site.instanceID == null ? toInt(site && site.siteID, 0) : site.instanceID],
    ["dungeonNameID", site && site.dungeonNameID == null ? null : site.dungeonNameID],
    ["factionID", site && site.factionID == null ? null : site.factionID],
    ["scanStrengthAttribute", site && site.scanStrengthAttribute == null ? null : site.scanStrengthAttribute],
    ["allowedTypes", Array.isArray(site && site.allowedTypes) ? site.allowedTypes : []],
    ["entryObjectTypeID", site && site.entryObjectTypeID == null ? null : site.entryObjectTypeID],
    ["solarSystemID", toInt(site && site.solarSystemID, 0)],
  ]);
}

function buildStaticSiteInfo(site) {
  return buildKeyVal([
    [
      "position",
      buildMarshalRealVectorList(
        Array.isArray(site && site.position) ? site.position : [0, 0, 0],
      ),
    ],
    ["dungeonNameID", site && site.dungeonNameID == null ? null : site.dungeonNameID],
    ["factionID", site && site.factionID == null ? null : site.factionID],
  ]);
}

function buildStructureSiteInfo(site) {
  const position = site && site.position && typeof site.position === "object"
    ? [
        toFiniteNumber(site.position.x, 0),
        toFiniteNumber(site.position.y, 0),
        toFiniteNumber(site.position.z, 0),
      ]
    : Array.isArray(site && site.position)
      ? site.position
      : [0, 0, 0];
  return buildKeyVal([
    ["typeID", toInt(site && site.typeID, 0)],
    ["groupID", toInt(site && site.groupID, 0)],
    ["categoryID", toInt(site && site.categoryID, 65)],
    ["position", buildMarshalRealVectorList(position)],
    ["targetID", String(site && site.targetID || "").trim().toUpperCase()],
  ]);
}

function buildSignalTrackerFullState(systemID, options = {}) {
  const anomalies = listSystemAnomalySites(systemID, options);
  const signatures = listSystemSignatureSites(systemID, options);
  const staticSites = listSystemStaticSites(systemID, options);
  const structures = listSystemStructureSites(systemID, options);
  return [
    buildDict(
      anomalies.map((site) => [site.siteID, buildAnomalySiteInfo(site)]),
    ),
    buildDict(
      signatures.map((site) => [site.siteID, buildSignatureSiteInfo(site)]),
    ),
    buildDict(
      staticSites.map((site) => [site.siteID, buildStaticSiteInfo(site)]),
    ),
    buildDict(
      structures.map((site) => [site.siteID, buildStructureSiteInfo(site)]),
    ),
  ];
}

function buildSignalTrackerSignatureEntries(systemID, options = {}) {
  return listSystemSignatureSites(systemID, options).map((site) => [
    site.siteID,
    buildSignatureSiteInfo(site),
  ]);
}

function buildSignalTrackerAnomalyEntries(systemID, options = {}) {
  return listSystemAnomalySites(systemID, options).map((site) => [
    site.siteID,
    buildAnomalySiteInfo(site),
  ]);
}

function buildSignalTrackerStaticSiteEntries(systemID, options = {}) {
  return listSystemStaticSites(systemID, options).map((site) => [
    site.siteID,
    buildStaticSiteInfo(site),
  ]);
}

function buildSignalTrackerStructureEntries(systemID, options = {}) {
  return listSystemStructureSites(systemID, options).map((site) => [
    site.siteID,
    buildStructureSiteInfo(site),
  ]);
}

function listAllScannableSites(systemID, options = {}) {
  return [
    ...listSystemAnomalySites(systemID, options),
    ...listSystemSignatureSites(systemID, options),
  ].sort((left, right) => left.siteID - right.siteID);
}

function getScanTargetID(systemID, siteID, options = {}) {
  const numericSiteID = toInt(options.targetSeedID, toInt(siteID, 0));
  if (numericSiteID <= 0) {
    return "";
  }

  const matchedSite = [
    ...listAllScannableSites(systemID, options),
    ...listSystemStaticSites(systemID, options),
    ...listSystemStructureSites(systemID, options),
  ]
    .find((site) => toInt(site && site.siteID, 0) === toInt(siteID, 0));
  if (matchedSite) {
    return String(matchedSite.targetID || "").trim().toUpperCase();
  }

  return targetIdRuntime.encodeTargetID(
    "site",
    systemID,
    numericSiteID,
  );
}

function resolveSiteByTargetID(systemID, targetID, options = {}) {
  const normalizedTargetID = String(targetID || "").trim().toUpperCase();
  if (!normalizedTargetID) {
    return null;
  }

  return listAllScannableSites(systemID, options)
    .find((site) => String(site.targetID || "").trim().toUpperCase() === normalizedTargetID) || null;
}

function listWormholeSignatureSites(systemID, options = {}) {
  return normalizeSiteCollection(
    wormholeSignatureProvider.listSignatureSites(systemID, options).map((site) => ({
      ...site,
      provider: wormholeSignatureProvider,
    })),
  );
}

module.exports = {
  AU_METERS: wormholeSignatureProvider.AU_METERS,
  DEFAULT_SIGNATURE_DEVIATION_METERS:
    wormholeSignatureProvider.DEFAULT_SIGNATURE_DEVIATION_METERS,
  buildSignalTrackerAnomalyEntries,
  buildSignalTrackerFullState,
  buildSignalTrackerSignatureEntries,
  buildSignalTrackerStaticSiteEntries,
  buildSignalTrackerStructureEntries,
  buildSystemScannableViews,
  buildSystemSignatureViews,
  getScanTargetID,
  listAllScannableSites,
  listSystemAnomalySites,
  listSystemSignatureSites,
  listSystemStaticSites,
  listSystemStructureSites,
  listWormholeSignatureSites,
  resolveSiteByTargetID,
  _testing: {
    anomalyProviders: ANOMALY_PROVIDERS,
    encodeSignatureCodeFromNumber:
      wormholeSignatureProvider.encodeSignatureCodeFromNumber,
    listSignatureProviders: () => [...SIGNATURE_PROVIDERS],
    listStaticSiteProviders: () => [...STATIC_SITE_PROVIDERS],
    listStructureProviders: () => [...STRUCTURE_PROVIDERS],
    listWormholeSignatureCandidates:
      wormholeSignatureProvider.listWormholeSignatureCandidates,
    allocateStableSignatureCodes:
      wormholeSignatureProvider.allocateStableSignatureCodes,
    buildSignaturePosition:
      wormholeSignatureProvider.buildSignaturePosition,
  },
};
