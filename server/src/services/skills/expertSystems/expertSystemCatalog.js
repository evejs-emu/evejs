const path = require("path");

const database = require(path.join(__dirname, "../../../newDatabase"));

const EXPERT_SYSTEMS_TABLE = "expertSystems";
const DEFAULT_MAX_INSTALLATIONS = 3;
const DEFAULT_TOP_UP_DAYS = 30;

let catalogCache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || "")
    .replace(/expert system package$/i, "")
    .replace(/expert system$/i, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function normalizeSkillGrant(entry) {
  const typeID = toInt(entry && entry.typeID, 0);
  const level = Math.max(0, Math.min(5, toInt(entry && entry.level, 0)));
  return typeID > 0 && level > 0 ? { typeID, level } : null;
}

function normalizeExpertSystem(rawEntry) {
  const typeID = toInt(rawEntry && rawEntry.typeID, 0);
  if (typeID <= 0) {
    return null;
  }

  const skillGrantMap = new Map();
  for (const rawGrant of Array.isArray(rawEntry.skillsGranted)
    ? rawEntry.skillsGranted
    : []) {
    const grant = normalizeSkillGrant(rawGrant);
    if (!grant) {
      continue;
    }
    skillGrantMap.set(grant.typeID, {
      typeID: grant.typeID,
      level: Math.max(grant.level, skillGrantMap.get(grant.typeID)?.level || 0),
    });
  }

  const associatedTypeIDs = [...new Set(
    (Array.isArray(rawEntry.associatedTypeIDs) ? rawEntry.associatedTypeIDs : [])
      .map((typeIDToNormalize) => toInt(typeIDToNormalize, 0))
      .filter((typeIDToKeep) => typeIDToKeep > 0),
  )].sort((left, right) => left - right);

  return Object.freeze({
    typeID,
    name: String(rawEntry.name || `Expert System ${typeID}`),
    durationDays: Math.max(1, toInt(rawEntry.durationDays, 7)),
    hidden: Boolean(rawEntry.hidden),
    retired: Boolean(rawEntry.retired),
    published: rawEntry.published !== false,
    groupID: toInt(rawEntry.groupID, 0),
    groupName: String(rawEntry.groupName || ""),
    skillsGranted: Object.freeze(
      [...skillGrantMap.values()].sort((left, right) => left.typeID - right.typeID),
    ),
    associatedTypeIDs: Object.freeze(associatedTypeIDs),
    sourceRefs: Object.freeze(
      (Array.isArray(rawEntry.sourceRefs) ? rawEntry.sourceRefs : [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    ),
  });
}

function readCatalogTable() {
  const result = database.read(EXPERT_SYSTEMS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function buildCatalogCache() {
  const table = readCatalogTable();
  const constants = table.constants && typeof table.constants === "object"
    ? table.constants
    : {};
  const expertSystems = Array.isArray(table.expertSystems)
    ? table.expertSystems
    : [];
  const byTypeID = new Map();
  const byNormalizedName = new Map();
  const byAssociatedTypeID = new Map();
  const byGrantedSkillTypeID = new Map();

  for (const rawEntry of expertSystems) {
    const normalized = normalizeExpertSystem(rawEntry);
    if (!normalized) {
      continue;
    }

    byTypeID.set(normalized.typeID, normalized);
    byNormalizedName.set(normalizeText(normalized.name), normalized);
    byNormalizedName.set(normalizeText(`${normalized.name} Expert System`), normalized);

    for (const associatedTypeID of normalized.associatedTypeIDs) {
      if (!byAssociatedTypeID.has(associatedTypeID)) {
        byAssociatedTypeID.set(associatedTypeID, []);
      }
      byAssociatedTypeID.get(associatedTypeID).push(normalized);
    }

    for (const grant of normalized.skillsGranted) {
      if (!byGrantedSkillTypeID.has(grant.typeID)) {
        byGrantedSkillTypeID.set(grant.typeID, []);
      }
      byGrantedSkillTypeID.get(grant.typeID).push(normalized);
    }
  }

  for (const entries of [
    ...byAssociatedTypeID.values(),
    ...byGrantedSkillTypeID.values(),
  ]) {
    entries.sort((left, right) => left.typeID - right.typeID);
  }

  return {
    constants: Object.freeze({
      maxCharacterInstallations:
        toInt(constants.maxCharacterInstallations, DEFAULT_MAX_INSTALLATIONS) ||
        DEFAULT_MAX_INSTALLATIONS,
      maxInstalledDurationToAllowTopUpDays:
        toInt(constants.maxInstalledDurationToAllowTopUpDays, DEFAULT_TOP_UP_DAYS) ||
        DEFAULT_TOP_UP_DAYS,
    }),
    entries: Object.freeze([...byTypeID.values()].sort((left, right) => left.typeID - right.typeID)),
    byTypeID,
    byNormalizedName,
    byAssociatedTypeID,
    byGrantedSkillTypeID,
  };
}

function getCatalogCache(options = {}) {
  if (!catalogCache || options.refresh === true) {
    catalogCache = buildCatalogCache();
  }
  return catalogCache;
}

function getExpertSystemConstants() {
  return { ...getCatalogCache().constants };
}

function getExpertSystemByTypeID(typeID) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return null;
  }
  return cloneValue(getCatalogCache().byTypeID.get(numericTypeID) || null);
}

function isExpertSystemType(typeID) {
  return Boolean(getCatalogCache().byTypeID.get(toInt(typeID, 0)));
}

function filterVisibility(entry, options = {}) {
  return (
    (options.includeHidden || !entry.hidden) &&
    (options.includeRetired || !entry.retired)
  );
}

function listExpertSystems(options = {}) {
  return getCatalogCache()
    .entries
    .filter((entry) => filterVisibility(entry, options))
    .map((entry) => cloneValue(entry));
}

function getAssociatedExpertSystems(typeID, options = {}) {
  return (getCatalogCache().byAssociatedTypeID.get(toInt(typeID, 0)) || [])
    .filter((entry) => filterVisibility(entry, options))
    .map((entry) => cloneValue(entry));
}

function getExpertSystemsGrantingSkill(skillTypeID, options = {}) {
  return (getCatalogCache().byGrantedSkillTypeID.get(toInt(skillTypeID, 0)) || [])
    .filter((entry) => filterVisibility(entry, options))
    .map((entry) => cloneValue(entry));
}

function scoreCandidate(query, candidate) {
  const normalizedQuery = normalizeText(query);
  const normalizedName = normalizeText(candidate && candidate.name);
  if (!normalizedQuery || !normalizedName) {
    return Number.POSITIVE_INFINITY;
  }
  if (normalizedName === normalizedQuery) {
    return 0;
  }
  if (normalizedName.startsWith(normalizedQuery)) {
    return 1;
  }
  if (normalizedName.includes(normalizedQuery)) {
    return 2;
  }
  return Number.POSITIVE_INFINITY;
}

function resolveExpertSystemQuery(query, options = {}) {
  const text = String(query || "").trim();
  if (!text) {
    return {
      success: false,
      errorMsg: "EXPERT_SYSTEM_REQUIRED",
      suggestions: [],
    };
  }

  const numericTypeID = toInt(text, 0);
  const cache = getCatalogCache();
  if (numericTypeID > 0) {
    const match = cache.byTypeID.get(numericTypeID);
    return match
      ? { success: true, data: cloneValue(match) }
      : { success: false, errorMsg: "EXPERT_SYSTEM_NOT_FOUND", suggestions: [] };
  }

  const exact = cache.byNormalizedName.get(normalizeText(text));
  if (exact) {
    return { success: true, data: cloneValue(exact) };
  }

  const candidates = cache.entries
    .filter((entry) => filterVisibility(entry, options))
    .map((entry) => ({ entry, score: scoreCandidate(text, entry) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return left.entry.name.localeCompare(right.entry.name);
    });

  if (
    candidates.length === 1 ||
    (candidates.length > 1 && candidates[0].score < candidates[1].score)
  ) {
    return { success: true, data: cloneValue(candidates[0].entry) };
  }

  return {
    success: false,
    errorMsg: candidates.length > 1
      ? "EXPERT_SYSTEM_AMBIGUOUS"
      : "EXPERT_SYSTEM_NOT_FOUND",
    suggestions: candidates
      .slice(0, 6)
      .map((candidate) => `${candidate.entry.name}(${candidate.entry.typeID})`),
  };
}

function refreshExpertSystemCatalog() {
  catalogCache = null;
  return listExpertSystems({ includeHidden: true, includeRetired: true });
}

module.exports = {
  EXPERT_SYSTEMS_TABLE,
  getAssociatedExpertSystems,
  getExpertSystemByTypeID,
  getExpertSystemConstants,
  getExpertSystemsGrantingSkill,
  isExpertSystemType,
  listExpertSystems,
  refreshExpertSystemCatalog,
  resolveExpertSystemQuery,
};
