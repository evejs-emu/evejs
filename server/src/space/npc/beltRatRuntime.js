const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../worldData"));
const {
  buildNpcDefinition,
  resolveNpcSpawnPool,
} = require(path.join(__dirname, "./npcData"));

const OPERATOR_KIND = "asteroidBeltRat";
const DEFAULT_LANDING_RADIUS_METERS = 250_000;

const PIRATE_FACTION_BY_FACTION_ID = Object.freeze({
  500010: "guristas",
  500011: "angels",
  500012: "blood",
  500019: "sanshas",
  500020: "serpentis",
});

const EMPIRE_FALLBACK_PIRATE_BY_FACTION_ID = Object.freeze({
  500001: "guristas",
  500002: "angels",
  500004: "serpentis",
  500007: "sanshas",
  500008: "sanshas",
});

const PIRATE_FACTION_BY_REGION_ID = Object.freeze({
  // Caldari / Guristas border and NPC space.
  10000002: "guristas",
  10000010: "guristas",
  10000015: "guristas",
  10000016: "guristas",
  10000023: "guristas",
  10000029: "guristas",
  10000033: "guristas",
  10000045: "guristas",
  10000055: "guristas",
  10000069: "guristas",

  // Minmatar / Angel and Angel NPC space.
  10000006: "angels",
  10000007: "angels",
  10000008: "angels",
  10000011: "angels",
  10000012: "angels",
  10000028: "angels",
  10000030: "angels",
  10000042: "angels",

  // Gallente / Serpentis and Serpentis NPC space.
  10000032: "serpentis",
  10000037: "serpentis",
  10000041: "serpentis",
  10000044: "serpentis",
  10000048: "serpentis",
  10000051: "serpentis",
  10000057: "serpentis",
  10000058: "serpentis",
  10000064: "serpentis",
  10000068: "serpentis",

  // Amarr west / Blood Raider and Blood Raider NPC space.
  10000038: "blood",
  10000049: "blood",
  10000050: "blood",
  10000054: "blood",
  10000060: "blood",
  10000063: "blood",
  10000065: "blood",

  // Amarr east / Ammatar / Sansha and Sansha NPC space.
  10000001: "sanshas",
  10000014: "sanshas",
  10000020: "sanshas",
  10000022: "sanshas",
  10000036: "sanshas",
  10000039: "sanshas",
  10000043: "sanshas",
  10000047: "sanshas",
  10000052: "sanshas",
  10000059: "sanshas",
  10000067: "sanshas",
});

const PROFILE_FAMILIES_BY_FACTION = Object.freeze({
  blood: [
    "parity_blood_raider_pulse_",
    "parity_blood_raider_beam_",
  ],
  sanshas: [
    "parity_sansha_pulse_",
    "parity_sansha_beam_",
  ],
  serpentis: [
    "parity_serpentis_blaster_",
    "parity_serpentis_rail_",
  ],
  angels: [
    "parity_angel_autocannon_",
    "parity_angel_artillery_",
  ],
  guristas: [
    "parity_guristas_missile_",
    "parity_guristas_rail_",
  ],
});

const STANDARD_PIRATE_FACTIONS = Object.freeze([
  "guristas",
  "serpentis",
  "angels",
  "blood",
  "sanshas",
]);

const COMMANDER_POOL_QUERY_BY_FACTION = Object.freeze({
  blood: "dark blood",
  sanshas: "true sansha",
  serpentis: "shadow serpentis",
  angels: "domination",
  guristas: "dread guristas",
});

const OFFICER_POOL_QUERY_BY_FACTION = Object.freeze({
  blood: "blood officer",
  sanshas: "sansha officer",
  serpentis: "serpentis officer",
  angels: "angel officer",
  guristas: "guristas officer",
});

const CAPITAL_POOL_QUERY_BY_FACTION = Object.freeze({
  blood: "capital_npc_blood",
  sanshas: "capital_npc_sanshas",
  serpentis: "capital_npc_serpentis",
  angels: "capital_npc_angels",
  guristas: "capital_npc_guristas",
});

const OFFICER_HOME_REGION_IDS_BY_FACTION = Object.freeze({
  guristas: new Set([10000015]), // Venal
  angels: new Set([10000012]), // Curse
  blood: new Set([10000060]), // Delve
  sanshas: new Set([10000022]), // Stain
  serpentis: new Set([10000058]), // Fountain
});

const HAULER_POOL_QUERY_BY_SECURITY_BAND = Object.freeze({
  highsec: "npc_mining_hauler_highsec",
  lowsec: "npc_mining_hauler_lowsec",
  nullsec: "npc_mining_hauler_nullsec",
});

