const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const database = require(path.join(__dirname, "../../newDatabase"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  buildDict,
  buildList,
  extractList,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  ensureAlliancesInitialized,
  ensureCorporationsInitialized,
  getAllianceRecord,
  getCorporationRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));

const MATCH_BY = {
  PARTIAL_TERMS: 0,
  EXACT_TERMS: 1,
  EXACT_PHRASE: 2,
  EXACT_PHRASE_ONLY: 3,
};

const RESULT_TYPE = {
  CHARACTER: 2,
  CORPORATION: 3,
  ALLIANCE: 4,
  SOLAR_SYSTEM: 7,
  STATION: 11,
};

const MAX_RESULT_COUNT = 500;
const STATIC_QUERY_CACHE_LIMIT = 512;
const staticSearchIndexCache = new Map();
const staticQueryResultCache = new Map();

function extractKwargValue(kwargs, key, fallback = undefined) {
  if (!kwargs) {
    return fallback;
  }

  if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
    const entry = kwargs.entries.find(([entryKey]) => entryKey === key);
    return entry ? entry[1] : fallback;
  }

  if (typeof kwargs === "object" && Object.prototype.hasOwnProperty.call(kwargs, key)) {
    return kwargs[key];
  }

  return fallback;
}

function normalizeSearchString(value) {
  return normalizeText(value, "").trim().toLowerCase();
}

function collapseSearchString(value) {
  return normalizeSearchString(value).replace(/[^a-z0-9]+/g, "");
}

function tokenizeSearchString(value) {
  return normalizeSearchString(value)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]+/g, ""))
    .filter(Boolean);
}

function appendMapListEntry(map, key, value) {
  if (!key) {
    return;
  }
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }
  map.set(key, [value]);
}

function getStaticGroupSourceRows(groupID) {
  const world = worldData.ensureLoaded();
  switch (Number(groupID) || 0) {
    case RESULT_TYPE.SOLAR_SYSTEM:
      return world.solarSystems;
    case RESULT_TYPE.STATION:
      return world.stations;
    default:
      return null;
  }
}

function getStaticGroupEntryName(groupID, row) {
  switch (Number(groupID) || 0) {
    case RESULT_TYPE.SOLAR_SYSTEM:
      return String(row && row.solarSystemName || "");
    case RESULT_TYPE.STATION:
      return String(row && (row.stationName || row.itemName) || "");
    default:
      return "";
  }
}

function getStaticGroupEntryID(groupID, row) {
  switch (Number(groupID) || 0) {
    case RESULT_TYPE.SOLAR_SYSTEM:
      return Number(row && row.solarSystemID) || 0;
    case RESULT_TYPE.STATION:
      return Number(row && row.stationID) || 0;
    default:
      return 0;
  }
}

function buildStaticSearchIndex(groupID) {
  const rows = getStaticGroupSourceRows(groupID);
  if (!rows) {
    return null;
  }

  const exactRawNameMap = new Map();
  const exactCollapsedNameMap = new Map();
  const entries = rows
    .map((row) => {
      const id = getStaticGroupEntryID(groupID, row);
      const name = getStaticGroupEntryName(groupID, row);
      const rawName = normalizeSearchString(name);
      const collapsedName = collapseSearchString(name);
      if (!id || !name || !collapsedName) {
        return null;
      }
      const entry = {
        id,
        rawName,
        collapsedName,
      };
      appendMapListEntry(exactRawNameMap, rawName, id);
      appendMapListEntry(exactCollapsedNameMap, collapsedName, id);
      return entry;
    })
    .filter(Boolean);

  const index = {
    entries,
    exactRawNameMap,
    exactCollapsedNameMap,
  };
  staticSearchIndexCache.set(Number(groupID) || 0, index);
  return index;
}

function getStaticSearchIndex(groupID) {
  const normalizedGroupID = Number(groupID) || 0;
  if (staticSearchIndexCache.has(normalizedGroupID)) {
    return staticSearchIndexCache.get(normalizedGroupID);
  }
  return buildStaticSearchIndex(normalizedGroupID);
}

function getCachedStaticQueryResult(key) {
  if (!staticQueryResultCache.has(key)) {
    return null;
  }
  const cached = staticQueryResultCache.get(key);
  staticQueryResultCache.delete(key);
  staticQueryResultCache.set(key, cached);
  return [...cached];
}

function setCachedStaticQueryResult(key, resultIDs) {
  staticQueryResultCache.set(key, [...resultIDs]);
  if (staticQueryResultCache.size <= STATIC_QUERY_CACHE_LIMIT) {
    return;
  }
  const oldestKey = staticQueryResultCache.keys().next().value;
  if (oldestKey !== undefined) {
    staticQueryResultCache.delete(oldestKey);
  }
}

