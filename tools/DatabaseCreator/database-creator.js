#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const crypto = require("crypto");
const {
  STRUCTURE_SIZE,
  STRUCTURE_FAMILY,
  STRUCTURE_GROUP_ID,
  DEFAULT_STRUCTURE_RADIUS,
  DEFAULT_STRUCTURE_TETHER_RANGE,
  STRUCTURE_TYPE_PRESETS,
  TATARA_EXCLUDED_DOCK_GROUP_NAMES,
  ONE_WAY_UNDOCK_TYPE_IDS,
  getAllowedServicesForStructureType,
} = require(path.join(
  __dirname,
  "..",
  "..",
  "server",
  "src",
  "services",
  "structure",
  "structureConstants.js",
));

const DEFAULT_BUILD = 3396210;
const DEFAULT_SDE_URL =
  "https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-3396210-jsonl.zip";
const STRUCTURE_SOVEREIGNTY_TYPE_IDS = new Set([32226, 32458]);
const STRUCTURE_REQUIRED_EXTRA_TYPE_IDS = [81080, 84294, 85230, 87227];
const STARTER_SHIP_FITTING_DEFINITIONS = Object.freeze([
  {
    shipTypeID: 588,
    modules: [{ typeID: 21857 }, { typeID: 3636 }, { typeID: 3651 }],
  },
  {
    shipTypeID: 596,
    modules: [{ typeID: 21857 }, { typeID: 3634 }, { typeID: 3651 }],
  },
  {
    shipTypeID: 601,
    modules: [{ typeID: 21857 }, { typeID: 3638 }, { typeID: 3651 }],
  },
  {
    shipTypeID: 606,
    modules: [{ typeID: 21857 }, { typeID: 3638 }, { typeID: 3651 }],
  },
  {
    shipTypeID: 58745,
    modules: [
      { typeID: 3634, quantity: 2, slotFamily: "high" },
      { typeID: 21857, slotFamily: "med" },
      { typeID: 30328, slotFamily: "med" },
      { typeID: 1957, slotFamily: "med" },
    ],
  },
]);

const GENERATED_TABLES = new Set([
  "asteroidBelts",
  "asteroidFieldStyles",
  "agentAuthority",
  "celestials",
  "characterCreationBloodlines",
  "characterCreationRaces",
  "characterCreationSchools",
  "clientTypeLists",
  "dbuffCollections",
  "factions",
  "industryBlueprints",
  "industryFacilities",
  "itemIcons",
  "itemTypes",
  "mapTagsAuthority",
  "movementAttributes",
  "npcCargo",
  "npcWreckItems",
  "npcWrecks",
  "planetSchematics",
  "reprocessingStatic",
  "shipDogmaAttributes",
  "shipCosmeticsCatalog",
  "shipTypes",
  "skillTypes",
  "solarSystems",
  "sovereigntyStatic",
  "stargates",
  "stargateTypes",
  "stations",
  "stationTypes",
  "starterShipFittings",
  "structureTypes",
  "typeDogma",
]);

const REQUIRED_TABLES = [
  "accessGroups",
  "accounts",
  "agentAuthority",
  "alliances",
  "asteroidBelts",
  "asteroidFieldStyles",
  "asteroidTypesBySolarSystemID",
  "authoredSpaceProps",
  "bookmarkFolders",
  "bookmarkGroups",
  "bookmarkKnownFolders",
  "bookmarkRuntimeState",
  "bookmarks",
  "bookmarkSubfolders",
  "calendarEvents",
  "calendarResponses",
  "capitalNpcAuthority",
  "celestials",
  "characterCreationBloodlines",
  "characterCreationRaces",
  "characterCreationSchools",
  "characterExpertSystems",
  "characterNotes",
  "characters",
  "clientEntityStandings",
  "clientTypeLists",
  "corporationBills",
  "corporationGoals",
  "corporationRuntime",
  "corporations",
  "corporationVotes",
  "dbuffCollections",
  "dungeonAuthority",
  "dungeonRuntimeState",
  "evermarkEntitlements",
  "evermarksCatalog",
  "expertSystems",
  "explorationAuthority",
  "explorationWormholeStatic",
  "factions",
  "fighterAbilities",
  "identityState",
  "industryBlueprints",
  "industryBlueprintState",
  "industryFacilities",
  "industryFacilityState",
  "industryJobs",
  "industryRuntime",
  "insuranceContracts",
  "itemIcons",
  "items",
  "itemTypes",
  "killmails",
  "lpWallets",
  "mail",
  "mapTagsAuthority",
  "marketEscrow",
  "marketRuntime",
  "miningLedger",
  "miningRuntimeState",
  "missionAuthority",
  "missionRuntimeState",
  "moduleGroupingState",
  "movementAttributes",
  "newEdenStore",
  "newEdenStoreRuntime",
  "notifications",
  "npcBehaviorProfiles",
  "npcCargo",
  "npcControlState",
  "npcEntities",
  "npcHostileUtilities",
  "npcLoadouts",
  "npcLootTables",
  "npcModules",
  "npcProfiles",
  "npcRuntimeControllers",
  "npcRuntimeState",
  "npcSpawnGroups",
  "npcSpawnPools",
  "npcSpawnSites",
  "npcStandingsAuthority",
  "npcStartupRules",
  "npcWreckItems",
  "npcWrecks",
  "overviewSharedPresets",
  "planetOrbitalState",
  "planetRuntimeState",
  "planetSchematics",
  "probeRuntimeState",
  "raffles",
  "rafflesRuntime",
  "reprocessingClientRandomizedMaterials",
  "reprocessingFacilityState",
  "reprocessingStatic",
  "savedFittings",
  "sharedBookmarkFolders",
  "shipCosmetics",
  "shipCosmeticsCatalog",
  "shipDirt",
  "shipDogmaAttributes",
  "shipInsurancePrices",
  "shipKillCounters",
  "shipLogoFittings",
  "shipTypes",
  "skillPlans",
  "skillQueues",
  "skills",
  "skillTradingState",
  "skillTrainingAlphaCaps",
  "skillTypes",
  "solarSystems",
  "sovereignty",
  "sovereigntyStatic",
  "stargates",
  "stargateTypes",
  "stargateVisualOverrides",
  "starterShipFittings",
  "stationGraphicLocators",
  "stations",
  "stationStandingsRestrictions",
  "stationTypes",
  "structureAssetSafety",
  "structureGraphicLocators",
  "structurePaintwork",
  "structureProfiles",
  "structures",
  "structureTetherRestrictions",
  "structureTypes",
  "trigDrifterSpawnAuthority",
  "typeDogma",
  "wormholeRuntimeState",
];

const ATTRIBUTE_IDS = {
  mass: 4,
  maxVelocity: 37,
  capacity: 38,
  radius: 162,
  inertia: 70,
  signatureRadius: 552,
  warpSpeedMultiplier: 600,
};

const REPROCESSING_ATTRIBUTE_IDS = {
  refiningYieldMultiplier: 717,
  reprocessingSkillType: 790,
  rigSize: 1547,
  hiSecModifier: 2355,
  lowSecModifier: 2356,
  nullSecModifier: 2357,
  oreBasicType: 2711,
  strRefiningYieldBonus: 2722,
  structureGasDecompressionEfficiencyBonus: 3261,
  gasDecompressionBaseEfficiency: 3262,
};

const REPROCESSING_ORE_SKILL_TYPE_IDS = new Set([
  12189,
  12195,
  60377,
  60378,
  60379,
  60380,
  60381,
]);

const REPROCESSING_MOON_ORE_SKILL_TYPE_IDS = new Set([
  46152,
  46153,
  46154,
  46155,
  46156,
]);

const REPROCESSING_GAS_GROUP_IDS = new Set([
  12,
  226,
  305,
  307,
  340,
  448,
  649,
  711,
  897,
  920,
  1975,
  2020,
  4168,
]);

const REPROCESSING_GENERAL_REFINABLE_TYPE_IDS = new Set([
  41139,
]);

const SOVEREIGNTY_PLANET_DEFINITIONS_VERSION = {
  major: 24,
  minor: 1,
  patch: 0,
  prerelease_tags: [],
  build_tags: ["elysian-eve", "ccp-equinox-resource-data4"],
};

const ASTEROID_FIELD_STYLES = [
  {
    fieldStyleID: "empire_highsec_standard",
    name: "Empire High-Sec Standard Belt",
    securityMin: 0.45,
    securityMax: 1.1,
    asteroidCountMin: 16,
    asteroidCountMax: 24,
    clusterCountMin: 3,
    clusterCountMax: 4,
    fieldRadiusMinMeters: 26000,
    fieldRadiusMaxMeters: 34000,
    clusterRadiusMinMeters: 3500,
    clusterRadiusMaxMeters: 7000,
    verticalSpreadMinMeters: 2000,
    verticalSpreadMaxMeters: 5000,
    innerExclusionRadiusMeters: 2000,
    largeAsteroidCountMin: 0,
    largeAsteroidCountMax: 1,
    decorativeTypes: [
      { typeID: 60559, weight: 4, radiusMinMeters: 900, radiusMaxMeters: 1800 },
      { typeID: 60560, weight: 4, radiusMinMeters: 1000, radiusMaxMeters: 1900 },
      { typeID: 60561, weight: 3, radiusMinMeters: 1100, radiusMaxMeters: 2100 },
      { typeID: 60562, weight: 2, radiusMinMeters: 1200, radiusMaxMeters: 2200 },
    ],
    largeTypes: [
      { typeID: 90042, weight: 3 },
      { typeID: 90445, weight: 2 },
    ],
  },
  {
    fieldStyleID: "empire_lowsec_standard",
    name: "Empire Low-Sec Standard Belt",
    securityMin: 0,
    securityMax: 0.449999,
    asteroidCountMin: 20,
    asteroidCountMax: 30,
    clusterCountMin: 4,
    clusterCountMax: 5,
    fieldRadiusMinMeters: 30000,
    fieldRadiusMaxMeters: 38000,
    clusterRadiusMinMeters: 4500,
    clusterRadiusMaxMeters: 8500,
    verticalSpreadMinMeters: 2500,
    verticalSpreadMaxMeters: 6500,
    innerExclusionRadiusMeters: 2200,
    largeAsteroidCountMin: 1,
    largeAsteroidCountMax: 2,
    decorativeTypes: [
      { typeID: 60559, weight: 3, radiusMinMeters: 1100, radiusMaxMeters: 2200 },
      { typeID: 60560, weight: 4, radiusMinMeters: 1200, radiusMaxMeters: 2400 },
      { typeID: 60561, weight: 4, radiusMinMeters: 1300, radiusMaxMeters: 2600 },
      { typeID: 60562, weight: 3, radiusMinMeters: 1400, radiusMaxMeters: 2800 },
    ],
    largeTypes: [
      { typeID: 90042, weight: 2 },
      { typeID: 90445, weight: 3 },
    ],
  },
  {
    fieldStyleID: "nullsec_standard",
    name: "Null-Sec Standard Belt",
    securityMin: -1,
    securityMax: -0.000001,
    asteroidCountMin: 24,
    asteroidCountMax: 36,
    clusterCountMin: 5,
    clusterCountMax: 6,
    fieldRadiusMinMeters: 34000,
    fieldRadiusMaxMeters: 46000,
    clusterRadiusMinMeters: 5000,
    clusterRadiusMaxMeters: 10000,
    verticalSpreadMinMeters: 3000,
    verticalSpreadMaxMeters: 8000,
    innerExclusionRadiusMeters: 2600,
    largeAsteroidCountMin: 2,
    largeAsteroidCountMax: 3,
    decorativeTypes: [
      { typeID: 60559, weight: 2, radiusMinMeters: 1300, radiusMaxMeters: 2600 },
      { typeID: 60560, weight: 3, radiusMinMeters: 1400, radiusMaxMeters: 2800 },
      { typeID: 60561, weight: 4, radiusMinMeters: 1500, radiusMaxMeters: 3100 },
      { typeID: 60562, weight: 4, radiusMinMeters: 1600, radiusMaxMeters: 3400 },
    ],
    largeTypes: [
      { typeID: 90042, weight: 2 },
      { typeID: 90445, weight: 3 },
      { typeID: 90446, weight: 2 },
    ],
  },
  {
    fieldStyleID: "wormhole_standard",
    name: "Wormhole Standard Belt",
    securityMin: -1,
    securityMax: 1.1,
    asteroidCountMin: 18,
    asteroidCountMax: 28,
    clusterCountMin: 4,
    clusterCountMax: 5,
    fieldRadiusMinMeters: 28000,
    fieldRadiusMaxMeters: 40000,
    clusterRadiusMinMeters: 4500,
    clusterRadiusMaxMeters: 9000,
    verticalSpreadMinMeters: 3000,
    verticalSpreadMaxMeters: 7500,
    innerExclusionRadiusMeters: 2400,
    largeAsteroidCountMin: 1,
    largeAsteroidCountMax: 3,
    decorativeTypes: [
      { typeID: 60559, weight: 2, radiusMinMeters: 1200, radiusMaxMeters: 2400 },
      { typeID: 60560, weight: 2, radiusMinMeters: 1400, radiusMaxMeters: 2600 },
      { typeID: 60561, weight: 3, radiusMinMeters: 1500, radiusMaxMeters: 3000 },
      { typeID: 60562, weight: 3, radiusMinMeters: 1600, radiusMaxMeters: 3200 },
    ],
    largeTypes: [
      { typeID: 90042, weight: 1 },
      { typeID: 90445, weight: 2 },
      { typeID: 90446, weight: 2 },
    ],
  },
];