const ASTEROID_BELT_PRESENTATION_BY_PROFILE_ID = Object.freeze({
  parity_sansha_pulse_frigate: "Sansha's Enslaver",
  parity_sansha_beam_frigate: "Sansha's Enslaver",
  parity_sansha_pulse_destroyer: "Sansha's Cannibal",
  parity_sansha_beam_destroyer: "Sansha's Cannibal",
  parity_sansha_pulse_cruiser: "Sansha's Beast",
  parity_sansha_beam_cruiser: "Sansha's Beast",
  parity_sansha_pulse_battlecruiser: "Sansha's Lord",
  parity_sansha_beam_battlecruiser: "Sansha's Lord",
  parity_sansha_pulse_battleship: "Sansha's Tyrant",
  parity_sansha_beam_battleship: "Sansha's Tyrant",
  parity_sansha_true_centii_enslaver: "True Sansha's Enslaver",
  parity_sansha_true_centior_cannibal: "True Sansha's Cannibal",
  parity_sansha_true_centum_beast: "True Sansha's Beast",
  parity_sansha_true_centus_lord: "True Sansha's Lord",
  parity_sansha_true_centus_tyrant: "True Sansha's Tyrant",

  parity_serpentis_blaster_frigate: "Serpentis Agent",
  parity_serpentis_rail_frigate: "Serpentis Agent",
  parity_serpentis_blaster_destroyer: "Serpentis Soldier",
  parity_serpentis_rail_destroyer: "Serpentis Soldier",
  parity_serpentis_blaster_cruiser: "Serpentis Chief Guard",
  parity_serpentis_rail_cruiser: "Serpentis Chief Guard",
  parity_serpentis_blaster_battlecruiser: "Serpentis Captain",
  parity_serpentis_rail_battlecruiser: "Serpentis Captain",
  parity_serpentis_blaster_battleship: "Serpentis Grand Admiral",
  parity_serpentis_rail_battleship: "Serpentis Grand Admiral",
  parity_serpentis_shadow_coreli_agent: "Shadow Serpentis Agent",
  parity_serpentis_shadow_corelior_soldier: "Shadow Serpentis Soldier",
  parity_serpentis_shadow_corelum_chief_guard: "Shadow Serpentis Chief Guard",
  parity_serpentis_shadow_corelatis_captain: "Shadow Serpentis Captain",
  parity_serpentis_shadow_core_grand_admiral: "Shadow Serpentis Grand Admiral",

  parity_angel_autocannon_frigate: "Angel Raider",
  parity_angel_artillery_frigate: "Angel Raider",
  parity_angel_autocannon_destroyer: "Angel Defacer",
  parity_angel_artillery_destroyer: "Angel Defacer",
  parity_angel_autocannon_cruiser: "Angel Liquidator",
  parity_angel_artillery_cruiser: "Angel Liquidator",
  parity_angel_autocannon_battlecruiser: "Angel Tribunus",
  parity_angel_artillery_battlecruiser: "Angel Tribunus",
  parity_angel_autocannon_battleship: "Angel War General",
  parity_angel_artillery_battleship: "Angel War General",
  parity_angel_gistii_domination_raider: "Domination Raider",
  parity_angel_gistior_domination_defacer: "Domination Defacer",
  parity_angel_gistum_domination_liquidator: "Domination Liquidator",
  parity_angel_gistatis_domination_tribunus: "Domination Tribunus",
  parity_angel_gist_domination_war_general: "Domination War General",

  parity_guristas_missile_frigate: "Guristas Arrogator",
  parity_guristas_rail_frigate: "Guristas Arrogator",
  parity_guristas_missile_destroyer: "Guristas Anarchist",
  parity_guristas_rail_destroyer: "Guristas Anarchist",
  parity_guristas_missile_cruiser: "Guristas Abolisher",
  parity_guristas_rail_cruiser: "Guristas Abolisher",
  parity_guristas_missile_battlecruiser: "Guristas Assaulter",
  parity_guristas_rail_battlecruiser: "Guristas Assaulter",
  parity_guristas_missile_battleship: "Guristas Extinguisher",
  parity_guristas_rail_battleship: "Guristas Extinguisher",
  parity_guristas_dread_pithi_arrogator: "Dread Guristas Arrogator",
  parity_guristas_dread_pithior_anarchist: "Dread Guristas Anarchist",
  parity_guristas_dread_pithum_abolisher: "Dread Guristas Abolisher",
  parity_guristas_dread_pithatis_assaulter: "Dread Guristas Assaulter",
  parity_guristas_dread_pith_extinguisher: "Dread Guristas Extinguisher",
});

const CAPITAL_CLASS_ALIASES = Object.freeze({
  dread: "dreadnought",
  dreads: "dreadnought",
  dreadnought: "dreadnought",
  dreadnoughts: "dreadnought",
  titan: "titan",
  titans: "titan",
  super: "supercarrier",
  supers: "supercarrier",
  supercarrier: "supercarrier",
  supercarriers: "supercarrier",
  carrier: "supercarrier",
  carriers: "supercarrier",
});

const SECURITY_PROFILES = Object.freeze([
  {
    minSecurity: 0.8,
    band: "highsec",
    minCount: 1,
    maxCount: 1,
    hullWeights: {
      frigate: 12,
    },
  },
  {
    minSecurity: 0.45,
    band: "highsec",
    minCount: 1,
    maxCount: 2,
    hullWeights: {
      frigate: 10,
      destroyer: 3,
    },
  },
  {
    minSecurity: 0.1,
    band: "lowsec",
    minCount: 2,
    maxCount: 3,
    hullWeights: {
      frigate: 8,
      destroyer: 5,
      cruiser: 3,
    },
  },
  {
    minSecurity: 0,
    band: "lowsec",
    minCount: 2,
    maxCount: 4,
    hullWeights: {
      destroyer: 5,
      cruiser: 6,
      battlecruiser: 2,
    },
  },
  {
    minSecurity: -0.45,
    band: "nullsec",
    minCount: 3,
    maxCount: 4,
    hullWeights: {
      cruiser: 5,
      battlecruiser: 5,
      battleship: 2,
    },
  },
  {
    minSecurity: Number.NEGATIVE_INFINITY,
    band: "nullsec",
    minCount: 3,
    maxCount: 5,
    hullWeights: {
      cruiser: 2,
      battlecruiser: 5,
      battleship: 5,
    },
  },
]);

const beltStateByKey = new Map();

let nowProvider = () => Date.now();
let randomProvider = () => Math.random();

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function clamp(value, min, max) {
  const numeric = toFiniteNumber(value, min);
  return Math.min(max, Math.max(min, numeric));
}

function random(options = {}) {
  return typeof options.random === "function"
    ? options.random()
    : randomProvider();
}

