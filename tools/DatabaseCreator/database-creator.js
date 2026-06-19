#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const crypto = require("crypto");

const DEFAULT_BUILD = 3396210;
const DEFAULT_SDE_URL =
  "https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-3396210-jsonl.zip";

const GENERATED_TABLES = new Set([
  "asteroidBelts",
  "celestials",
  "characterCreationBloodlines",
  "characterCreationRaces",
  "characterCreationSchools",
  "clientTypeLists",
  "dbuffCollections",
  "factions",
  "industryBlueprints",
  "itemTypes",
  "movementAttributes",
  "reprocessingStatic",
  "shipDogmaAttributes",
  "shipTypes",
  "skillTypes",
  "solarSystems",
  "sovereigntyStatic",
  "stargates",
  "stargateTypes",
  "stations",
  "stationTypes",
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

function fileTimeNow() {
  const unixMs = Date.now();
  const epochOffsetMs = 11644473600000;
  return String(BigInt(unixMs + epochOffsetMs) * 10000n);
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
  return {
    typeID: toInt(raw._key),
    groupID: toInt(raw.groupID),
    categoryID: toInt(group && group.categoryID),
    groupName: localName(group && group.name),
    categoryName: localName(category && category.name),
    name: localName(raw.name, `Type ${raw._key}`),
    description: localName(raw.description, ""),
    mass: toNumber(raw.mass, 0),
    volume: toNumber(raw.volume, 0),
    capacity: toNumber(raw.capacity, 0),
    portionSize: toInt(raw.portionSize, 1),
    raceID: toInt(raw.raceID, 0),
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

function dogmaAttributesForType(typeID, dogmaByTypeID) {
  const entry = dogmaByTypeID.get(String(typeID)) || {};
  const attributes = {};
  for (const attribute of Array.isArray(entry.dogmaAttributes) ? entry.dogmaAttributes : []) {
    attributes[String(attribute.attributeID)] = attribute.value;
  }
  return attributes;
}

function movementRecord(type, dogmaByTypeID) {
  const attrs = dogmaAttributesForType(type.typeID, dogmaByTypeID);
  return {
    typeID: type.typeID,
    typeName: type.name,
    mass: toNumber(attrs[ATTRIBUTE_IDS.mass], type.mass),
    maxVelocity: toNumber(attrs[ATTRIBUTE_IDS.maxVelocity], 0),
    inertia: toNumber(attrs[ATTRIBUTE_IDS.inertia], 0),
    radius: toNumber(attrs[ATTRIBUTE_IDS.radius], type.radius),
    signatureRadius: toNumber(attrs[ATTRIBUTE_IDS.signatureRadius], 0),
    warpSpeedMultiplier: toNumber(attrs[ATTRIBUTE_IDS.warpSpeedMultiplier], 0),
    alignTime: null,
    maxAccelerationTime: null,
  };
}

function solarSystemRecord(raw) {
  return {
    regionID: toInt(raw.regionID),
    constellationID: toInt(raw.constellationID),
    solarSystemID: toInt(raw._key),
    solarSystemName: localName(raw.name, `System ${raw._key}`),
    position: cloneVector(raw.position),
    security: toNumber(raw.securityStatus, 0),
    factionID: toInt(raw.factionID, 0) || null,
    radius: toNumber(raw.radius, 0),
    sunTypeID: toInt(raw.sunTypeID, 0) || null,
    securityClass: raw.securityClass || null,
    starID: toInt(raw.starID, 0) || null,
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
  const solarSystems = [];
  const solarSystemByID = new Map();
  const stargates = [];
  const celestials = [];
  const stations = [];
  const blueprints = [];
  const races = [];
  const bloodlines = [];
  const factions = [];
  const typeMaterials = [];
  const dbuffCollections = [];
  const clientTypeLists = [];
  const planetResources = [];
  const sovereigntyUpgrades = [];
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
  await readJsonlRecords(sdeDir, "mapSolarSystems.jsonl", (row) => {
    const system = solarSystemRecord(row);
    solarSystems.push(system);
    solarSystemByID.set(system.solarSystemID, system);
  });
  await readJsonlRecords(sdeDir, "mapStargates.jsonl", (row) => {
    const system = solarSystemByID.get(toInt(row.solarSystemID)) || {};
    const type = typeByID.get(toInt(row.typeID)) || {};
    stargates.push({
      itemID: toInt(row._key),
      typeID: toInt(row.typeID),
      groupID: type.groupID || 10,
      categoryID: type.categoryID || 2,
      groupName: type.groupName || "Stargate",
      solarSystemID: toInt(row.solarSystemID),
      constellationID: system.constellationID || 0,
      regionID: system.regionID || 0,
      itemName: `${system.solarSystemName || "Unknown"} Stargate ${row._key}`,
      position: cloneVector(row.position),
      radius: type.radius || toNumber(row.radius, 0),
      destinationID: toInt(row.destination && row.destination.stargateID),
      destinationSolarSystemID: toInt(row.destination && row.destination.solarSystemID),
      destinationName: "",
    });
  });
  await readJsonlRecords(sdeDir, "mapPlanets.jsonl", (row) => {
    const system = solarSystemByID.get(toInt(row.solarSystemID)) || {};
    const type = typeByID.get(toInt(row.typeID)) || {};
    celestials.push({
      itemID: toInt(row._key),
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
      itemName: `${system.solarSystemName || "System"} Planet ${row._key}`,
      security: system.security || 0,
      celestialIndex: toInt(row.celestialIndex, 0),
      orbitIndex: toInt(row.orbitIndex, 0),
      kind: "planet",
    });
  });
  await readJsonlRecords(sdeDir, "mapMoons.jsonl", (row) => {
    const system = solarSystemByID.get(toInt(row.solarSystemID)) || {};
    const type = typeByID.get(toInt(row.typeID)) || {};
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
      itemName: `${system.solarSystemName || "System"} Moon ${row._key}`,
      security: system.security || 0,
      celestialIndex: toInt(row.celestialIndex, 0),
      orbitIndex: toInt(row.orbitIndex, 0),
      kind: "moon",
    });
  });
  await readJsonlRecords(sdeDir, "mapAsteroidBelts.jsonl", (row) => {
    const system = solarSystemByID.get(toInt(row.solarSystemID)) || {};
    const type = typeByID.get(toInt(row.typeID)) || {};
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
      radius: toNumber(row.radius, type.radius || 0),
      itemName: `${system.solarSystemName || "System"} Asteroid Belt ${row._key}`,
      security: system.security || 0,
      securityClass: system.securityClass || null,
      celestialIndex: toInt(row.celestialIndex, 0),
      orbitIndex: toInt(row.orbitIndex, 0),
      kind: "asteroidBelt",
      fieldSeed: toInt(row._key),
    };
    celestials.push(belt);
  });
  await readJsonlRecords(sdeDir, "npcStations.jsonl", (row) => {
    const system = solarSystemByID.get(toInt(row.solarSystemID)) || {};
    const type = typeByID.get(toInt(row.typeID)) || {};
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
      constellationName: "",
      regionID: system.regionID || 0,
      regionName: "",
      stationName: `${system.solarSystemName || "System"} Station ${row._key}`,
      position: cloneVector(row.position),
      reprocessingEfficiency: toNumber(row.reprocessingEfficiency, 0),
      reprocessingStationsTake: toNumber(row.reprocessingStationsTake, 0),
      reprocessingHangarFlag: toInt(row.reprocessingHangarFlag, 4),
      radius: type.radius || 0,
    });
  });
  await readJsonlRecords(sdeDir, "blueprints.jsonl", (row) => blueprints.push(row));
  await readJsonlRecords(sdeDir, "races.jsonl", (row) => races.push(row));
  await readJsonlRecords(sdeDir, "bloodlines.jsonl", (row) => bloodlines.push(row));
  await readJsonlRecords(sdeDir, "factions.jsonl", (row) => factions.push(row));
  await readJsonlRecords(sdeDir, "typeMaterials.jsonl", (row) => typeMaterials.push(row));
  await readJsonlRecords(sdeDir, "dbuffCollections.jsonl", (row) => dbuffCollections.push(row));
  await readJsonlRecords(sdeDir, "typeLists.jsonl", (row) => clientTypeLists.push(row));
  await readJsonlRecords(sdeDir, "planetResources.jsonl", (row) => planetResources.push(row));
  await readJsonlRecords(sdeDir, "sovereigntyUpgrades.jsonl", (row) => sovereigntyUpgrades.push(row));

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
    blueprints,
    races,
    bloodlines,
    factions,
    typeMaterials,
    dbuffCollections,
    clientTypeLists,
    planetResources,
    sovereigntyUpgrades,
  };
}

