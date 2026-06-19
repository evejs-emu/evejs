const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const database = require(path.join(__dirname, "../../newDatabase"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  classifyMiningMaterialType,
} = require("./miningInventory");
const {
  computeAsteroidRadiusFromQuantity,
} = require("./miningMath");
const {
  resolveMiningVisualPresentation,
} = require("./miningVisuals");
const {
  flushMiningStartupSummary,
  mergeMiningPresentationSummary,
} = require("./miningStartupSummary");

const MINING_RUNTIME_TABLE = "miningRuntimeState";
const MINING_RUNTIME_VERSION = 1;
const ASTEROID_DEPLETION_DESTRUCTION_EFFECT_ID = 2;
const WORMHOLE_SYSTEM_MIN = 31_000_000;
const WORMHOLE_SYSTEM_MAX = 31_999_999;
const ORE_GRADE_VARIANTS = Object.freeze([
  Object.freeze({
    suffix: "",
    weightMultiplier: 1,
    quantityMultiplier: 1,
  }),
  Object.freeze({
    suffix: " II-Grade",
    weightMultiplier: 0.45,
    quantityMultiplier: 1,
  }),
  Object.freeze({
    suffix: " III-Grade",
    weightMultiplier: 0.3,
    quantityMultiplier: 1,
  }),
  Object.freeze({
    suffix: " IV-Grade",
    weightMultiplier: 0.2,
    quantityMultiplier: 1,
  }),
]);
const DEFAULT_TEMPLATE_BY_FIELD_STYLE = Object.freeze({
  empire_highsec_standard: Object.freeze([
    { oreName: "Veldspar", weight: 5, quantityMultiplier: 1.2 },
    { oreName: "Scordite", weight: 4, quantityMultiplier: 1.15 },
    { oreName: "Pyroxeres", weight: 3, quantityMultiplier: 0.95 },
    { oreName: "Plagioclase", weight: 3, quantityMultiplier: 0.95 },
    { oreName: "Omber", weight: 2, quantityMultiplier: 0.75 },
    { oreName: "Kernite", weight: 1, quantityMultiplier: 0.65 },
  ]),
  empire_lowsec_standard: Object.freeze([
    { oreName: "Kernite", weight: 4, quantityMultiplier: 1.1 },
    { oreName: "Omber", weight: 3, quantityMultiplier: 1.0 },
    { oreName: "Jaspet", weight: 3, quantityMultiplier: 0.9 },
    { oreName: "Hemorphite", weight: 2, quantityMultiplier: 0.8 },
    { oreName: "Hedbergite", weight: 2, quantityMultiplier: 0.8 },
  ]),
  nullsec_standard: Object.freeze([
    { oreName: "Spodumain", weight: 4, quantityMultiplier: 1.0 },
    { oreName: "Gneiss", weight: 3, quantityMultiplier: 0.9 },
    { oreName: "Dark Ochre", weight: 3, quantityMultiplier: 0.85 },
    { oreName: "Crokite", weight: 3, quantityMultiplier: 0.8 },
    { oreName: "Bistot", weight: 2, quantityMultiplier: 0.75 },
    { oreName: "Arkonor", weight: 2, quantityMultiplier: 0.7 },
    { oreName: "Mercoxit", weight: 1, quantityMultiplier: 0.5 },
  ]),
  wormhole_standard: Object.freeze([
    { oreName: "Gneiss", weight: 4, quantityMultiplier: 1.0 },
    { oreName: "Spodumain", weight: 3, quantityMultiplier: 0.95 },
    { oreName: "Dark Ochre", weight: 3, quantityMultiplier: 0.9 },
    { oreName: "Crokite", weight: 2, quantityMultiplier: 0.8 },
    { oreName: "Bistot", weight: 2, quantityMultiplier: 0.75 },
    { oreName: "Arkonor", weight: 2, quantityMultiplier: 0.7 },
  ]),
});

let cachedTemplateEntries = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildMarshalDict(entries = []) {
  return {
    type: "dict",
    entries,
  };
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clamp(value, minimum, maximum) {
  return Math.min(
    Math.max(toFiniteNumber(value, minimum), minimum),
    maximum,
  );
}

function isWormholeSystemID(systemID) {
  const normalizedSystemID = toInt(systemID, 0);
  return (
    normalizedSystemID >= WORMHOLE_SYSTEM_MIN &&
    normalizedSystemID <= WORMHOLE_SYSTEM_MAX
  );
}

function normalizeStateRecord(record = {}) {
  return {
    version: MINING_RUNTIME_VERSION,
    entityID: toInt(record.entityID, 0),
    visualTypeID: toInt(record.visualTypeID, 0),
    beltID: toInt(record.beltID, 0),
    fieldStyleID: String(record.fieldStyleID || "").trim() || null,
    yieldTypeID: toInt(record.yieldTypeID, 0),
    yieldKind: String(record.yieldKind || "").trim().toLowerCase() || null,
    unitVolume: Math.max(0.000001, toFiniteNumber(record.unitVolume, 1)),
    originalQuantity: Math.max(0, toInt(record.originalQuantity, 0)),
    remainingQuantity: Math.max(0, toInt(record.remainingQuantity, 0)),
    originalRadius: Math.max(1, toFiniteNumber(record.originalRadius, 1)),
    updatedAtMs: Math.max(0, toInt(record.updatedAtMs, Date.now())),
  };
}

function isPersistedStateStillValid(scene, entity, persistedState, estimatedOriginalQuantity) {
  if (!persistedState || !entity) {
    return false;
  }

  if (toInt(persistedState.entityID, 0) !== toInt(entity.itemID, 0)) {
    return false;
  }
  if (
    toInt(entity.beltID, 0) > 0 &&
    toInt(persistedState.beltID, 0) > 0 &&
    toInt(persistedState.beltID, 0) !== toInt(entity.beltID, 0)
  ) {
    return false;
  }

  const persistedFieldStyleID = String(persistedState.fieldStyleID || "").trim();
  const entityFieldStyleID = String(entity.fieldStyleID || "").trim();
  if (persistedFieldStyleID && entityFieldStyleID && persistedFieldStyleID !== entityFieldStyleID) {
    return false;
  }
  if (toInt(persistedState.visualTypeID, 0) <= 0) {
    return false;
  }

  const entityRadius = Math.max(0, toFiniteNumber(entity.radius, 0));
  if (entityRadius > 50 && toFiniteNumber(persistedState.originalRadius, 0) <= 1) {
    return false;
  }
  if (
    estimatedOriginalQuantity >= 100 &&
    Math.max(0, toInt(persistedState.originalQuantity, 0)) <= 1
  ) {
    return false;
  }

  return true;
}

function buildTemplateEntries() {
  const entriesByFieldStyle = new Map();
  for (const [fieldStyleID, definitions] of Object.entries(DEFAULT_TEMPLATE_BY_FIELD_STYLE)) {
    const entries = definitions
      .flatMap((definition) => buildTemplateEntriesForOreDefinition(definition))
      .filter(Boolean);
    entriesByFieldStyle.set(fieldStyleID, entries);
  }
  return entriesByFieldStyle;
}

function buildTemplateEntriesForOreDefinition(definition) {
  const baseOreName = String(definition && definition.oreName || "").trim();
  if (!baseOreName) {
    return [];
  }

  const baseWeight = Math.max(0.000001, toFiniteNumber(definition && definition.weight, 1));
  const baseQuantityMultiplier = Math.max(
    0.1,
    toFiniteNumber(definition && definition.quantityMultiplier, 1),
  );
  const entries = [];
  const seenTypeIDs = new Set();
  for (const gradeVariant of ORE_GRADE_VARIANTS) {
    const oreName = `${baseOreName}${gradeVariant.suffix}`;
    const lookup = resolveItemByName(oreName);
    if (!lookup.success || !lookup.match) {
      continue;
    }

    const classification = classifyMiningMaterialType(lookup.match);
    if (!classification || classification.kind !== "ore") {
      continue;
    }

    const typeID = toInt(lookup.match.typeID, 0);
    if (typeID <= 0 || seenTypeIDs.has(typeID)) {
      continue;
    }
    seenTypeIDs.add(typeID);

    entries.push({
      typeID,
      typeRecord: lookup.match,
      baseOreName,
      oreName,
      gradeSuffix: gradeVariant.suffix || null,
      weight: Math.max(0.000001, baseWeight * gradeVariant.weightMultiplier),
      quantityMultiplier: Math.max(
        0.1,
        baseQuantityMultiplier * gradeVariant.quantityMultiplier,
      ),
    });
  }

  return entries;
}

function getTemplateEntries() {
  if (!cachedTemplateEntries) {
    cachedTemplateEntries = buildTemplateEntries();
  }
  return cachedTemplateEntries;
}

function getTemplateEntriesForFieldStyle(fieldStyleID) {
  return getTemplateEntries().get(String(fieldStyleID || "").trim()) || [];
}

function hashInteger(value) {
  let hash = toInt(value, 0) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function pickWeightedTemplateEntry(entity, entries) {
  const normalizedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (normalizedEntries.length <= 0) {
    return null;
  }

  const totalWeight = normalizedEntries.reduce(
    (sum, entry) => sum + Math.max(0, toFiniteNumber(entry.weight, 0)),
    0,
  );
  if (totalWeight <= 0) {
    return normalizedEntries[0] || null;
  }

  const seed =
    hashInteger(toInt(entity && entity.itemID, 0)) ^
    hashInteger(toInt(entity && entity.beltID, 0)) ^
    hashInteger(String(entity && entity.fieldStyleID || "").length * 8191);
  let cursor = (seed / 0xffffffff) * totalWeight;
  for (const entry of normalizedEntries) {
    cursor -= Math.max(0, toFiniteNumber(entry.weight, 0));
    if (cursor <= 0) {
      return entry;
    }
  }
  return normalizedEntries[normalizedEntries.length - 1] || null;
}

function isDecorativeAsteroidType(typeRecord) {
  const groupName = String(typeRecord && typeRecord.groupName || "").toLowerCase();
  const typeName = String(typeRecord && typeRecord.name || "").toLowerCase();
  return (
    groupName.includes("decorative asteroid") ||
    groupName.includes("phased asteroid") ||
    typeName.startsWith("cosmetic asteroid") ||
    typeName.startsWith("phased ")
  );
}

function resolveDirectYieldType(entity) {
  const candidateTypeIDs = [
    toInt(entity && entity.miningYieldTypeID, 0),
    toInt(entity && entity.slimTypeID, 0),
    toInt(entity && entity.typeID, 0),
  ].filter((value, index, array) => value > 0 && array.indexOf(value) === index);

  for (const candidateTypeID of candidateTypeIDs) {
    const typeRecord = resolveItemByTypeID(candidateTypeID) || null;
    if (!typeRecord) {
      continue;
    }
    if (!isDecorativeAsteroidType(typeRecord)) {
      const classification = classifyMiningMaterialType(typeRecord);
      if (classification) {
        return classification.typeRecord;
      }
    }

    const phasedMatch = /^phased\s+(.+)$/i.exec(String(typeRecord.name || "").trim());
    if (phasedMatch) {
      const lookup = resolveItemByName(phasedMatch[1]);
      if (lookup.success && lookup.match) {
        const classification = classifyMiningMaterialType(lookup.match);
        if (classification) {
          return classification.typeRecord;
        }
      }
    }
  }

  return null;
}

function resolveTemplateSetForEntity(scene, entity) {
  const fieldStyleID = String(entity && entity.fieldStyleID || "").trim();
  if (fieldStyleID) {
    const entries = getTemplateEntriesForFieldStyle(fieldStyleID);
    if (entries.length > 0) {
      return entries;
    }
  }

  const systemRecord = worldData.getSolarSystemByID(scene && scene.systemID);
  const securityStatus = toFiniteNumber(
    systemRecord && (systemRecord.securityStatus ?? systemRecord.security),
    0,
  );
  if (isWormholeSystemID(scene && scene.systemID)) {
    return getTemplateEntriesForFieldStyle("wormhole_standard");
  }
  if (securityStatus >= 0.45) {
    return getTemplateEntriesForFieldStyle("empire_highsec_standard");
  }
  if (securityStatus >= 0) {
    return getTemplateEntriesForFieldStyle("empire_lowsec_standard");
  }
  return getTemplateEntriesForFieldStyle("nullsec_standard");
}

function resolveYieldTypeForEntity(scene, entity) {
  const directType = resolveDirectYieldType(entity);
  if (directType) {
    return directType;
  }

  const templateEntry = pickWeightedTemplateEntry(
    entity,
    resolveTemplateSetForEntity(scene, entity),
  );
  return templateEntry ? templateEntry.typeRecord : null;
}

function estimateOriginalQuantity(scene, entity, yieldType, templateEntry = null) {
  const explicitQuantity = Math.max(
    0,
    toInt(
      entity &&
        (
          entity.resourceQuantity ??
          entity.mineableQuantity ??
          entity.originalQuantity
        ),
      0,
    ),
  );
  if (explicitQuantity > 0) {
    return explicitQuantity;
  }

  const unitVolume = Math.max(0.000001, toFiniteNumber(yieldType && yieldType.volume, 1));
  const quantityScale = Math.max(
    0.000001,
    toFiniteNumber(config.miningBeltQuantityScale, 0.08),
  );
  const quantityMultiplier = Math.max(
    0.1,
    toFiniteNumber(templateEntry && templateEntry.quantityMultiplier, 1),
  );
  const minimumVolume = Math.max(
    1,
    toFiniteNumber(config.miningBeltMinimumAsteroidVolumeM3, 15_000),
  );
  const maximumVolume = Math.max(
    minimumVolume,
    toFiniteNumber(config.miningBeltMaximumAsteroidVolumeM3, 3_000_000),
  );
  const estimatedVolume = clamp(
    (toFiniteNumber(entity && entity.radius, 0) ** 2) * quantityScale * quantityMultiplier,
    minimumVolume,
    maximumVolume,
  );
  return Math.max(1, Math.round(estimatedVolume / unitVolume));
}

function createMiningPresentationSummary(systemID) {
  return {
    systemID: toInt(systemID, 0),
    updatedCount: 0,
    oreCount: 0,
    iceCount: 0,
    gasCount: 0,
    otherCount: 0,
    oreRemainingQuantity: 0,
    iceRemainingQuantity: 0,
    gasRemainingQuantity: 0,
    otherRemainingQuantity: 0,
    withGraphicCount: 0,
  };
}

function recordMiningPresentationSummary(summary, entity, state) {
  if (!summary || !state) {
    return;
  }

  summary.updatedCount += 1;
  const remainingQuantity = Math.max(0, toInt(state.remainingQuantity, 0));
  const yieldKind = String(state.yieldKind || "").trim().toLowerCase();

  if (yieldKind === "ice") {
    summary.iceCount += 1;
    summary.iceRemainingQuantity += remainingQuantity;
  } else if (yieldKind === "gas") {
    summary.gasCount += 1;
    summary.gasRemainingQuantity += remainingQuantity;
  } else if (yieldKind === "ore") {
    summary.oreCount += 1;
    summary.oreRemainingQuantity += remainingQuantity;
  } else {
    summary.otherCount += 1;
    summary.otherRemainingQuantity += remainingQuantity;
  }

  if (
    toInt(entity && entity.graphicID, 0) > 0 ||
    toInt(entity && entity.slimGraphicID, 0) > 0
  ) {
    summary.withGraphicCount += 1;
  }
}

function logMiningPresentationSummary(scene, summary) {
  if (!scene || !summary) {
    return;
  }

  mergeMiningPresentationSummary(scene, summary);
  flushMiningStartupSummary(scene);
}

function applyYieldPresentationToEntity(entity, state, summary = null) {
  if (!entity || !state) {
    return;
  }

  const yieldTypeRecord = resolveItemByTypeID(toInt(state.yieldTypeID, 0)) || null;
  const resolvedPresentation =
    typeof resolveMiningVisualPresentation === "function" && yieldTypeRecord
      ? (() => {
          try {
            return resolveMiningVisualPresentation(yieldTypeRecord, {
              entityID: toInt(entity && entity.itemID, 0),
              radius: state.originalRadius || entity.radius,
            });
          } catch (_error) {
            return null;
          }
        })()
      : null;

  const preferredVisualTypeID = toInt(
    state.visualTypeID ||
      (resolvedPresentation && resolvedPresentation.visualTypeID) ||
      entity.visualTypeID ||
      entity.typeID,
    0,
  );
  const spaceTypeRecord = resolveItemByTypeID(preferredVisualTypeID) || null;
  if (preferredVisualTypeID > 0) {
    entity.visualTypeID = preferredVisualTypeID;
  }
  if (spaceTypeRecord) {
    entity.typeID = spaceTypeRecord.typeID;
    entity.groupID = spaceTypeRecord.groupID;
    entity.categoryID = spaceTypeRecord.categoryID;
  }

  if (yieldTypeRecord) {
    entity.miningYieldTypeID = yieldTypeRecord.typeID;
    entity.miningYieldKind = state.yieldKind || null;
    entity.slimTypeID = yieldTypeRecord.typeID;
    entity.slimGroupID = yieldTypeRecord.groupID;
    entity.slimCategoryID = yieldTypeRecord.categoryID;
    entity.itemName = yieldTypeRecord.name;
    entity.slimName = yieldTypeRecord.name;
  } else if (spaceTypeRecord) {
    entity.slimTypeID = spaceTypeRecord.typeID;
    entity.slimGroupID = spaceTypeRecord.groupID;
    entity.slimCategoryID = spaceTypeRecord.categoryID;
    entity.itemName = spaceTypeRecord.name;
    entity.slimName = spaceTypeRecord.name;
  }

  const resolvedGraphicID = toInt(
    (resolvedPresentation && resolvedPresentation.graphicID) ||
      entity.graphicID ||
      entity.slimGraphicID,
    0,
  );
  if (resolvedGraphicID > 0) {
    entity.graphicID = resolvedGraphicID;
    entity.slimGraphicID = resolvedGraphicID;
  }

  if (state.remainingQuantity > 0) {
    const minimumRadiusRatio = Math.max(
      0.01,
      toFiniteNumber(config.miningDepletedAsteroidRadiusRatio, 0.25),
    );
    const minimumRuntimeRadius = Math.max(1, state.originalRadius * minimumRadiusRatio);
    const computedRadius = computeAsteroidRadiusFromQuantity(
      state.yieldTypeID,
      state.remainingQuantity,
      {
        unitVolume: state.unitVolume,
        fallbackScale: Math.max(
          0.000001,
          toFiniteNumber(config.miningBeltQuantityScale, 0.08),
        ),
        fallbackMinRadius: Math.max(250, state.originalRadius * 0.2),
        fallbackMaxRadius: Math.max(state.originalRadius, entity.radius),
      },
    );
    entity.radius = clamp(
      computedRadius,
      minimumRuntimeRadius,
      Math.max(minimumRuntimeRadius, state.originalRadius),
    );
  }
  recordMiningPresentationSummary(summary, entity, state);
}

function resolveDepletionDestructionEffectID(entity, state) {
  const kind = String(entity && entity.kind || "").trim().toLowerCase();
  const yieldKind = String(state && state.yieldKind || "").trim().toLowerCase();
  if (kind === "asteroid" || yieldKind === "ore") {
    return ASTEROID_DEPLETION_DESTRUCTION_EFFECT_ID;
  }
  return 0;
}

function shouldPersistMineableState(entity) {
  if (!entity) {
    return false;
  }
  return !(
    entity.dungeonMaterializedSiteContent === true ||
    entity.dungeonSiteContentMissionObjectiveTarget === true ||
    toInt(entity.dungeonSiteInstanceID, 0) > 0
  );
}

function buildSceneCache(scene, persistedByEntityID = {}) {
  return {
    version: MINING_RUNTIME_VERSION,
    persistedByEntityID,
    byEntityID: new Map(),
  };
}

function readPersistedSystemState(systemID) {
  const result = database.read(
    MINING_RUNTIME_TABLE,
    `/systems/${String(toInt(systemID, 0))}/entities`,
  );
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function areMiningStatesEquivalent(left, right) {
  if (!left || !right) {
    return false;
  }
  return (
    toInt(left.entityID, 0) === toInt(right.entityID, 0) &&
    toInt(left.visualTypeID, 0) === toInt(right.visualTypeID, 0) &&
    toInt(left.beltID, 0) === toInt(right.beltID, 0) &&
    String(left.fieldStyleID || "").trim() === String(right.fieldStyleID || "").trim() &&
    toInt(left.yieldTypeID, 0) === toInt(right.yieldTypeID, 0) &&
    String(left.yieldKind || "").trim().toLowerCase() === String(right.yieldKind || "").trim().toLowerCase() &&
    Math.abs(toFiniteNumber(left.unitVolume, 0) - toFiniteNumber(right.unitVolume, 0)) < 0.000001 &&
    toInt(left.originalQuantity, 0) === toInt(right.originalQuantity, 0) &&
    toInt(left.remainingQuantity, 0) === toInt(right.remainingQuantity, 0) &&
    Math.abs(toFiniteNumber(left.originalRadius, 0) - toFiniteNumber(right.originalRadius, 0)) < 0.000001
  );
}

function writePersistedState(scene, state, options = {}) {
  const existingPersistedState = options && options.existingPersistedState
    ? normalizeStateRecord(options.existingPersistedState)
    : null;
  const shouldPersistBaseline = options && options.persistBaseline === true;
  if (
    !shouldPersistBaseline &&
    !existingPersistedState &&
    toInt(state && state.remainingQuantity, 0) === toInt(state && state.originalQuantity, 0)
  ) {
    return false;
  }
  if (existingPersistedState && areMiningStatesEquivalent(existingPersistedState, state)) {
    return false;
  }

  database.write(
    MINING_RUNTIME_TABLE,
    `/systems/${String(toInt(scene && scene.systemID, 0))}/entities/${String(toInt(state && state.entityID, 0))}`,
    cloneValue(state),
  );
  const persistedByEntityID =
    (options && options.persistedByEntityID && typeof options.persistedByEntityID === "object")
      ? options.persistedByEntityID
      : (
          scene &&
          scene._miningRuntimeState &&
          scene._miningRuntimeState.persistedByEntityID &&
          typeof scene._miningRuntimeState.persistedByEntityID === "object"
            ? scene._miningRuntimeState.persistedByEntityID
            : null
        );
  if (persistedByEntityID) {
    persistedByEntityID[String(toInt(state && state.entityID, 0))] = cloneValue(state);
  }
  return true;
}

function buildMineableState(scene, entity, persistedState = null) {
  const rawPersistedState = persistedState
    ? normalizeStateRecord(persistedState)
    : null;
  const templateEntry = pickWeightedTemplateEntry(
    entity,
    resolveTemplateSetForEntity(scene, entity),
  );
  const yieldType =
    resolveItemByTypeID(
      toInt(rawPersistedState && rawPersistedState.yieldTypeID, 0),
    ) ||
    resolveYieldTypeForEntity(scene, entity);
  const classification = classifyMiningMaterialType(yieldType);
  if (!yieldType || !classification) {
    return null;
  }
  const estimatedOriginalQuantity = estimateOriginalQuantity(
    scene,
    entity,
    yieldType,
    templateEntry,
  );
  const normalizedPersistedState = isPersistedStateStillValid(
    scene,
    entity,
    rawPersistedState,
    estimatedOriginalQuantity,
  )
    ? rawPersistedState
    : null;

  const originalRadius = Math.max(
    1,
    toFiniteNumber(
      normalizedPersistedState
        ? normalizedPersistedState.originalRadius
        : undefined,
      entity && entity.radius,
    ),
  );
  const originalQuantity = Math.max(
    1,
    toInt(
      normalizedPersistedState
        ? normalizedPersistedState.originalQuantity
        : undefined,
      estimatedOriginalQuantity,
    ),
  );
  const remainingQuantity = clamp(
    toInt(
      normalizedPersistedState
        ? normalizedPersistedState.remainingQuantity
        : undefined,
      originalQuantity,
    ),
    0,
    originalQuantity,
  );

  return normalizeStateRecord({
    entityID: entity.itemID,
    visualTypeID: toInt(
      normalizedPersistedState
        ? normalizedPersistedState.visualTypeID
        : undefined,
      entity.visualTypeID || entity.typeID,
    ),
    beltID: entity.beltID,
    fieldStyleID: entity.fieldStyleID || null,
    yieldTypeID: yieldType.typeID,
    yieldKind: classification.kind,
    unitVolume: Math.max(0.000001, toFiniteNumber(yieldType.volume, 1)),
    originalQuantity,
    remainingQuantity,
    originalRadius,
    updatedAtMs: normalizedPersistedState
      ? toInt(normalizedPersistedState.updatedAtMs, Date.now())
      : Date.now(),
  });
}

function isMineableStaticEntity(entity) {
  if (!entity || toInt(entity.itemID, 0) <= 0) {
    return false;
  }
  if (entity.generatedMiningSiteAnchor === true) {
    return false;
  }
  if (String(entity.kind || "").toLowerCase() === "asteroid") {
    return true;
  }

  const typeRecord = resolveItemByTypeID(toInt(entity.typeID, 0)) || null;
  return Boolean(typeRecord && (classifyMiningMaterialType(typeRecord) || isDecorativeAsteroidType(typeRecord)));
}

function ensureSceneMiningState(scene) {
  if (!scene) {
    return null;
  }
  if (scene._miningRuntimeState) {
    return scene._miningRuntimeState;
  }

  const persistedByEntityID = readPersistedSystemState(scene.systemID);
  const cache = buildSceneCache(scene, persistedByEntityID);
  const presentationSummary = createMiningPresentationSummary(scene.systemID);

  for (const entity of [...(scene.staticEntities || [])]) {
    if (!isMineableStaticEntity(entity)) {
      continue;
    }

    entity.systemID = toInt(scene && scene.systemID, 0);
    const persistState = shouldPersistMineableState(entity);
    const persistedState = persistState
      ? persistedByEntityID[String(toInt(entity.itemID, 0))] || null
      : null;
    const state = buildMineableState(scene, entity, persistedState);
    if (!state) {
      continue;
    }

    if (state.remainingQuantity <= 0) {
      scene.removeStaticEntity(entity.itemID, {
        broadcast: false,
      });
      cache.byEntityID.set(state.entityID, state);
      if (persistState) {
        writePersistedState(scene, state, {
          existingPersistedState: persistedState,
          persistedByEntityID,
          persistBaseline: true,
        });
      }
      continue;
    }

    applyYieldPresentationToEntity(entity, state, presentationSummary);
    cache.byEntityID.set(state.entityID, state);
    if (persistState) {
      writePersistedState(scene, state, {
        existingPersistedState: persistedState,
        persistedByEntityID,
        persistBaseline: false,
      });
    }
  }

  scene._miningRuntimeState = cache;
  logMiningPresentationSummary(scene, presentationSummary);
  return cache;
}

function getMineableState(scene, entityID) {
  const cache = ensureSceneMiningState(scene);
  if (!cache) {
    return null;
  }
  return cache.byEntityID.get(toInt(entityID, 0)) || null;
}

function updateMineableState(scene, entity, nextState, options = {}) {
  const cache = ensureSceneMiningState(scene);
  if (!cache || !entity || !nextState) {
    return {
      success: false,
      errorMsg: "MINEABLE_NOT_FOUND",
    };
  }

  const normalizedState = normalizeStateRecord(nextState);
  if (shouldPersistMineableState(entity)) {
    writePersistedState(scene, normalizedState, {
      existingPersistedState:
        cache.persistedByEntityID[String(normalizedState.entityID)] || null,
      persistBaseline: true,
    });
  }
  cache.byEntityID.set(normalizedState.entityID, normalizedState);

  if (normalizedState.remainingQuantity <= 0) {
    if (typeof scene.clearAllTargetingForEntity === "function") {
      scene.clearAllTargetingForEntity(entity, {
        reason: "Exploding",
        nowMs: options.nowMs,
      });
    }
    try {
      const droneRuntime = require(path.join(__dirname, "../drone/droneRuntime"));
      if (droneRuntime && typeof droneRuntime.idleMiningDronesTargeting === "function") {
        droneRuntime.idleMiningDronesTargeting(scene, normalizedState.entityID, {
          excludeDroneID: options.sourceDroneID,
        });
      }
    } catch (_) {
      // Drone runtime may be unavailable during isolated mining-state tests.
    }
    if (
      typeof scene.removeStaticEntity === "function" &&
      scene.getEntityByID &&
      scene.getEntityByID(normalizedState.entityID)
    ) {
      scene.removeStaticEntity(normalizedState.entityID, {
        broadcast: options.broadcast !== false,
        nowMs: options.nowMs,
        terminalDestructionEffectID: resolveDepletionDestructionEffectID(
          entity,
          normalizedState,
        ),
      });
    }
  } else {
    applyYieldPresentationToEntity(entity, normalizedState);
  }

  return {
    success: true,
    data: {
      state: normalizedState,
    },
  };
}

function resolveOreMinedSession(options = {}) {
  const candidate =
    options.session ||
    (options.sourceEntity && options.sourceEntity.session) ||
    null;
  return candidate && typeof candidate.sendNotification === "function"
    ? candidate
    : null;
}

function resolveOreMinedCharacterID(sourceEntity, session) {
  return toInt(
    sourceEntity && (
      sourceEntity.characterID ||
      sourceEntity.pilotCharacterID
    ),
    toInt(
      session && (
        session.characterID ||
        session.charID ||
        session.charid ||
        session.characterId
      ),
      toInt(sourceEntity && sourceEntity.ownerID, 0),
    ),
  );
}

function resolveOreMinedSystemID(scene, sourceEntity, session) {
  return toInt(
    scene && (scene.systemID || scene.solarSystemID),
    toInt(
      sourceEntity && sourceEntity.systemID,
      toInt(
        session && (
          session.solarsystemid2 ||
          session.solarsystemid ||
          (session._space && session._space.systemID)
        ),
        0,
      ),
    ),
  );
}

function notifyOreMined(scene, entity, previousState, deltaData, options = {}) {
  if (options.notifyOreMined === false) {
    return false;
  }
  if (!options.sourceEntity && !options.moduleItem) {
    return false;
  }

  const session = resolveOreMinedSession(options);
  if (!session) {
    return false;
  }

  const sourceEntity = options.sourceEntity || {};
  const moduleItem = options.moduleItem || {};
  const yieldTypeID = toInt(previousState && previousState.yieldTypeID, 0);
  const yieldTypeRecord = resolveItemByTypeID(yieldTypeID) || {};
  const moduleTypeID = toInt(
    options.moduleTypeID,
    toInt(moduleItem && moduleItem.typeID, 0),
  );
  const moduleTypeRecord = resolveItemByTypeID(moduleTypeID) || {};
  const shipTypeID = toInt(
    options.shipTypeID,
    toInt(sourceEntity && sourceEntity.typeID, 0),
  );
  const shipTypeRecord = resolveItemByTypeID(shipTypeID) || {};
  const quantityAdded = Math.max(0, toInt(options.quantityAdded, 0));
  const amountWasted = Math.max(
    0,
    toInt(options.amountWasted, toInt(options.wastedQuantity, 0)),
  );
  const quantityRemoved = Math.max(
    0,
    toInt(
      options.quantityRemoved,
      toInt(deltaData && deltaData.depletedQuantity, 0),
    ),
  );
  if (quantityAdded <= 0 && quantityRemoved <= 0 && amountWasted <= 0) {
    return false;
  }

  const systemID = resolveOreMinedSystemID(scene, sourceEntity, session);
  const systemRecord = worldData.getSolarSystemByID(systemID) || {};
  const payload = buildMarshalDict([
    [
      "itemID",
      toInt(entity && entity.itemID, toInt(previousState && previousState.entityID, 0)),
    ],
    ["quantity_added", quantityAdded],
    [
      "shipGroupID",
      toInt(
        options.shipGroupID,
        toInt(sourceEntity && sourceEntity.groupID, toInt(shipTypeRecord.groupID, 0)),
      ),
    ],
    ["amountCritBonus", Math.max(0, toInt(options.amountCritBonus, 0))],
    ["hasRewards", options.hasRewards === true],
    ["oreType", yieldTypeID],
    ["oreGroupID", toInt(options.oreGroupID, toInt(yieldTypeRecord.groupID, 0))],
    ["quantity_removed", quantityRemoved],
    [
      "moduleItemID",
      toInt(options.moduleItemID, toInt(moduleItem && moduleItem.itemID, 0)),
    ],
    [
      "solarSystemFactionID",
      toInt(options.solarSystemFactionID, toInt(systemRecord.factionID, 0)),
    ],
    ["amountWasted", amountWasted],
    ["shipTypeID", shipTypeID],
    ["moduleTypeID", moduleTypeID],
    ["solarsystemID", systemID],
    ["shipID", toInt(options.shipID, toInt(sourceEntity && sourceEntity.itemID, 0))],
    ["charID", resolveOreMinedCharacterID(sourceEntity, session)],
    [
      "moduleGroupID",
      toInt(
        options.moduleGroupID,
        toInt(moduleItem && moduleItem.groupID, toInt(moduleTypeRecord.groupID, 0)),
      ),
    ],
  ]);

  session.sendNotification("OnOreMined", "charid", [payload]);
  return true;
}

function applyMiningDelta(scene, entity, minedQuantity, wastedQuantity, options = {}) {
  const currentState = getMineableState(scene, entity && entity.itemID);
  if (!currentState) {
    return {
      success: false,
      errorMsg: "MINEABLE_NOT_FOUND",
    };
  }

  const depletedQuantity = Math.max(
    0,
    toInt(minedQuantity, 0) + toInt(wastedQuantity, 0),
  );
  const nextState = normalizeStateRecord({
    ...currentState,
    remainingQuantity: Math.max(0, currentState.remainingQuantity - depletedQuantity),
    updatedAtMs: options.nowMs ?? Date.now(),
  });

  const updateResult = updateMineableState(scene, entity, nextState, options);
  if (!updateResult.success) {
    return updateResult;
  }

  const deltaData = {
    previousState: currentState,
    state: nextState,
    depleted: nextState.remainingQuantity <= 0,
    depletedQuantity,
  };
  notifyOreMined(scene, entity, currentState, deltaData, {
    ...options,
    wastedQuantity,
  });

  return {
    success: true,
    data: deltaData,
  };
}

function clearPersistedSystemState(systemID) {
  const normalizedSystemID = toInt(systemID, 0);
  if (normalizedSystemID <= 0) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const removeResult = database.remove(
    MINING_RUNTIME_TABLE,
    `/systems/${String(normalizedSystemID)}`,
  );
  if (
    !removeResult.success &&
    removeResult.errorMsg !== "ENTRY_NOT_FOUND"
  ) {
    return removeResult;
  }

  return {
    success: true,
    data: {
      systemID: normalizedSystemID,
    },
  };
}

function summarizeSceneMiningState(scene) {
  const cache = ensureSceneMiningState(scene);
  if (!cache) {
    return null;
  }

  const activeStaticEntityIDs = new Set(
    [...(scene && scene.staticEntities ? scene.staticEntities : [])]
      .map((entity) => toInt(entity && entity.itemID, 0))
      .filter((entityID) => entityID > 0),
  );
  const summary = {
    systemID: toInt(scene && scene.systemID, 0),
    trackedCount: 0,
    activeCount: 0,
    depletedCount: 0,
    oreCount: 0,
    iceCount: 0,
    gasCount: 0,
    activeAsteroidEntityCount: [...(scene && scene.staticEntities ? scene.staticEntities : [])]
      .filter((entity) => String(entity && entity.kind || "").toLowerCase() === "asteroid")
      .length,
  };

  for (const state of cache.byEntityID.values()) {
    if (!state) {
      continue;
    }
    summary.trackedCount += 1;
    if (state.remainingQuantity > 0 && activeStaticEntityIDs.has(toInt(state.entityID, 0))) {
      summary.activeCount += 1;
    } else {
      summary.depletedCount += 1;
    }

    if (state.yieldKind === "ice") {
      summary.iceCount += 1;
    } else if (state.yieldKind === "gas") {
      summary.gasCount += 1;
    } else {
      summary.oreCount += 1;
    }
  }

  return summary;
}

function resetSceneMiningState(scene, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const clearResult = clearPersistedSystemState(scene.systemID);
  if (!clearResult.success) {
    return clearResult;
  }

  let asteroidResetResult = null;
  if (options.rebuildAsteroids !== false) {
    const asteroidService = require(path.join(__dirname, "../../space/asteroids"));
    if (
      asteroidService &&
      typeof asteroidService.resetSceneAsteroidFields === "function"
    ) {
      asteroidResetResult = asteroidService.resetSceneAsteroidFields(scene, {
        broadcast: options.broadcast === true,
        nowMs: options.nowMs,
      });
      if (!asteroidResetResult.success) {
        return asteroidResetResult;
      }
    }
  }

  let generatedResourceSiteResetResult = null;
  if (options.rebuildResourceSites !== false) {
    const miningResourceSiteService = require("./miningResourceSiteService");
    if (
      miningResourceSiteService &&
      typeof miningResourceSiteService.resetSceneGeneratedResourceSites === "function"
    ) {
      generatedResourceSiteResetResult =
        miningResourceSiteService.resetSceneGeneratedResourceSites(scene, {
          broadcast: options.broadcast === true,
          nowMs: options.nowMs,
        });
      if (!generatedResourceSiteResetResult.success) {
        return generatedResourceSiteResetResult;
      }
    }
  }

  scene._miningRuntimeState = null;
  const cache = ensureSceneMiningState(scene);
  return {
    success: true,
    data: {
      systemID: toInt(scene.systemID, 0),
      mineableCount: cache ? cache.byEntityID.size : 0,
      asteroidResetResult:
        asteroidResetResult && asteroidResetResult.data
          ? asteroidResetResult.data
          : null,
      generatedResourceSiteResetResult:
        generatedResourceSiteResetResult && generatedResourceSiteResetResult.data
          ? generatedResourceSiteResetResult.data
          : null,
      summary: summarizeSceneMiningState(scene),
    },
  };
}

module.exports = {
  MINING_RUNTIME_TABLE,
  ensureSceneMiningState,
  getMineableState,
  updateMineableState,
  applyMiningDelta,
  isMineableStaticEntity,
  shouldPersistMineableState,
  clearPersistedSystemState,
  summarizeSceneMiningState,
  resetSceneMiningState,
  _testing: {
    getTemplateEntriesForFieldStyle,
    buildTemplateEntriesForOreDefinition,
    ORE_GRADE_VARIANTS,
  },
};
