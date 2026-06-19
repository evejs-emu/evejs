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
  return value && typeof value === "object" ? value : {};
}

function normalizePayload(payload = {}) {
  return {
    version: toInt(payload.version, 0),
    generatedAt: String(payload.generatedAt || "").trim(),
    source: normalizeObject(payload.source),
    counts: normalizeObject(payload.counts),
    meta: normalizeObject(payload.meta),
    sourcePriorities: normalizeObject(payload.sourcePriorities),
    sourceConfidence: normalizeObject(payload.sourceConfidence),
    spawnProfiles: normalizeObject(payload.spawnProfiles),
    coverage: normalizeObject(payload.coverage),
    clientData: normalizeObject(payload.clientData),
    templatesByID: normalizeObject(payload.templatesByID),
    indexes: normalizeObject(payload.indexes),
  };
}

function buildCache() {
  const payload = normalizePayload(readStaticTable(TABLE.DUNGEON_AUTHORITY));
  const templatesByID = new Map();
  const templatesBySourceDungeonID = new Map();
  const templatesBySource = new Map();
  const templatesByFamily = new Map();
  const templatesByDungeonNameID = new Map();
  const templatesByArchetypeID = new Map();
  const templatesByResourceTypeID = new Map();
  const archetypesByID = new Map();
  const clientDungeonsByID = new Map();
  const objectiveChainsByID = new Map();
  const objectiveTypesByID = new Map();
  const spawnProfilesByFamily = new Map();

  for (const [templateID, template] of Object.entries(payload.templatesByID || {})) {
    const normalizedTemplate = {
      ...template,
      templateID,
      source: String(template && template.source || "").trim().toLowerCase() || "unknown",
      siteFamily: String(template && template.siteFamily || "").trim().toLowerCase() || "unknown",
      sourceDungeonID:
        template && template.sourceDungeonID != null
          ? toInt(template.sourceDungeonID, 0)
          : null,
      archetypeID:
        template && template.archetypeID != null
          ? toInt(template.archetypeID, 0)
          : null,
    };
    templatesByID.set(templateID, normalizedTemplate);

    if (normalizedTemplate.sourceDungeonID && normalizedTemplate.sourceDungeonID > 0) {
      templatesBySourceDungeonID.set(normalizedTemplate.sourceDungeonID, normalizedTemplate);
    }

    if (!templatesBySource.has(normalizedTemplate.source)) {
      templatesBySource.set(normalizedTemplate.source, []);
    }
    templatesBySource.get(normalizedTemplate.source).push(normalizedTemplate);

    if (!templatesByFamily.has(normalizedTemplate.siteFamily)) {
      templatesByFamily.set(normalizedTemplate.siteFamily, []);
    }
    templatesByFamily.get(normalizedTemplate.siteFamily).push(normalizedTemplate);

    if (toInt(normalizedTemplate.dungeonNameID, 0) > 0) {
      const dungeonNameID = toInt(normalizedTemplate.dungeonNameID, 0);
      if (!templatesByDungeonNameID.has(dungeonNameID)) {
        templatesByDungeonNameID.set(dungeonNameID, []);
      }
      templatesByDungeonNameID.get(dungeonNameID).push(normalizedTemplate);
    }

    if (normalizedTemplate.archetypeID && normalizedTemplate.archetypeID > 0) {
      if (!templatesByArchetypeID.has(normalizedTemplate.archetypeID)) {
        templatesByArchetypeID.set(normalizedTemplate.archetypeID, []);
      }
      templatesByArchetypeID.get(normalizedTemplate.archetypeID).push(normalizedTemplate);
    }

    const resourceComposition =
      normalizedTemplate &&
      normalizedTemplate.resourceComposition &&
      typeof normalizedTemplate.resourceComposition === "object"
        ? normalizedTemplate.resourceComposition
        : {};
    const resourceTypeIDs = [
      ...(Array.isArray(resourceComposition.oreTypeIDs) ? resourceComposition.oreTypeIDs : []),
      ...(Array.isArray(resourceComposition.gasTypeIDs) ? resourceComposition.gasTypeIDs : []),
      ...(Array.isArray(resourceComposition.iceTypeIDs) ? resourceComposition.iceTypeIDs : []),
    ]
      .map((entry) => toInt(entry, 0))
      .filter((entry) => entry > 0);
    for (const resourceTypeID of [...new Set(resourceTypeIDs)]) {
      if (!templatesByResourceTypeID.has(resourceTypeID)) {
        templatesByResourceTypeID.set(resourceTypeID, []);
      }
      templatesByResourceTypeID.get(resourceTypeID).push(normalizedTemplate);
    }
  }

  const rawArchetypesByID =
    payload.clientData &&
    payload.clientData.tables &&
    payload.clientData.tables.archetypesByID
      ? payload.clientData.tables.archetypesByID
      : {};
  for (const [archetypeID, archetype] of Object.entries(rawArchetypesByID)) {
    archetypesByID.set(toInt(archetypeID, 0), archetype);
  }

  const rawDungeonsByID =
    payload.clientData &&
    payload.clientData.tables &&
    payload.clientData.tables.dungeonsByID
      ? payload.clientData.tables.dungeonsByID
      : {};
  for (const [dungeonID, dungeon] of Object.entries(rawDungeonsByID)) {
    clientDungeonsByID.set(toInt(dungeonID, 0), dungeon);
  }

  const rawObjectiveChainsByID =
    payload.clientData &&
    payload.clientData.tables &&
    payload.clientData.tables.objectiveChainsByID
      ? payload.clientData.tables.objectiveChainsByID
      : {};
  for (const [objectiveChainID, objectiveChain] of Object.entries(rawObjectiveChainsByID)) {
    objectiveChainsByID.set(toInt(objectiveChainID, 0), clone(objectiveChain));
  }

  const rawObjectiveTypesByID =
    payload.clientData &&
    payload.clientData.tables &&
    payload.clientData.tables.objectiveTypesByID
      ? payload.clientData.tables.objectiveTypesByID
      : {};
  for (const [objectiveTypeID, objectiveType] of Object.entries(rawObjectiveTypesByID)) {
    objectiveTypesByID.set(toInt(objectiveTypeID, 0), clone(objectiveType));
  }

  const rawSpawnProfiles =
    payload &&
    payload.spawnProfiles &&
    payload.spawnProfiles.families &&
    typeof payload.spawnProfiles.families === "object"
      ? payload.spawnProfiles.families
      : {};
  for (const [family, profile] of Object.entries(rawSpawnProfiles)) {
    const normalizedFamily = String(family || "").trim().toLowerCase();
    if (!normalizedFamily || !profile || typeof profile !== "object") {
      continue;
    }
    spawnProfilesByFamily.set(normalizedFamily, clone(profile));
  }

  return {
    payload,
    templatesByID,
    templatesBySourceDungeonID,
    templatesBySource,
    templatesByFamily,
    templatesByDungeonNameID,
    templatesByArchetypeID,
    templatesByResourceTypeID,
    archetypesByID,
    clientDungeonsByID,
    objectiveChainsByID,
    objectiveTypesByID,
    spawnProfilesByFamily,
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

function getTemplateByID(templateID) {
  const template = ensureCache().templatesByID.get(String(templateID || "").trim());
  return template ? clone(template) : null;
}

function getClientDungeonTemplate(sourceDungeonID) {
  const template = ensureCache().templatesBySourceDungeonID.get(toInt(sourceDungeonID, 0));
  return template ? clone(template) : null;
}

function listTemplatesByFamily(siteFamily) {
  const normalizedFamily = String(siteFamily || "").trim().toLowerCase();
  return clone(ensureCache().templatesByFamily.get(normalizedFamily) || []);
}

function listTemplatesBySource(source) {
  const normalizedSource = String(source || "").trim().toLowerCase();
  return clone(ensureCache().templatesBySource.get(normalizedSource) || []);
}

function listTemplatesByDungeonNameID(dungeonNameID) {
  return clone(
    ensureCache().templatesByDungeonNameID.get(toInt(dungeonNameID, 0)) || [],
  );
}

function listTemplatesByArchetypeID(archetypeID) {
  return clone(
    ensureCache().templatesByArchetypeID.get(toInt(archetypeID, 0)) || [],
  );
}

function listTemplatesByResourceTypeID(resourceTypeID) {
  return clone(
    ensureCache().templatesByResourceTypeID.get(toInt(resourceTypeID, 0)) || [],
  );
}

function getArchetypeByID(archetypeID) {
  const archetype = ensureCache().archetypesByID.get(toInt(archetypeID, 0));
  return archetype ? clone(archetype) : null;
}

function getClientDungeonByID(dungeonID) {
  const dungeon = ensureCache().clientDungeonsByID.get(toInt(dungeonID, 0));
  return dungeon ? clone(dungeon) : null;
}

function getObjectiveChainByID(objectiveChainID) {
  const objectiveChain = ensureCache().objectiveChainsByID.get(toInt(objectiveChainID, 0));
  return objectiveChain ? clone(objectiveChain) : null;
}

function getObjectiveTypeByID(objectiveTypeID) {
  const objectiveType = ensureCache().objectiveTypesByID.get(toInt(objectiveTypeID, 0));
  return objectiveType ? clone(objectiveType) : null;
}

function getSpawnProfile(siteFamily) {
  const normalizedFamily = String(siteFamily || "").trim().toLowerCase();
  const profile = ensureCache().spawnProfilesByFamily.get(normalizedFamily) || null;
  return profile ? clone(profile) : null;
}

function listUniverseSpawnFamilies() {
  return [...ensureCache().spawnProfilesByFamily.keys()].sort((left, right) => left.localeCompare(right));
}

function getCoverage() {
  return clone(ensureCache().payload.coverage || {});
}

module.exports = {
  clearCache,
  getCoverage,
  getArchetypeByID,
  getClientDungeonByID,
  getClientDungeonTemplate,
  getObjectiveChainByID,
  getObjectiveTypeByID,
  getPayload,
  getSpawnProfile,
  getTemplateByID,
  listUniverseSpawnFamilies,
  listTemplatesByArchetypeID,
  listTemplatesByDungeonNameID,
  listTemplatesByFamily,
  listTemplatesByResourceTypeID,
  listTemplatesBySource,
};
