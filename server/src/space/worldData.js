const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../services/_shared/referenceData"));

let cache = null;

function getStructureState() {
  return require(path.join(__dirname, "../services/structure/structureState"));
}

function buildMaps() {
  const solarSystems = readStaticRows(TABLE.SOLAR_SYSTEMS);
  const stations = readStaticRows(TABLE.STATIONS);
  const stationTypes = readStaticRows(TABLE.STATION_TYPES);
  const stargateTypes = readStaticRows(TABLE.STARGATE_TYPES);
  const celestials = readStaticRows(TABLE.CELESTIALS);
  const asteroidBelts = readStaticRows(TABLE.ASTEROID_BELTS);
  const stargates = readStaticRows(TABLE.STARGATES);
  const attributes = readStaticRows(TABLE.MOVEMENT_ATTRIBUTES);

  const solarSystemsById = new Map();
  const stationsById = new Map();
  const stationTypesById = new Map();
  const stargateTypesById = new Map();
  const celestialsById = new Map();
  const asteroidBeltsById = new Map();
  const stationsBySystem = new Map();
  const celestialsBySystem = new Map();
  const asteroidBeltsBySystem = new Map();
  const stargatesById = new Map();
  const stargatesBySystem = new Map();
  const movementByTypeId = new Map();

  for (const system of solarSystems) {
    solarSystemsById.set(system.solarSystemID, system);
  }

  for (const station of stations) {
    stationsById.set(station.stationID, station);
    if (!stationsBySystem.has(station.solarSystemID)) {
      stationsBySystem.set(station.solarSystemID, []);
    }
    stationsBySystem.get(station.solarSystemID).push(station);
  }

  for (const stationType of stationTypes) {
    stationTypesById.set(stationType.stationTypeID, stationType);
  }

  for (const stargateType of stargateTypes) {
    stargateTypesById.set(stargateType.typeID, stargateType);
  }

  for (const celestial of celestials) {
    celestialsById.set(celestial.itemID, celestial);
    if (!celestialsBySystem.has(celestial.solarSystemID)) {
      celestialsBySystem.set(celestial.solarSystemID, []);
    }
    celestialsBySystem.get(celestial.solarSystemID).push(celestial);
  }

  for (const asteroidBelt of asteroidBelts) {
    asteroidBeltsById.set(asteroidBelt.itemID, asteroidBelt);
    if (!asteroidBeltsBySystem.has(asteroidBelt.solarSystemID)) {
      asteroidBeltsBySystem.set(asteroidBelt.solarSystemID, []);
    }
    asteroidBeltsBySystem.get(asteroidBelt.solarSystemID).push(asteroidBelt);
  }

  for (const stargate of stargates) {
    stargatesById.set(stargate.itemID, stargate);
    if (!stargatesBySystem.has(stargate.solarSystemID)) {
      stargatesBySystem.set(stargate.solarSystemID, []);
    }
    stargatesBySystem.get(stargate.solarSystemID).push(stargate);
  }

  for (const attribute of attributes) {
    movementByTypeId.set(attribute.typeID, attribute);
  }

  for (const value of stationsBySystem.values()) {
    value.sort((left, right) => left.stationID - right.stationID);
  }
  for (const value of celestialsBySystem.values()) {
    value.sort((left, right) => left.itemID - right.itemID);
  }
  for (const value of asteroidBeltsBySystem.values()) {
    value.sort((left, right) => left.itemID - right.itemID);
  }
  for (const value of stargatesBySystem.values()) {
    value.sort((left, right) => left.itemID - right.itemID);
  }

  return {
    solarSystems,
    stations,
    stationTypes,
    stargateTypes,
    celestials,
    asteroidBelts,
    stargates,
    attributes,
    solarSystemsById,
    stationsById,
    stationTypesById,
    stargateTypesById,
    celestialsById,
    asteroidBeltsById,
    stationsBySystem,
    celestialsById,
    celestialsBySystem,
    asteroidBeltsBySystem,
    stargatesById,
    stargatesBySystem,
    movementByTypeId,
  };
}

