const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const dungeonAuthority = require(path.join(__dirname, "./dungeonAuthority"));
const dungeonRuntime = require(path.join(__dirname, "./dungeonRuntime"));
const {
  buildDict,
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const ARCHETYPES = Object.freeze({
  combatSites: 24,
  oreAnomaly: 27,
  iceBelt: 28,
  invasionSites: 65,
  homefrontSites: 70,
});

const ARCHETYPE_SETS = Object.freeze({
  combatAnomalies: new Set([ARCHETYPES.combatSites]),
  oreAnomalies: new Set([ARCHETYPES.oreAnomaly]),
  iceBelts: new Set([ARCHETYPES.iceBelt]),
  factionWarfare: new Set([33, 34, 35, 36, 68]),
  homefrontOperations: new Set([ARCHETYPES.homefrontSites]),
  pirateInsurgencies: new Set([72, 73, 74, 75, 76, 77, 78, 79]),
  triglavianSites: new Set([ARCHETYPES.invasionSites]),
});

const ACTIVE_STATES = Object.freeze(["seeded", "active", "paused"]);

let cachedBuckets = null;
let cachedEntryDicts = null;
let cachedCountDicts = null;
let cacheListenerRegistered = false;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function invalidateCache() {
  cachedBuckets = null;
  cachedEntryDicts = null;
  cachedCountDicts = null;
}

function normalizeLifecycleState(value) {
  return normalizeText(value, "").toLowerCase();
}

function positionsEqual(left, right) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    Number(left.x) === Number(right.x) &&
    Number(left.y) === Number(right.y) &&
    Number(left.z) === Number(right.z)
  );
}

function isSummaryEligible(summary) {
  if (!summary || typeof summary !== "object") {
    return false;
  }
  if (normalizeText(summary.instanceScope, "shared").toLowerCase() !== "shared") {
    return false;
  }
  if (normalizeText(summary.siteKind, "").toLowerCase() !== "anomaly") {
    return false;
  }
  return ACTIVE_STATES.includes(normalizeLifecycleState(summary.lifecycleState));
}

function doesSummaryTopologyChangeMatter(beforeSummary, afterSummary) {
  const beforeEligible = isSummaryEligible(beforeSummary);
  const afterEligible = isSummaryEligible(afterSummary);
  if (beforeEligible !== afterEligible) {
    return true;
  }
  if (!beforeEligible && !afterEligible) {
    return false;
  }
  return (
    toInt(beforeSummary && beforeSummary.solarSystemID, 0) !==
      toInt(afterSummary && afterSummary.solarSystemID, 0) ||
    toInt(beforeSummary && beforeSummary.archetypeID, 0) !==
      toInt(afterSummary && afterSummary.archetypeID, 0) ||
    toInt(beforeSummary && beforeSummary.sourceDungeonID, 0) !==
      toInt(afterSummary && afterSummary.sourceDungeonID, 0) ||
    toInt(beforeSummary && beforeSummary.factionID, 0) !==
      toInt(afterSummary && afterSummary.factionID, 0) ||
    toInt(beforeSummary && beforeSummary.difficulty, 0) !==
      toInt(afterSummary && afterSummary.difficulty, 0) ||
    toInt(beforeSummary && beforeSummary.entryObjectTypeID, 0) !==
      toInt(afterSummary && afterSummary.entryObjectTypeID, 0) ||
    toInt(beforeSummary && beforeSummary.dungeonNameID, 0) !==
      toInt(afterSummary && afterSummary.dungeonNameID, 0) ||
    !positionsEqual(beforeSummary && beforeSummary.position, afterSummary && afterSummary.position)
  );
}

function ensureCacheListener() {
  if (cacheListenerRegistered) {
    return;
  }
  if (typeof dungeonRuntime.registerInstanceChangeListener === "function") {
    dungeonRuntime.registerInstanceChangeListener((change) => {
      const changeType = normalizeText(change && change.changeType, "").toLowerCase();
      if (changeType === "created" || changeType === "removed") {
        if (
          isSummaryEligible(change && change.before) ||
          isSummaryEligible(change && change.after)
        ) {
          invalidateCache();
        }
        return;
      }
      if (doesSummaryTopologyChangeMatter(change && change.before, change && change.after)) {
        invalidateCache();
      }
    });
  }
  cacheListenerRegistered = true;
}