function chooseWeightedKey(weights = {}, options = {}) {
  const entries = Object.entries(weights)
    .map(([key, weight]) => [key, Math.max(0, toFiniteNumber(weight, 0))])
    .filter(([, weight]) => weight > 0);
  if (entries.length <= 0) {
    return null;
  }

  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random(options) * totalWeight;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll < 0) {
      return key;
    }
  }
  return entries[entries.length - 1][0];
}

function chooseArrayEntry(values = [], options = {}) {
  if (!Array.isArray(values) || values.length <= 0) {
    return null;
  }
  const index = Math.min(
    values.length - 1,
    Math.floor(random(options) * values.length),
  );
  return values[index];
}

function getSystemRecord(systemID) {
  return worldData.getSolarSystemByID(toPositiveInt(systemID, 0)) || null;
}

function getSecurityStatusForSystem(systemID) {
  const system = getSystemRecord(systemID);
  return toFiniteNumber(
    system && (system.securityStatus ?? system.security),
    0,
  );
}

function resolveSecurityProfile(systemID) {
  const numericSystemID = toPositiveInt(systemID, 0);
  if (numericSystemID >= 31_000_000 && numericSystemID <= 31_999_999) {
    return {
      band: "wormhole",
      securityStatus: -0.99,
      eligible: false,
    };
  }

  const securityStatus = getSecurityStatusForSystem(numericSystemID);
  const profile = SECURITY_PROFILES.find(
    (entry) => securityStatus >= entry.minSecurity,
  ) || SECURITY_PROFILES[SECURITY_PROFILES.length - 1];
  return {
    ...profile,
    securityStatus,
    eligible: true,
  };
}

function resolvePirateFactionKeyForSystem(systemID, options = {}) {
  const explicitFactionKey = String(options.factionKey || "").trim().toLowerCase();
  if (PROFILE_FAMILIES_BY_FACTION[explicitFactionKey]) {
    return explicitFactionKey;
  }

  const system = getSystemRecord(systemID);
  const regionID = toPositiveInt(system && system.regionID, 0);
  const factionID = toPositiveInt(system && system.factionID, 0);
  return (
    PIRATE_FACTION_BY_FACTION_ID[factionID] ||
    PIRATE_FACTION_BY_REGION_ID[regionID] ||
    EMPIRE_FALLBACK_PIRATE_BY_FACTION_ID[factionID] ||
    "mixed"
  );
}

function resolveConcretePirateFactionKey(systemID, options = {}) {
  const factionKey = resolvePirateFactionKeyForSystem(systemID, options);
  if (factionKey !== "mixed") {
    return factionKey;
  }
  return chooseArrayEntry(STANDARD_PIRATE_FACTIONS, options) || "guristas";
}

function resolveConfigValue(key, options = {}) {
  if (options.config && Object.prototype.hasOwnProperty.call(options.config, key)) {
    return options.config[key];
  }
  if (Object.prototype.hasOwnProperty.call(options, key)) {
    return options[key];
  }
  return config[key];
}

function normalizeCapitalClassToken(value) {
  return CAPITAL_CLASS_ALIASES[String(value || "").trim().toLowerCase()] || "";
}

function parseCapitalAllowedClasses(value) {
  const rawValue = String(value || "").trim().toLowerCase();
  if (!rawValue) {
    return new Set(["dreadnought"]);
  }
  if (["all", "any", "*"].includes(rawValue)) {
    return new Set(["dreadnought", "titan", "supercarrier"]);
  }

  const classes = rawValue
    .split(/[,|;\s]+/g)
    .map(normalizeCapitalClassToken)
    .filter(Boolean);
  return new Set(classes.length > 0 ? classes : ["dreadnought"]);
}

function resolveBeltRatConfig(options = {}) {
  return {
    enabled: resolveConfigValue("asteroidBeltNpcRatsEnabled", options) === true,
    chanceHighSec: clamp(
      resolveConfigValue("asteroidBeltNpcRatHighSecChance", options),
      0,
      1,
    ),
    chanceLowSec: clamp(
      resolveConfigValue("asteroidBeltNpcRatLowSecChance", options),
      0,
      1,
    ),
    chanceNullSec: clamp(
      resolveConfigValue("asteroidBeltNpcRatNullSecChance", options),
      0,
      1,
    ),
    rollCooldownMs: Math.max(
      0,
      toInt(resolveConfigValue("asteroidBeltNpcRatRollCooldownMs", options), 120_000),
    ),
    respawnCooldownMs: Math.max(
      0,
      toInt(resolveConfigValue("asteroidBeltNpcRatRespawnCooldownMs", options), 1_200_000),
    ),
    maxActiveGroupsPerBelt: Math.max(
      1,
      toInt(resolveConfigValue("asteroidBeltNpcRatMaxActiveGroupsPerBelt", options), 1),
    ),
    landingRadiusMeters: Math.max(
      1_000,
      toFiniteNumber(
        resolveConfigValue("asteroidBeltNpcRatLandingRadiusMeters", options),
        DEFAULT_LANDING_RADIUS_METERS,
      ),
    ),
    spawnDistanceMeters: Math.max(
      1_000,
      toFiniteNumber(resolveConfigValue("asteroidBeltNpcRatSpawnDistanceMeters", options), 30_000),
    ),
    specialsEnabled:
      resolveConfigValue("asteroidBeltNpcRatSpecialsEnabled", options) !== false,
    haulerChance: clamp(
      resolveConfigValue("asteroidBeltNpcRatHaulerChance", options),
      0,
      1,
    ),
    commanderChance: clamp(
      resolveConfigValue("asteroidBeltNpcRatCommanderChance", options),
      0,
      1,
    ),
    officerChance: clamp(
      resolveConfigValue("asteroidBeltNpcRatOfficerChance", options),
      0,
      1,
    ),
    officerMaxSecurity: clamp(
      resolveConfigValue("asteroidBeltNpcRatOfficerMaxSecurity", options),
      -1,
      1,
    ),
    officerRequireHomeRegion:
      resolveConfigValue("asteroidBeltNpcRatOfficerRequireHomeRegion", options) !== false,
    capitalEnabled:
      resolveConfigValue("asteroidBeltNpcRatCapitalEnabled", options) !== false,
    capitalChance: clamp(
      resolveConfigValue("asteroidBeltNpcRatCapitalChance", options),
      0,
      1,
    ),
    capitalMaxSecurity: clamp(
      resolveConfigValue("asteroidBeltNpcRatCapitalMaxSecurity", options),
      -1,
      1,
    ),
    capitalAllowedClasses: parseCapitalAllowedClasses(
      resolveConfigValue("asteroidBeltNpcRatCapitalClasses", options),
    ),
    capitalMaxActiveGroupsPerSystem: Math.max(
      0,
      toInt(resolveConfigValue("asteroidBeltNpcRatCapitalMaxActiveGroupsPerSystem", options), 1),
    ),
  };
}

