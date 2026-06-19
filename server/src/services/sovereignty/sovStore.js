const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  SOVEREIGNTY_TABLE,
} = require(path.join(__dirname, "./sovConstants"));

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
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

function buildDefaultResourcesState() {
  return {
    planetDefinitions: [],
    planetDefinitionsVersion: normalizeSemanticVersion({
      major: 0,
      minor: 0,
      patch: 0,
    }),
    starConfigurations: [],
    upgradeDefinitions: [],
  };
}

function buildDefaultSovereigntyTable() {
  return {
    _meta: {
      version: 2,
      updatedAt: null,
    },
    alliances: {},
    systems: {},
    hubs: {},
    skyhooks: {},
    mercenaryDens: {},
    resources: buildDefaultResourcesState(),
  };
}

function mergeSovereigntyTableDefaults(value = {}) {
  const defaults = buildDefaultSovereigntyTable();
  const table = value && typeof value === "object" ? cloneValue(value) : {};
  return {
    _meta: {
      version: Math.max(
        1,
        normalizeInteger(table && table._meta && table._meta.version, defaults._meta.version),
      ),
      updatedAt:
        table && table._meta && table._meta.updatedAt
          ? String(table._meta.updatedAt)
          : null,
    },
    alliances:
      table && table.alliances && typeof table.alliances === "object"
        ? cloneValue(table.alliances)
        : {},
    systems:
      table && table.systems && typeof table.systems === "object"
        ? cloneValue(table.systems)
        : {},
    hubs:
      table && table.hubs && typeof table.hubs === "object"
        ? cloneValue(table.hubs)
        : {},
    skyhooks:
      table && table.skyhooks && typeof table.skyhooks === "object"
        ? cloneValue(table.skyhooks)
        : {},
    mercenaryDens:
      table && table.mercenaryDens && typeof table.mercenaryDens === "object"
        ? cloneValue(table.mercenaryDens)
        : {},
    resources: {
      planetDefinitions:
        table &&
        table.resources &&
        Array.isArray(table.resources.planetDefinitions)
          ? cloneValue(table.resources.planetDefinitions)
          : cloneValue(defaults.resources.planetDefinitions),
      planetDefinitionsVersion: normalizeSemanticVersion(
        table && table.resources && table.resources.planetDefinitionsVersion,
      ),
      starConfigurations:
        table &&
        table.resources &&
        Array.isArray(table.resources.starConfigurations)
          ? cloneValue(table.resources.starConfigurations)
          : cloneValue(defaults.resources.starConfigurations),
      upgradeDefinitions:
        table &&
        table.resources &&
        Array.isArray(table.resources.upgradeDefinitions)
          ? cloneValue(table.resources.upgradeDefinitions)
          : cloneValue(defaults.resources.upgradeDefinitions),
    },
  };
}

function readSovereigntyTable() {
  const result = database.read(SOVEREIGNTY_TABLE, "/");
  return mergeSovereigntyTableDefaults(result && result.success ? result.data : {});
}

function writeSovereigntyTable(table) {
  const nextTable = mergeSovereigntyTableDefaults(table);
  nextTable._meta.updatedAt = new Date().toISOString();
  database.write(SOVEREIGNTY_TABLE, "/", nextTable);
  return nextTable;
}

module.exports = {
  buildDefaultResourcesState,
  buildDefaultSovereigntyTable,
  cloneValue,
  mergeSovereigntyTableDefaults,
  normalizeSemanticVersion,
  readSovereigntyTable,
  writeSovereigntyTable,
};