const ZERO_DEFAULT_RADIUS_TYPE_IDS = new Set([40550, 70826, 76359]);
const DBUFF_OPERATION_BY_NAME = new Map([
  ["ModAdd", 2],
  ["PostMul", 4],
  ["PostPercent", 6],
  ["PreAssignment", 7],
  ["PostAssignment", 8],
]);

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    sdeDir: "",
    outDir: "",
    build: DEFAULT_BUILD,
    sdeUrl: DEFAULT_SDE_URL,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sde-dir") {
      options.sdeDir = path.resolve(argv[++index]);
    } else if (arg === "--out") {
      options.outDir = path.resolve(argv[++index]);
    } else if (arg === "--build") {
      options.build = Number(argv[++index]);
    } else if (arg === "--sde-url") {
      options.sdeUrl = String(argv[++index] || "");
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node tools/DatabaseCreator/database-creator.js --sde-dir <jsonl-dir> --out <data-dir> [--force]",
  ].join("\n");
}

function assertDirectory(dirPath, label) {
  if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`${label} not found: ${dirPath || "(missing)"}`);
  }
}

function ensureCleanOutDir(outDir, force) {
  if (fs.existsSync(outDir)) {
    const entries = fs.readdirSync(outDir);
    if (entries.length > 0 && !force) {
      throw new Error(`Output data directory is not empty. Re-run with --force: ${outDir}`);
    }
    if (force) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(outDir, { recursive: true });
}

function localName(value, fallback = "") {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return value.en || value.en_US || value["en-us"] || value.enGB || Object.values(value)[0] || fallback;
  }
  return fallback;
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function optionalInt(value) {
  return value == null ? null : toInt(value, 0);
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(value) {
  return {
    x: toNumber(value && value.x, 0),
    y: toNumber(value && value.y, 0),
    z: toNumber(value && value.z, 0),
  };
}

function roundNumber(value, decimalPlaces) {
  const numeric = toNumber(value, 0);
  return Number(numeric.toFixed(decimalPlaces));
}

function roundVector(value, decimalPlaces = 3) {
  return {
    x: roundNumber(value && value.x, decimalPlaces),
    y: roundNumber(value && value.y, decimalPlaces),
    z: roundNumber(value && value.z, decimalPlaces),
  };
}

function addVectors(left, right) {
  if (!left || !right) {
    return null;
  }
  return {
    x: toNumber(left.x, 0) + toNumber(right.x, 0),
    y: toNumber(left.y, 0) + toNumber(right.y, 0),
    z: toNumber(left.z, 0) + toNumber(right.z, 0),
  };
}

function romanNumeral(number) {
  const value = toInt(number, 0);
  if (value <= 0) {
    return "";
  }
  const numerals = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let remaining = value;
  let output = "";
  for (const [amount, token] of numerals) {
    while (remaining >= amount) {
      output += token;
      remaining -= amount;
    }
  }
  return output;
}

function fileTimeNow() {
  const unixMs = Date.now();
  const epochOffsetMs = 11644473600000;
  return String(BigInt(unixMs + epochOffsetMs) * 10000n);
}

function hashInteger(text) {
  return crypto.createHash("sha256").update(String(text)).digest().readUInt32BE(0);
}

function seededInt(seed, salt, min, max) {
  const lower = toInt(min, 0);
  const upper = toInt(max, lower);
  if (upper <= lower) {
    return lower;
  }
  return lower + (hashInteger(`${seed}:${salt}`) % (upper - lower + 1));
}

function asteroidFieldStyleForBelt(belt) {
  const securityClass = String(belt.securityClass || "").trim().toUpperCase();
  if (securityClass.startsWith("W") || belt.solarSystemID >= 31000000) {
    return ASTEROID_FIELD_STYLES.find((style) => style.fieldStyleID === "wormhole_standard");
  }
  const security = toNumber(belt.security, 0);
  if (security >= 0.45) {
    return ASTEROID_FIELD_STYLES.find((style) => style.fieldStyleID === "empire_highsec_standard");
  }
  if (security >= 0) {
    return ASTEROID_FIELD_STYLES.find((style) => style.fieldStyleID === "empire_lowsec_standard");
  }
  return ASTEROID_FIELD_STYLES.find((style) => style.fieldStyleID === "nullsec_standard");
}

function addAsteroidFieldProfile(belt) {
  const style = asteroidFieldStyleForBelt(belt) || ASTEROID_FIELD_STYLES[0];
  const seed = belt.fieldSeed || belt.itemID;
  return {
    ...belt,
    fieldStyleID: style.fieldStyleID,
    fieldSeed: seed,
    asteroidCount: seededInt(seed, "asteroidCount", style.asteroidCountMin, style.asteroidCountMax),
    clusterCount: seededInt(seed, "clusterCount", style.clusterCountMin, style.clusterCountMax),
    fieldRadiusMeters: seededInt(seed, "fieldRadiusMeters", style.fieldRadiusMinMeters, style.fieldRadiusMaxMeters),
    clusterRadiusMeters: seededInt(seed, "clusterRadiusMeters", style.clusterRadiusMinMeters, style.clusterRadiusMaxMeters),
    verticalSpreadMeters: seededInt(seed, "verticalSpreadMeters", style.verticalSpreadMinMeters, style.verticalSpreadMaxMeters),
    largeAsteroidCount: seededInt(seed, "largeAsteroidCount", style.largeAsteroidCountMin, style.largeAsteroidCountMax),
  };
}

async function readJsonlRecords(sdeDir, fileName, onRecord) {
  const filePath = path.join(sdeDir, fileName);
  if (!fs.existsSync(filePath)) {
    return 0;
  }
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let count = 0;
  for await (const line of lines) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    onRecord(JSON.parse(text));
    count += 1;
  }
  return count;
}

function buildSource(options, sdeMeta = {}) {
  return {
    provider: "CCP public static-data JSONL",
    authority: `eve-online-static-data-${options.build}-jsonl`,
    buildNumber: options.build,
    sdeUrl: options.sdeUrl,
    releaseDate: sdeMeta.releaseDate || null,
    generatedAt: new Date().toISOString(),
    generatedBy: "tools/DatabaseCreator",
  };
}

function typeRecord(raw, groups, categories) {
  const group = groups.get(toInt(raw.groupID));
  const category = group ? categories.get(toInt(group.categoryID)) : null;
  const groupID = toInt(raw.groupID);
  return {
    typeID: toInt(raw._key),
    groupID,
    categoryID: groupID === 0 ? null : toInt(group && group.categoryID),
    groupName: localName(group && group.name),
    categoryName: localName(category && category.name),
    name: localName(raw.name, `Type ${raw._key}`),
    description: localName(raw.description, ""),
    mass: toNumber(raw.mass, 0),
    volume: toNumber(raw.volume, 0),
    capacity: toNumber(raw.capacity, 0),
    portionSize: toInt(raw.portionSize, 1),
    raceID: raw.raceID == null ? null : toInt(raw.raceID, 0),
    basePrice: toNumber(raw.basePrice, 0),
    marketGroupID: toInt(raw.marketGroupID, 0) || null,
    iconID: toInt(raw.iconID, 0) || null,
    soundID: toInt(raw.soundID, 0) || null,
    graphicID: toInt(raw.graphicID, 0) || null,
    radius: toNumber(raw.radius, 0),
    published: raw.published === true,
    metaGroupID: toInt(raw.metaGroupID, 0) || null,
  };
}

function publicTypeRecord(type, shape = "full") {
  const base = {
    typeID: type.typeID,
    groupID: type.groupID,
    categoryID: type.groupID === 0 ? null : type.categoryID,
    groupName: type.groupID === 0 ? null : type.groupName,
    name: type.name,
  };

  if (shape === "skill") {
    return {
      ...base,
      published: type.published === true,
      raceID: type.raceID,
      basePrice: type.basePrice,
      marketGroupID: type.marketGroupID,
      iconID: type.iconID,
      soundID: type.soundID,
      graphicID: type.graphicID,
    };
  }

  return {
    ...base,
    mass: type.mass,
    volume: type.volume,
    capacity: type.capacity,
    portionSize: type.portionSize,
    raceID: type.raceID,
    basePrice: type.basePrice,
    marketGroupID: type.marketGroupID,
    iconID: type.iconID,
    soundID: type.soundID,
    graphicID: type.graphicID,
    radius: type.radius || (ZERO_DEFAULT_RADIUS_TYPE_IDS.has(type.typeID) ? 0 : 1),
    published: type.published === true,
  };
}

function compareTypeNameThenID(left, right) {
  return String(left.name || "").localeCompare(String(right.name || "")) ||
    (Number(left.typeID) - Number(right.typeID));
}

function stargateTypeRecord(type) {
  return {
    typeID: type.typeID,
    typeName: type.name,
    groupID: type.groupID,
    categoryID: type.categoryID,
    groupName: type.groupName,
    raceID: type.raceID,
    graphicID: type.graphicID,
    published: type.published === true,
  };
}

function stationTypeRecord(type, locator = null) {
  const directionalLocators = Array.isArray(locator && locator.directionalLocators)
    ? locator.directionalLocators
    : [];
  const dockLocator = directionalLocators[0] || null;
  return {
    stationTypeID: type.typeID,
    typeName: type.name,
    groupID: type.groupID,
    categoryID: type.categoryID,
    groupName: type.groupName,
    raceID: type.raceID,
    graphicID: type.graphicID,
    radius: type.radius || 0,
    basePrice: type.basePrice,
    volume: type.volume,
    portionSize: type.portionSize,
    published: type.published === true,
    dockEntry: dockLocator ? cloneVector(dockLocator.position) : null,
    dockOrientation: dockLocator ? cloneVector(dockLocator.direction) : null,
    graphicLocationID: toInt(locator && locator.graphicLocationID, 0) || null,
    directionalLocatorCategories: Array.isArray(locator && locator.directionalLocatorCategories)
      ? locator.directionalLocatorCategories
      : [],
    undockLocatorCategories: Array.isArray(locator && locator.undockLocatorCategories)
      ? locator.undockLocatorCategories
      : [],
  };
}

function intArray(value) {
  return Array.isArray(value) ? value.map((entry) => toInt(entry, 0)) : [];
}

function clientTypeListRecord(row) {
  return {
    excludedTypeIDs: intArray(row.excludedTypeIDs),
    listID: toInt(row._key),
    includedCategoryIDs: intArray(row.includedCategoryIDs),
    includedTypeIDs: intArray(row.includedTypeIDs),
    excludedGroupIDs: intArray(row.excludedGroupIDs),
    includedGroupIDs: intArray(row.includedGroupIDs),
    excludedCategoryIDs: intArray(row.excludedCategoryIDs),
  };
}

function clientTypeListCounts(rows) {
  return {
    includedCategoryReferenceCount: rows.reduce((sum, row) => sum + row.includedCategoryIDs.length, 0),
    includedGroupReferenceCount: rows.reduce((sum, row) => sum + row.includedGroupIDs.length, 0),
    typeListCount: rows.length,
    excludedTypeReferenceCount: rows.reduce((sum, row) => sum + row.excludedTypeIDs.length, 0),
    excludedCategoryReferenceCount: rows.reduce((sum, row) => sum + row.excludedCategoryIDs.length, 0),
    includedTypeReferenceCount: rows.reduce((sum, row) => sum + row.includedTypeIDs.length, 0),
    excludedGroupReferenceCount: rows.reduce((sum, row) => sum + row.excludedGroupIDs.length, 0),
  };
}

function skillLevelRecords(skills) {
  return (Array.isArray(skills) ? skills : []).map((skill) => ({
    typeID: toInt(skill._key || skill.typeID, 0),
    level: toInt(skill._value || skill.level, 0),
  }));
}

function characterCreationRaceRecord(row, typeByID) {
  const shipTypeID = toInt(row.shipTypeID, 0);
  const shipType = typeByID.get(shipTypeID) || {};
  return {
    raceID: toInt(row._key),
    name: localName(row.name),
    shipTypeID,
    shipName: shipType.name || "",
    skills: skillLevelRecords(row.skills),
  };
}

function characterCreationBloodlineRecord(row) {
  return {
    bloodlineID: toInt(row._key),
    name: localName(row.name),
    raceID: toInt(row.raceID),
    corporationID: toInt(row.corporationID, 0),
  };
}

function factionRecord(row) {
  return {
    factionID: toInt(row._key),
    corporationID: optionalInt(row.corporationID),
    name: localName(row.name),
    shortDescription: localName(row.shortDescription),
    description: localName(row.description),
    flatLogo: row.flatLogo || null,
    flatLogoWithName: row.flatLogoWithName || null,
    iconID: toInt(row.iconID, 0) || null,
    militiaCorporationID: toInt(row.militiaCorporationID, 0) || null,
    solarSystemID: toInt(row.solarSystemID, 0) || null,
    sizeFactor: toNumber(row.sizeFactor, 0),
    uniqueName: row.uniqueName === true,
    memberRaces: intArray(row.memberRaces),
  };
}

function dbuffCollectionRecord(row) {
  return {
    collectionID: toInt(row._key),
    aggregateMode: row.aggregateMode || "",
    operation: DBUFF_OPERATION_BY_NAME.get(row.operationName) || 0,
    operationName: row.operationName || "",
    developerDescription: row.developerDescription || "",
    itemModifiers: Array.isArray(row.itemModifiers) ? row.itemModifiers : [],
    locationModifiers: Array.isArray(row.locationModifiers) ? row.locationModifiers : [],
    locationGroupModifiers: Array.isArray(row.locationGroupModifiers) ? row.locationGroupModifiers : [],
    locationCategoryModifiers: Array.isArray(row.locationCategoryModifiers) ? row.locationCategoryModifiers : [],
    locationRequiredSkillModifiers: Array.isArray(row.locationRequiredSkillModifiers)
      ? row.locationRequiredSkillModifiers
      : [],
  };
}

function planetSchematicRecord(row) {
  const materials = Array.isArray(row.types) ? row.types : [];
  function schematicMaterial(entry) {
    return {
      typeID: toInt(entry._key ?? entry.typeID),
      quantity: toInt(entry.quantity, 0),
    };
  }
  return {
    schematicID: toInt(row._key),
    name: localName(row.name),
    cycleTime: toInt(row.cycleTime, 0),
    pinTypeIDs: intArray(row.pins),
    inputs: materials
      .filter((entry) => entry.isInput === true)
      .map(schematicMaterial),
    outputs: materials
      .filter((entry) => entry.isInput === false)
      .map(schematicMaterial),
  };
}

function buildItemIcons(authority, options, source) {
  const iconsByID = {};
  for (const row of authority.icons) {
    const iconID = toInt(row && row._key, -1);
    const iconFile = row && typeof row.iconFile === "string" ? row.iconFile.trim() : "";
    if (iconID < 0 || iconFile === "") {
      continue;
    }
    iconsByID[String(iconID)] = iconFile;
  }
  return {
    meta: {
      version: 1,
      description: "Cached iconID to res path authority for local store/catalog image seeding.",
      updatedAt: source.generatedAt,
      sourceSnapshot: path.basename(options.sdeDir || `eve-online-static-data-${options.build}-jsonl`),
    },
    iconsByID,
  };
}

function industryFacilityProfile(station, operation) {
  const serviceIDs = Array.isArray(operation.services)
    ? operation.services.map((serviceID) => toInt(serviceID)).sort((left, right) => left - right)
    : [];
  const supportsFactory = serviceIDs.includes(14);
  const supportsLaboratory = serviceIDs.includes(15);
  if (!supportsFactory && !supportsLaboratory) {
    return null;
  }
  return {
    facilityID: station.stationID,
    solarSystemID: station.solarSystemID,
    regionID: station.regionID,
    typeID: station.stationTypeID,
    ownerID: station.corporationID,
    operationID: station.operationID,
    serviceIDs,
    supportsFactory,
    supportsLaboratory,
    manufacturingFactor: toNumber(operation.manufacturingFactor, 1),
    researchFactor: toNumber(operation.researchFactor, 1),
  };
}

function buildIndustryFacilities(authority, source) {
  const npcFacilityProfiles = authority.stations
    .map((station) => industryFacilityProfile(
      station,
      authority.stationOperationsByID.get(station.operationID) || {},
    ))
    .filter(Boolean);
  return {
    source,
    npcFacilityProfiles,
    npcFacilityProfilesByFacilityID: Object.fromEntries(
      npcFacilityProfiles.map((profile) => [String(profile.facilityID), profile]),
    ),
  };
}

function dogmaAttributeNameMap(dogmaAttributes) {
  const byID = new Map();
  for (const row of Object.values(dogmaAttributes)) {
    byID.set(toInt(row._key), row.name || "");
  }
  return byID;
}

function typeDogmaAttributeByName(typeID, attributeNames, dogmaByTypeID, dogmaAttributeNamesByID) {
  const row = dogmaByTypeID.get(String(typeID));
  if (!row || !Array.isArray(row.dogmaAttributes)) {
    return 0;
  }
  const names = new Set(attributeNames);
  for (const attribute of row.dogmaAttributes) {
    if (names.has(dogmaAttributeNamesByID.get(toInt(attribute.attributeID)))) {
      return toNumber(attribute.value, 0);
    }
  }
  return 0;
}

function deriveStructureFamily(groupID, typeID) {
  const preset = STRUCTURE_TYPE_PRESETS[toPositiveInt(typeID)] || null;
  if (preset && preset.family) {
    return preset.family;
  }
  switch (toPositiveInt(groupID)) {
    case STRUCTURE_GROUP_ID.CITADEL:
      return STRUCTURE_FAMILY.CITADEL;
    case STRUCTURE_GROUP_ID.ENGINEERING_COMPLEX:
      return STRUCTURE_FAMILY.ENGINEERING;
    case STRUCTURE_GROUP_ID.REFINERY:
    case STRUCTURE_GROUP_ID.METENOX:
      return STRUCTURE_FAMILY.REFINERY;
    case STRUCTURE_GROUP_ID.CYNO_BEACON:
    case STRUCTURE_GROUP_ID.CYNO_JAMMER:
    case STRUCTURE_GROUP_ID.JUMP_GATE:
      return STRUCTURE_FAMILY.FLEX;
    case STRUCTURE_GROUP_ID.OBSERVATORY:
      return STRUCTURE_FAMILY.OBSERVATORY;
    case STRUCTURE_GROUP_ID.ADMINISTRATION_HUB:
      return STRUCTURE_FAMILY.SOV;
    case STRUCTURE_GROUP_ID.FOB:
    case STRUCTURE_GROUP_ID.PIRATE_STRONGHOLD:
      return STRUCTURE_FAMILY.STRONGHOLD;
    default:
      return STRUCTURE_FAMILY.UNKNOWN;
  }
}

function deriveStructureSize(groupID, typeID) {
  const preset = STRUCTURE_TYPE_PRESETS[toPositiveInt(typeID)] || null;
  if (preset && preset.size) {
    return preset.size;
  }
  if (toPositiveInt(groupID) === STRUCTURE_GROUP_ID.CYNO_BEACON) {
    return STRUCTURE_SIZE.FLEX;
  }
  return STRUCTURE_SIZE.UNDEFINED;
}

function structureTypeRecord(type, authority, dogmaAttributeNamesByID) {
  const typeID = type.typeID;
  const preset = STRUCTURE_TYPE_PRESETS[typeID] || null;
  const family = deriveStructureFamily(type.groupID, typeID);
  const size = deriveStructureSize(type.groupID, typeID);
  const dogma = (...names) => typeDogmaAttributeByName(
    typeID,
    names,
    authority.dogmaByTypeID,
    dogmaAttributeNamesByID,
  );
  return {
    typeID,
    name: type.name,
    groupID: type.groupID,
    categoryID: type.categoryID,
    structureFamily: family,
    structureSize: size,
    radius: Math.max(DEFAULT_STRUCTURE_RADIUS, toNumber(type.radius, dogma("radius")) || DEFAULT_STRUCTURE_RADIUS),
    shieldCapacity: Math.max(0, dogma("shieldCapacity")),
    armorHP: Math.max(0, dogma("armorHP")),
    hullHP: Math.max(0, dogma("hp", "structureHP")),
    capacitorCapacity: Math.max(0, dogma("capacitorCapacity")),
    maxTargetRange: Math.max(0, dogma("maxTargetRange")),
    maxLockedTargets: Math.max(0, dogma("maxLockedTargets")),
    tetheringRange: Math.max(DEFAULT_STRUCTURE_TETHER_RANGE, dogma("tetheringRange") || DEFAULT_STRUCTURE_TETHER_RANGE),
    damageCap: Math.max(0, dogma("damageCap")),
    allowedServices: getAllowedServicesForStructureType(typeID, family),
    dockable: typeof (preset && preset.dockable) === "boolean"
      ? preset.dockable
      : ![
        STRUCTURE_FAMILY.FLEX,
        STRUCTURE_FAMILY.OBSERVATORY,
        STRUCTURE_FAMILY.SOV,
      ].includes(family),
    defaultQuantumCoreTypeID: toPositiveInt(preset && preset.defaultQuantumCoreTypeID) || null,
    excludedDockGroupNames: typeID === 35836 ? [...TATARA_EXCLUDED_DOCK_GROUP_NAMES] : [],
    oneWayUndockClasses: [...(ONE_WAY_UNDOCK_TYPE_IDS[typeID] || [])],
    published: type.published !== false,
  };
}

function buildStructureTypes(authority) {
  const dogmaAttributeNamesByID = dogmaAttributeNameMap(authority.dogmaAttributes);
  const selectedTypes = [
    ...authority.types
      .filter((type) => STRUCTURE_SOVEREIGNTY_TYPE_IDS.has(type.typeID))
      .sort((left, right) => left.typeID - right.typeID),
    ...authority.types
      .filter((type) => type.categoryID === 65)
      .sort((left, right) => left.typeID - right.typeID),
    ...STRUCTURE_REQUIRED_EXTRA_TYPE_IDS
      .map((typeID) => authority.typeByID.get(typeID))
      .filter(Boolean),
  ];
  const seen = new Set();
  const structureTypes = [];
  for (const type of selectedTypes) {
    if (seen.has(type.typeID)) {
      continue;
    }
    seen.add(type.typeID);
    structureTypes.push(structureTypeRecord(type, authority, dogmaAttributeNamesByID));
  }
  return {
    _meta: {
      seedVersion: 2,
      generatedAt: new Date().toISOString(),
    },
    structureTypes,
  };
}

function buildMapTagsAuthority(options) {
  return {
    version: {
      major: 1,
      minor: 0,
      patch: 0,
      prerelease_tags: [],
      build_tags: [String(options.build)],
    },
    generatedAt: new Date().toISOString(),
    source: {
      provider: "EvEJS local bootstrap",
      reason: "No public SDE map-tag source data identified; emit empty authority shape.",
      usedFiles: [],
    },
    systems: [],
    constellations: [],
    regions: [],
  };
}

function starterTypeName(typeByID, typeID) {
  const type = typeByID.get(toInt(typeID));
  return type && type.name ? type.name : `Type ${typeID}`;
}

function buildStarterShipFittings(authority) {
  const fittings = {};
  for (const definition of STARTER_SHIP_FITTING_DEFINITIONS) {
    fittings[String(definition.shipTypeID)] = {
      shipTypeID: definition.shipTypeID,
      shipName: starterTypeName(authority.typeByID, definition.shipTypeID),
      modules: definition.modules.map((module) => {
        const record = {
          typeID: module.typeID,
          name: starterTypeName(authority.typeByID, module.typeID),
        };
        if (module.quantity != null) {
          record.quantity = module.quantity;
        }
        if (module.slotFamily) {
          record.slotFamily = module.slotFamily;
        }
        return record;
      }),
    };
  }
  return fittings;
}

function agentMissionKind(agentTypeID, divisionID) {
  if (agentTypeID === 4) {
    return "research";
  }
  if ([23, 27].includes(divisionID)) {
    return "mining";
  }
  if ([22, 25, 37].includes(divisionID)) {
    return "courier";
  }
  return "encounter";
}

function agentMissionTypeLabel(kind) {
  const labels = {
    courier: "UI/Agents/MissionTypes/Courier",
    encounter: "UI/Agents/MissionTypes/Encounter",
    mining: "UI/Agents/MissionTypes/Mining",
    research: "UI/Agents/MissionTypes/Research",
  };
  return labels[kind] || "UI/Agents/MissionTypes/Encounter";
}

function agentMissionPoolKey(record) {
  return [
    `kind:${record.missionKind}`,
    `level:${record.level}`,
    `agentType:${record.agentTypeID}`,
    `division:${record.divisionID}`,
    `corp:${record.corporationID}`,
    `faction:${record.factionID}`,
  ].join("|");
}

function addAgentIndex(indexes, indexName, key, agentID) {
  const normalizedKey = toInt(key, 0);
  if (!normalizedKey && indexName !== "missionPoolKeyToAgentIDs") {
    return;
  }
  const objectKey = indexName === "missionPoolKeyToAgentIDs" ? String(key || "") : String(normalizedKey);
  if (!objectKey) {
    return;
  }
  if (!indexes[indexName][objectKey]) {
    indexes[indexName][objectKey] = [];
  }
  indexes[indexName][objectKey].push(agentID);
}

function sortAgentIndex(index) {
  const sorted = {};
  for (const key of Object.keys(index).sort((left, right) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }
    return left.localeCompare(right);
  })) {
    sorted[key] = sortedUniqueNumbers(index[key]);
  }
  return sorted;
}