function resolveSpawnChanceForBand(band, resolvedConfig) {
  switch (String(band || "").toLowerCase()) {
    case "highsec":
      return resolvedConfig.chanceHighSec;
    case "lowsec":
      return resolvedConfig.chanceLowSec;
    case "nullsec":
      return resolvedConfig.chanceNullSec;
    default:
      return 0;
  }
}

function buildBeltStateKey(systemID, beltID) {
  return `${toPositiveInt(systemID, 0)}:${toPositiveInt(beltID, 0)}`;
}

function getOrCreateBeltState(systemID, beltID) {
  const key = buildBeltStateKey(systemID, beltID);
  let state = beltStateByKey.get(key);
  if (!state) {
    state = {
      key,
      systemID: toPositiveInt(systemID, 0),
      beltID: toPositiveInt(beltID, 0),
      lastRollAtMs: Number.NEGATIVE_INFINITY,
      lastSpawnAtMs: Number.NEGATIVE_INFINITY,
      spawnSequence: 0,
      spawnedEntityIDs: new Set(),
    };
    beltStateByKey.set(key, state);
  }
  return state;
}

function isAsteroidBeltEntity(entity) {
  return Boolean(
    entity &&
    toPositiveInt(entity.itemID, 0) > 0 &&
    String(entity.kind || "").trim().toLowerCase() === "asteroidbelt"
  );
}

function squareDistance(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return (dx * dx) + (dy * dy) + (dz * dz);
}

function getBeltEntitiesForScene(scene) {
  return Array.isArray(scene && scene.staticEntities)
    ? scene.staticEntities.filter(isAsteroidBeltEntity)
    : [];
}

function findNearestBeltForEntity(scene, entity, options = {}) {
  if (!scene || !entity || !entity.position) {
    return null;
  }

  const resolvedConfig = resolveBeltRatConfig(options);
  const maxDistanceMeters = Math.max(
    1_000,
    toFiniteNumber(options.maxDistanceMeters, resolvedConfig.landingRadiusMeters),
  );
  let nearest = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (const belt of getBeltEntitiesForScene(scene)) {
    const distanceSq = squareDistance(entity.position, belt.position);
    const beltRadius = Math.max(0, toFiniteNumber(belt.radius, 0));
    const effectiveMaxDistance = maxDistanceMeters + beltRadius;
    if (distanceSq > effectiveMaxDistance * effectiveMaxDistance) {
      continue;
    }
    if (distanceSq < nearestDistanceSq) {
      nearest = belt;
      nearestDistanceSq = distanceSq;
    }
  }
  return nearest;
}

function countActiveBeltRatGroups(scene, beltEntity, state) {
  const beltID = toPositiveInt(beltEntity && beltEntity.itemID, 0);
  if (!scene || !beltID) {
    return 0;
  }

  const activeGroupKeys = new Set();
  const dynamicEntities = scene.dynamicEntities instanceof Map
    ? scene.dynamicEntities.values()
    : [];
  for (const entity of dynamicEntities) {
    if (!entity || entity.nativeNpc !== true) {
      continue;
    }
    const operatorKind = String(entity.operatorKind || "").trim();
    const anchorID = toPositiveInt(entity.anchorID, 0);
    if (operatorKind !== OPERATOR_KIND || anchorID !== beltID) {
      continue;
    }
    const groupKey = String(entity.spawnSiteID || entity.spawnGroupInstanceID || entity.itemID);
    activeGroupKeys.add(groupKey);
  }

  if (state && state.spawnedEntityIDs instanceof Set) {
    for (const entityID of [...state.spawnedEntityIDs]) {
      const entity = typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(entityID)
        : null;
      if (entity && entity.nativeNpc === true) {
        activeGroupKeys.add(String(entity.spawnSiteID || state.key));
      } else {
        state.spawnedEntityIDs.delete(entityID);
      }
    }
  }

  return activeGroupKeys.size;
}

function countActiveBeltRatCapitalGroupsInSystem(scene) {
  if (!scene) {
    return 0;
  }

  const activeGroupKeys = new Set();
  const dynamicEntities = scene.dynamicEntities instanceof Map
    ? scene.dynamicEntities.values()
    : [];
  for (const entity of dynamicEntities) {
    if (!entity || entity.nativeNpc !== true || entity.capitalNpc !== true) {
      continue;
    }
    if (String(entity.operatorKind || "").trim() !== OPERATOR_KIND) {
      continue;
    }
    activeGroupKeys.add(String(entity.spawnSiteID || entity.spawnGroupInstanceID || entity.itemID));
  }
  return activeGroupKeys.size;
}

