const path = require("path");

const database = require(path.join(__dirname, "../newDatabase"));
const log = require(path.join(__dirname, "./logger"));
const worldData = require(path.join(__dirname, "../space/worldData"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../services/_shared/referenceData"));
const { readCatalog } = require(path.join(
  __dirname,
  "../services/ship/shipCosmeticsState",
));

function readRoot(tableName) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function countObjectEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }

  return Object.keys(value).length;
}

function normalizeCount(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallback;
  }

  return Math.trunc(numericValue);
}

function countSkinOverrides(charactersByID) {
  let total = 0;
  for (const characterEntry of Object.values(charactersByID)) {
    total += countObjectEntries(
      characterEntry && characterEntry.skinOverridesBySkinID,
    );
  }
  return total;
}

function buildStartupDataSummary() {
  const world = worldData.ensureLoaded();
  const accounts = readRoot("accounts");
  const characters = readRoot("characters");
  const items = readRoot("items");
  const shipCosmeticsRuntime = readRoot("shipCosmetics");
  const shipCosmeticsCatalog = readCatalog();

  return {
    runtime: {
      accounts: countObjectEntries(accounts),
      characters: countObjectEntries(characters),
      items: countObjectEntries(items),
      appliedShipSkins: countObjectEntries(shipCosmeticsRuntime.ships),
      characterSkinOverrides: countSkinOverrides(shipCosmeticsRuntime.characters || {}),
    },
    space: {
      solarSystems: world.solarSystems.length,
      stations: world.stations.length,
      stationTypes: world.stationTypes.length,
      celestials: world.celestials.length,
      asteroidBelts: world.asteroidBelts.length,
      stargates: world.stargates.length,
      stargateTypes: world.stargateTypes.length,
    },
    reference: {
      shipTypes: readStaticRows(TABLE.SHIP_TYPES).length,
      skillTypes: readStaticRows(TABLE.SKILL_TYPES).length,
      movementAttributes: world.attributes.length,
    },
    cosmetics: {
      skins: normalizeCount(
        shipCosmeticsCatalog.counts && shipCosmeticsCatalog.counts.skins,
        countObjectEntries(shipCosmeticsCatalog.skinsBySkinID),
      ),
      shipTypes: normalizeCount(
        shipCosmeticsCatalog.counts && shipCosmeticsCatalog.counts.shipTypes,
        countObjectEntries(shipCosmeticsCatalog.shipTypesByTypeID),
      ),
      materials: normalizeCount(
        shipCosmeticsCatalog.counts && shipCosmeticsCatalog.counts.materials,
        countObjectEntries(shipCosmeticsCatalog.materialsByMaterialID),
      ),
      licenseTypes: normalizeCount(
        shipCosmeticsCatalog.counts && shipCosmeticsCatalog.counts.licenseTypes,
        countObjectEntries(shipCosmeticsCatalog.licenseTypesByTypeID),
      ),
    },
  };
}

function formatStartupDataSummary(summary = buildStartupDataSummary()) {
  return [
    `[Startup] Runtime: ${summary.runtime.accounts} accounts, ${summary.runtime.characters} characters, ${summary.runtime.items} items`,
    `[Startup] Space: ${summary.space.solarSystems} solar systems, ${summary.space.stations} stations, ${summary.space.stationTypes} station types, ${summary.space.celestials} celestials, ${summary.space.asteroidBelts} asteroid belts, ${summary.space.stargates} stargates, ${summary.space.stargateTypes} stargate types`,
    `[Startup] Reference: ${summary.reference.shipTypes} ship types, ${summary.reference.skillTypes} skill types, ${summary.reference.movementAttributes} movement profiles`,
    `[Startup] Cosmetics: ${summary.cosmetics.skins} skins, ${summary.cosmetics.shipTypes} skinnable hull mappings, ${summary.cosmetics.materials} materials, ${summary.cosmetics.licenseTypes} license types, ${summary.runtime.appliedShipSkins} applied ship skins, ${summary.runtime.characterSkinOverrides} character skin overrides`,
  ];
}

function logStartupDataSummary(logger = log) {
  const summary = buildStartupDataSummary();

  if (typeof logger.success === "function") {
    logger.success("[Startup] Data summary");
  } else {
    console.log("[Startup] Data summary");
  }

  for (const line of formatStartupDataSummary(summary)) {
    if (typeof logger.info === "function") {
      logger.info(line);
      continue;
    }
    console.log(line);
  }

  return summary;
}

module.exports = {
  buildStartupDataSummary,
  formatStartupDataSummary,
  logStartupDataSummary,
};
