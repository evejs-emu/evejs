const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));

const FALLBACK_PLANET_DEFINITION_VERSION = Object.freeze({
  major: 24,
  minor: 1,
  patch: 0,
  prerelease_tags: [],
  build_tags: ["evejs", "ccp-equinox-resource-data4", "client-3396210"],
});

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = normalizeInteger(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => String(entry || "").trim())
    .filter((entry) => entry.length > 0);
}

function normalizeSemanticVersion(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    major: Math.max(0, normalizeInteger(source.major, 0)),
    minor: Math.max(0, normalizeInteger(source.minor, 0)),
    patch: Math.max(0, normalizeInteger(source.patch, 0)),
    prerelease_tags: normalizeStringList(source.prerelease_tags),
    build_tags: normalizeStringList(source.build_tags),
  };
}

function buildMap(values, keyName) {
  const result = new Map();
  for (const value of values) {
    const key = normalizePositiveInteger(value && value[keyName], null);
    if (!key) {
      continue;
    }
    result.set(key, value);
  }
  return result;
}

function buildPlanetsBySolarSystemID(values) {
  const result = new Map();
  if (!values || typeof values !== "object") {
    return result;
  }
  for (const [solarSystemID, planetIDs] of Object.entries(values)) {
    const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
    if (!numericSolarSystemID) {
      continue;
    }
    const normalizedPlanetIDs = Array.isArray(planetIDs)
      ? planetIDs
          .map((planetID) => normalizePositiveInteger(planetID, null))
          .filter(Boolean)
          .sort((left, right) => left - right)
      : [];
    result.set(numericSolarSystemID, normalizedPlanetIDs);
  }
  return result;
}

function normalizeDefinitionRows(value) {
  if (Array.isArray(value)) {
    return cloneValue(value);
  }
  if (value && typeof value === "object") {
    return cloneValue(Object.values(value));
  }
  return [];
}

function buildSovereigntyStaticSnapshotFromAuthority() {
  const authority = readStaticTable(TABLE.SOVEREIGNTY_STATIC);
  const planetDefinitions = normalizeDefinitionRows(
    authority && authority.planetDefinitions,
  );
  const starConfigurations = normalizeDefinitionRows(
    authority && authority.starConfigurations,
  );
  const upgradeDefinitions = normalizeDefinitionRows(
    authority && authority.upgradeDefinitions,
  );

  if (
    planetDefinitions.length === 0 &&
    starConfigurations.length === 0 &&
    upgradeDefinitions.length === 0
  ) {
    return null;
  }

  return {
    planetDefinitions,
    planetDefinitionsByPlanetID: buildMap(planetDefinitions, "planetID"),
    planetDefinitionsVersion: normalizeSemanticVersion(
      authority && authority.planetDefinitionsVersion,
    ) || cloneValue(FALLBACK_PLANET_DEFINITION_VERSION),
    planetsBySolarSystemID: buildPlanetsBySolarSystemID(
      authority && authority.planetsBySolarSystemID,
    ),
    starConfigurations,
    starConfigurationsByStarID: buildMap(starConfigurations, "starID"),
    starConfigurationsBySolarSystemID: buildMap(starConfigurations, "solarSystemID"),
    upgradeDefinitions,
    upgradeDefinitionsByTypeID: buildMap(upgradeDefinitions, "installationTypeID"),
  };
}

module.exports = {
  buildSovereigntyStaticSnapshotFromAuthority,
};
