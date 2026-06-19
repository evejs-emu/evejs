const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));

const FALLBACK_ITEMS = [
  {
    typeID: 34,
    groupID: 18,
    categoryID: 4,
    groupName: "Mineral",
    name: "Tritanium",
    published: true,
    mass: null,
    volume: 0.01,
    capacity: null,
    portionSize: 1,
    radius: null,
  },
];

let cachedRegistry = null;

function normalizeItemName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function splitNormalizedWords(value) {
  const normalized = normalizeItemName(value);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function createRegistry() {
  return {
    byName: new Map(),
    byTypeID: new Map(),
  };
}

function normalizeEntry(entry) {
  return {
    ...entry,
    typeID: Number(entry.typeID),
    groupID: Number(entry.groupID),
    categoryID: Number(entry.categoryID),
    groupName: String(entry.groupName || "").trim(),
    name: String(entry.name || "").trim(),
    published:
      Object.prototype.hasOwnProperty.call(entry || {}, "published")
        ? Boolean(entry.published)
        : true,
    mass: Number.isFinite(Number(entry.mass)) ? Number(entry.mass) : null,
    volume: Number.isFinite(Number(entry.volume)) ? Number(entry.volume) : null,
    capacity: Number.isFinite(Number(entry.capacity)) ? Number(entry.capacity) : null,
    portionSize: Number.isFinite(Number(entry.portionSize))
      ? Number(entry.portionSize)
      : null,
    raceID: Number.isFinite(Number(entry.raceID)) ? Number(entry.raceID) : null,
    basePrice: Number.isFinite(Number(entry.basePrice)) ? Number(entry.basePrice) : null,
    marketGroupID: Number.isFinite(Number(entry.marketGroupID))
      ? Number(entry.marketGroupID)
      : null,
    iconID: Number.isFinite(Number(entry.iconID)) ? Number(entry.iconID) : null,
    soundID: Number.isFinite(Number(entry.soundID)) ? Number(entry.soundID) : null,
    graphicID: Number.isFinite(Number(entry.graphicID)) ? Number(entry.graphicID) : null,
    radius: Number.isFinite(Number(entry.radius)) ? Number(entry.radius) : null,
  };
}

function addEntry(registry, entry) {
  const normalizedEntry = normalizeEntry(entry);
  if (
    !Number.isInteger(normalizedEntry.typeID) ||
    normalizedEntry.typeID <= 0 ||
    !normalizedEntry.name
  ) {
    return;
  }

  registry.byTypeID.set(normalizedEntry.typeID, normalizedEntry);

  const normalizedName = normalizeItemName(normalizedEntry.name);
  if (!normalizedName) {
    return;
  }

  if (!registry.byName.has(normalizedName)) {
    registry.byName.set(normalizedName, []);
  }

  const entries = registry.byName.get(normalizedName);
  if (!entries.some((candidate) => candidate.typeID === normalizedEntry.typeID)) {
    entries.push(normalizedEntry);
  }
}

function buildFallbackRegistry() {
  const registry = createRegistry();
  for (const item of FALLBACK_ITEMS) {
    addEntry(registry, item);
  }
  return registry;
}

function loadDbRegistry() {
  try {
    const types = readStaticRows(TABLE.ITEM_TYPES);
    if (!Array.isArray(types) || types.length === 0) {
      return null;
    }

    const registry = createRegistry();
    for (const type of types) {
      addEntry(registry, type);
    }

    return registry.byTypeID.size > 0 ? registry : null;
  } catch (error) {
    log.warn(
      `[ItemRegistry] Failed to load item reference data from newDatabase: ${error.message}`,
    );
    return null;
  }
}

function loadRegistry() {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const dbRegistry = loadDbRegistry();
  if (dbRegistry) {
    cachedRegistry = dbRegistry;
    return cachedRegistry;
  }

  cachedRegistry = buildFallbackRegistry();
  return cachedRegistry;
}

function dedupeEntries(entries) {
  const deduped = [];
  const seen = new Set();

  for (const entry of entries) {
    const key = `${entry.typeID}:${entry.name}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function formatSuggestionLabel(entry) {
  return `${entry.name} (${entry.typeID}${entry.published === false ? ", unpublished" : ""})`;
}

function levenshteinDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a) {
    return b.length;
  }
  if (!b) {
    return a.length;
  }

  const previous = new Array(b.length + 1);
  const current = new Array(b.length + 1);
  for (let index = 0; index <= b.length; index += 1) {
    previous[index] = index;
  }

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function buildFuzzySuggestions(registry, normalizedQuery) {
  const queryWords = splitNormalizedWords(normalizedQuery);
  const scored = [];

  for (const entry of registry.byTypeID.values()) {
    const normalizedName = normalizeItemName(entry.name);
    if (!normalizedName) {
      continue;
    }

    const nameWords = splitNormalizedWords(normalizedName);
    let score = Number.POSITIVE_INFINITY;

    if (normalizedName.startsWith(normalizedQuery)) {
      score = Math.min(score, 0.2);
    }

    if (nameWords.some((word) => word.startsWith(normalizedQuery))) {
      score = Math.min(score, 0.4);
    }

    if (queryWords.length > 0) {
      const alignedTokenDistance = queryWords.reduce((sum, queryWord, index) => {
        const nameWord = nameWords[index] || "";
        return sum + levenshteinDistance(queryWord, nameWord);
      }, Math.abs(queryWords.length - nameWords.length) * 2);
      score = Math.min(score, alignedTokenDistance);

      const tokenPrefixHits = queryWords.filter((queryWord) =>
        nameWords.some((nameWord) => nameWord.startsWith(queryWord)),
      ).length;
      if (tokenPrefixHits === queryWords.length) {
        score = Math.min(score, 0.5);
      } else if (tokenPrefixHits >= Math.max(2, queryWords.length - 1)) {
        score = Math.min(score, 1.5);
      }

      const tokenDistance = queryWords.reduce((sum, queryWord) => {
        let best = Number.POSITIVE_INFINITY;
        for (const nameWord of nameWords) {
          best = Math.min(best, levenshteinDistance(queryWord, nameWord));
        }
        return sum + best;
      }, 0);
      score = Math.min(score, tokenDistance + 1);
    }

    score = Math.min(score, levenshteinDistance(normalizedQuery, normalizedName));
    const threshold = Math.max(2, Math.ceil(normalizedName.length * 0.3));
    if (score > threshold) {
      continue;
    }

    scored.push({
      entry,
      score,
      publishedPenalty: entry.published === false ? 0.25 : 0,
      blueprintPenalty: normalizedName.includes(" blueprint") ? 0.4 : 0,
      nameLengthPenalty: normalizedName.length * 0.0001,
    });
  }

  return scored
    .sort((left, right) => {
      const leftScore =
        left.score + left.publishedPenalty + left.blueprintPenalty + left.nameLengthPenalty;
      const rightScore =
        right.score + right.publishedPenalty + right.blueprintPenalty + right.nameLengthPenalty;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return left.entry.name.localeCompare(right.entry.name);
    })
    .map((entry) => entry.entry);
}

function resolveItemByTypeID(typeID) {
  const numericTypeID = Number(typeID);
  if (!Number.isInteger(numericTypeID) || numericTypeID <= 0) {
    return null;
  }

  const registry = loadRegistry();
  return registry.byTypeID.get(numericTypeID) || null;
}

function resolveItemByName(query) {
  const normalizedQuery = normalizeItemName(query);
  if (!normalizedQuery) {
    return {
      success: false,
      errorMsg: "ITEM_NAME_REQUIRED",
      suggestions: [],
    };
  }

  const registry = loadRegistry();
  if (/^\d+$/.test(normalizedQuery)) {
    const exactTypeMatch = registry.byTypeID.get(Number(normalizedQuery)) || null;
    if (exactTypeMatch) {
      return { success: true, match: exactTypeMatch, suggestions: [] };
    }
  }

  const exactMatches = dedupeEntries(registry.byName.get(normalizedQuery) || []);
  if (exactMatches.length === 1) {
    return { success: true, match: exactMatches[0], suggestions: [] };
  }
  if (exactMatches.length > 1) {
    return {
      success: false,
      errorMsg: "AMBIGUOUS_ITEM_NAME",
      suggestions: exactMatches
        .slice(0, 5)
        .map((entry) => formatSuggestionLabel(entry)),
    };
  }

  const partialMatches = [];
  for (const entry of registry.byTypeID.values()) {
    if (normalizeItemName(entry.name).includes(normalizedQuery)) {
      partialMatches.push(entry);
    }
  }

  const deduped = dedupeEntries(partialMatches);
  if (deduped.length === 1) {
    return { success: true, match: deduped[0], suggestions: [] };
  }

  return {
    success: false,
    errorMsg: deduped.length > 1 ? "AMBIGUOUS_ITEM_NAME" : "ITEM_NOT_FOUND",
    suggestions: (
      deduped.length > 0 ? deduped : buildFuzzySuggestions(registry, normalizedQuery)
    )
      .slice(0, 5)
      .map((entry) => formatSuggestionLabel(entry)),
  };
}

module.exports = {
  resolveItemByName,
  resolveItemByTypeID,
};