function ensureLoaded() {
  if (!cache) {
    cache = buildMaps();
    log.info(
      `[SpaceWorld] Loaded ${cache.solarSystems.length} systems, ${cache.stations.length} stations, ${cache.stationTypes.length} station types, ${cache.celestials.length} celestials, ${cache.asteroidBelts.length} asteroid belts, ${cache.stargates.length} stargates`,
    );
  }

  return cache;
}

function getSolarSystemByID(solarSystemID) {
  return ensureLoaded().solarSystemsById.get(Number(solarSystemID)) || null;
}

function getSolarSystems() {
  return [...ensureLoaded().solarSystems];
}

function getStationByID(stationID) {
  return ensureLoaded().stationsById.get(Number(stationID)) || null;
}

function getStationsForOwner(ownerID) {
  const numericOwnerID = Number(ownerID) || 0;
  if (!numericOwnerID) {
    return [];
  }

  return ensureLoaded().stations.filter((station) => (
    Number(station.corporationID || station.ownerID || 0) === numericOwnerID
  ));
}

function getStationTypeByID(stationTypeID) {
  return ensureLoaded().stationTypesById.get(Number(stationTypeID)) || null;
}

function getStargateTypeByID(typeID) {
  return ensureLoaded().stargateTypesById.get(Number(typeID)) || null;
}

function getStationsForSystem(solarSystemID) {
  return [
    ...(ensureLoaded().stationsBySystem.get(Number(solarSystemID)) || []),
  ];
}

function getAsteroidBeltsForSystem(solarSystemID) {
  return [
    ...(ensureLoaded().asteroidBeltsBySystem.get(Number(solarSystemID)) || []),
  ];
}

function getAsteroidBeltByID(asteroidBeltID) {
  return ensureLoaded().asteroidBeltsById.get(Number(asteroidBeltID)) || null;
}

function getCelestialsForSystem(solarSystemID) {
  return [
    ...(ensureLoaded().celestialsBySystem.get(Number(solarSystemID)) || []),
  ];
}

function getCelestialByID(celestialID) {
  return ensureLoaded().celestialsById.get(Number(celestialID)) || null;
}

function getStargatesForSystem(solarSystemID) {
  return [
    ...(ensureLoaded().stargatesBySystem.get(Number(solarSystemID)) || []),
  ];
}

function getStructureByID(structureID) {
  return getStructureState().getStructureByID(structureID);
}

function getStructuresForSystem(solarSystemID) {
  return getStructureState().listStructuresForSystem(solarSystemID);
}

function getStaticSceneForSystem(solarSystemID) {
  const numericSystemID = Number(solarSystemID);
  return [
    ...getStationsForSystem(numericSystemID),
    ...getStructuresForSystem(numericSystemID),
    ...getAsteroidBeltsForSystem(numericSystemID),
    ...getCelestialsForSystem(numericSystemID),
    ...getStargatesForSystem(numericSystemID),
  ];
}

function getStargateByID(stargateID) {
  return ensureLoaded().stargatesById.get(Number(stargateID)) || null;
}

function getMovementAttributesForType(typeID) {
  return ensureLoaded().movementByTypeId.get(Number(typeID)) || null;
}

module.exports = {
  ensureLoaded,
  getSolarSystems,
  getSolarSystemByID,
  getStationByID,
  getStationsForOwner,
  getStationTypeByID,
  getStargateTypeByID,
  getStationsForSystem,
  getAsteroidBeltByID,
  getAsteroidBeltsForSystem,
  getCelestialByID,
  getStructureByID,
  getStructuresForSystem,
  getCelestialsForSystem,
  getStargatesForSystem,
  getStaticSceneForSystem,
  getStargateByID,
  getMovementAttributesForType,
};
