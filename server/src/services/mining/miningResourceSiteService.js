const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const BaseService = require(path.join(__dirname, "../baseService"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const dungeonAuthority = require(path.join(__dirname, "../dungeon/dungeonAuthority"));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  resolveMiningVisualPresentation,
} = require(path.join(__dirname, "./miningVisuals"));
const {
  recordGeneratedSiteBootstrap,
  resetMiningStartupSummary,
} = require(path.join(__dirname, "./miningStartupSummary"));

const ICE_SITE_ITEM_ID_BASE = 5_100_000_000_000;
const GAS_SITE_ITEM_ID_BASE = 5_200_000_000_000;
const SITE_ID_SYSTEM_STRIDE = 10_000;
const SITE_ID_SITE_STRIDE = 100;
const DUNGEON_GAS_SITE_CHILD_STRIDE = 100;
const DEFAULT_SITE_RADIUS_METERS = 18_000;
const DEFAULT_SITE_ANCHOR_OFFSET_METERS = 120_000;
const DEFAULT_ICE_CHUNKS_PER_SITE = 12;
const DEFAULT_GAS_CLOUDS_PER_SITE = 14;
const DEFAULT_ICE_QUANTITY_RANGE = Object.freeze([1_500, 4_500]);
const DEFAULT_GAS_QUANTITY_RANGE = Object.freeze([4_000, 12_000]);
const TEMPLATE_NAMES = Object.freeze({
  ice: Object.freeze({
    highsec: Object.freeze(["Blue Ice", "Clear Icicle", "White Glaze", "Glacial Mass"]),
    lowsec: Object.freeze(["Dark Glitter", "Glare Crust", "Gelidus"]),
    nullsec: Object.freeze(["Krystallos", "Gelidus", "Dark Glitter", "Glare Crust", "Azure Ice", "Crystalline Icicle"]),
    wormhole: Object.freeze([]),
  }),
  gas: Object.freeze({
    highsec: Object.freeze([]),
    lowsec: Object.freeze([
      "Amber Mykoserocin",
      "Golden Mykoserocin",
      "Lime Mykoserocin",
      "Viridian Mykoserocin",
      "Amber Cytoserocin",
      "Golden Cytoserocin",
      "Lime Cytoserocin",
      "Viridian Cytoserocin",
    ]),
    nullsec: Object.freeze([
      "Azure Mykoserocin",
      "Celadon Mykoserocin",
      "Malachite Mykoserocin",
      "Vermillion Mykoserocin",
      "Azure Cytoserocin",
      "Celadon Cytoserocin",
      "Malachite Cytoserocin",
      "Vermillion Cytoserocin",
    ]),
    wormhole: Object.freeze([
      "Fullerite-C50",
      "Fullerite-C60",
      "Fullerite-C70",
      "Fullerite-C72",
      "Fullerite-C84",
      "Fullerite-C28",
      "Fullerite-C32",
      "Fullerite-C320",
      "Fullerite-C540",
    ]),
  }),
});

let cachedTypeRecordByName = null;
let scanMgrServiceModule = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(
    Math.max(toFiniteNumber(value, minimum), minimum),
    maximum,
  );
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function getVectorMagnitude(vector) {
  const x = toFiniteNumber(vector && vector.x, 0);
  const y = toFiniteNumber(vector && vector.y, 0);
  const z = toFiniteNumber(vector && vector.z, 0);
  return Math.sqrt((x * x) + (y * y) + (z * z));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const magnitude = getVectorMagnitude(vector);
  if (magnitude <= 0) {
    return { ...fallback };
  }
  return {
    x: toFiniteNumber(vector && vector.x, 0) / magnitude,
    y: toFiniteNumber(vector && vector.y, 0) / magnitude,
    z: toFiniteNumber(vector && vector.z, 0) / magnitude,
  };
}

function scaleVector(vector, scalar) {
  const numericScalar = toFiniteNumber(scalar, 0);
  return {
    x: toFiniteNumber(vector && vector.x, 0) * numericScalar,
    y: toFiniteNumber(vector && vector.y, 0) * numericScalar,
    z: toFiniteNumber(vector && vector.z, 0) * numericScalar,
  };
}

function resolveSunExclusionRadius(scene) {
  const sceneEntities = Array.isArray(scene && scene.staticEntities)
    ? scene.staticEntities
    : [];
  return sceneEntities
    .filter((entity) => (
      entity &&
      entity.position &&
      (
        entity.kind === "sun" ||
        toInt(entity.groupID, 0) === 6
      )
    ))
    .reduce(
      (maximum, entity) => Math.max(
        maximum,
        Math.max(0, toFiniteNumber(entity && entity.radius, 0)) + 250_000,
      ),
      0,
    );
}

function clampPositionOutsideSun(scene, position, minimumMarginMeters = 0) {
  const exclusionRadius = Math.max(
    0,
    resolveSunExclusionRadius(scene) + Math.max(0, toFiniteNumber(minimumMarginMeters, 0)),
  );
  const resolvedPosition = cloneVector(position);
  if (exclusionRadius <= 0) {
    return resolvedPosition;
  }
  const currentMagnitude = getVectorMagnitude(resolvedPosition);
  if (currentMagnitude > exclusionRadius) {
    return resolvedPosition;
  }
  return scaleVector(
    normalizeVector(resolvedPosition, { x: 1, y: 0, z: 0 }),
    exclusionRadius,
  );
}

function hashValue(value) {
  let state = toInt(value, 0) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state ^= state >>> 16;
  return state >>> 0;
}

function createRng(seed) {
  let state = hashValue(seed) || 1;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let output = state;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

function getSecurityBand(systemID) {
  const systemRecord = worldData.getSolarSystemByID(systemID) || null;
  const securityStatus = toFiniteNumber(
    systemRecord && (systemRecord.securityStatus ?? systemRecord.security),
    0,
  );
  if (toInt(systemID, 0) >= 31_000_000 && toInt(systemID, 0) <= 31_999_999) {
    return "wormhole";
  }
  if (securityStatus >= 0.45) {
    return "highsec";
  }
  if (securityStatus >= 0) {
    return "lowsec";
  }
  return "nullsec";
}

function getConfiguredSiteCount(kind, securityBand) {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  switch (`${normalizedKind}:${securityBand}`) {
    case "ice:highsec":
      return Math.max(0, toInt(config.miningIceSitesHighSecPerSystem, 1));
    case "ice:lowsec":
      return Math.max(0, toInt(config.miningIceSitesLowSecPerSystem, 1));
    case "ice:nullsec":
      return Math.max(0, toInt(config.miningIceSitesNullSecPerSystem, 1));
    case "ice:wormhole":
      return Math.max(0, toInt(config.miningIceSitesWormholePerSystem, 0));
    case "gas:highsec":
      return Math.max(0, toInt(config.miningGasSitesHighSecPerSystem, 0));
    case "gas:lowsec":
      return Math.max(0, toInt(config.miningGasSitesLowSecPerSystem, 1));
    case "gas:nullsec":
      return Math.max(0, toInt(config.miningGasSitesNullSecPerSystem, 1));
    case "gas:wormhole":
      return Math.max(0, toInt(config.miningGasSitesWormholePerSystem, 2));
    default:
      return 0;
  }
}

function getAnchorCandidates(scene) {
  const sceneEntities = Array.isArray(scene && scene.staticEntities)
    ? scene.staticEntities
    : [];
  const sunExclusionRadius = resolveSunExclusionRadius(scene);
  const isSafeAnchorEntity = (entity) => (
    entity &&
    entity.position &&
    entity.generatedMiningSite !== true &&
    getVectorMagnitude(entity.position) > sunExclusionRadius
  );
  const beltEntities = sceneEntities.filter((entity) => (
    entity &&
    isSafeAnchorEntity(entity) &&
    entity.kind === "asteroidBelt" &&
    entity.position
  ));
  if (beltEntities.length > 0) {
    return beltEntities.map((entity) => ({
      itemID: toInt(entity.itemID, 0),
      itemName: String(entity.itemName || ""),
      position: cloneVector(entity.position),
    }));
  }

  const celestialEntities = sceneEntities.filter((entity) => (
    entity &&
    isSafeAnchorEntity(entity) &&
    entity.kind !== "sun" &&
    toInt(entity.groupID, 0) !== 6 &&
    entity.kind !== "station" &&
    entity.kind !== "structure" &&
    entity.kind !== "stargate"
  ));
  if (celestialEntities.length > 0) {
    return celestialEntities.map((entity) => ({
      itemID: toInt(entity.itemID, 0),
      itemName: String(entity.itemName || ""),
      position: cloneVector(entity.position),
    }));
  }

  const infrastructureEntities = sceneEntities.filter((entity) => (
    entity &&
    isSafeAnchorEntity(entity) &&
    (
      entity.kind === "station" ||
      entity.kind === "structure" ||
      entity.kind === "stargate"
    )
  ));
  if (infrastructureEntities.length > 0) {
    return infrastructureEntities.map((entity) => ({
      itemID: toInt(entity.itemID, 0),
      itemName: String(entity.itemName || ""),
      position: cloneVector(entity.position),
    }));
  }

  const systemRecord = worldData.getSolarSystemByID(toInt(scene && scene.systemID, 0)) || null;
  const fallbackDistance = Math.max(
    1_000_000_000,
    Math.ceil(sunExclusionRadius + 500_000),
    Math.round(toFiniteNumber(systemRecord && systemRecord.radius, 0) * 0.25),
  );
  return [{
    itemID: toInt(scene && scene.systemID, 0),
    itemName: "System Fallback",
    position: { x: fallbackDistance, y: 0, z: 0 },
  }];
}

function ensureTypeRecordCache() {
  if (cachedTypeRecordByName) {
    return cachedTypeRecordByName;
  }
  cachedTypeRecordByName = new Map();
  for (const name of new Set([
    "Ice Field",
    "Gas Cloud 1",
    ...Object.values(TEMPLATE_NAMES.ice).flat(),
    ...Object.values(TEMPLATE_NAMES.gas).flat(),
  ])) {
    const lookup = resolveItemByName(name);
    if (lookup && lookup.success && lookup.match) {
      cachedTypeRecordByName.set(name, lookup.match);
    }
  }
  return cachedTypeRecordByName;
}

function getTypeRecordByName(name) {
  return ensureTypeRecordCache().get(String(name || "").trim()) || null;
}

function getScanMgrServiceModule() {
  if (!scanMgrServiceModule) {
    scanMgrServiceModule = require(path.join(
      __dirname,
      "../exploration/scanMgrService",
    ));
  }
  return scanMgrServiceModule;
}

function notifySignalTrackerAnomalyDelta(scene) {
  const systemID = toInt(scene && scene.systemID, 0);
  if (systemID <= 0) {
    return;
  }

  const scanMgrService = getScanMgrServiceModule();
  if (
    scanMgrService &&
    typeof scanMgrService.notifyAnomalyDeltaForSystem === "function"
  ) {
    scanMgrService.notifyAnomalyDeltaForSystem(systemID, {
      scene,
    });
  }
}

function getTemplateTypeRecords(kind, securityBand) {
  const templateNames = (
    TEMPLATE_NAMES[kind] &&
    TEMPLATE_NAMES[kind][securityBand]
  ) || [];
  let records = templateNames
    .map((name) => getTypeRecordByName(name))
    .filter(Boolean);
  if (records.length > 0) {
    return records;
  }

  const fallbackBands = kind === "gas"
    ? ["lowsec", "nullsec", "wormhole", "highsec"]
    : ["nullsec", "lowsec", "highsec", "wormhole"];
  for (const fallbackBand of fallbackBands) {
    if (fallbackBand === securityBand) {
      continue;
    }
    records = ((TEMPLATE_NAMES[kind] && TEMPLATE_NAMES[kind][fallbackBand]) || [])
      .map((name) => getTypeRecordByName(name))
      .filter(Boolean);
    if (records.length > 0) {
      return records;
    }
  }
  return [];
}

function buildAnchorItemID(kind, systemID, siteIndex) {
  const base = kind === "gas" ? GAS_SITE_ITEM_ID_BASE : ICE_SITE_ITEM_ID_BASE;
  return (
    base +
    (normalizePositiveInt(systemID, 0) * SITE_ID_SYSTEM_STRIDE) +
    (siteIndex * SITE_ID_SITE_STRIDE)
  );
}

function buildChildItemID(kind, systemID, siteIndex, childIndex) {
  return buildAnchorItemID(kind, systemID, siteIndex) + childIndex + 1;
}

function buildDungeonGasCloudItemID(siteID, childIndex) {
  return (
    (Math.max(0, toInt(siteID, 0)) * DUNGEON_GAS_SITE_CHILD_STRIDE) +
    Math.max(0, toInt(childIndex, 0)) +
    1
  );
}

function resolveGeneratedSiteRawIndex(kind, localSiteIndex) {
  const normalizedLocalSiteIndex = Math.max(0, toInt(localSiteIndex, 0));
  return kind === "gas"
    ? normalizedLocalSiteIndex + 100
    : normalizedLocalSiteIndex;
}

function resolveGeneratedSiteLocalIndex(kind, rawSiteIndex) {
  const normalizedRawSiteIndex = Math.max(0, toInt(rawSiteIndex, 0));
  return kind === "gas"
    ? Math.max(0, normalizedRawSiteIndex - 100)
    : normalizedRawSiteIndex;
}

function resolveGeneratedSiteLabel(kind, localSiteIndex) {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  const normalizedLocalSiteIndex = Math.max(0, toInt(localSiteIndex, 0));
  const fieldLabel = normalizedKind === "gas" ? "Gas Field" : "Ice Field";
  return `${fieldLabel} ${normalizedLocalSiteIndex + 1}`;
}

function resolveGeneratedMiningEntityDescriptor(itemID) {
  const numericItemID = toInt(itemID, 0);
  if (numericItemID <= 0) {
    return null;
  }

  const families = [
    { kind: "ice", base: ICE_SITE_ITEM_ID_BASE },
    { kind: "gas", base: GAS_SITE_ITEM_ID_BASE },
  ];

  for (const family of families) {
    const offset = numericItemID - family.base;
    if (offset <= 0) {
      continue;
    }

    const systemID = Math.floor(offset / SITE_ID_SYSTEM_STRIDE);
    const withinSystem = offset % SITE_ID_SYSTEM_STRIDE;
    const rawSiteIndex = Math.floor(withinSystem / SITE_ID_SITE_STRIDE);
    const siteOffset = withinSystem % SITE_ID_SITE_STRIDE;
    if (systemID <= 0 || rawSiteIndex < 0 || siteOffset <= 0) {
      continue;
    }

    return {
      kind: family.kind,
      systemID,
      rawSiteIndex,
      localSiteIndex: resolveGeneratedSiteLocalIndex(family.kind, rawSiteIndex),
      siteOffset,
      anchorID:
        family.base +
        (systemID * SITE_ID_SYSTEM_STRIDE) +
        (rawSiteIndex * SITE_ID_SITE_STRIDE),
      childIndex: siteOffset - 1,
    };
  }

  return null;
}

function buildFieldCenter(anchorPosition, seed) {
  const rng = createRng(seed);
  const angle = rng() * Math.PI * 2;
  const distance = Math.max(
    25_000,
    toFiniteNumber(
      config.miningGeneratedSiteAnchorOffsetMeters,
      DEFAULT_SITE_ANCHOR_OFFSET_METERS,
    ),
  );
  return addVectors(anchorPosition, {
    x: Math.cos(angle) * distance,
    y: ((rng() * 2) - 1) * (distance * 0.12),
    z: Math.sin(angle) * distance,
  });
}

function buildMineablePosition(center, siteRadiusMeters, siteIndex, childIndex) {
  const rng = createRng(hashValue(siteIndex * 4099 + childIndex * 131 + toInt(center.x, 0)));
  const angle = ((Math.PI * 2) / Math.max(1, childIndex + 1)) * childIndex + (rng() * 0.35);
  const radialDistance = Math.sqrt(rng()) * siteRadiusMeters;
  return addVectors(center, {
    x: Math.cos(angle) * radialDistance,
    y: ((rng() * 2) - 1) * Math.max(500, siteRadiusMeters * 0.18),
    z: Math.sin(angle) * radialDistance,
  });
}

function pickTemplateType(templateTypeRecords, seed) {
  if (!Array.isArray(templateTypeRecords) || templateTypeRecords.length <= 0) {
    return null;
  }
  const index = hashValue(seed) % templateTypeRecords.length;
  return templateTypeRecords[index] || null;
}

function getQuantityRange(kind) {
  return kind === "gas" ? DEFAULT_GAS_QUANTITY_RANGE : DEFAULT_ICE_QUANTITY_RANGE;
}

function resolveGeneratedSiteShellTypeRecord(kind, templateTypeRecord) {
  const fallbackName = kind === "gas" ? "Gas Cloud 1" : "Ice Field";
  const shellTypeRecord = getTypeRecordByName(fallbackName);
  return shellTypeRecord || templateTypeRecord || null;
}

function resolveGeneratedSiteVisualPresentation(kind, templateTypeRecord, itemID) {
  const shellTypeRecord = resolveGeneratedSiteShellTypeRecord(kind, templateTypeRecord);
  const minedTypeRecord = templateTypeRecord || shellTypeRecord || null;
  let presentation = null;
  if (typeof resolveMiningVisualPresentation === "function" && minedTypeRecord) {
    try {
      presentation = resolveMiningVisualPresentation(minedTypeRecord, {
        entityID: itemID,
        radius: minedTypeRecord.radius,
      });
    } catch (_error) {
      presentation = null;
    }
  }

  const shellTypeID = normalizePositiveInt(
    presentation && presentation.visualTypeID,
    normalizePositiveInt(
      shellTypeRecord && shellTypeRecord.typeID,
      normalizePositiveInt(minedTypeRecord && minedTypeRecord.typeID, 0),
    ),
  );
  const resolvedShellTypeRecord =
    resolveItemByTypeID(shellTypeID) ||
    shellTypeRecord ||
    minedTypeRecord ||
    null;
  const graphicID = normalizePositiveInt(
    presentation && presentation.graphicID,
    normalizePositiveInt(
      minedTypeRecord && minedTypeRecord.graphicID,
      normalizePositiveInt(
        resolvedShellTypeRecord && resolvedShellTypeRecord.graphicID,
        0,
      ),
    ),
  );

  return {
    shellTypeID,
    shellTypeRecord: resolvedShellTypeRecord,
    graphicID,
  };
}

function buildMineableQuantity(kind, seed) {
  const rng = createRng(seed);
  const [minimum, maximum] = getQuantityRange(kind);
  return Math.max(
    1,
    Math.round(minimum + ((maximum - minimum) * rng())),
  );
}

function buildAnchorEntity(kind, systemID, siteIndex, position) {
  const anchorType = kind === "gas"
    ? getTypeRecordByName("Gas Cloud 1")
    : getTypeRecordByName("Ice Field");
  if (!anchorType) {
    return null;
  }
  const anchorID = buildAnchorItemID(kind, systemID, siteIndex);
  const fieldLabel = kind === "gas" ? "Gas Field" : "Ice Field";
  return {
    kind: kind === "gas" ? "gasFieldAnchor" : "iceFieldAnchor",
    generatedMiningSite: true,
    generatedMiningSiteAnchor: true,
    generatedMiningSiteKind: kind,
    generatedMiningSiteIndex: siteIndex,
    itemID: anchorID,
    typeID: anchorType.typeID,
    groupID: anchorType.groupID,
    categoryID: anchorType.categoryID,
    ownerID: 1,
    itemName: `${fieldLabel} ${siteIndex + 1}`,
    slimName: `${fieldLabel} ${siteIndex + 1}`,
    position: cloneVector(position),
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: Math.max(1_500, toFiniteNumber(anchorType.radius, 2_000)),
    staticVisibilityScope: "bubble",
  };
}

function buildMineableEntity(kind, systemID, siteIndex, childIndex, center, templateTypeRecord) {
  if (!templateTypeRecord) {
    return null;
  }
  const itemID = buildChildItemID(kind, systemID, siteIndex, childIndex);
  const siteRadiusMeters = Math.max(
    5_000,
    toFiniteNumber(config.miningGeneratedSiteRadiusMeters, DEFAULT_SITE_RADIUS_METERS),
  );
  const visualPresentation = resolveGeneratedSiteVisualPresentation(
    kind,
    templateTypeRecord,
    itemID,
  );
  const shellTypeRecord = visualPresentation.shellTypeRecord || templateTypeRecord;
  return {
    kind: kind === "gas" ? "gasCloud" : "iceChunk",
    generatedMiningSite: true,
    generatedMiningSiteKind: kind,
    generatedMiningSiteIndex: siteIndex,
    itemID,
    typeID: normalizePositiveInt(
      shellTypeRecord && shellTypeRecord.typeID,
      templateTypeRecord.typeID,
    ),
    groupID: normalizePositiveInt(
      shellTypeRecord && shellTypeRecord.groupID,
      templateTypeRecord.groupID,
    ),
    categoryID: normalizePositiveInt(
      shellTypeRecord && shellTypeRecord.categoryID,
      templateTypeRecord.categoryID,
    ),
    slimTypeID: templateTypeRecord.typeID,
    slimGroupID: templateTypeRecord.groupID,
    slimCategoryID: templateTypeRecord.categoryID,
    visualTypeID: normalizePositiveInt(
      visualPresentation.shellTypeID,
      normalizePositiveInt(
        shellTypeRecord && shellTypeRecord.typeID,
        templateTypeRecord.typeID,
      ),
    ),
    miningYieldTypeID: templateTypeRecord.typeID,
    miningYieldKind: kind,
    graphicID: normalizePositiveInt(visualPresentation.graphicID, 0),
    slimGraphicID: normalizePositiveInt(visualPresentation.graphicID, 0),
    ownerID: 1,
    itemName: String(templateTypeRecord.name || `${kind} ${childIndex + 1}`),
    slimName: String(templateTypeRecord.name || `${kind} ${childIndex + 1}`),
    position: buildMineablePosition(center, siteRadiusMeters, siteIndex, childIndex),
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: kind === "gas"
      ? 1_800 + ((childIndex % 4) * 250)
      : 3_000 + ((childIndex % 5) * 450),
    staticVisibilityScope: "bubble",
    resourceQuantity: buildMineableQuantity(
      kind,
      hashValue(systemID * 8191 + siteIndex * 257 + childIndex * 13 + templateTypeRecord.typeID),
    ),
  };
}

function buildGeneratedSiteMemberDefinition(
  kind,
  systemID,
  rawSiteIndex,
  childIndex,
  templateTypeRecord,
  rotationIndex = 0,
) {
  if (!templateTypeRecord) {
    return null;
  }

  const entityID = buildChildItemID(kind, systemID, rawSiteIndex, childIndex);
  const visualPresentation = resolveGeneratedSiteVisualPresentation(
    kind,
    templateTypeRecord,
    entityID,
  );
  const shellTypeRecord = visualPresentation.shellTypeRecord || templateTypeRecord;
  const originalQuantity = buildMineableQuantity(
    kind,
    hashValue(
      systemID * 8191 +
      rawSiteIndex * 257 +
      childIndex * 13 +
      templateTypeRecord.typeID +
      (Math.max(0, toInt(rotationIndex, 0)) * 37),
    ),
  );

  return {
    entityID,
    childIndex,
    yieldTypeID: normalizePositiveInt(templateTypeRecord.typeID, 0),
    yieldKind: kind,
    resourceName: String(templateTypeRecord.name || "").trim() || null,
    visualTypeID: normalizePositiveInt(
      visualPresentation.shellTypeID,
      normalizePositiveInt(
        shellTypeRecord && shellTypeRecord.typeID,
        templateTypeRecord.typeID,
      ),
    ),
    originalQuantity,
    remainingQuantity: originalQuantity,
    originalRadius: kind === "gas"
      ? 1_800 + ((childIndex % 4) * 250)
      : 3_000 + ((childIndex % 5) * 450),
    unitVolume: Math.max(0.000001, toFiniteNumber(templateTypeRecord.volume, 1)),
  };
}

function buildGeneratedResourceSiteDefinition(systemID, kind, localSiteIndex, options = {}) {
  const numericSystemID = toInt(systemID, 0);
  const normalizedKind = String(kind || "").trim().toLowerCase();
  const normalizedLocalSiteIndex = Math.max(0, toInt(localSiteIndex, 0));
  const rotationIndex = Math.max(0, toInt(options && options.rotationIndex, 0));
  if (
    numericSystemID <= 0 ||
    (normalizedKind !== "ice" && normalizedKind !== "gas")
  ) {
    return null;
  }

  const securityBand = getSecurityBand(numericSystemID);
  const templateTypeRecords = getTemplateTypeRecords(normalizedKind, securityBand);
  if (templateTypeRecords.length <= 0) {
    return null;
  }

  const rawSiteIndex = resolveGeneratedSiteRawIndex(
    normalizedKind,
    normalizedLocalSiteIndex,
  );
  const memberCount = getChildCountForKind(normalizedKind);
  const members = [];
  for (let childIndex = 0; childIndex < memberCount; childIndex += 1) {
    const templateTypeRecord = pickTemplateType(
      templateTypeRecords,
      hashValue(
        numericSystemID * 4099 +
        rawSiteIndex * 97 +
        childIndex * 17 +
        (rotationIndex * 131),
      ),
    );
    const member = buildGeneratedSiteMemberDefinition(
      normalizedKind,
      numericSystemID,
      rawSiteIndex,
      childIndex,
      templateTypeRecord,
      rotationIndex,
    );
    if (member) {
      members.push(member);
    }
  }

  if (members.length <= 0) {
    return null;
  }

  const resourceTypeIDs = [...new Set(
    members
      .map((member) => normalizePositiveInt(member && member.yieldTypeID, 0))
      .filter((entry) => entry > 0),
  )].sort((left, right) => left - right);
  const resourceNames = [...new Set(
    members
      .map((member) => String(member && member.resourceName || "").trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
  const totalOriginalQuantity = members.reduce(
    (sum, member) => sum + Math.max(0, toInt(member && member.originalQuantity, 0)),
    0,
  );

  return {
    solarSystemID: numericSystemID,
    family: normalizedKind,
    siteKind: "anomaly",
    localSiteIndex: normalizedLocalSiteIndex,
    rawSiteIndex,
    rotationIndex,
    siteID: buildAnchorItemID(normalizedKind, numericSystemID, rawSiteIndex),
    label: resolveGeneratedSiteLabel(normalizedKind, normalizedLocalSiteIndex),
    securityBand,
    memberCount: members.length,
    activeMemberCount: members.length,
    totalOriginalQuantity,
    totalRemainingQuantity: totalOriginalQuantity,
    resourceTypeIDs,
    resourceNames,
    members,
  };
}

function buildGeneratedResourceSiteDefinitionsForSystem(systemID) {
  const numericSystemID = toInt(systemID, 0);
  if (numericSystemID <= 0) {
    return [];
  }

  const securityBand = getSecurityBand(numericSystemID);
  const definitions = [];

  if (config.miningGeneratedIceSitesEnabled === true) {
    const iceSiteCount = getConfiguredSiteCount("ice", securityBand);
    for (let localSiteIndex = 0; localSiteIndex < iceSiteCount; localSiteIndex += 1) {
      const definition = buildGeneratedResourceSiteDefinition(
        numericSystemID,
        "ice",
        localSiteIndex,
      );
      if (definition) {
        definitions.push(definition);
      }
    }
  }

  return definitions.sort((left, right) => (
    toInt(left && left.rawSiteIndex, 0) - toInt(right && right.rawSiteIndex, 0)
  ));
}

function listSeededDungeonMiningSiteDefinitions(systemID) {
  const numericSystemID = toInt(systemID, 0);
  if (numericSystemID <= 0) {
    return [];
  }

  const dungeonRuntime = require(path.join(__dirname, "../dungeon/dungeonRuntime"));
  return dungeonRuntime
    .listActiveInstancesBySystem(numericSystemID, {
      full: true,
    })
    .filter((instance) => (
      instance &&
      String(instance.siteOrigin || "").trim().toLowerCase() === "generatedmining" &&
      instance.runtimeFlags &&
      instance.runtimeFlags.universeSeeded === true &&
      instance.siteFamily === "ice"
    ))
    .map((instance) => {
      const metadata = instance.metadata && typeof instance.metadata === "object"
        ? instance.metadata
        : {};
      const spawnState = instance.spawnState && typeof instance.spawnState === "object"
        ? instance.spawnState
        : {};
      const family = String(instance.siteFamily || "").trim().toLowerCase() || "ice";
      const rawSiteIndex = Math.max(
        0,
        toInt(
          metadata.rawSiteIndex,
          spawnState.rawSiteIndex,
        ),
      );
      const localSiteIndex = Math.max(
        0,
        toInt(
          metadata.localSiteIndex,
          spawnState.localSiteIndex != null
            ? spawnState.localSiteIndex
            : resolveGeneratedSiteLocalIndex(family, rawSiteIndex),
        ),
      );
      return {
        solarSystemID: numericSystemID,
        family,
        siteKind: "anomaly",
        localSiteIndex,
        rawSiteIndex,
        rotationIndex: Math.max(
          0,
          toInt(
            metadata.rotationIndex,
            spawnState.rotationIndex,
          ),
        ),
        siteID: Math.max(
          0,
          toInt(
            metadata.siteID,
            spawnState.siteID,
          ),
        ) || buildAnchorItemID(family, numericSystemID, rawSiteIndex),
        label:
          String(
            metadata.label ||
            spawnState.label ||
            resolveGeneratedSiteLabel(family, localSiteIndex),
          ).trim(),
        memberCount: Math.max(
          0,
          toInt(spawnState.memberCount, Array.isArray(spawnState.members) ? spawnState.members.length : 0),
        ),
        activeMemberCount: Math.max(
          0,
          toInt(
            spawnState.activeMemberCount,
            Array.isArray(spawnState.members)
              ? spawnState.members.filter((member) => toInt(member && member.remainingQuantity, 0) > 0).length
              : 0,
          ),
        ),
        totalOriginalQuantity: Math.max(0, toInt(spawnState.totalOriginalQuantity, 0)),
        totalRemainingQuantity: Math.max(0, toInt(spawnState.totalRemainingQuantity, 0)),
        resourceTypeIDs: Array.isArray(spawnState.resourceTypeIDs)
          ? [...spawnState.resourceTypeIDs]
          : [],
        resourceNames: Array.isArray(spawnState.resourceNames)
          ? [...spawnState.resourceNames]
          : [],
        members: Array.isArray(spawnState.members)
          ? JSON.parse(JSON.stringify(spawnState.members))
          : [],
        position:
          instance && instance.position && typeof instance.position === "object"
            ? cloneVector(instance.position)
            : null,
      };
    })
    .sort((left, right) => (
      toInt(left && left.rawSiteIndex, 0) - toInt(right && right.rawSiteIndex, 0)
    ));
}

function buildDungeonGasSiteMemberDefinition(siteID, childIndex, typeRecord) {
  if (!typeRecord) {
    return null;
  }

  const normalizedSiteID = Math.max(0, toInt(siteID, 0));
  const normalizedChildIndex = Math.max(0, toInt(childIndex, 0));
  const originalQuantity = buildMineableQuantity(
    "gas",
    hashValue(
      (normalizedSiteID * 257) +
      (normalizedChildIndex * 13) +
      toInt(typeRecord.typeID, 0),
    ),
  );

  return {
    entityID: buildDungeonGasCloudItemID(normalizedSiteID, normalizedChildIndex),
    childIndex: normalizedChildIndex,
    yieldTypeID: normalizePositiveInt(typeRecord.typeID, 0),
    yieldKind: "gas",
    resourceName: String(typeRecord.name || "").trim() || null,
    visualTypeID: normalizePositiveInt(typeRecord.typeID, 0),
    originalQuantity,
    remainingQuantity: originalQuantity,
    originalRadius: 1_800 + ((normalizedChildIndex % 4) * 250),
    unitVolume: Math.max(0.000001, toFiniteNumber(typeRecord.volume, 1)),
  };
}

function listActiveDungeonGasSiteDefinitions(systemID) {
  const numericSystemID = toInt(systemID, 0);
  if (numericSystemID <= 0) {
    return [];
  }

  const dungeonRuntime = require(path.join(__dirname, "../dungeon/dungeonRuntime"));
  return dungeonRuntime
    .listActiveInstancesBySystem(numericSystemID, {
      full: true,
    })
    .filter((instance) => (
      instance &&
      String(instance.siteOrigin || "").trim().toLowerCase() !== "generatedmining" &&
      String(instance.siteFamily || "").trim().toLowerCase() === "gas" &&
      String(instance.siteKind || "").trim().toLowerCase() === "signature"
    ))
    .map((instance) => {
      const template = dungeonAuthority.getTemplateByID(instance && instance.templateID) || null;
      const metadata = instance && instance.metadata && typeof instance.metadata === "object"
        ? instance.metadata
        : {};
      const spawnState = instance && instance.spawnState && typeof instance.spawnState === "object"
        ? instance.spawnState
        : {};
      const resourceComposition = template && template.resourceComposition && typeof template.resourceComposition === "object"
        ? template.resourceComposition
        : {};
      const gasTypeRecords = [...new Map(
        (Array.isArray(resourceComposition.gasTypeIDs) ? resourceComposition.gasTypeIDs : [])
          .map((entry) => resolveItemByTypeID(normalizePositiveInt(entry, 0)))
          .filter(Boolean)
          .map((typeRecord) => [normalizePositiveInt(typeRecord && typeRecord.typeID, 0), typeRecord]),
      ).values()];
      if (gasTypeRecords.length <= 0) {
        return null;
      }

      const desiredMemberCount = Math.max(
        gasTypeRecords.length,
        getChildCountForKind("gas"),
      );
      const members = [];
      for (let childIndex = 0; childIndex < desiredMemberCount; childIndex += 1) {
        const typeRecord = gasTypeRecords[childIndex % gasTypeRecords.length];
        const member = buildDungeonGasSiteMemberDefinition(
          Math.max(0, toInt(metadata.siteID, toInt(instance && instance.instanceID, 0))),
          childIndex,
          typeRecord,
        );
        if (member) {
          members.push(member);
        }
      }
      if (members.length <= 0) {
        return null;
      }

      const siteID = Math.max(0, toInt(metadata.siteID, toInt(instance && instance.instanceID, 0)));
      const totalOriginalQuantity = members.reduce(
        (sum, member) => sum + Math.max(0, toInt(member && member.originalQuantity, 0)),
        0,
      );
      return {
        solarSystemID: numericSystemID,
        family: "gas",
        siteKind: "signature",
        rawSiteIndex: siteID,
        localSiteIndex: Math.max(0, toInt(spawnState.slotIndex, metadata.slotIndex)),
        siteID,
        instanceID: Math.max(0, toInt(instance && instance.instanceID, 0)),
        templateID: String(instance && instance.templateID || "").trim() || null,
        label: String(
          metadata.label ||
          spawnState.label ||
          `Gas Site ${Math.max(0, toInt(template && template.sourceDungeonID, 0)) || siteID}`,
        ).trim(),
        securityBand: getSecurityBand(numericSystemID),
        memberCount: members.length,
        activeMemberCount: members.length,
        totalOriginalQuantity,
        totalRemainingQuantity: totalOriginalQuantity,
        resourceTypeIDs: gasTypeRecords.map((typeRecord) => normalizePositiveInt(typeRecord && typeRecord.typeID, 0)),
        resourceNames: gasTypeRecords
          .map((typeRecord) => String(typeRecord && typeRecord.name || "").trim())
          .filter(Boolean),
        members,
        materializeAnchor: false,
        position:
          instance && instance.position && typeof instance.position === "object"
            ? cloneVector(instance.position)
            : null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => toInt(left && left.siteID, 0) - toInt(right && right.siteID, 0));
}

function buildMineableEntityFromDefinitionMember(
  kind,
  systemID,
  rawSiteIndex,
  center,
  member,
  options = {},
) {
  const yieldTypeRecord = resolveItemByTypeID(
    normalizePositiveInt(member && member.yieldTypeID, 0),
  );
  if (!yieldTypeRecord) {
    return null;
  }

  const childIndex = Math.max(0, toInt(member && member.childIndex, 0));
  const visualTypeRecord = resolveItemByTypeID(
    normalizePositiveInt(member && member.visualTypeID, 0),
  ) || yieldTypeRecord;
  const siteRadiusMeters = Math.max(
    5_000,
    toFiniteNumber(config.miningGeneratedSiteRadiusMeters, DEFAULT_SITE_RADIUS_METERS),
  );

  return {
    kind: kind === "gas" ? "gasCloud" : "iceChunk",
    generatedMiningSite: options.generatedMiningSite !== false,
    generatedMiningSiteKind: options.generatedMiningSite !== false ? kind : undefined,
    generatedMiningSiteIndex: options.generatedMiningSite !== false ? rawSiteIndex : undefined,
    dungeonMaterializedGasSite:
      options.generatedMiningSite === false && kind === "gas"
        ? true
        : undefined,
    dungeonMaterializedGasSiteID:
      options.generatedMiningSite === false
        ? Math.max(0, toInt(options.siteID, 0)) || null
        : undefined,
    dungeonMaterializedGasSiteInstanceID:
      options.generatedMiningSite === false
        ? Math.max(0, toInt(options.instanceID, 0)) || null
        : undefined,
    itemID: normalizePositiveInt(member && member.entityID, 0),
    typeID: normalizePositiveInt(
      visualTypeRecord && visualTypeRecord.typeID,
      yieldTypeRecord.typeID,
    ),
    groupID: normalizePositiveInt(
      visualTypeRecord && visualTypeRecord.groupID,
      yieldTypeRecord.groupID,
    ),
    categoryID: normalizePositiveInt(
      visualTypeRecord && visualTypeRecord.categoryID,
      yieldTypeRecord.categoryID,
    ),
    slimTypeID: yieldTypeRecord.typeID,
    slimGroupID: yieldTypeRecord.groupID,
    slimCategoryID: yieldTypeRecord.categoryID,
    visualTypeID: normalizePositiveInt(
      member && member.visualTypeID,
      normalizePositiveInt(
        visualTypeRecord && visualTypeRecord.typeID,
        yieldTypeRecord.typeID,
      ),
    ),
    miningYieldTypeID: yieldTypeRecord.typeID,
    miningYieldKind: kind,
    graphicID: normalizePositiveInt(
      visualTypeRecord && visualTypeRecord.graphicID,
      normalizePositiveInt(yieldTypeRecord && yieldTypeRecord.graphicID, 0),
    ),
    slimGraphicID: normalizePositiveInt(
      visualTypeRecord && visualTypeRecord.graphicID,
      normalizePositiveInt(yieldTypeRecord && yieldTypeRecord.graphicID, 0),
    ),
    ownerID: 1,
    itemName: String(
      yieldTypeRecord.name ||
      member && member.resourceName ||
      `${kind} ${childIndex + 1}`
    ),
    slimName: String(
      yieldTypeRecord.name ||
      member && member.resourceName ||
      `${kind} ${childIndex + 1}`
    ),
    position: buildMineablePosition(center, siteRadiusMeters, rawSiteIndex, childIndex),
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: Math.max(
      1,
      toFiniteNumber(
        member && member.originalRadius,
        kind === "gas"
          ? 1_800 + ((childIndex % 4) * 250)
          : 3_000 + ((childIndex % 5) * 450),
      ),
    ),
    staticVisibilityScope: "bubble",
    resourceQuantity: Math.max(1, toInt(member && member.originalQuantity, 1)),
  };
}

function resolveSiteCenter(scene, definition, anchorCandidates) {
  const explicitPosition = definition && definition.position && typeof definition.position === "object"
    ? cloneVector(definition.position)
    : null;
  const siteRadiusMeters = Math.max(
    5_000,
    toFiniteNumber(config.miningGeneratedSiteRadiusMeters, DEFAULT_SITE_RADIUS_METERS),
  );
  if (explicitPosition) {
    return clampPositionOutsideSun(
      scene,
      explicitPosition,
      siteRadiusMeters + 50_000,
    );
  }

  const rawSiteIndex = Math.max(0, toInt(definition && definition.rawSiteIndex, 0));
  const family = String(definition && definition.family || "").trim().toLowerCase();
  const sourceAnchor =
    anchorCandidates[rawSiteIndex % anchorCandidates.length] || anchorCandidates[0];
  if (!sourceAnchor || !sourceAnchor.position) {
    return null;
  }
  return clampPositionOutsideSun(
    scene,
    buildFieldCenter(
      sourceAnchor.position,
      hashValue(
        (toInt(scene && scene.systemID, 0) * 12289) +
        (rawSiteIndex * 257) +
        (family === "gas" ? 17 : 5),
      ),
    ),
    siteRadiusMeters + 50_000,
  );
}

function buildSiteEntitiesFromDefinition(scene, definition, anchorCandidates) {
  const systemID = toInt(scene && scene.systemID, 0);
  const family = String(definition && definition.family || "").trim().toLowerCase();
  const rawSiteIndex = Math.max(0, toInt(definition && definition.rawSiteIndex, 0));
  if (
    systemID <= 0 ||
    (family !== "ice" && family !== "gas")
  ) {
    return [];
  }

  const center = resolveSiteCenter(scene, definition, anchorCandidates);
  if (!center) {
    return [];
  }

  const entities = [];
  if (definition && definition.materializeAnchor !== false) {
    const anchorEntity = buildAnchorEntity(family, systemID, rawSiteIndex, center);
    if (anchorEntity) {
      anchorEntity.itemName = String(definition && definition.label || anchorEntity.itemName).trim();
      anchorEntity.slimName = String(definition && definition.label || anchorEntity.slimName).trim();
      entities.push(anchorEntity);
    }
  }

  const members = Array.isArray(definition && definition.members)
    ? definition.members
    : [];
  for (const member of members) {
    const entity = buildMineableEntityFromDefinitionMember(
      family,
      systemID,
      rawSiteIndex,
      center,
      member,
      {
        generatedMiningSite: definition && definition.materializeAnchor !== false,
        siteID: definition && definition.siteID,
        instanceID: definition && definition.instanceID,
      },
    );
    if (!entity) {
      continue;
    }
    entity.position = clampPositionOutsideSun(
      scene,
      entity.position,
      Math.max(10_000, toFiniteNumber(entity.radius, 0) + 25_000),
    );
    entities.push(entity);
  }

  recordGeneratedSiteBootstrap(scene, {
    kind: family,
    siteIndex: rawSiteIndex,
    securityBand: String(definition && definition.securityBand || getSecurityBand(systemID)),
    mineableCount: members.length,
  });

  return entities;
}

function getChildCountForKind(kind) {
  return kind === "gas"
    ? Math.max(1, toInt(config.miningGasCloudsPerSite, DEFAULT_GAS_CLOUDS_PER_SITE))
    : Math.max(1, toInt(config.miningIceChunksPerSite, DEFAULT_ICE_CHUNKS_PER_SITE));
}

function buildSiteEntities(scene, kind, siteIndex, securityBand, anchorCandidates) {
  const systemID = toInt(scene && scene.systemID, 0);
  const templateTypeRecords = getTemplateTypeRecords(kind, securityBand);
  if (templateTypeRecords.length <= 0) {
    return [];
  }
  const sourceAnchor = anchorCandidates[siteIndex % anchorCandidates.length] || anchorCandidates[0];
  if (!sourceAnchor || !sourceAnchor.position) {
    return [];
  }
  const siteRadiusMeters = Math.max(
    5_000,
    toFiniteNumber(config.miningGeneratedSiteRadiusMeters, DEFAULT_SITE_RADIUS_METERS),
  );

  const center = clampPositionOutsideSun(
    scene,
    buildFieldCenter(
      sourceAnchor.position,
      hashValue(systemID * 12289 + siteIndex * 257 + (kind === "gas" ? 17 : 5)),
    ),
    siteRadiusMeters + 50_000,
  );
  const entities = [];
  const anchorEntity = buildAnchorEntity(kind, systemID, siteIndex, center);
  if (anchorEntity) {
    entities.push(anchorEntity);
  }

  const childCount = getChildCountForKind(kind);
  let mineableCount = 0;
  for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
    const templateType = pickTemplateType(
      templateTypeRecords,
      hashValue(systemID * 4099 + siteIndex * 97 + childIndex * 17),
    );
    const entity = buildMineableEntity(
      kind,
      systemID,
      siteIndex,
      childIndex,
      center,
      templateType,
    );
    if (entity) {
      entity.position = clampPositionOutsideSun(
        scene,
        entity.position,
        Math.max(10_000, toFiniteNumber(entity.radius, 0) + 25_000),
      );
      mineableCount += 1;
      entities.push(entity);
    }
  }

  recordGeneratedSiteBootstrap(scene, {
    kind,
    siteIndex,
    securityBand,
    mineableCount,
  });

  return entities;
}

function buildGeneratedResourceSitePlan(scene) {
  const systemID = toInt(scene && scene.systemID, 0);
  if (!scene || systemID <= 0) {
    return [];
  }
  const seededDefinitions = listSeededDungeonMiningSiteDefinitions(systemID);
  let generatedDefinitions = seededDefinitions;
  if (generatedDefinitions.length <= 0) {
    let allowFallbackDefinitions = true;
    try {
      const dungeonUniverseRuntime = require(path.join(
        __dirname,
        "../dungeon/dungeonUniverseRuntime",
      ));
      const status = dungeonUniverseRuntime.getUniverseReconcileStatus(Date.now());
      if (status && status.fullUpToDate === true) {
        allowFallbackDefinitions = false;
      }
    } catch (_error) {
      allowFallbackDefinitions = true;
    }
    generatedDefinitions = allowFallbackDefinitions
      ? buildGeneratedResourceSiteDefinitionsForSystem(systemID)
      : [];
  }
  const dungeonGasDefinitions = listActiveDungeonGasSiteDefinitions(systemID);
  if (generatedDefinitions.length <= 0 && dungeonGasDefinitions.length <= 0) {
    return [];
  }
  const anchorCandidates = getAnchorCandidates(scene);
  if (anchorCandidates.length <= 0) {
    return [];
  }

  return [
    ...generatedDefinitions.flatMap((definition) => (
      buildSiteEntitiesFromDefinition(scene, definition, anchorCandidates)
    )),
    ...dungeonGasDefinitions.flatMap((definition) => (
      buildSiteEntitiesFromDefinition(scene, definition, anchorCandidates)
    )),
  ];
}

function listGeneratedResourceSiteEntities(scene) {
  return (Array.isArray(scene && scene.staticEntities) ? scene.staticEntities : [])
    .filter((entity) => entity && entity.generatedMiningSite === true);
}

function listMaterializedResourceSiteEntities(scene) {
  return (Array.isArray(scene && scene.staticEntities) ? scene.staticEntities : [])
    .filter((entity) => (
      entity &&
      (
        entity.generatedMiningSite === true ||
        entity.dungeonMaterializedGasSite === true
      )
    ));
}

function handleSceneCreated(scene) {
  if (!scene || scene._miningResourceSitesInitialized === true) {
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  }

  scene._miningResourceSitesInitialized = true;
  const spawned = [];
  for (const entity of buildGeneratedResourceSitePlan(scene)) {
    if (scene.addStaticEntity(entity)) {
      spawned.push(entity);
    }
  }

  notifySignalTrackerAnomalyDelta(scene);

  return {
    success: true,
    data: {
      spawned,
    },
  };
}

function resetSceneGeneratedResourceSites(scene, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  resetMiningStartupSummary(scene);
  const removedEntityIDs = [];
  for (const entity of listMaterializedResourceSiteEntities(scene)) {
    const removeResult = scene.removeStaticEntity(entity.itemID, {
      broadcast: options.broadcast === true,
      nowMs: options.nowMs,
    });
    if (removeResult && removeResult.success) {
      removedEntityIDs.push(entity.itemID);
    }
  }

  scene._miningResourceSitesInitialized = false;
  const spawnResult = handleSceneCreated(scene);
  if (!spawnResult.success) {
    return spawnResult;
  }

  return {
    success: true,
    data: {
      removedEntityIDs,
      removedCount: removedEntityIDs.length,
      spawned: Array.isArray(spawnResult.data && spawnResult.data.spawned)
        ? spawnResult.data.spawned
        : [],
    },
  };
}

class MiningResourceSiteService extends BaseService {
  constructor() {
    super("miningResourceSite");
  }
}

module.exports = MiningResourceSiteService;
module.exports.handleSceneCreated = handleSceneCreated;
module.exports.resetSceneGeneratedResourceSites = resetSceneGeneratedResourceSites;
module.exports.buildGeneratedResourceSiteDefinitionsForSystem = buildGeneratedResourceSiteDefinitionsForSystem;
module.exports.buildGeneratedResourceSiteDefinition = buildGeneratedResourceSiteDefinition;
module.exports.resolveGeneratedMiningEntityDescriptor = resolveGeneratedMiningEntityDescriptor;
module.exports.resolveGeneratedSiteLocalIndex = resolveGeneratedSiteLocalIndex;
module.exports.resolveGeneratedSiteRawIndex = resolveGeneratedSiteRawIndex;
module.exports._testing = {
  buildGeneratedResourceSiteDefinition,
  buildGeneratedResourceSiteDefinitionsForSystem,
  buildGeneratedResourceSitePlan,
  getSecurityBand,
  getConfiguredSiteCount,
  getAnchorCandidates,
  resolveSunExclusionRadius,
  clampPositionOutsideSun,
  listGeneratedResourceSiteEntities,
  listMaterializedResourceSiteEntities,
  listSeededDungeonMiningSiteDefinitions,
  listActiveDungeonGasSiteDefinitions,
  resolveGeneratedMiningEntityDescriptor,
};