function buildAgentAuthority(authority, source) {
  const stationByID = new Map(authority.stations.map((station) => [station.stationID, station]));
  const agentsByID = {};
  const indexes = {
    stationIDToAgentIDs: {},
    corporationIDToAgentIDs: {},
    factionIDToAgentIDs: {},
    solarSystemIDToAgentIDs: {},
    agentTypeIDToAgentIDs: {},
    divisionIDToAgentIDs: {},
    missionPoolKeyToAgentIDs: {},
  };

  for (const row of [...authority.npcCharacters].sort((left, right) => toInt(left._key) - toInt(right._key))) {
    if (!row.agent || typeof row.agent !== "object") {
      continue;
    }
    const agentID = toInt(row._key, 0);
    const station = stationByID.get(toInt(row.locationID, 0)) || null;
    const corporationID = toInt(row.corporationID, 0);
    const corporation = authority.corporationsByID.get(corporationID) || {};
    const factionID = toInt(corporation.factionID, 0);
    const agentTypeID = toInt(row.agent.agentTypeID, 0);
    const divisionID = toInt(row.agent.divisionID, 0);
    const level = toInt(row.agent.level, 0);
    const missionKind = agentMissionKind(agentTypeID, divisionID);
    const record = {
      agentID,
      ownerTypeID: 1373,
      ownerName: localName(row.name, `Agent ${agentID}`),
      gender: row.gender === true ? 1 : 0,
      agentTypeID,
      divisionID,
      level,
      isLocator: row.agent.isLocator === true,
      corporationID,
      factionID,
      stationID: station ? station.stationID : null,
      stationTypeID: station ? station.stationTypeID : null,
      solarSystemID: station ? station.solarSystemID : toInt(row.locationID, 0) || null,
      isInSpace: false,
      raceID: toInt(row.raceID, 0),
      bloodlineID: toInt(row.bloodlineID, 0),
      careerID: toInt(row.careerID, 0),
      schoolID: toInt(row.schoolID, 0),
      specialityID: toInt(row.specialityID, 0),
      missionKind,
      missionTypeLabel: agentMissionTypeLabel(missionKind),
      missionPoolKey: "",
      missionTemplateIDs: [],
      importantMission: [6, 7, 10].includes(agentTypeID),
      conversationMetadata: {
        placeholder: true,
        source: "agentAuthority",
      },
    };
    record.missionPoolKey = agentMissionPoolKey(record);
    agentsByID[String(agentID)] = record;

    addAgentIndex(indexes, "stationIDToAgentIDs", record.stationID, agentID);
    addAgentIndex(indexes, "corporationIDToAgentIDs", record.corporationID, agentID);
    addAgentIndex(indexes, "factionIDToAgentIDs", record.factionID, agentID);
    addAgentIndex(indexes, "solarSystemIDToAgentIDs", record.solarSystemID, agentID);
    addAgentIndex(indexes, "agentTypeIDToAgentIDs", record.agentTypeID, agentID);
    addAgentIndex(indexes, "divisionIDToAgentIDs", record.divisionID, agentID);
    addAgentIndex(indexes, "missionPoolKeyToAgentIDs", record.missionPoolKey, agentID);
  }

  const sortedIndexes = {};
  for (const [indexName, index] of Object.entries(indexes)) {
    sortedIndexes[indexName] = sortAgentIndex(index);
  }

  const agentRows = Object.values(agentsByID);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      ...source,
      sourceFiles: ["npcCharacters.jsonl", "agentTypes.jsonl", "npcCorporations.jsonl", "npcStations.jsonl"],
      publicSdeLimitations: [
        "Mission template pools are local EvEJS authority data and are not present in public SDE JSONL.",
        "Current checked-in agentAuthority was seeded from an older npcCharacters snapshot plus local patches; public build counts can differ.",
      ],
    },
    counts: {
      agentCount: agentRows.length,
      stationAgentCount: agentRows.filter((row) => row.stationID != null).length,
      inSpaceAgentCount: agentRows.filter((row) => row.isInSpace === true).length,
      locatorAgentCount: agentRows.filter((row) => row.isLocator === true).length,
      researchAgentCount: agentRows.filter((row) => row.missionKind === "research").length,
      missionPoolCount: 0,
      missionTemplateCount: 0,
    },
    missionPoolsByKindAndLevel: {},
    agentsByID,
    indexes: sortedIndexes,
  };
}

