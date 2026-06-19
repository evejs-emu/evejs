const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));

const TABLE = Object.freeze({
  ITEM_TYPES: "itemTypes",
  CLIENT_TYPE_LISTS: "clientTypeLists",
  CLIENT_ENTITY_STANDINGS: "clientEntityStandings",
  MAP_TAGS_AUTHORITY: "mapTagsAuthority",
  FIGHTER_ABILITIES: "fighterAbilities",
  TYPE_DOGMA: "typeDogma",
  SHIP_TYPES: "shipTypes",
  SHIP_DOGMA_ATTRIBUTES: "shipDogmaAttributes",
  SKILL_TYPES: "skillTypes",
  SOVEREIGNTY_STATIC: "sovereigntyStatic",
  PLANET_SCHEMATICS: "planetSchematics",
  CHARACTER_CREATION_RACES: "characterCreationRaces",
  CHARACTER_CREATION_BLOODLINES: "characterCreationBloodlines",
  CHARACTER_CREATION_SCHOOLS: "characterCreationSchools",
  SOLAR_SYSTEMS: "solarSystems",
  STATIONS: "stations",
  STATION_TYPES: "stationTypes",
  STARGATE_TYPES: "stargateTypes",
  CELESTIALS: "celestials",
  CERTIFICATES: "certificates",
  MAP_NAMES: "mapNames",
  ASTEROID_BELTS: "asteroidBelts",
  ASTEROID_FIELD_STYLES: "asteroidFieldStyles",
  STARGATES: "stargates",
  MOVEMENT_ATTRIBUTES: "movementAttributes",
  EXPLORATION_AUTHORITY: "explorationAuthority",
  EXPLORATION_WORMHOLE_STATIC: "explorationWormholeStatic",
  DUNGEON_AUTHORITY: "dungeonAuthority",
  AGENT_AUTHORITY: "agentAuthority",
  MISSION_AUTHORITY: "missionAuthority",
  NPC_STANDINGS_AUTHORITY: "npcStandingsAuthority",
  STATION_STANDINGS_RESTRICTIONS: "stationStandingsRestrictions",
});

const ROW_KEY = Object.freeze({
  [TABLE.ITEM_TYPES]: "types",
  [TABLE.CLIENT_TYPE_LISTS]: "typeLists",
  [TABLE.CLIENT_ENTITY_STANDINGS]: "types",
  [TABLE.SHIP_TYPES]: "ships",
  [TABLE.SKILL_TYPES]: "skills",
  [TABLE.CHARACTER_CREATION_RACES]: "races",
  [TABLE.CHARACTER_CREATION_BLOODLINES]: "bloodlines",
  [TABLE.CHARACTER_CREATION_SCHOOLS]: "schools",
  [TABLE.SOLAR_SYSTEMS]: "solarSystems",
  [TABLE.STATIONS]: "stations",
  [TABLE.STATION_TYPES]: "stationTypes",
  [TABLE.STARGATE_TYPES]: "stargateTypes",
  [TABLE.CELESTIALS]: "celestials",
  [TABLE.ASTEROID_BELTS]: "belts",
  [TABLE.ASTEROID_FIELD_STYLES]: "fieldStyles",
  [TABLE.STARGATES]: "stargates",
  [TABLE.PLANET_SCHEMATICS]: "schematics",
  [TABLE.MOVEMENT_ATTRIBUTES]: "attributes",
  [TABLE.EXPLORATION_WORMHOLE_STATIC]: "systems",
});

const cache = new Map();

function normalizePayload(tableName, payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  return payload;
}

function readStaticTable(tableName) {
  if (cache.has(tableName)) {
    return cache.get(tableName);
  }

  const result = database.read(tableName, "/");
  if (!result.success) {
    log.warn(
      `[ReferenceData] Failed to load table ${tableName}: ${result.errorMsg || "READ_ERROR"}`,
    );
    const fallback = {};
    cache.set(tableName, fallback);
    return fallback;
  }

  const payload = normalizePayload(tableName, result.data);
  cache.set(tableName, payload);
  return payload;
}

function readStaticRows(tableName) {
  const payload = readStaticTable(tableName);
  const rowKey = ROW_KEY[tableName];
  if (!rowKey) {
    return [];
  }

  const rows = payload[rowKey];
  return Array.isArray(rows) ? rows : [];
}

function clearReferenceCache(tableNames = null) {
  if (!tableNames) {
    cache.clear();
    return;
  }

  const targets = Array.isArray(tableNames) ? tableNames : [tableNames];
  for (const tableName of targets) {
    cache.delete(tableName);
  }
}

module.exports = {
  TABLE,
  readStaticTable,
  readStaticRows,
  clearReferenceCache,
};