function buildTables(authority, options) {
  const source = buildSource(options, authority.sdeMeta);
  const shipTypes = authority.types.filter((type) => type.categoryID === 6);
  const skillTypes = authority.types.filter((type) => type.categoryID === 16);
  const stationTypeIDs = new Set(authority.stations.map((station) => station.stationTypeID));
  const stargateTypeIDs = new Set(authority.stargates.map((gate) => gate.typeID));
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

  const reprocessingTypes = authority.typeMaterials.map((row) => {
    const type = authority.typeByID.get(toInt(row._key)) || {};
    return {
      typeID: toInt(row._key),
      name: type.name || `Type ${row._key}`,
      groupID: type.groupID || 0,
      categoryID: type.categoryID || 0,
      groupName: type.groupName || "",
      portionSize: type.portionSize || 1,
      basePrice: type.basePrice || 0,
      published: type.published === true,
      isRefinable: true,
      isRecyclable: true,
      materials: (Array.isArray(row.materials) ? row.materials : []).map((material) => ({
        materialTypeID: toInt(material.materialTypeID || material.typeID),
        quantity: toInt(material.quantity, 0),
      })),
      randomizedMaterials: [],
      averageRandomizedOutputs: [],
    };
  });

  return {
    asteroidBelts: { source, count: belts.length, belts },
    celestials: { source, count: authority.celestials.length, celestials: authority.celestials },
    characterCreationBloodlines: {
      source,
      count: authority.bloodlines.length,
      bloodlines: authority.bloodlines.map((row) => ({ ...row, bloodlineID: toInt(row._key), name: localName(row.name) })),
    },
    characterCreationRaces: {
      source,
      count: authority.races.length,
      races: authority.races.map((row) => ({ ...row, raceID: toInt(row._key), raceName: localName(row.name) })),
    },
    characterCreationSchools: buildCharacterCreationSchools(),
    clientTypeLists: { source, count: authority.clientTypeLists.length, typeLists: authority.clientTypeLists },
    dbuffCollections: { source, count: authority.dbuffCollections.length, collections: authority.dbuffCollections },
    factions: {
      source,
      count: authority.factions.length,
      factions: authority.factions.map((row) => ({ ...row, factionID: toInt(row._key), factionName: localName(row.name) })),
    },
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
    itemTypes: { source, count: authority.types.length, types: authority.types },
    movementAttributes: {
      source,
      count: authority.types.length,
      attributes: authority.types.map((type) => movementRecord(type, authority.dogmaByTypeID)),
    },
    reprocessingStatic: {
      source,
      reprocessingTypes,
      reprocessingTypesByTypeID: Object.fromEntries(reprocessingTypes.map((row) => [String(row.typeID), row])),
      profiles: {},
      compressedTypeIDsByBaseTypeID: {},
    },
    shipDogmaAttributes: {
      source,
      count: shipTypes.length,
      ships: shipTypes.map((type) => ({
        typeID: type.typeID,
        typeName: type.name,
        attributes: dogmaAttributesForType(type.typeID, authority.dogmaByTypeID),
      })),
    },
    shipTypes: { source, count: shipTypes.length, ships: shipTypes },
    skillTypes: { source, count: skillTypes.length, skills: skillTypes },
    solarSystems: { source, count: authority.solarSystems.length, solarSystems: authority.solarSystems },
    sovereigntyStatic: {
      source,
      planetResources: authority.planetResources,
      sovereigntyUpgrades: authority.sovereigntyUpgrades,
      solarSystemPowerByID: {},
      counts: {
        planetResourceCount: authority.planetResources.length,
        upgradeCount: authority.sovereigntyUpgrades.length,
      },
    },
    stargates: { source, count: authority.stargates.length, stargates: authority.stargates },
    stargateTypes: {
      source,
      count: stargateTypeIDs.size,
      stargateTypes: [...stargateTypeIDs].sort((a, b) => a - b).map((typeID) => authority.typeByID.get(typeID)).filter(Boolean),
    },
    stations: { source, count: authority.stations.length, stations: authority.stations },
    stationTypes: {
      source,
      count: stationTypeIDs.size,
      stationTypes: [...stationTypeIDs].sort((a, b) => a - b).map((typeID) => authority.typeByID.get(typeID)).filter(Boolean),
    },
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
      styles: {},
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