function enLocalization(value) {
  const text = localName(value);
  return text ? { en: text } : null;
}

function enDescription(value) {
  const localized = enLocalization(value);
  if (!localized) {
    return null;
  }
  return { en: localized.en.replace(/\r?\n/g, "\r\n") };
}

function skinMaterialRecord(row) {
  return {
    skinMaterialID: toInt(row && row._key, 0),
    displayNameID: row && row.displayNameID != null ? toInt(row.displayNameID, 0) : null,
    materialSetID: toInt(row && row.materialSetID, 0),
    displayName: enLocalization(row && row.displayName),
  };
}

function sortedUniqueNumbers(values) {
  return [...new Set(values.map((value) => toInt(value, 0)).filter((value) => value > 0))]
    .sort((left, right) => left - right);
}

function cosmeticLicenseSummary(license, authority, skinsByID, includeSkinFields) {
  const licenseTypeID = toInt(license.licenseTypeID || license._key, 0);
  const skinID = toInt(license.skinID, 0);
  const skin = skinsByID.get(skinID) || null;
  const licenseType = authority.typeByID.get(licenseTypeID) || null;
  const group = licenseType ? authority.groups.get(toInt(licenseType.groupID, 0)) : null;
  const base = {
    licenseTypeID,
    duration: toInt(license.duration, -1),
    isSingleUse: license.isSingleUse === true,
    typeName: licenseType ? licenseType.name : null,
    published: licenseType ? licenseType.published === true : false,
    groupID: licenseType ? toInt(licenseType.groupID, 0) : 0,
    groupName: licenseType ? licenseType.groupName || null : null,
    groupPublished: group ? group.published === true : false,
  };

  if (!includeSkinFields) {
    return base;
  }

  return {
    licenseTypeID,
    skinID,
    skinMaterialID: skin ? toInt(skin.skinMaterialID, 0) || null : null,
    internalName: skin ? skin.internalName || "" : "",
    shipTypeIDs: skin ? sortedUniqueNumbers(intArray(skin.types)) : [],
    duration: base.duration,
    typeName: base.typeName,
    published: base.published,
    groupID: base.groupID,
    groupName: base.groupName,
    groupPublished: base.groupPublished,
    isSingleUse: base.isSingleUse,
    missingSkinDefinition: !skin,
  };
}

function ensureShipCosmeticIndex(shipTypesByTypeID, typeID) {
  const key = String(typeID);
  if (!shipTypesByTypeID[key]) {
    shipTypesByTypeID[key] = {
      typeID,
      skinIDs: [],
      materialIDs: [],
      licenseTypeIDs: [],
    };
  }
  return shipTypesByTypeID[key];
}

function buildShipCosmeticsCatalog(authority, options) {
  const skinsByID = new Map(authority.skins.map((row) => [toInt(row._key, 0), row]));
  const materialRowsByID = new Map(authority.skinMaterials.map((row) => [toInt(row._key, 0), row]));
  const licensesBySkinID = new Map();
  for (const license of authority.skinLicenses) {
    const skinID = toInt(license.skinID, 0);
    if (!licensesBySkinID.has(skinID)) {
      licensesBySkinID.set(skinID, []);
    }
    licensesBySkinID.get(skinID).push(license);
  }

  const skinsBySkinID = {};
  const shipTypesByTypeID = {};
  const materialsByMaterialID = {};
  const licenseTypesByTypeID = {};

  for (const material of [...authority.skinMaterials].sort((left, right) => toInt(left._key) - toInt(right._key))) {
    const materialRecord = skinMaterialRecord(material);
    materialsByMaterialID[String(materialRecord.skinMaterialID)] = {
      skinMaterialID: materialRecord.skinMaterialID,
      displayNameID: materialRecord.displayNameID,
      materialSetID: materialRecord.materialSetID,
      skinIDs: [],
      shipTypeIDs: [],
      licenseTypeIDs: [],
      displayName: materialRecord.displayName,
    };
  }

  for (const skin of [...authority.skins].sort((left, right) => toInt(left._key) - toInt(right._key))) {
    const skinID = toInt(skin._key, 0);
    const skinMaterialID = toInt(skin.skinMaterialID, 0) || null;
    const shipTypeIDs = sortedUniqueNumbers(intArray(skin.types));
    const licenseRows = [...(licensesBySkinID.get(skinID) || [])]
      .sort((left, right) => toInt(left.licenseTypeID || left._key) - toInt(right.licenseTypeID || right._key));
    const licenseTypeIDs = sortedUniqueNumbers(licenseRows.map((license) => license.licenseTypeID || license._key));
    const material = skinMaterialID ? materialRowsByID.get(skinMaterialID) : null;
    skinsBySkinID[String(skinID)] = {
      skinID,
      internalName: skin.internalName || "",
      skinMaterialID,
      material: material ? skinMaterialRecord(material) : null,
      shipTypeIDs,
      licenseTypeIDs,
      licenseTypes: licenseRows.map((license) => cosmeticLicenseSummary(license, authority, skinsByID, false)),
      allowCCPDevs: skin.allowCCPDevs === true,
      skinDescription: enDescription(skin.skinDescription),
      visibleSerenity: skin.visibleSerenity === true,
      visibleTranquility: skin.visibleTranquility === true,
    };

    if (skinMaterialID && !materialsByMaterialID[String(skinMaterialID)]) {
      materialsByMaterialID[String(skinMaterialID)] = {
        skinMaterialID,
        displayNameID: null,
        materialSetID: 0,
        skinIDs: [],
        shipTypeIDs: [],
        licenseTypeIDs: [],
        displayName: null,
      };
    }

    if (skinMaterialID) {
      const materialIndex = materialsByMaterialID[String(skinMaterialID)];
      materialIndex.skinIDs.push(skinID);
      materialIndex.shipTypeIDs.push(...shipTypeIDs);
      materialIndex.licenseTypeIDs.push(...licenseTypeIDs);
    }

    for (const shipTypeID of shipTypeIDs) {
      const shipIndex = ensureShipCosmeticIndex(shipTypesByTypeID, shipTypeID);
      shipIndex.skinIDs.push(skinID);
      if (skinMaterialID) {
        shipIndex.materialIDs.push(skinMaterialID);
      }
      shipIndex.licenseTypeIDs.push(...licenseTypeIDs);
    }
  }

  for (const license of [...authority.skinLicenses].sort((left, right) =>
    toInt(left.licenseTypeID || left._key) - toInt(right.licenseTypeID || right._key))) {
    const licenseTypeID = toInt(license.licenseTypeID || license._key, 0);
    licenseTypesByTypeID[String(licenseTypeID)] = cosmeticLicenseSummary(license, authority, skinsByID, true);
  }

  for (const index of Object.values(shipTypesByTypeID)) {
    index.skinIDs = sortedUniqueNumbers(index.skinIDs);
    index.materialIDs = sortedUniqueNumbers(index.materialIDs);
    index.licenseTypeIDs = sortedUniqueNumbers(index.licenseTypeIDs);
  }

  for (const index of Object.values(materialsByMaterialID)) {
    index.skinIDs = sortedUniqueNumbers(index.skinIDs);
    index.shipTypeIDs = sortedUniqueNumbers(index.shipTypeIDs);
    index.licenseTypeIDs = sortedUniqueNumbers(index.licenseTypeIDs);
  }

  const sortedShipTypesByTypeID = {};
  for (const key of Object.keys(shipTypesByTypeID).map(Number).sort((left, right) => left - right)) {
    sortedShipTypesByTypeID[String(key)] = shipTypesByTypeID[String(key)];
  }

  return {
    meta: {
      provider: "CCP public static-data JSONL",
      generatedAt: new Date().toISOString(),
      description: "Ship cosmetics catalog generated from public EVE Static Data JSONL.",
      authority: `eve-online-static-data-${options.build}-jsonl`,
      buildNumber: options.build,
      releaseDate: authority.sdeMeta.releaseDate || null,
      sourceFiles: ["skins.jsonl", "skinMaterials.jsonl", "skinLicenses.jsonl", "types.jsonl", "groups.jsonl"],
      publicSdeLimitations: [
        "skinMaterials.jsonl does not include displayNameID; generated displayNameID values are null.",
      ],
    },
    counts: {
      skins: Object.keys(skinsBySkinID).length,
      shipTypes: Object.keys(sortedShipTypesByTypeID).length,
      materials: Object.keys(materialsByMaterialID).length,
      licenseTypes: Object.keys(licenseTypesByTypeID).length,
    },
    skinsBySkinID,
    shipTypesByTypeID: sortedShipTypesByTypeID,
    materialsByMaterialID,
    licenseTypesByTypeID,
  };
}

function dogmaAttributeValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(5)) : value;
}

function dogmaAttributesForType(typeID, dogmaByTypeID) {
  const entry = dogmaByTypeID.get(String(typeID)) || {};
  const attributes = {};
  for (const attribute of Array.isArray(entry.dogmaAttributes) ? entry.dogmaAttributes : []) {
    const attributeID = toInt(attribute.attributeID, 0);
    attributes[String(attributeID)] = dogmaAttributeValue(attribute.value);
  }
  return attributes;
}

function dogmaAttributeRecord(row) {
  return {
    attributeID: toInt(row._key),
    attributeName: localName(row.displayName, row.name || ""),
    description: localName(row.description),
    iconID: row.iconID == null ? null : toInt(row.iconID, 0),
    defaultValue: toNumber(row.defaultValue, 0),
    published: row.published === true,
    displayName: localName(row.displayName),
    unitID: row.unitID == null ? null : toInt(row.unitID, 0),
    stackable: row.stackable === true,
    highIsGood: row.highIsGood === true,
    categoryID: toInt(row.attributeCategoryID, 0),
    name: row.name || "",
    dataType: toInt(row.dataType, 0),
    displayWhenZero: row.displayWhenZero === true,
  };
}

function movementRecord(type, dogmaByTypeID) {
  const attrs = dogmaAttributesForType(type.typeID, dogmaByTypeID);
  return {
    typeID: type.typeID,
    typeName: type.name,
    mass: toNumber(attrs[ATTRIBUTE_IDS.mass], type.mass),
    maxVelocity: toNumber(attrs[ATTRIBUTE_IDS.maxVelocity], null),
    inertia: toNumber(attrs[ATTRIBUTE_IDS.inertia], null),
    radius: toNumber(attrs[ATTRIBUTE_IDS.radius], type.radius),
    signatureRadius: toNumber(attrs[ATTRIBUTE_IDS.signatureRadius], null),
    warpSpeedMultiplier: toNumber(attrs[ATTRIBUTE_IDS.warpSpeedMultiplier], null),
    alignTime: null,
    maxAccelerationTime: null,
  };
}

function reprocessingFamily(type, reprocessingSkillType) {
  if (reprocessingSkillType === 18025) {
    return "ice";
  }
  if (REPROCESSING_MOON_ORE_SKILL_TYPE_IDS.has(reprocessingSkillType)) {
    return "moon_ore";
  }
  if (REPROCESSING_ORE_SKILL_TYPE_IDS.has(reprocessingSkillType) || type.categoryID === 25) {
    return "ore";
  }
  if (REPROCESSING_GAS_GROUP_IDS.has(type.groupID)) {
    return "gas";
  }
  return "general";
}

function reprocessingTypeRecord(row, typeByID, dogmaByTypeID) {
  const typeID = toInt(row._key);
  const type = typeByID.get(typeID) || {};
  const attrs = dogmaAttributesForType(typeID, dogmaByTypeID);
  const reprocessingSkillType = toInt(attrs[REPROCESSING_ATTRIBUTE_IDS.reprocessingSkillType], 0);
  const family = reprocessingFamily(type, reprocessingSkillType);
  return {
    typeID,
    name: type.name || `Type ${row._key}`,
    groupID: type.groupID || 0,
    categoryID: type.categoryID || 0,
    groupName: type.groupName || "",
    portionSize: type.portionSize || 1,
    basePrice: type.basePrice || 0,
    published: type.published === true,
    reprocessingSkillType,
    reprocessingFamily: family,
    isRefinable: family !== "general" || REPROCESSING_GENERAL_REFINABLE_TYPE_IDS.has(typeID),
    isRecyclable: true,
    materials: (Array.isArray(row.materials) ? row.materials : []).map((material) => ({
      materialTypeID: toInt(material.materialTypeID || material.typeID),
      quantity: toInt(material.quantity, 0),
    })),
    randomizedMaterials: [],
    averageRandomizedOutputs: [],
  };
}

function buildCompressedTypeMaps(types) {
  const typesByName = new Map();
  for (const type of [...types].sort((left, right) => left.typeID - right.typeID)) {
    if (!typesByName.has(type.name)) {
      typesByName.set(type.name, type);
    }
  }

  const compressedTypeBySourceTypeID = {};
  const sourceTypesByCompressedTypeID = {};

  for (const sourceType of [...types].sort((left, right) => left.typeID - right.typeID)) {
    if (!sourceType.name || sourceType.name.startsWith("Compressed ") || !sourceType.marketGroupID) {
      continue;
    }
    const compressedType = typesByName.get(`Compressed ${sourceType.name}`);
    if (!compressedType || !compressedType.marketGroupID) {
      continue;
    }
    compressedTypeBySourceTypeID[String(sourceType.typeID)] = compressedType.typeID;
    const compressedKey = String(compressedType.typeID);
    if (!sourceTypesByCompressedTypeID[compressedKey]) {
      sourceTypesByCompressedTypeID[compressedKey] = [];
    }
    sourceTypesByCompressedTypeID[compressedKey].push(sourceType.typeID);
  }

  return { compressedTypeBySourceTypeID, sourceTypesByCompressedTypeID };
}

function structureReprocessingProfile(type, dogmaByTypeID) {
  const attrs = dogmaAttributesForType(type.typeID, dogmaByTypeID);
  const rigSize = toInt(attrs[REPROCESSING_ATTRIBUTE_IDS.rigSize], 0);
  if (rigSize <= 0) {
    return null;
  }
  return {
    typeID: type.typeID,
    name: type.name,
    rigSize,
    reprocessingYieldBonusPercent: toNumber(attrs[REPROCESSING_ATTRIBUTE_IDS.strRefiningYieldBonus], 0),
    gasDecompressionEfficiencyBase: toNumber(
      attrs[REPROCESSING_ATTRIBUTE_IDS.gasDecompressionBaseEfficiency],
      0.8,
    ),
    gasDecompressionEfficiencyBonusAdd: toNumber(
      attrs[REPROCESSING_ATTRIBUTE_IDS.structureGasDecompressionEfficiencyBonus],
      0,
    ),
  };
}

function reprocessingRigYieldClasses(type) {
  const text = `${type.groupName || ""} ${type.name || ""}`.toLowerCase();
  if (!text.includes("reprocessing")) {
    return [];
  }
  if (text.includes("ice")) {
    return ["ice"];
  }
  if (text.includes("moon ore") || text.includes("lns ore")) {
    return ["moon_ore"];
  }
  if (text.includes("asteroid ore") || text.includes("hs ore")) {
    return ["ore"];
  }
  if (/\bore reprocessing\b/.test(text)) {
    return ["ore", "moon_ore"];
  }
  return ["ore", "moon_ore", "ice"];
}

function reprocessingRigProfile(type, dogmaByTypeID) {
  const attrs = dogmaAttributesForType(type.typeID, dogmaByTypeID);
  const rigSize = toInt(attrs[REPROCESSING_ATTRIBUTE_IDS.rigSize], 0);
  const refiningYieldMultiplierBase = attrs[REPROCESSING_ATTRIBUTE_IDS.refiningYieldMultiplier];
  const yieldClasses = reprocessingRigYieldClasses(type);
  if (rigSize <= 0 || refiningYieldMultiplierBase == null || yieldClasses.length === 0) {
    return null;
  }
  return {
    typeID: type.typeID,
    name: type.name,
    rigSize,
    refiningYieldMultiplierBase: toNumber(refiningYieldMultiplierBase, 0),
    securityMultipliers: {
      high: toNumber(attrs[REPROCESSING_ATTRIBUTE_IDS.hiSecModifier], 1),
      low: toNumber(attrs[REPROCESSING_ATTRIBUTE_IDS.lowSecModifier], 1),
      null: toNumber(attrs[REPROCESSING_ATTRIBUTE_IDS.nullSecModifier], 1),
    },
    yieldClasses,
    isGeneralMonitor: yieldClasses.length > 1,
  };
}

function buildSovereigntyStatic(authority, source) {
  const planetResourcesByID = new Map(
    authority.planetResources.map((row) => [toInt(row._key), row]),
  );
  const suns = authority.celestials
    .filter((entry) => entry.kind === "sun" && planetResourcesByID.has(entry.itemID))
    .sort((left, right) => left.solarSystemID - right.solarSystemID || left.itemID - right.itemID);
  const claimableSolarSystemIDs = suns.map((entry) => entry.solarSystemID);
  const claimableSolarSystemIDSet = new Set(claimableSolarSystemIDs);
  const planetDefinitions = authority.celestials
    .filter((entry) => entry.kind === "planet" && claimableSolarSystemIDSet.has(entry.solarSystemID))
    .sort((left, right) => left.itemID - right.itemID)
    .map((planet) => {
      const resource = planetResourcesByID.get(planet.itemID) || {};
      const reagent = resource.reagent || null;
      return {
        planetID: planet.itemID,
        solarSystemID: planet.solarSystemID,
        power: toInt(resource.power, 0),
        workforce: toInt(resource.workforce, 0),
        reagentDefinitions: reagent
          ? [{
              reagentTypeID: toInt(reagent.type_id, 0),
              amountPerCycle: toInt(reagent.amount_per_cycle, 0),
              cyclePeriodSeconds: toInt(reagent.cycle_period, 0),
              securedPercentage: 50,
              securedCapacity: toInt(reagent.amount_per_cycle, 0) * 24,
              unsecuredCapacity: toInt(reagent.amount_per_cycle, 0) * 24,
              securedStock: 0,
              unsecuredStock: 0,
            }]
          : [],
      };
    });
  const planetsBySolarSystemID = {};
  for (const planet of planetDefinitions) {
    const key = String(planet.solarSystemID);
    if (!planetsBySolarSystemID[key]) {
      planetsBySolarSystemID[key] = [];
    }
    planetsBySolarSystemID[key].push(planet.planetID);
  }
  const starConfigurations = suns.map((sun) => ({
    starID: sun.itemID,
    solarSystemID: sun.solarSystemID,
    power: toInt((planetResourcesByID.get(sun.itemID) || {}).power, 0),
  }));
  const upgradeDefinitions = authority.sovereigntyUpgrades
    .map((row) => {
      const installationTypeID = toInt(row._key);
      const fuel = row.fuel || {};
      const type = authority.typeByID.get(installationTypeID) || {};
      const attrs = dogmaAttributesForType(installationTypeID, authority.dogmaByTypeID);
      return {
        installationTypeID,
        powerRequired: toInt(row.power_allocation, 0),
        workforceRequired: toInt(row.workforce_allocation, 0),
        fuelTypeID: toInt(fuel.type_id, 0),
        fuelConsumptionPerHour: toInt(fuel.hourly_upkeep, 0),
        fuelStartupCost: toInt(fuel.startup_cost, 0),
        mutuallyExclusiveGroup: String(row.mutually_exclusive_group || ""),
        powerProduced: toInt(row.power_production, 0),
        workforceProduced: toInt(row.workforce_production, 0),
        requiredStrategicIndex: toInt(attrs[1615], 0),
        typeName: type.name || "",
        groupID: type.groupID || 0,
        published: type.published === true,
      };
    })
    .sort((left, right) => left.installationTypeID - right.installationTypeID);

  return {
    source,
    planetDefinitionsVersion: SOVEREIGNTY_PLANET_DEFINITIONS_VERSION,
    claimableSolarSystemIDs,
    planetDefinitions,
    planetsBySolarSystemID,
    starConfigurations,
    upgradeDefinitions,
  };
}