function listActiveSharedInstanceSummaries() {
  const summariesByID = new Map();
  for (const lifecycleState of ACTIVE_STATES) {
    const summaries = dungeonRuntime.listInstancesByLifecycle(lifecycleState) || [];
    for (const summary of summaries) {
      const instanceID = Math.max(0, toInt(summary && summary.instanceID, 0));
      if (instanceID <= 0 || summariesByID.has(instanceID)) {
        continue;
      }
      if (normalizeText(summary && summary.instanceScope, "shared").toLowerCase() !== "shared") {
        continue;
      }
      if (normalizeText(summary && summary.siteKind, "").toLowerCase() !== "anomaly") {
        continue;
      }
      summariesByID.set(instanceID, summary);
    }
  }
  return [...summariesByID.values()];
}

function hydrateSummary(summary) {
  const template = dungeonAuthority.getTemplateByID(
    normalizeText(summary && summary.templateID, ""),
  );
  const position =
    summary && summary.position && typeof summary.position === "object"
      ? {
          x: Number(summary.position.x) || 0,
          y: Number(summary.position.y) || 0,
          z: Number(summary.position.z) || 0,
        }
      : null;
  return {
    instanceID: Math.max(0, toInt(summary && summary.instanceID, 0)),
    solarSystemID: Math.max(0, toInt(summary && summary.solarSystemID, 0)),
    dungeonID:
      Math.max(0, toInt(summary && summary.sourceDungeonID, 0)) ||
      Math.max(0, toInt(template && template.sourceDungeonID, 0)),
    archetypeID:
      Math.max(0, toInt(summary && summary.archetypeID, 0)) ||
      Math.max(0, toInt(template && template.archetypeID, 0)),
    factionID:
      Math.max(0, toInt(summary && summary.factionID, 0)) ||
      Math.max(0, toInt(template && template.factionID, 0)) ||
      null,
    difficulty:
      Math.max(0, toInt(summary && summary.difficulty, 0)) ||
      Math.max(0, toInt(template && template.difficulty, 0)) ||
      1,
    entryObjectTypeID:
      Math.max(0, toInt(summary && summary.entryObjectTypeID, 0)) ||
      Math.max(0, toInt(template && template.entryObjectTypeID, 0)) ||
      null,
    dungeonNameID:
      Math.max(0, toInt(summary && summary.dungeonNameID, 0)) ||
      Math.max(0, toInt(template && template.dungeonNameID, 0)) ||
      null,
    position,
  };
}

function buildDungeonEntry(record) {
  const entries = [
    ["dungeonID", record.dungeonID],
    ["instanceID", record.instanceID],
    ["siteID", record.instanceID],
    ["solarSystemID", record.solarSystemID],
    ["archetypeID", record.archetypeID || null],
    ["factionID", record.factionID || null],
    ["difficulty", record.difficulty || 1],
    ["entryObjectTypeID", record.entryObjectTypeID || null],
    ["dungeonNameID", record.dungeonNameID || null],
  ];
  // Packaged client consumers of this cache do not require the raw position,
  // and advertising it as a plain JS object causes marshal failures. Keep the
  // payload lean and stable so these global caches stay cheap to serve.
  return buildKeyVal(entries);
}

function buildGroupedBuckets() {
  const groupedEntries = new Map(
    Object.keys(ARCHETYPE_SETS).map((key) => [key, new Map()]),
  );
  const groupedCounts = new Map(
    Object.keys(ARCHETYPE_SETS).map((key) => [key, new Map()]),
  );

  for (const summary of listActiveSharedInstanceSummaries()) {
    const hydrated = hydrateSummary(summary);
    if (hydrated.instanceID <= 0 || hydrated.solarSystemID <= 0 || hydrated.dungeonID <= 0) {
      continue;
    }

    for (const [bucketKey, archetypeSet] of Object.entries(ARCHETYPE_SETS)) {
      if (!archetypeSet.has(hydrated.archetypeID)) {
        continue;
      }
      const entriesBySystem = groupedEntries.get(bucketKey);
      const countsBySystem = groupedCounts.get(bucketKey);
      if (!entriesBySystem.has(hydrated.solarSystemID)) {
        entriesBySystem.set(hydrated.solarSystemID, []);
      }
      entriesBySystem.get(hydrated.solarSystemID).push(hydrated);
      countsBySystem.set(
        hydrated.solarSystemID,
        (countsBySystem.get(hydrated.solarSystemID) || 0) + 1,
      );
    }
  }

  for (const entriesBySystem of groupedEntries.values()) {
    for (const records of entriesBySystem.values()) {
      records.sort((left, right) => (
        left.instanceID - right.instanceID ||
        left.dungeonID - right.dungeonID
      ));
    }
  }

  return {
    entries: groupedEntries,
    counts: groupedCounts,
  };
}