function resolveSpawnCount(securityProfile, options = {}) {
  const minCount = Math.max(1, toInt(options.minCount, securityProfile.minCount || 1));
  const maxCount = Math.max(minCount, toInt(options.maxCount, securityProfile.maxCount || minCount));
  if (minCount === maxCount) {
    return minCount;
  }
  return minCount + Math.floor(random(options) * ((maxCount - minCount) + 1));
}

function buildProfileIDForFactionHull(factionKey, hullClass, options = {}) {
  const families = PROFILE_FAMILIES_BY_FACTION[factionKey] || null;
  if (!families) {
    return null;
  }
  const prefix = chooseArrayEntry(families, options);
  if (!prefix) {
    return null;
  }
  return `${prefix}${hullClass}`;
}

function applyAsteroidBeltPresentation(definition) {
  if (!definition || !definition.profile) {
    return definition;
  }

  const profileID = String(definition.profile.profileID || "").trim();
  const presentationName = ASTEROID_BELT_PRESENTATION_BY_PROFILE_ID[profileID];
  if (!presentationName) {
    return definition;
  }

  return {
    ...definition,
    profile: {
      ...definition.profile,
      name: presentationName,
      shipNameTemplate: presentationName,
      presentationName,
      asteroidBeltPresentationName: presentationName,
      sourceProfileName: definition.profile.name || null,
      sourceShipNameTemplate: definition.profile.shipNameTemplate || null,
    },
  };
}

function chooseWeightedPoolEntry(pool, options = {}) {
  const entries = Array.isArray(pool && pool.entries)
    ? pool.entries
    : [];
  const weighted = entries
    .map((entry) => ({
      profileID: String(entry && entry.profileID || "").trim(),
      weight: Math.max(0, toFiniteNumber(entry && entry.weight, 0)),
    }))
    .filter((entry) => entry.profileID && entry.weight > 0);
  if (weighted.length <= 0) {
    return null;
  }

  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random(options) * totalWeight;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll < 0) {
      return entry.profileID;
    }
  }
  return weighted[weighted.length - 1].profileID;
}

function getSystemRegionID(systemID) {
  const system = getSystemRecord(systemID);
  return toPositiveInt(system && system.regionID, 0);
}

function isOfficerEligible(systemID, factionKey, securityProfile, resolvedConfig) {
  if (!securityProfile || securityProfile.eligible !== true) {
    return false;
  }
  if (String(securityProfile.band || "").toLowerCase() !== "nullsec") {
    return false;
  }
  const homeRegionIDs = OFFICER_HOME_REGION_IDS_BY_FACTION[factionKey] || null;
  const inHomeRegion = Boolean(homeRegionIDs && homeRegionIDs.has(getSystemRegionID(systemID)));
  if (resolvedConfig.officerRequireHomeRegion === true) {
    return inHomeRegion;
  }
  return (
    inHomeRegion ||
    toFiniteNumber(securityProfile.securityStatus, 0) <= resolvedConfig.officerMaxSecurity
  );
}

function isCapitalSpawnEligible(systemID, factionKey, securityProfile, resolvedConfig) {
  if (!securityProfile || securityProfile.eligible !== true) {
    return false;
  }
  if (resolvedConfig.capitalEnabled !== true) {
    return false;
  }
  if (String(securityProfile.band || "").toLowerCase() !== "nullsec") {
    return false;
  }
  if (toFiniteNumber(securityProfile.securityStatus, 1) > resolvedConfig.capitalMaxSecurity) {
    return false;
  }
  return Boolean(CAPITAL_POOL_QUERY_BY_FACTION[factionKey]);
}

function getSpecialSpawnPoolQuery(kind, factionKey, securityProfile) {
  switch (String(kind || "").toLowerCase()) {
    case "hauler":
      return HAULER_POOL_QUERY_BY_SECURITY_BAND[
        String(securityProfile && securityProfile.band || "").toLowerCase()
      ] || null;
    case "commander":
      return COMMANDER_POOL_QUERY_BY_FACTION[factionKey] || null;
    case "officer":
      return OFFICER_POOL_QUERY_BY_FACTION[factionKey] || null;
    case "capital":
      return CAPITAL_POOL_QUERY_BY_FACTION[factionKey] || null;
    default:
      return null;
  }
}

function isSpecialSpawnKindEligible(kind, systemID, factionKey, securityProfile, resolvedConfig) {
  switch (String(kind || "").toLowerCase()) {
    case "hauler":
      return Boolean(HAULER_POOL_QUERY_BY_SECURITY_BAND[
        String(securityProfile && securityProfile.band || "").toLowerCase()
      ]);
    case "commander":
      return Boolean(COMMANDER_POOL_QUERY_BY_FACTION[factionKey]);
    case "officer":
      return isOfficerEligible(systemID, factionKey, securityProfile, resolvedConfig);
    case "capital":
      return isCapitalSpawnEligible(systemID, factionKey, securityProfile, resolvedConfig);
    default:
      return false;
  }
}

function rollSpecialSpawnKind(systemID, factionKey, securityProfile, resolvedConfig, options = {}) {
  const forcedKind = String(
    options.forceSpecialSpawnKind ||
    options.specialSpawnKind ||
    "",
  ).trim().toLowerCase();
  if (forcedKind) {
    return isSpecialSpawnKindEligible(
      forcedKind,
      systemID,
      factionKey,
      securityProfile,
      resolvedConfig,
    )
      ? forcedKind
      : null;
  }

  if (options.skipSpecialSpawns === true || resolvedConfig.specialsEnabled !== true) {
    return null;
  }

  const candidates = [
    ["capital", resolvedConfig.capitalChance],
    ["officer", resolvedConfig.officerChance],
    ["commander", resolvedConfig.commanderChance],
    ["hauler", resolvedConfig.haulerChance],
  ];
  for (const [kind, chance] of candidates) {
    if (
      chance > 0 &&
      isSpecialSpawnKindEligible(kind, systemID, factionKey, securityProfile, resolvedConfig) &&
      random(options) < chance
    ) {
      return kind;
    }
  }
  return null;
}