function solarSystemRecord(raw, constellationsByID, regionsByID, starsByID) {
  const constellation = constellationsByID.get(toInt(raw.constellationID)) || {};
  const region = regionsByID.get(toInt(raw.regionID)) || {};
  const star = starsByID.get(toInt(raw.starID)) || {};
  return {
    regionID: toInt(raw.regionID),
    constellationID: toInt(raw.constellationID),
    solarSystemID: toInt(raw._key),
    solarSystemName: localName(raw.name, `System ${raw._key}`),
    position: cloneVector(raw.position),
    security: toNumber(raw.securityStatus, 0),
    factionID: toInt(raw.factionID, toInt(constellation.factionID, toInt(region.factionID, 0))),
    radius: toNumber(raw.radius, 0),
    sunTypeID: toInt(star.typeID, 0),
    securityClass: raw.securityClass || "",
    ...(raw.visualEffect ? { visualEffect: raw.visualEffect } : {}),
  };
}

function itemName(typeByID, typeID, fallback) {
  return (typeByID.get(toInt(typeID)) || {}).name || fallback;
}

function buildCharacter(characterID, accountId, characterName, options = {}) {
  const now = fileTimeNow();
  const stationID = options.stationID || 60003760;
  const solarSystemID = options.solarSystemID || 30000142;
  const corporationID = options.corporationID || 1000044;
  const raceID = options.raceID || 2;
  const bloodlineID = options.bloodlineID || 8;
  const schoolID = options.schoolID || 33;
  const factionID = options.factionID || 500001;
  return {
    accountId,
    characterName,
    gender: 1,
    bloodlineID,
    ancestryID: options.ancestryID || bloodlineID,
    raceID,
    typeID: options.typeID || 1380,
    corporationID,
    allianceID: 0,
    factionID,
    stationID,
    solarSystemID,
    constellationID: options.constellationID || 20000020,
    regionID: options.regionID || 10000002,
    createDateTime: now,
    startDateTime: now,
    logoffDate: now,
    deletePrepareDateTime: null,
    lockTypeID: null,
    securityRating: 0,
    securityStatus: 0,
    title: "",
    description: "Local EvEJS bootstrap character",
    aurBalance: 0,
    skillPoints: 0,
    shipTypeID: 670,
    shipName: "Capsule",
    shipID: characterID + 1000000000000,
    bounty: 0,
    skillQueueEndTime: 0,
    daysLeft: 365,
    userType: 30,
    petitionMessage: "",
    worldSpaceID: 0,
    unreadMailCount: 0,
    upcomingEventCount: 0,
    unprocessedNotifications: 0,
    shortName: "none",
    allianceMemberStartDate: 0,
    skillTypeID: null,
    toLevel: null,
    trainingStartTime: null,
    trainingEndTime: null,
    queueEndTime: null,
    finishSP: null,
    trainedSP: null,
    finishedSkills: [],
    bookmarkFolders: [
      {
        ownerID: characterID,
        folderID: 1,
        folderName: "Personal Locations",
        creatorID: characterID,
      },
    ],
    bookmarks: [],
    savedFittings: {},
    empireID: factionID,
    schoolID,
    homeStationID: stationID,
    cloneStationID: stationID,
    plexBalance: 0,
    balance: 1000000000,
    walletJournal: [],
    characterAttributes: {
      charisma: 20,
      intelligence: 20,
      memory: 20,
      perception: 20,
      willpower: 20,
    },
    respecInfo: {
      freeRespecs: 3,
      lastRespecDate: null,
      nextTimedRespec: null,
    },
    freeSkillPoints: 0,
    skillHistory: [],
    boosters: [],
    implants: [],
    jumpClones: [],
    timeLastCloneJump: "0",
    employmentHistory: [
      {
        corporationID,
        startDate: now,
        deleted: 0,
      },
    ],
    standingData: {
      char: [],
      corp: [],
      npc: [],
    },
  };
}

function buildLocalAccountsAndCharacters() {
  return {
    accounts: {
      test: {
        passwordhash: "3c28f123ea4002af55e8962f16eeec798d7981d8",
        id: 1,
        role: "431255270151428096",
        chatRole: "431255270151428096",
        banned: false,
        multiCharacterTrainingSlots: {
          2: "157469184000000000",
          3: "157469184000000000",
        },
      },
      test2: {
        passwordhash: "34f22f6e036ae414200f97322f7f4ec24acdb54f",
        id: 2,
        role: "431255270151428096",
        chatRole: "431255270151428096",
        banned: false,
        multiCharacterTrainingSlots: {
          2: "157469184000000000",
          3: "157469184000000000",
        },
      },
    },
    characters: {
      140000001: buildCharacter(140000001, 1, "Test Pilot"),
      140000002: buildCharacter(140000002, 2, "Test Two"),
      140000004: buildCharacter(140000004, 2, "GM Elysian", {
        raceID: 1,
        bloodlineID: 1,
        ancestryID: 1,
        corporationID: 1000006,
        schoolID: 35,
        factionID: 500004,
      }),
    },
    identityState: {
      version: 1,
      nextAccountID: 3,
      nextCharacterID: 140000005,
      nextItemID: 9988400000000,
    },
  };
}

function buildLocalItems(typeByID) {
  const gmId = 140000004;
  const stationID = 60003760;
  const items = {};
  const entries = [
    { itemID: 9988400000001, ownerID: 140000001, typeID: 670, quantity: -1, singleton: 1, name: "Capsule" },
    { itemID: 9988400000002, ownerID: 140000002, typeID: 670, quantity: -1, singleton: 1, name: "Capsule" },
    { itemID: 9988400000003, ownerID: gmId, typeID: 670, quantity: -1, singleton: 1, name: "Capsule" },
    { itemID: 9988400000100, ownerID: gmId, typeID: 52568, quantity: 256, singleton: 0, name: "HyperCore" },
    { itemID: 9988400000101, ownerID: gmId, typeID: 9854, quantity: -1, singleton: 1, name: "Polaris Inspector Frigate" },
    { itemID: 9988400000102, ownerID: gmId, typeID: 40519, quantity: 12, singleton: 0, name: "Skill Extractor" },
  ];
  for (const entry of entries) {
    const type = typeByID.get(entry.typeID) || {};
    items[String(entry.itemID)] = {
      itemID: entry.itemID,
      typeID: entry.typeID,
      ownerID: entry.ownerID,
      locationID: stationID,
      flagID: 4,
      quantity: entry.quantity,
      stacksize: entry.quantity > 0 ? entry.quantity : 1,
      singleton: entry.singleton,
      groupID: type.groupID || 0,
      categoryID: type.categoryID || 0,
      customInfo: "",
      itemName: type.name || entry.name,
      mass: type.mass || 0,
      volume: type.volume || 0,
      capacity: type.capacity || 0,
      radius: type.radius || 0,
      spaceState: null,
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    };
  }
  return items;
}

function buildCorporations() {
  const base = {
    _meta: {
      nextCustomCorporationID: 98000001,
      npcSeedVersion: 1,
    },
    records: {},
  };
  for (const corp of [
    { id: 1000044, name: "Science and Trade Institute", ticker: "STI", factionID: 500001, raceID: 1 },
    { id: 1000006, name: "Deep Core Mining Inc.", ticker: "DCMI", factionID: 500001, raceID: 1 },
  ]) {
    base.records[String(corp.id)] = {
      corporationID: corp.id,
      corporationName: corp.name,
      tickerName: corp.ticker,
      description: "Local bootstrap NPC corporation record.",
      ceoID: 0,
      creatorID: 0,
      allianceID: null,
      stationID: 60003760,
      solarSystemID: 30000142,
      factionID: corp.factionID,
      raceID: corp.raceID,
      deleted: 0,
      shares: 1,
      taxRate: 0,
      loyaltyPointTaxRate: 0,
      friendlyFire: 0,
      memberLimit: -1,
      url: "",
      hasPlayerPersonnelManager: false,
      isNPC: true,
      createdAt: fileTimeNow(),
    };
  }
  return base;
}

function buildCharacterCreationSchools() {
  const schools = {};
  const definitions = [
    [31, 4, 1000166, 60012505, 30003489],
    [32, 4, 1000167, 60012505, 30003489],
    [33, 2, 1000044, 60003760, 30000142],
    [34, 2, 1000045, 60003760, 30000142],
    [35, 1, 1000006, 60008494, 30003410],
    [36, 1, 1000007, 60008494, 30003410],
    [37, 8, 1000094, 60015068, 30002547],
    [38, 8, 1000095, 60015068, 30002547],
  ];
  for (const [schoolID, raceID, corporationID, stationID, solarSystemID] of definitions) {
    schools[String(schoolID)] = {
      schoolID,
      raceID,
      corporationID,
      stationID,
      homeStationID: stationID,
      solarSystemID,
      starterSystemID: solarSystemID,
      careerAgents: [],
    };
  }
  return {
    source: {
      provider: "EvEJS local bootstrap",
      note: "Minimal school map for local character creation; career agents are filtered by local agent authority when provided.",
    },
    count: Object.keys(schools).length,
    schools,
  };
}