function searchStaticGroup(groupID, search, exactMode) {
  const index = getStaticSearchIndex(groupID);
  if (!index) {
    return null;
  }

  const rawSearch = normalizeSearchString(search);
  const collapsedSearch = collapseSearchString(search);
  const cacheKey = `${Number(groupID) || 0}|${Number(exactMode) || 0}|${rawSearch}`;
  const cached = getCachedStaticQueryResult(cacheKey);
  if (cached) {
    return cached;
  }
  if (!collapsedSearch) {
    return [];
  }

  let results = [];
  switch (Number(exactMode) || 0) {
    case MATCH_BY.EXACT_TERMS:
    case MATCH_BY.EXACT_PHRASE:
    case MATCH_BY.EXACT_PHRASE_ONLY: {
      const seen = new Set();
      const exactRaw = index.exactRawNameMap.get(rawSearch) || [];
      const exactCollapsed = index.exactCollapsedNameMap.get(collapsedSearch) || [];
      results = [...exactRaw, ...exactCollapsed].filter((id) => {
        if (!id || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      });
      break;
    }
    case MATCH_BY.PARTIAL_TERMS:
    default: {
      const terms = tokenizeSearchString(search);
      const exactMatches = [];
      const prefixMatches = [];
      const substringMatches = [];
      for (const entry of index.entries) {
        const matches =
          terms.length > 0
            ? terms.every((term) => entry.collapsedName.includes(term))
            : entry.collapsedName.includes(collapsedSearch);
        if (!matches) {
          continue;
        }
        if (
          entry.rawName === rawSearch ||
          entry.collapsedName === collapsedSearch
        ) {
          exactMatches.push(entry.id);
          continue;
        }
        if (
          entry.rawName.startsWith(rawSearch) ||
          entry.collapsedName.startsWith(collapsedSearch)
        ) {
          prefixMatches.push(entry.id);
          continue;
        }
        substringMatches.push(entry.id);
      }
      results = [...exactMatches, ...prefixMatches, ...substringMatches];
      break;
    }
  }

  const limitedResults = results.slice(0, MAX_RESULT_COUNT);
  setCachedStaticQueryResult(cacheKey, limitedResults);
  return limitedResults;
}

function matchesSearch(name, search, exactMode = MATCH_BY.PARTIAL_TERMS) {
  const rawTarget = normalizeSearchString(name);
  const collapsedTarget = collapseSearchString(name);
  const rawSearch = normalizeSearchString(search);
  const collapsedSearch = collapseSearchString(search);
  if (!collapsedSearch) {
    return false;
  }

  switch (Number(exactMode) || 0) {
    case MATCH_BY.EXACT_TERMS:
    case MATCH_BY.EXACT_PHRASE:
    case MATCH_BY.EXACT_PHRASE_ONLY:
      return rawTarget === rawSearch || collapsedTarget === collapsedSearch;
    case MATCH_BY.PARTIAL_TERMS:
    default: {
      const terms = tokenizeSearchString(search);
      if (!terms.length) {
        return collapsedTarget.includes(collapsedSearch);
      }
      return terms.every((term) => collapsedTarget.includes(term));
    }
  }
}

function collectSearchableOwners(groupID) {
  switch (Number(groupID) || 0) {
    case RESULT_TYPE.CHARACTER: {
      const tableResult = database.read("characters", "/");
      const characters =
        tableResult && tableResult.success && tableResult.data && typeof tableResult.data === "object"
          ? tableResult.data
          : {};
      return Object.keys(characters)
        .map((characterID) => getCharacterRecord(characterID))
        .filter(Boolean)
        .map((record) => ({
          id: Number(record.characterID || 0) || 0,
          name: record.characterName || `Character ${record.characterID}`,
        }))
        .filter((entry) => entry.id > 0 && entry.name);
    }
    case RESULT_TYPE.CORPORATION: {
      const corporations = ensureCorporationsInitialized();
      return Object.keys((corporations && corporations.records) || {})
        .map((corporationID) => getCorporationRecord(corporationID))
        .filter(Boolean)
        .map((record) => ({
          id: Number(record.corporationID || 0) || 0,
          name: record.corporationName || `Corporation ${record.corporationID}`,
        }))
        .filter((entry) => entry.id > 0 && entry.name);
    }
    case RESULT_TYPE.ALLIANCE: {
      const alliances = ensureAlliancesInitialized();
      return Object.keys((alliances && alliances.records) || {})
        .map((allianceID) => getAllianceRecord(allianceID))
        .filter(Boolean)
        .map((record) => ({
          id: Number(record.allianceID || 0) || 0,
          name: record.allianceName || `Alliance ${record.allianceID}`,
        }))
        .filter((entry) => entry.id > 0 && entry.name);
    }
    default:
      return [];
  }
}

function searchGroup(groupID, search, exactMode) {
  const staticMatches = searchStaticGroup(groupID, search, exactMode);
  if (staticMatches) {
    return staticMatches;
  }

  return collectSearchableOwners(groupID)
    .filter((entry) => matchesSearch(entry.name, search, exactMode))
    .map((entry) => entry.id)
    .slice(0, MAX_RESULT_COUNT);
}

function clearSearchCaches() {
  staticSearchIndexCache.clear();
  staticQueryResultCache.clear();
}

class SearchService extends BaseService {
  constructor() {
    super("search");
  }

  Handle_Query(args, session, kwargs) {
    const search = normalizeText(args && args[0], "");
    const groupIDs = extractList(args && args[1])
      .map((groupID) => Number(groupID))
      .filter((groupID) => Number.isFinite(groupID));
    const exactMode = Number(extractKwargValue(kwargs, "exact", 0)) || 0;

    return buildDict(
      groupIDs.map((groupID) => [groupID, buildList(searchGroup(groupID, search, exactMode))]),
    );
  }

  Handle_QuickQuery(args, session, kwargs) {
    const search = normalizeText(args && args[0], "");
    const groupIDs = extractList(args && args[1])
      .map((groupID) => Number(groupID))
      .filter((groupID) => Number.isFinite(groupID));
    const exactMode = Number(extractKwargValue(kwargs, "exact", 0)) || 0;
    const matches = [];
    const seen = new Set();

    for (const groupID of groupIDs) {
      for (const ownerID of searchGroup(groupID, search, exactMode)) {
        const numericOwnerID = Number(ownerID) || 0;
        if (numericOwnerID > 0 && !seen.has(numericOwnerID)) {
          seen.add(numericOwnerID);
          matches.push(numericOwnerID);
        }
      }
    }

    return buildList(matches);
  }
}

module.exports = SearchService;
module.exports._testing = {
  clearSearchCaches,
  searchStaticGroup,
};