function resolveSpecialSpawnCount(kind, options = {}) {
  switch (String(kind || "").toLowerCase()) {
    case "hauler": {
      const minCount = Math.max(1, toInt(options.haulerMinCount, 2));
      const maxCount = Math.max(minCount, toInt(options.haulerMaxCount, 4));
      if (minCount === maxCount) {
        return minCount;
      }
      return minCount + Math.floor(random(options) * ((maxCount - minCount) + 1));
    }
    default:
      return 1;
  }
}

function chooseWeightedCapitalPoolDefinition(pool, resolvedConfig, options = {}) {
  const allowedClasses = resolvedConfig && resolvedConfig.capitalAllowedClasses instanceof Set
    ? resolvedConfig.capitalAllowedClasses
    : new Set(["dreadnought"]);
  const entries = Array.isArray(pool && pool.entries) ? pool.entries : [];
  const weighted = [];
  for (const entry of entries) {
    const profileID = String(entry && entry.profileID || "").trim();
    if (!profileID) {
      continue;
    }
    const definition = buildNpcDefinition(profileID);
    const capitalClassID = normalizeCapitalClassToken(
      definition && definition.profile && definition.profile.capitalClassID,
    );
    if (
      !definition ||
      definition.profile.capitalNpc !== true ||
      !allowedClasses.has(capitalClassID)
    ) {
      continue;
    }
    const weight = Math.max(0, toFiniteNumber(entry && entry.weight, 0));
    if (weight <= 0) {
      continue;
    }
    weighted.push({ profileID, definition, weight });
  }

  if (weighted.length <= 0) {
    return null;
  }

  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random(options) * totalWeight;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll < 0) {
      return entry;
    }
  }
  return weighted[weighted.length - 1];
}

function buildSpecialBeltRatSpawnPlan(systemID, factionKey, securityProfile, resolvedConfig, options = {}) {
  const forcedKind = String(
    options.forceSpecialSpawnKind ||
    options.specialSpawnKind ||
    "",
  ).trim().toLowerCase();
  if (
    forcedKind &&
    !isSpecialSpawnKindEligible(
      forcedKind,
      systemID,
      factionKey,
      securityProfile,
      resolvedConfig,
    )
  ) {
    return {
      success: false,
      errorMsg: "SPECIAL_SPAWN_NOT_ELIGIBLE",
      specialSpawnKind: forcedKind,
      factionKey,
      securityProfile,
    };
  }

  const specialSpawnKind = rollSpecialSpawnKind(
    systemID,
    factionKey,
    securityProfile,
    resolvedConfig,
    options,
  );
  if (!specialSpawnKind) {
    return null;
  }

  const poolQuery = getSpecialSpawnPoolQuery(specialSpawnKind, factionKey, securityProfile);
  const poolResult = poolQuery ? resolveNpcSpawnPool(poolQuery) : null;
  const pool = poolResult && poolResult.success === true ? poolResult.data : null;
  if (!pool) {
    return {
      success: false,
      errorMsg: "SPECIAL_SPAWN_POOL_NOT_FOUND",
      specialSpawnKind,
      factionKey,
      securityProfile,
      poolQuery,
    };
  }

  const count = resolveSpecialSpawnCount(specialSpawnKind, options);
  const definitions = [];
  const profileIDs = [];
  for (let index = 0; index < count; index += 1) {
    const capitalEntry = specialSpawnKind === "capital"
      ? chooseWeightedCapitalPoolDefinition(pool, resolvedConfig, options)
      : null;
    const profileID = capitalEntry
      ? capitalEntry.profileID
      : chooseWeightedPoolEntry(pool, options);
    const rawDefinition = capitalEntry
      ? capitalEntry.definition
      : profileID
        ? buildNpcDefinition(profileID)
        : null;
    const definition = specialSpawnKind === "capital"
      ? rawDefinition
      : applyAsteroidBeltPresentation(rawDefinition);
    if (!definition) {
      continue;
    }
    profileIDs.push(profileID);
    definitions.push(definition);
  }

  if (definitions.length <= 0) {
    return {
      success: false,
      errorMsg: "SPECIAL_NPC_DEFINITION_INCOMPLETE",
      specialSpawnKind,
      factionKey,
      securityProfile,
      poolQuery,
    };
  }

  return {
    success: true,
    data: {
      systemID: toPositiveInt(systemID, 0),
      factionKey,
      requestedCount: count,
      profileIDs,
      definitions,
      securityBand: securityProfile.band,
      securityStatus: securityProfile.securityStatus,
      specialSpawnKind,
      spawnPoolID: String(pool.spawnPoolID || ""),
      selectionID: `belt_rat:${factionKey}:${securityProfile.band}:${specialSpawnKind}`,
      selectionName: `${factionKey} ${specialSpawnKind} belt spawn (${securityProfile.band})`,
    },
  };
}