function writeTable(outDir, tableName, data) {
  const tableDir = path.join(outDir, tableName);
  fs.mkdirSync(tableDir, { recursive: true });
  fs.writeFileSync(path.join(tableDir, "data.json"), JSON.stringify(data, null, 2), "utf8");
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

async function loadSdeAuthority(sdeDir) {
  const categories = new Map();
  const groups = new Map();
  const types = [];
  const typeByID = new Map();
  const dogmaByTypeID = new Map();
  const dogmaAttributes = {};
  const dogmaEffects = {};
  const constellationsByID = new Map();
  const regionsByID = new Map();
  const starsByID = new Map();
  const rawStars = [];
  const solarSystems = [];
  const solarSystemByID = new Map();
  const stargates = [];
  const rawStargates = [];
  const celestials = [];
  const planetNamesByID = new Map();
  const stations = [];
  const corporationsByID = new Map();
  const stationOperationsByID = new Map();
  const npcCharacters = [];
  const agentTypes = [];
  const blueprints = [];
  const races = [];
  const bloodlines = [];
  const factions = [];
  const typeMaterials = [];
  const dbuffCollections = [];
  const icons = [];
  const clientTypeLists = [];
  const planetResources = [];
  const planetSchematics = [];
  const sovereigntyUpgrades = [];
  const skins = [];
  const skinMaterials = [];
  const skinLicenses = [];
  const sdeMeta = {};

  await readJsonlRecords(sdeDir, "_sde.jsonl", (row) => {
    if (row._key === "sde") {
      sdeMeta.buildNumber = row.buildNumber;
      sdeMeta.releaseDate = row.releaseDate;
    }
  });
  await readJsonlRecords(sdeDir, "categories.jsonl", (row) => categories.set(toInt(row._key), row));
  await readJsonlRecords(sdeDir, "groups.jsonl", (row) => groups.set(toInt(row._key), row));
  await readJsonlRecords(sdeDir, "types.jsonl", (row) => {
    const type = typeRecord(row, groups, categories);
    types.push(type);
    typeByID.set(type.typeID, type);
  });
  await readJsonlRecords(sdeDir, "dogmaAttributes.jsonl", (row) => {
    dogmaAttributes[String(row._key)] = row;
  });
  await readJsonlRecords(sdeDir, "dogmaEffects.jsonl", (row) => {
    dogmaEffects[String(row._key)] = row;
  });
  await readJsonlRecords(sdeDir, "typeDogma.jsonl", (row) => {
    dogmaByTypeID.set(String(row._key), row);
  });
  await readJsonlRecords(sdeDir, "mapConstellations.jsonl", (row) => {
    constellationsByID.set(toInt(row._key), row);
  });
  await readJsonlRecords(sdeDir, "mapRegions.jsonl", (row) => {
    regionsByID.set(toInt(row._key), row);
  });
  await readJsonlRecords(sdeDir, "mapStars.jsonl", (row) => {
    rawStars.push(row);
    starsByID.set(toInt(row._key), row);
  });
  await readJsonlRecords(sdeDir, "mapSolarSystems.jsonl", (row) => {
    const system = solarSystemRecord(row, constellationsByID, regionsByID, starsByID);
    solarSystems.push(system);
    solarSystemByID.set(system.solarSystemID, system);
  });
  await readJsonlRecords(sdeDir, "mapStargates.jsonl", (row) => rawStargates.push(row));
  const stargatesByID = new Map(rawStargates.map((row) => [toInt(row._key), row]));
  function stargateName(stargate) {
    const destination = solarSystemByID.get(toInt(stargate.destination && stargate.destination.solarSystemID));
    return `Stargate (${destination && destination.solarSystemName || ""})`;
  }
  for (const row of rawStargates) {
    const destinationStargate = stargatesByID.get(toInt(row.destination && row.destination.stargateID));
    stargates.push({
      itemID: toInt(row._key),
      typeID: toInt(row.typeID),
      solarSystemID: toInt(row.solarSystemID),
      itemName: stargateName(row),
      position: roundVector(row.position, 3),
      radius: 15000,
      destinationID: toInt(row.destination && row.destination.stargateID),
      destinationSolarSystemID: toInt(row.destination && row.destination.solarSystemID),
      destinationName: destinationStargate ? stargateName(destinationStargate) : null,
    });
  }
  for (const row of rawStars) {
    const system = solarSystemByID.get(toInt(row.solarSystemID)) || {};
    const type = typeByID.get(toInt(row.typeID)) || {};
    celestials.push({
      itemID: toInt(row._key),
      typeID: toInt(row.typeID),
      groupID: type.groupID || 6,
      categoryID: type.categoryID || 2,
      groupName: type.groupName || "Sun",
      solarSystemID: toInt(row.solarSystemID),
      constellationID: system.constellationID || 0,
      regionID: system.regionID || 0,
      orbitID: null,
      position: { x: 0, y: 0, z: 0 },
      radius: toNumber(row.radius, type.radius || 0),
      itemName: `${system.solarSystemName || "System"} - Star`,
      security: system.security || 0,
      celestialIndex: null,
      orbitIndex: null,
      kind: "sun",
    });
  }
  await readJsonlRecords(sdeDir, "mapPlanets.jsonl", (row) => {
    const system = solarSystemByID.get(toInt(row.solarSystemID)) || {};
    const type = typeByID.get(toInt(row.typeID)) || {};
    const itemID = toInt(row._key);
    const planetName = `${system.solarSystemName || "System"} ${romanNumeral(row.celestialIndex) || itemID}`;
    planetNamesByID.set(itemID, planetName);
    celestials.push({
      itemID,
      typeID: toInt(row.typeID),
      groupID: type.groupID || 7,
      categoryID: type.categoryID || 2,
      groupName: type.groupName || "Planet",
      solarSystemID: toInt(row.solarSystemID),
      constellationID: system.constellationID || 0,
      regionID: system.regionID || 0,
      orbitID: toInt(row.orbitID, 0) || null,
      position: cloneVector(row.position),
      radius: toNumber(row.radius, type.radius || 0),
      itemName: planetName,
      security: system.security || 0,
      celestialIndex: optionalInt(row.celestialIndex),
      orbitIndex: optionalInt(row.orbitIndex),
      kind: "planet",
    });
  });
  await readJsonlRecords(sdeDir, "mapMoons.jsonl", (row) => {
    const system = solarSystemByID.get(toInt(row.solarSystemID)) || {};
    const type = typeByID.get(toInt(row.typeID)) || {};
    const parentName = planetNamesByID.get(toInt(row.orbitID)) ||
      `${system.solarSystemName || "System"} ${toInt(row.orbitID, 0) || ""}`.trim();
    const orbitIndex = optionalInt(row.orbitIndex);
    celestials.push({
      itemID: toInt(row._key),
      typeID: toInt(row.typeID),
      groupID: type.groupID || 8,
      categoryID: type.categoryID || 2,
      groupName: type.groupName || "Moon",
      solarSystemID: toInt(row.solarSystemID),
      constellationID: system.constellationID || 0,
      regionID: system.regionID || 0,
      orbitID: toInt(row.orbitID, 0) || null,
      position: cloneVector(row.position),
      radius: toNumber(row.radius, type.radius || 0),
      itemName: `${parentName} - Moon ${orbitIndex || row._key}`,
      security: system.security || 0,
      celestialIndex: optionalInt(row.celestialIndex),
      orbitIndex,
      kind: "moon",
    });
  });
  await readJsonlRecords(sdeDir, "mapAsteroidBelts.jsonl", (row) => {
    const system = solarSystemByID.get(toInt(row.solarSystemID)) || {};
    const type = typeByID.get(toInt(row.typeID)) || {};
    const parentName = planetNamesByID.get(toInt(row.orbitID)) ||
      `${system.solarSystemName || "System"} ${toInt(row.orbitID, 0) || ""}`.trim();
    const orbitIndex = optionalInt(row.orbitIndex);
    const belt = {
      itemID: toInt(row._key),
      typeID: toInt(row.typeID),
      groupID: type.groupID || 9,
      categoryID: type.categoryID || 2,
      groupName: type.groupName || "Asteroid Belt",
      solarSystemID: toInt(row.solarSystemID),
      constellationID: system.constellationID || 0,
      regionID: system.regionID || 0,
      orbitID: toInt(row.orbitID, 0) || null,
      position: cloneVector(row.position),
      radius: row.radius == null ? 15000 : toNumber(row.radius, 15000),
      itemName: `${parentName} - Asteroid Belt ${orbitIndex || row._key}`,
      security: system.security || 0,
      securityClass: system.securityClass || "",
      celestialIndex: optionalInt(row.celestialIndex),
      orbitIndex,
      kind: "asteroidBelt",
      fieldSeed: toInt(row._key),
    };
    celestials.push(addAsteroidFieldProfile(belt));
  });
  await readJsonlRecords(sdeDir, "npcCorporations.jsonl", (row) => {
    corporationsByID.set(toInt(row._key), row);
  });
  await readJsonlRecords(sdeDir, "npcCharacters.jsonl", (row) => npcCharacters.push(row));
  await readJsonlRecords(sdeDir, "agentTypes.jsonl", (row) => agentTypes.push(row));
  await readJsonlRecords(sdeDir, "stationOperations.jsonl", (row) => {
    stationOperationsByID.set(toInt(row._key), row);
  });
  const celestialsByID = new Map(celestials.map((entry) => [entry.itemID, entry]));
  await readJsonlRecords(sdeDir, "npcStations.jsonl", (row) => {
    const system = solarSystemByID.get(toInt(row.solarSystemID)) || {};
    const constellation = constellationsByID.get(toInt(system.constellationID)) || {};
    const region = regionsByID.get(toInt(system.regionID)) || {};
    const type = typeByID.get(toInt(row.typeID)) || {};
    const corporation = corporationsByID.get(toInt(row.ownerID)) || {};
    const operation = stationOperationsByID.get(toInt(row.operationID)) || {};
    const orbit = celestialsByID.get(toInt(row.orbitID)) || {};
    const useOperationName = row.useOperationName === true;
    const orbitName = orbit.itemName || system.solarSystemName || "System";
    const corporationName = localName(corporation.name, `Corporation ${row.ownerID}`);
    const operationName = localName(operation.operationName, `Operation ${row.operationID}`);
    const stationName = useOperationName
      ? `${orbitName} - ${corporationName} ${operationName}`
      : `${orbitName} - ${corporationName}`;
    const radius = type.radius || 0;
    stations.push({
      stationID: toInt(row._key),
      security: system.security || 0,
      dockingCostPerVolume: 0,
      maxShipVolumeDockable: 50000000,
      officeRentalCost: 10000,
      operationID: toInt(row.operationID, 0),
      stationTypeID: toInt(row.typeID),
      corporationID: toInt(row.ownerID, 0),
      solarSystemID: toInt(row.solarSystemID),
      solarSystemName: system.solarSystemName || "",
      constellationID: system.constellationID || 0,
      constellationName: localName(constellation.name),
      regionID: system.regionID || 0,
      regionName: localName(region.name),
      stationName,
      position: cloneVector(row.position),
      reprocessingEfficiency: toNumber(row.reprocessingEfficiency, 0),
      reprocessingStationsTake: toNumber(row.reprocessingStationsTake, 0),
      reprocessingHangarFlag: toInt(row.reprocessingHangarFlag, 4),
      itemName: stationName,
      itemID: toInt(row._key),
      groupID: type.groupID || 0,
      categoryID: type.categoryID || 0,
      orbitID: toInt(row.orbitID, 0) || null,
      orbitName: orbit.itemName || null,
      orbitGroupID: orbit.groupID || null,
      orbitTypeID: orbit.typeID || null,
      orbitKind: orbit.kind === "sun" ? "star" : orbit.kind || null,
      stationTypeName: type.name || "",
      stationRaceID: type.raceID,
      stationGraphicID: type.graphicID,
      radius,
      interactionRadius: radius,
      useOperationName,
      dockEntry: null,
      dockPosition: null,
      dockOrientation: null,
      undockDirection: null,
      undockPosition: null,
    });
  });
  await readJsonlRecords(sdeDir, "blueprints.jsonl", (row) => blueprints.push(row));
  await readJsonlRecords(sdeDir, "races.jsonl", (row) => races.push(row));
  await readJsonlRecords(sdeDir, "bloodlines.jsonl", (row) => bloodlines.push(row));
  await readJsonlRecords(sdeDir, "factions.jsonl", (row) => factions.push(row));
  await readJsonlRecords(sdeDir, "typeMaterials.jsonl", (row) => typeMaterials.push(row));
  await readJsonlRecords(sdeDir, "dbuffCollections.jsonl", (row) => dbuffCollections.push(row));
  await readJsonlRecords(sdeDir, "icons.jsonl", (row) => icons.push(row));
  await readJsonlRecords(sdeDir, "typeLists.jsonl", (row) => clientTypeLists.push(row));
  await readJsonlRecords(sdeDir, "planetResources.jsonl", (row) => planetResources.push(row));
  await readJsonlRecords(sdeDir, "planetSchematics.jsonl", (row) => planetSchematics.push(row));
  await readJsonlRecords(sdeDir, "sovereigntyUpgrades.jsonl", (row) => sovereigntyUpgrades.push(row));
  await readJsonlRecords(sdeDir, "skins.jsonl", (row) => skins.push(row));
  await readJsonlRecords(sdeDir, "skinMaterials.jsonl", (row) => skinMaterials.push(row));
  await readJsonlRecords(sdeDir, "skinLicenses.jsonl", (row) => skinLicenses.push(row));

  stargates.sort((left, right) => left.itemID - right.itemID);
  celestials.sort((left, right) => left.itemID - right.itemID);

  return {
    sdeMeta,
    categories,
    groups,
    types,
    typeByID,
    dogmaByTypeID,
    dogmaAttributes,
    dogmaEffects,
    solarSystems,
    stargates,
    celestials,
    stations,
    corporationsByID,
    npcCharacters,
    agentTypes,
    blueprints,
    races,
    bloodlines,
    factions,
    typeMaterials,
    dbuffCollections,
    stationOperationsByID,
    icons,
    clientTypeLists,
    planetResources,
    planetSchematics,
    sovereigntyUpgrades,
    skins,
    skinMaterials,
    skinLicenses,
  };
}

function buildTables(authority, options) {
  const source = buildSource(options, authority.sdeMeta);
  const itemTypes = authority.types
    .filter((type) => type.typeID !== 0)
    .map((type) => publicTypeRecord(type, "full"));
  const shipTypes = authority.types
    .filter((type) => type.categoryID === 6)
    .map((type) => publicTypeRecord(type, "full"))
    .sort(compareTypeNameThenID);
  const skillTypes = authority.types
    .filter((type) => type.categoryID === 16)
    .map((type) => publicTypeRecord(type, "skill"))
    .sort(compareTypeNameThenID);
  const characterCreationRaces = authority.races
    .filter((row) => row.shipTypeID != null)
    .map((row) => characterCreationRaceRecord(row, authority.typeByID))
    .sort((left, right) => left.raceID - right.raceID);
  const playableRaceIDs = new Set(characterCreationRaces.map((race) => race.raceID));
  const characterCreationBloodlines = authority.bloodlines
    .filter((row) => playableRaceIDs.has(toInt(row.raceID)))
    .map(characterCreationBloodlineRecord)
    .sort((left, right) => left.bloodlineID - right.bloodlineID);
  const clientTypeLists = authority.clientTypeLists
    .map(clientTypeListRecord)
    .sort((left, right) => left.listID - right.listID);
  const factionRecords = {};
  for (const row of authority.factions) {
    const record = factionRecord(row);
    factionRecords[String(record.factionID)] = record;
  }
  const dbuffCollectionsByID = {};
  for (const row of authority.dbuffCollections) {
    const record = dbuffCollectionRecord(row);
    dbuffCollectionsByID[String(record.collectionID)] = record;
  }
  const dogmaAttributeTypesByID = {};
  for (const row of Object.values(authority.dogmaAttributes).sort((left, right) => toInt(left._key) - toInt(right._key))) {
    const record = dogmaAttributeRecord(row);
    dogmaAttributeTypesByID[String(record.attributeID)] = record;
  }
  const shipAttributesByTypeID = {};
  for (const type of [...shipTypes].sort((left, right) => left.typeID - right.typeID)) {
    const attributes = dogmaAttributesForType(type.typeID, authority.dogmaByTypeID);
    shipAttributesByTypeID[String(type.typeID)] = {
      typeID: type.typeID,
      typeName: type.name,
      attributeCount: Object.keys(attributes).length,
      attributes,
    };
  }
  const totalShipAttributeCount = Object.values(shipAttributesByTypeID)
    .reduce((sum, row) => sum + row.attributeCount, 0);
  const stationTypeIDs = new Set(authority.stations.map((station) => station.stationTypeID));
  const stargateTypeIDs = new Set(authority.stargates.map((gate) => gate.typeID));
  const movementStaticTypeIDs = new Set([
    ...authority.celestials.map((entry) => entry.typeID),
    ...authority.stargates.map((gate) => gate.typeID),
    ...stationTypeIDs,
  ]);
  const movementAttributes = authority.types
    .filter((type) => (
      type.categoryID === 6 ||
      movementStaticTypeIDs.has(type.typeID)
    ))
    .map((type) => movementRecord(type, authority.dogmaByTypeID))
    .sort((left, right) => left.typeID - right.typeID);
  const planetSchematics = authority.planetSchematics
    .map(planetSchematicRecord)
    .sort((left, right) => left.schematicID - right.schematicID);
  const belts = authority.celestials.filter((entry) => entry.kind === "asteroidBelt");
  const dogmaTypesByTypeID = {};
  for (const [typeID, row] of authority.dogmaByTypeID.entries()) {
    dogmaTypesByTypeID[typeID] = row;
  }
  const blueprintDefinitionsByTypeID = {};
  const blueprintDefinitions = authority.blueprints.map((row) => {
    const type = authority.typeByID.get(toInt(row._key)) || {};
    const manufacturing = row.activities && row.activities.manufacturing;
    const product = manufacturing && Array.isArray(manufacturing.products)
      ? manufacturing.products[0]
      : null;
    const productType = product ? authority.typeByID.get(toInt(product.typeID)) || {} : {};
    const record = {
      blueprintTypeID: toInt(row._key),
      blueprintName: type.name || `Blueprint ${row._key}`,
      blueprintGroupID: type.groupID || 0,
      blueprintGroupName: type.groupName || "",
      blueprintCategoryID: type.categoryID || 0,
      blueprintCategoryName: type.categoryName || "",
      productTypeID: product ? toInt(product.typeID) : 0,
      productName: productType.name || "",
      productGroupID: productType.groupID || 0,
      productGroupName: productType.groupName || "",
      productCategoryID: productType.categoryID || 0,
      productCategoryName: productType.categoryName || "",
      maxProductionLimit: toInt(row.maxProductionLimit, 0),
      published: type.published === true,
      activities: row.activities || {},
    };
    blueprintDefinitionsByTypeID[String(record.blueprintTypeID)] = record;
    return record;
  });

  const reprocessingTypes = authority.typeMaterials
    .filter((row) => Array.isArray(row.materials) && row.materials.length > 0)
    .map((row) => reprocessingTypeRecord(row, authority.typeByID, authority.dogmaByTypeID))
    .sort((left, right) => left.typeID - right.typeID);
  const structureReprocessingProfiles = authority.types
    .map((type) => structureReprocessingProfile(type, authority.dogmaByTypeID))
    .filter(Boolean)
    .sort((left, right) => left.typeID - right.typeID);
  const reprocessingRigProfiles = authority.types
    .map((type) => reprocessingRigProfile(type, authority.dogmaByTypeID))
    .filter(Boolean)
    .sort((left, right) => left.typeID - right.typeID);
  const {
    compressedTypeBySourceTypeID,
    sourceTypesByCompressedTypeID,
  } = buildCompressedTypeMaps(authority.types);

  return {
    asteroidBelts: { source, count: belts.length, belts },
    asteroidFieldStyles: {
      source: {
        provider: "EvEJS local asteroid field styles",
        note: "Server-authored deterministic asteroid field envelopes used to augment public SDE belt rows.",
      },
      count: ASTEROID_FIELD_STYLES.length,
      fieldStyles: ASTEROID_FIELD_STYLES,
    },
    celestials: { source, count: authority.celestials.length, celestials: authority.celestials },
    characterCreationBloodlines: {
      source,
      count: characterCreationBloodlines.length,
      bloodlines: characterCreationBloodlines,
    },
    characterCreationRaces: {
      source,
      count: characterCreationRaces.length,
      races: characterCreationRaces,
    },
    characterCreationSchools: buildCharacterCreationSchools(),
    clientTypeLists: {
      source,
      count: clientTypeLists.length,
      typeLists: clientTypeLists,
      counts: clientTypeListCounts(clientTypeLists),
    },
    dbuffCollections: {
      source,
      counts: { collectionCount: Object.keys(dbuffCollectionsByID).length },
      collectionsByID: dbuffCollectionsByID,
    },
    factions: {
      source,
      records: factionRecords,
    },
    agentAuthority: buildAgentAuthority(authority, source),
    industryBlueprints: {
      source,
      blueprintDefinitions,
      blueprintDefinitionsByTypeID,
      blueprintTypeIDsByProductTypeID: Object.fromEntries(
        blueprintDefinitions
          .filter((row) => row.productTypeID > 0)
          .map((row) => [String(row.productTypeID), row.blueprintTypeID]),
      ),
      manufacturingBlueprintTypeIDs: blueprintDefinitions
        .filter((row) => row.activities && row.activities.manufacturing)
        .map((row) => row.blueprintTypeID),
    },
    industryFacilities: buildIndustryFacilities(authority, source),
    itemIcons: buildItemIcons(authority, options, source),
    itemTypes: { source, count: itemTypes.length, types: itemTypes },
    mapTagsAuthority: buildMapTagsAuthority(options),
    movementAttributes: {
      source,
      count: movementAttributes.length,
      attributes: movementAttributes,
    },
    npcCargo: {
      nextCargoID: 980200000000,
      cargo: {},
    },
    npcWreckItems: {
      nextWreckItemID: 980400000000,
      items: {},
    },
    npcWrecks: {
      nextWreckID: 980300000000,
      wrecks: {},
    },
    planetSchematics: {
      source,
      count: planetSchematics.length,
      schematics: planetSchematics,
    },
    reprocessingStatic: {
      source,
      reprocessingTypes,
      structureReprocessingProfiles,
      reprocessingRigProfiles,
      compressedTypeBySourceTypeID,
      sourceTypesByCompressedTypeID,
    },
    shipDogmaAttributes: {
      source,
      counts: {
        shipTypes: Object.keys(shipAttributesByTypeID).length,
        attributeTypes: Object.keys(dogmaAttributeTypesByID).length,
        totalAttributes: totalShipAttributeCount,
      },
      attributeTypesByID: dogmaAttributeTypesByID,
      shipAttributesByTypeID,
    },
    shipCosmeticsCatalog: buildShipCosmeticsCatalog(authority, options),
    shipTypes: { source, count: shipTypes.length, ships: shipTypes },
    skillTypes: { source, count: skillTypes.length, skills: skillTypes },
    solarSystems: { source, count: authority.solarSystems.length, solarSystems: authority.solarSystems },
    sovereigntyStatic: buildSovereigntyStatic(authority, source),
    stargates: { source, count: authority.stargates.length, stargates: authority.stargates },
    stargateTypes: {
      source,
      count: stargateTypeIDs.size,
      stargateTypes: [...stargateTypeIDs]
        .sort((a, b) => a - b)
        .map((typeID) => authority.typeByID.get(typeID))
        .filter(Boolean)
        .map(stargateTypeRecord),
    },
    stations: { source, count: authority.stations.length, stations: authority.stations },
    stationTypes: {
      source,
      count: stationTypeIDs.size,
      stationTypes: [...stationTypeIDs]
        .sort((a, b) => a - b)
        .map((typeID) => authority.typeByID.get(typeID))
        .filter(Boolean)
        .map((type) => stationTypeRecord(type)),
    },
    starterShipFittings: buildStarterShipFittings(authority),
    structureTypes: buildStructureTypes(authority),
    typeDogma: {
      source,
      attributeTypesByID: authority.dogmaAttributes,
      effectTypesByID: authority.dogmaEffects,
      typesByTypeID: dogmaTypesByTypeID,
      counts: {
        attributeCount: Object.keys(authority.dogmaAttributes).length,
        effectCount: Object.keys(authority.dogmaEffects).length,
        typeCount: Object.keys(dogmaTypesByTypeID).length,
      },
    },
  };
}

function defaultPlaceholderForTable(tableName) {
  if (tableName === "authoredSpaceProps") {
    return null;
  }
  if (tableName === "asteroidFieldStyles") {
    return {
      source: { provider: "EvEJS local bootstrap" },
      count: ASTEROID_FIELD_STYLES.length,
      fieldStyles: ASTEROID_FIELD_STYLES,
    };
  }
  if (tableName === "asteroidTypesBySolarSystemID") {
    return {
      source: { provider: "EvEJS local bootstrap", note: "Generated without client private asteroid map." },
      counts: { systemCount: 0, distinctTypeCount: 0, totalAssignmentCount: 0 },
      systems: {},
    };
  }
  if (tableName === "corporations") {
    return buildCorporations();
  }
  if (tableName === "rafflesRuntime") {
    return { nextRaffleId: 980000001, nextRunningId: 980000001, reservations: {} };
  }
  if (tableName === "capitalNpcAuthority") {
    return { source: { provider: "EvEJS local bootstrap" }, entries: [], manifestsByProfileID: {} };
  }
  if (tableName === "npcHostileUtilities") {
    return { templates: [] };
  }
  if (tableName === "trigDrifterSpawnAuthority") {
    return { version: 1, systemLists: {} };
  }
  if (tableName === "skillTrainingAlphaCaps") {
    return { source: "EvEJS local bootstrap", capsByTypeID: {} };
  }
  if (tableName === "mapTagsAuthority") {
    return { source: { provider: "EvEJS local bootstrap" }, assets: {} };
  }
  return {};
}

async function createDatabase(options) {
  assertDirectory(options.sdeDir, "SDE JSONL directory");
  ensureCleanOutDir(options.outDir, options.force);

  const authority = await loadSdeAuthority(options.sdeDir);
  const tables = buildTables(authority, options);
  const local = buildLocalAccountsAndCharacters();
  tables.accounts = local.accounts;
  tables.characters = local.characters;
  tables.identityState = local.identityState;
  tables.items = buildLocalItems(authority.typeByID);
  tables.skills = {
    140000001: {},
    140000002: {},
    140000004: {},
  };

  const generatedTables = [];
  const placeholderTables = [];
  for (const tableName of REQUIRED_TABLES) {
    if (Object.prototype.hasOwnProperty.call(tables, tableName)) {
      writeTable(options.outDir, tableName, tables[tableName]);
      generatedTables.push(tableName);
      continue;
    }
    const placeholder = defaultPlaceholderForTable(tableName);
    const tableDir = path.join(options.outDir, tableName);
    fs.mkdirSync(tableDir, { recursive: true });
    if (tableName === "authoredSpaceProps") {
      fs.writeFileSync(
        path.join(tableDir, "Manifest.json"),
        JSON.stringify({ source: "EvEJS local bootstrap", props: [] }, null, 2),
        "utf8",
      );
    } else {
      writeTable(options.outDir, tableName, placeholder);
    }
    placeholderTables.push(tableName);
  }

  const manifestPath = path.resolve(options.outDir, "../manifest.json");
  const sdeMetaPath = path.join(options.sdeDir, "_sde.jsonl");
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    build: options.build,
    sdeUrl: options.sdeUrl,
    sdeMeta: authority.sdeMeta,
    sdeSha256: sha256File(sdeMetaPath),
    outputDataDir: options.outDir,
    generatedTables,
    placeholderTables,
    requiredTables: REQUIRED_TABLES,
    accounts: ["test", "test2"],
    characters: {
      test: [140000001],
      test2: [140000002, 140000004],
      hyperNetSeedOwnerId: 140000004,
    },
    hyperNet: {
      hyperNetSeedEnabled: true,
      hyperNetSeedOwnerId: 140000004,
      hyperNetSeedRestockEnabled: true,
      hyperCoreTypeID: 52568,
    },
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.sdeDir || !options.outDir) {
    throw new Error(usage());
  }
  const manifest = await createDatabase(options);
  console.log(`Generated ${manifest.generatedTables.length} data table(s).`);
  console.log(`Created ${manifest.placeholderTables.length} placeholder table(s).`);
  console.log(`Manifest: ${path.resolve(options.outDir, "../manifest.json")}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[DatabaseCreator] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_BUILD,
  DEFAULT_SDE_URL,
  REQUIRED_TABLES,
  GENERATED_TABLES,
  parseArgs,
  createDatabase,
  loadSdeAuthority,
  buildTables,
  buildLocalAccountsAndCharacters,
};
