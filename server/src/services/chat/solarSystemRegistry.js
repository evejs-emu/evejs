const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));

let cachedRegistry = null;

function normalizeSolarSystemName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function createRegistry() {
  return {
    byName: new Map(),
    bySolarSystemID: new Map(),
  };
}

function normalizeEntry(entry) {
  return {
    ...entry,
    solarSystemID: Number(entry.solarSystemID),
    solarSystemName: String(entry.solarSystemName || "").trim(),
  };
}

function addEntry(registry, entry) {
  const normalizedEntry = normalizeEntry(entry);
  if (
    !Number.isInteger(normalizedEntry.solarSystemID) ||
    normalizedEntry.solarSystemID <= 0 ||
    !normalizedEntry.solarSystemName
  ) {
    return;
  }

  const normalizedName = normalizeSolarSystemName(
    normalizedEntry.solarSystemName,
  );
  if (!normalizedName) {
    return;
  }

  registry.bySolarSystemID.set(
    normalizedEntry.solarSystemID,
    normalizedEntry,
  );

  if (!registry.byName.has(normalizedName)) {
    registry.byName.set(normalizedName, []);
  }

  const entries = registry.byName.get(normalizedName);
  if (
    !entries.some(
      (candidate) =>
        candidate.solarSystemID === normalizedEntry.solarSystemID,
    )
  ) {
    entries.push(normalizedEntry);
  }
}

function loadRegistry() {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const registry = createRegistry();
  for (const solarSystem of worldData.getSolarSystems()) {
    addEntry(registry, solarSystem);
  }

  cachedRegistry = registry;
  return cachedRegistry;
}

function dedupeEntries(entries) {
  const deduped = [];
  const seen = new Set();

  for (const entry of entries) {
    const key = `${entry.solarSystemID}:${entry.solarSystemName}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function resolveSolarSystemByID(solarSystemID) {
  const numericSolarSystemID = Number(solarSystemID);
  if (!Number.isInteger(numericSolarSystemID) || numericSolarSystemID <= 0) {
    return null;
  }

  const registry = loadRegistry();
  return registry.bySolarSystemID.get(numericSolarSystemID) || null;
}

function resolveSolarSystemByName(query) {
  const numericQuery = Number(query);
  if (Number.isInteger(numericQuery) && numericQuery > 0) {
    const byID = resolveSolarSystemByID(numericQuery);
    if (byID) {
      return {
        success: true,
        match: byID,
        suggestions: [],
      };
    }
  }

  const normalizedQuery = normalizeSolarSystemName(query);
  if (!normalizedQuery) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NAME_REQUIRED",
      suggestions: [],
    };
  }

  const registry = loadRegistry();
  const exactMatches = dedupeEntries(registry.byName.get(normalizedQuery) || []);
  if (exactMatches.length === 1) {
    return {
      success: true,
      match: exactMatches[0],
      suggestions: [],
    };
  }
  if (exactMatches.length > 1) {
    return {
      success: false,
      errorMsg: "AMBIGUOUS_SOLAR_SYSTEM_NAME",
      suggestions: exactMatches
        .slice(0, 5)
        .map((entry) => entry.solarSystemName),
    };
  }

  const partialMatches = [];
  for (const entry of registry.bySolarSystemID.values()) {
    if (
      normalizeSolarSystemName(entry.solarSystemName).includes(normalizedQuery)
    ) {
      partialMatches.push(entry);
    }
  }

  const deduped = dedupeEntries(partialMatches);
  if (deduped.length === 1) {
    return {
      success: true,
      match: deduped[0],
      suggestions: [],
    };
  }

  return {
    success: false,
    errorMsg:
      deduped.length > 1
        ? "AMBIGUOUS_SOLAR_SYSTEM_NAME"
        : "SOLAR_SYSTEM_NOT_FOUND",
    suggestions: deduped
      .slice(0, 5)
      .map((entry) => entry.solarSystemName),
  };
}

module.exports = {
  resolveSolarSystemByID,
  resolveSolarSystemByName,
};