function buildBeltRatSpawnPlan(systemID, options = {}) {
  const securityProfile = resolveSecurityProfile(systemID);
  if (!securityProfile.eligible) {
    return {
      success: false,
      errorMsg: "SECURITY_BAND_NOT_ELIGIBLE",
      securityProfile,
    };
  }

  const factionKey = resolveConcretePirateFactionKey(systemID, options);
  const resolvedConfig = resolveBeltRatConfig(options);
  const specialPlan = buildSpecialBeltRatSpawnPlan(
    systemID,
    factionKey,
    securityProfile,
    resolvedConfig,
    options,
  );
  if (specialPlan) {
    return specialPlan;
  }

  const count = resolveSpawnCount(securityProfile, options);
  const definitions = [];
  const profileIDs = [];
  for (let index = 0; index < count; index += 1) {
    const hullClass = chooseWeightedKey(securityProfile.hullWeights, options) || "frigate";
    const profileID = buildProfileIDForFactionHull(factionKey, hullClass, options);
    const definition = profileID
      ? applyAsteroidBeltPresentation(buildNpcDefinition(profileID))
      : null;
    if (!definition) {
      continue;
    }
    profileIDs.push(profileID);
    definitions.push(definition);
  }

  if (definitions.length <= 0) {
    return {
      success: false,
      errorMsg: "NPC_DEFINITION_INCOMPLETE",
      factionKey,
      securityProfile,
    };
  }

  return {
    success: true,
    data: {
      systemID: toPositiveInt(systemID, 0),
      factionKey,
      requestedCount: count,
      profileIDs,
      definitions,
      securityBand: securityProfile.band,
      securityStatus: securityProfile.securityStatus,
      specialSpawnKind: "normal",
      spawnPoolID: "",
      selectionID: `belt_rat:${factionKey}:${securityProfile.band}`,
      selectionName: `${factionKey} belt rats (${securityProfile.band})`,
    },
  };
}

function spawnBeltRatGroup(scene, session, beltEntity, state, plan, options = {}) {
  const spawnNativeDefinitionsInContext =
    typeof options.spawnNativeDefinitionsInContext === "function"
      ? options.spawnNativeDefinitionsInContext
      : require(path.join(__dirname, "./nativeNpcService")).spawnNativeDefinitionsInContext;
  const shipID = toPositiveInt(
    options.preferredTargetID,
    toPositiveInt(session && session._space && session._space.shipID, 0),
  );
  const spawnSiteID = `${state.key}:${state.spawnSequence + 1}`;
  const context = {
    systemID: toPositiveInt(scene && scene.systemID, toPositiveInt(plan && plan.systemID, 0)),
    scene,
    anchorEntity: beltEntity,
    preferredTargetID: shipID,
    anchorKind: "asteroidBelt",
    anchorLabel: String(beltEntity && (beltEntity.itemName || beltEntity.slimName) || "Asteroid Belt"),
  };
  const selectionResult = {
    success: true,
    data: {
      selectionKind: "beltRat",
      selectionID: plan.selectionID,
      selectionName: plan.selectionName,
      definitions: plan.definitions,
    },
    suggestions: [],
  };

  const resolvedConfig = resolveBeltRatConfig(options);
  const spawnResult = spawnNativeDefinitionsInContext(context, selectionResult, {
    ...options,
    entityType: "npc",
    transient: true,
    broadcast: options.broadcast === true,
    deferGroupBehaviorTick: true,
    preferredTargetID: shipID,
    spawnDistanceMeters: resolvedConfig.spawnDistanceMeters,
    spreadMeters: toFiniteNumber(options.spreadMeters, 8_000),
    formationSpacingMeters: toFiniteNumber(options.formationSpacingMeters, 1_250),
    selectionKind: "beltRat",
    selectionID: plan.selectionID,
    selectionName: plan.selectionName,
    operatorKind: OPERATOR_KIND,
    anchorKind: "asteroidBelt",
    anchorID: toPositiveInt(beltEntity && beltEntity.itemID, 0),
    anchorName: String(beltEntity && (beltEntity.itemName || beltEntity.slimName) || "Asteroid Belt"),
    spawnSiteID,
  });

  if (!spawnResult || spawnResult.success !== true || !spawnResult.data) {
    return spawnResult || {
      success: false,
      errorMsg: "NPC_NATIVE_SPAWN_FAILED",
    };
  }

  state.spawnSequence += 1;
  const spawned = Array.isArray(spawnResult.data.spawned)
    ? spawnResult.data.spawned
    : [];
  for (const entry of spawned) {
    const entityID = toPositiveInt(entry && entry.entity && entry.entity.itemID, 0);
    if (entityID) {
      state.spawnedEntityIDs.add(entityID);
    }
  }

  return {
    ...spawnResult,
    data: {
      ...spawnResult.data,
      spawnSiteID,
      profileIDs: plan.profileIDs,
      factionKey: plan.factionKey,
      securityBand: plan.securityBand,
      securityStatus: plan.securityStatus,
      specialSpawnKind: plan.specialSpawnKind || "normal",
      spawnPoolID: plan.spawnPoolID || "",
    },
  };
}