function getBuckets() {
  ensureCacheListener();
  if (!cachedBuckets) {
    cachedBuckets = buildGroupedBuckets();
  }
  return cachedBuckets;
}

function buildGroupedEntryDict(bucketKey) {
  ensureCacheListener();
  if (!cachedEntryDicts) {
    cachedEntryDicts = new Map();
  }
  if (cachedEntryDicts.has(bucketKey)) {
    return cachedEntryDicts.get(bucketKey);
  }
  const buckets = getBuckets().entries.get(bucketKey) || new Map();
  const dict = buildDict(
    [...buckets.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([solarSystemID, records]) => [
        solarSystemID,
        buildList(records.map((record) => buildDungeonEntry(record))),
      ]),
  );
  cachedEntryDicts.set(bucketKey, dict);
  return dict;
}

function buildGroupedCountDict(bucketKey) {
  ensureCacheListener();
  if (!cachedCountDicts) {
    cachedCountDicts = new Map();
  }
  if (cachedCountDicts.has(bucketKey)) {
    return cachedCountDicts.get(bucketKey);
  }
  const counts = getBuckets().counts.get(bucketKey) || new Map();
  const dict = buildDict(
    [...counts.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([solarSystemID, count]) => [solarSystemID, Math.max(0, toInt(count, 0))]),
  );
  cachedCountDicts.set(bucketKey, dict);
  return dict;
}

class DungeonInstanceCacheMgrService extends BaseService {
  constructor() {
    super("dungeonInstanceCacheMgr");
  }

  Handle_GetCombatAnomalyInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetCombatAnomalyInstances");
    return buildGroupedEntryDict("combatAnomalies");
  }

  Handle_GetCombatAnomaliesCount() {
    log.debug("[DungeonInstanceCacheMgr] GetCombatAnomaliesCount");
    return buildGroupedCountDict("combatAnomalies");
  }

  Handle_GetIceBeltInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetIceBeltInstances");
    return buildGroupedEntryDict("iceBelts");
  }

  Handle_GetIceBeltsCount() {
    log.debug("[DungeonInstanceCacheMgr] GetIceBeltsCount");
    return buildGroupedCountDict("iceBelts");
  }

  Handle_GetOreAnomalyInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetOreAnomalyInstances");
    return buildGroupedEntryDict("oreAnomalies");
  }

  Handle_GetOreAnomaliesCount() {
    log.debug("[DungeonInstanceCacheMgr] GetOreAnomaliesCount");
    return buildGroupedCountDict("oreAnomalies");
  }

  Handle_GetOreAnomaliesCountInRange() {
    log.debug("[DungeonInstanceCacheMgr] GetOreAnomaliesCountInRange");
    return buildGroupedCountDict("oreAnomalies");
  }

  Handle_GetFactionWarfareInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetFactionWarfareInstances");
    return buildGroupedEntryDict("factionWarfare");
  }

  Handle_GetHomefrontSiteInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetHomefrontSiteInstances");
    return buildGroupedEntryDict("homefrontOperations");
  }

  Handle_GetPirateInsurgencyInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetPirateInsurgencyInstances");
    return buildGroupedEntryDict("pirateInsurgencies");
  }

  Handle_GetTriglavianSiteInstances() {
    log.debug("[DungeonInstanceCacheMgr] GetTriglavianSiteInstances");
    return buildGroupedEntryDict("triglavianSites");
  }
}

DungeonInstanceCacheMgrService._testing = {
  ARCHETYPE_SETS,
  buildGroupedBuckets,
  hydrateSummary,
  invalidateCache,
};

module.exports = DungeonInstanceCacheMgrService;