function maybeSpawnForBeltArrival(scene, session, beltEntity, options = {}) {
  if (!scene || !isAsteroidBeltEntity(beltEntity)) {
    return {
      success: false,
      spawned: false,
      reason: "BELT_NOT_FOUND",
    };
  }

  const resolvedConfig = resolveBeltRatConfig(options);
  if (!resolvedConfig.enabled && options.forceSpawn !== true) {
    return {
      success: true,
      spawned: false,
      reason: "DISABLED",
    };
  }

  const systemID = toPositiveInt(scene.systemID, toPositiveInt(beltEntity.solarSystemID, 0));
  const state = getOrCreateBeltState(systemID, beltEntity.itemID);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : nowProvider();
  const activeGroups = countActiveBeltRatGroups(scene, beltEntity, state);
  if (activeGroups >= resolvedConfig.maxActiveGroupsPerBelt && options.forceSpawn !== true) {
    return {
      success: true,
      spawned: false,
      reason: "ACTIVE_GROUP_PRESENT",
      activeGroups,
    };
  }
  if (
    resolvedConfig.respawnCooldownMs > 0 &&
    nowMs - state.lastSpawnAtMs < resolvedConfig.respawnCooldownMs &&
    options.forceSpawn !== true
  ) {
    return {
      success: true,
      spawned: false,
      reason: "RESPAWN_COOLDOWN",
    };
  }
  if (
    resolvedConfig.rollCooldownMs > 0 &&
    nowMs - state.lastRollAtMs < resolvedConfig.rollCooldownMs &&
    options.forceSpawn !== true
  ) {
    return {
      success: true,
      spawned: false,
      reason: "ROLL_COOLDOWN",
    };
  }

  const planResult = buildBeltRatSpawnPlan(systemID, options);
  if (!planResult.success || !planResult.data) {
    return {
      success: false,
      spawned: false,
      reason: planResult.errorMsg || "SPAWN_PLAN_FAILED",
      planResult,
    };
  }
  if (
    String(planResult.data.specialSpawnKind || "").toLowerCase() === "capital" &&
    resolvedConfig.capitalMaxActiveGroupsPerSystem > 0
  ) {
    const activeCapitalGroups = countActiveBeltRatCapitalGroupsInSystem(scene);
    if (
      activeCapitalGroups >= resolvedConfig.capitalMaxActiveGroupsPerSystem &&
      options.forceSpawn !== true
    ) {
      return {
        success: true,
        spawned: false,
        reason: "CAPITAL_ACTIVE_SYSTEM_LIMIT",
        activeCapitalGroups,
      };
    }
  }

  state.lastRollAtMs = nowMs;
  const isSpecialSpawn =
    String(planResult.data.specialSpawnKind || "normal").toLowerCase() !== "normal";
  const chance = options.forceSpawn === true
    ? 1
    : isSpecialSpawn
      ? 1
      : resolveSpawnChanceForBand(planResult.data.securityBand, resolvedConfig);
  if (random(options) >= chance) {
    return {
      success: true,
      spawned: false,
      reason: "CHANCE_MISS",
      chance,
      securityBand: planResult.data.securityBand,
      factionKey: planResult.data.factionKey,
      specialSpawnKind: planResult.data.specialSpawnKind,
    };
  }

  const spawnResult = spawnBeltRatGroup(
    scene,
    session,
    beltEntity,
    state,
    planResult.data,
    {
      ...options,
      broadcast: options.broadcast === true,
    },
  );
  if (!spawnResult || spawnResult.success !== true) {
    return {
      success: false,
      spawned: false,
      reason: spawnResult && spawnResult.errorMsg
        ? spawnResult.errorMsg
        : "SPAWN_FAILED",
      spawnResult,
    };
  }

  state.lastSpawnAtMs = nowMs;
  log.debug(
    `[BeltRats] spawned system=${systemID} belt=${beltEntity.itemID} ` +
    `faction=${planResult.data.factionKey} band=${planResult.data.securityBand} ` +
    `kind=${planResult.data.specialSpawnKind || "normal"} ` +
    `count=${spawnResult.data.requestedAmount || planResult.data.definitions.length}`,
  );
  return {
    success: true,
    spawned: true,
    data: spawnResult.data,
  };
}

function maybeSpawnForSessionArrival(scene, session, shipEntity, options = {}) {
  if (!scene || !session || !shipEntity || !shipEntity.position) {
    return {
      success: false,
      spawned: false,
      reason: "SHIP_NOT_FOUND",
    };
  }

  let beltEntity = null;
  const targetEntityID = toPositiveInt(options.targetEntityID, 0);
  if (targetEntityID && typeof scene.getEntityByID === "function") {
    const targetEntity = scene.getEntityByID(targetEntityID);
    if (isAsteroidBeltEntity(targetEntity)) {
      beltEntity = targetEntity;
    }
  }
  if (!beltEntity) {
    beltEntity = findNearestBeltForEntity(scene, shipEntity, options);
  }
  if (!beltEntity) {
    return {
      success: true,
      spawned: false,
      reason: "NOT_AT_BELT",
    };
  }
  return maybeSpawnForBeltArrival(scene, session, beltEntity, options);
}

function resetForTests() {
  beltStateByKey.clear();
  nowProvider = () => Date.now();
  randomProvider = () => Math.random();
}

function configureForTests(options = {}) {
  if (typeof options.nowProvider === "function") {
    nowProvider = options.nowProvider;
  }
  if (typeof options.randomProvider === "function") {
    randomProvider = options.randomProvider;
  }
}

module.exports = {
  OPERATOR_KIND,
  resolveSecurityProfile,
  resolvePirateFactionKeyForSystem,
  buildBeltRatSpawnPlan,
  findNearestBeltForEntity,
  maybeSpawnForBeltArrival,
  maybeSpawnForSessionArrival,
  _testing: {
    resetForTests,
    configureForTests,
    resolveBeltRatConfig,
    countActiveBeltRatGroups,
    countActiveBeltRatCapitalGroupsInSystem,
    buildBeltStateKey,
    getOrCreateBeltState,
    isOfficerEligible,
    isCapitalSpawnEligible,
    buildSpecialBeltRatSpawnPlan,
    applyAsteroidBeltPresentation,
    PROFILE_FAMILIES_BY_FACTION,
    PIRATE_FACTION_BY_REGION_ID,
    OFFICER_HOME_REGION_IDS_BY_FACTION,
    CAPITAL_POOL_QUERY_BY_FACTION,
    ASTEROID_BELT_PRESENTATION_BY_PROFILE_ID,
  },
};
