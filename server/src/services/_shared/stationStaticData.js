const path = require("path");

const { currentFileTime } = require(path.join(
  __dirname,
  "./serviceHelpers",
));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const structureState = require(path.join(
  __dirname,
  "../structure/structureState",
));
const structureLocatorGeometry = require(path.join(
  __dirname,
  "../structure/structureLocatorGeometry",
));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
} = require(path.join(__dirname, "../structure/structureConstants"));
const {
  getSessionStructureID,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  getOwnerLookupRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  getFactionRecord,
  getFactionRecordByCorporationID,
} = require(path.join(__dirname, "../faction/factionState"));
const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "./referenceData"));

const DEFAULT_STATION = {
  stationID: 60003760,
  stationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
  orbitID: 40009077,
  description: "Primary trade hub station for this EveJS Elysian sandbox.",
  solarSystemID: 30000142,
  solarSystemName: "Jita",
  constellationID: 20000020,
  constellationName: "Kimotoro",
  regionID: 10000002,
  regionName: "The Forge",
  ownerID: 1000035,
  ownerName: "Caldari Navy",
  corporationID: 1000035,
  corporationName: "Caldari Navy",
  corporationTicker: "CN",
  factionID: 500001,
  factionName: "Caldari State",
  stationTypeID: 1529,
  operationID: 22,
  security: 0.9,
  dockingCostPerVolume: 0.0,
  officeRentalCost: 10000,
  reprocessingStationsTake: 0.05,
  reprocessingHangarFlag: 4,
  maxShipVolumeDockable: 50000000,
  upgradeLevel: 0,
};

const NPC_OWNER_OVERRIDES = Object.freeze({
  1000006: {
    ownerID: 1000006,
    ownerName: "Science and Trade Institute",
    typeID: 2,
    gender: 0,
    tickerName: "STI",
  },
  1000009: {
    ownerID: 1000009,
    ownerName: "Center for Advanced Studies",
    typeID: 2,
    gender: 0,
    tickerName: "CAS",
  },
  1000035: {
    ownerID: 1000035,
    ownerName: DEFAULT_STATION.ownerName,
    typeID: 2,
    gender: 0,
    tickerName: DEFAULT_STATION.corporationTicker,
  },
  1000044: {
    ownerID: 1000044,
    ownerName: "State War Academy",
    typeID: 2,
    gender: 0,
    tickerName: "SWA",
  },
  1000115: {
    ownerID: 1000115,
    ownerName: "Republic Military School",
    typeID: 2,
    gender: 0,
    tickerName: "RMS",
  },
  500001: {
    ownerID: 500001,
    ownerName: DEFAULT_STATION.factionName,
    typeID: 30,
    gender: 0,
    tickerName: null,
  },
});

const STATION_SERVICES = [
  {
    serviceID: 16,
    serviceName: "Office Rental",
    serviceNameID: null,
    stationServiceItemID: 28156,
  },
  {
    serviceID: 512,
    serviceName: "Cloning",
    serviceNameID: null,
    stationServiceItemID: 28158,
  },
  {
    serviceID: 4096,
    serviceName: "Repair Facilities",
    serviceNameID: null,
    stationServiceItemID: 28159,
  },
  {
    serviceID: 8192,
    serviceName: "Reprocessing Plant",
    serviceNameID: null,
    stationServiceItemID: 28157,
  },
  {
    serviceID: 16384,
    serviceName: "Market",
    serviceNameID: null,
    stationServiceItemID: 28166,
  },
  {
    serviceID: 65536,
    serviceName: "Fitting",
    serviceNameID: null,
    stationServiceItemID: 28155,
  },
  {
    serviceID: 1048576,
    serviceName: "Insurance",
    serviceNameID: null,
    stationServiceItemID: 0,
  },
];

const STATION_SERVICE_TO_STRUCTURE_SERVICE_ID = Object.freeze({
  16: STRUCTURE_SERVICE_ID.OFFICES,
  512: STRUCTURE_SERVICE_ID.MEDICAL,
  4096: STRUCTURE_SERVICE_ID.REPAIR,
  8192: STRUCTURE_SERVICE_ID.REPROCESSING,
  16384: STRUCTURE_SERVICE_ID.MARKET,
  65536: STRUCTURE_SERVICE_ID.FITTING,
  1048576: STRUCTURE_SERVICE_ID.INSURANCE,
});

let cachedStandingsRestrictions = null;

function normalizeRestrictionsPayload(payload = {}) {
  return {
    restrictionsByOwnerID:
      payload && typeof payload.restrictionsByOwnerID === "object"
        ? payload.restrictionsByOwnerID
        : {},
  };
}

function getStandingsRestrictions() {
  if (cachedStandingsRestrictions) {
    return cachedStandingsRestrictions;
  }

  const payload = normalizeRestrictionsPayload(
    readStaticTable(TABLE.STATION_STANDINGS_RESTRICTIONS),
  );
  cachedStandingsRestrictions = payload.restrictionsByOwnerID || {};
  return cachedStandingsRestrictions;
}

function clearStationStaticDataCache() {
  cachedStandingsRestrictions = null;
}

function resolveFactionIdentity(corporationID, fallbackFactionID = null) {
  const factionRecord = getFactionRecordByCorporationID(corporationID);
  if (factionRecord) {
    return {
      factionID: factionRecord.factionID,
      factionName: factionRecord.name,
    };
  }

  const fallbackRecord = getFactionRecord(fallbackFactionID);
  if (fallbackRecord) {
    return {
      factionID: fallbackRecord.factionID,
      factionName: fallbackRecord.name,
    };
  }

  return {
    factionID: fallbackFactionID || null,
    factionName: DEFAULT_STATION.factionName,
  };
}

function getStationRecord(session = null, overrideStationID = null) {
  const stationID =
    overrideStationID ||
    (session && (session.stationid || session.stationID || session.locationid)) ||
    DEFAULT_STATION.stationID;

  const structureID =
    overrideStationID ||
    getSessionStructureID(session) ||
    null;
  const structure =
    structureID && !worldData.getStationByID(structureID)
      ? structureState.getStructureByID(structureID)
      : null;
  if (structure) {
    const dockingGeometry = structureLocatorGeometry.buildStructureDockingGeometry(
      structure,
      {
        selectionStrategy: "first",
      },
    );
    const ownerRecord =
      getOwnerLookupRecord(structure.ownerCorpID) ||
      NPC_OWNER_OVERRIDES[structure.ownerCorpID] ||
      null;
    const factionIdentity = resolveFactionIdentity(
      structure.ownerCorpID,
      DEFAULT_STATION.factionID,
    );
    const solarSystem = worldData.getSolarSystemByID(structure.solarSystemID);
    return {
      ...DEFAULT_STATION,
      stationID: structure.structureID,
      stationName: structure.itemName || structure.name || `Structure ${structure.structureID}`,
      stationTypeID: structure.typeID,
      solarSystemID: structure.solarSystemID,
      solarSystemName:
        (solarSystem && solarSystem.solarSystemName) ||
        DEFAULT_STATION.solarSystemName,
      constellationID: structure.constellationID,
      regionID: structure.regionID,
      ownerID: structure.ownerCorpID,
      ownerName: ownerRecord ? ownerRecord.ownerName : DEFAULT_STATION.ownerName,
      corporationID: structure.ownerCorpID,
      corporationName: ownerRecord
        ? ownerRecord.ownerName
        : DEFAULT_STATION.corporationName,
      corporationTicker: ownerRecord ? ownerRecord.tickerName : DEFAULT_STATION.corporationTicker,
      factionID: factionIdentity.factionID,
      factionName: factionIdentity.factionName,
      orbitID: structure.structureID,
      x: structure.position && structure.position.x ? structure.position.x : 0,
      y: structure.position && structure.position.y ? structure.position.y : 0,
      z: structure.position && structure.position.z ? structure.position.z : 0,
      position: structure.position,
      dockPosition: dockingGeometry.dockPosition,
      dockOrientation: dockingGeometry.dockOrientation,
      undockDirection: dockingGeometry.undockDirection,
      undockPosition: dockingGeometry.undockPosition,
      dunRotation: dockingGeometry.dunRotation,
      isStructure: true,
      structureID: structure.structureID,
      structureTypeID: structure.typeID,
      structureState: structure.state,
      structureUpkeepState: structure.upkeepState,
      serviceStates: structure.serviceStates || {},
    };
  }

  const station = worldData.getStationByID(stationID);
  if (station) {
    const ownerRecord =
      getOwnerLookupRecord(station.corporationID) ||
      getOwnerLookupRecord(station.ownerID) ||
      NPC_OWNER_OVERRIDES[station.corporationID] ||
      NPC_OWNER_OVERRIDES[station.ownerID] ||
      null;
    const factionIdentity = resolveFactionIdentity(
      station.corporationID || station.ownerID,
      DEFAULT_STATION.factionID,
    );
    const solarSystem = worldData.getSolarSystemByID(station.solarSystemID);
    return {
      ...DEFAULT_STATION,
      ...station,
      stationID: station.stationID,
      stationName: station.stationName,
      stationTypeID: station.stationTypeID,
      solarSystemID: station.solarSystemID,
      solarSystemName:
        (solarSystem && solarSystem.solarSystemName) ||
        DEFAULT_STATION.solarSystemName,
      constellationID: station.constellationID,
      regionID: station.regionID,
      ownerID: station.corporationID,
      ownerName: ownerRecord ? ownerRecord.ownerName : DEFAULT_STATION.ownerName,
      corporationID: station.corporationID,
      corporationName: ownerRecord
        ? ownerRecord.ownerName
        : DEFAULT_STATION.corporationName,
      corporationTicker: ownerRecord ? ownerRecord.tickerName : DEFAULT_STATION.corporationTicker,
      factionID: factionIdentity.factionID,
      factionName: factionIdentity.factionName,
      security: Number(station.security || 0),
      orbitID: station.orbitID || null,
      x: station.position && station.position.x ? station.position.x : 0,
      y: station.position && station.position.y ? station.position.y : 0,
      z: station.position && station.position.z ? station.position.z : 0,
    };
  }

  return {
    ...DEFAULT_STATION,
    stationID,
    solarSystemID:
      (session && (session.solarsystemid2 || session.solarsystemid)) ||
      DEFAULT_STATION.solarSystemID,
    constellationID:
      (session && session.constellationID) || DEFAULT_STATION.constellationID,
    regionID: (session && session.regionID) || DEFAULT_STATION.regionID,
  };
}

function getStaticOwnerRecord(ownerID, session = null) {
  const numericOwnerID = Number(ownerID) || 0;
  if (!numericOwnerID) {
    return null;
  }

  const station = getStationRecord(session);
  const dynamicOwnerRecord = getOwnerLookupRecord(numericOwnerID);
  if (dynamicOwnerRecord) {
    return dynamicOwnerRecord;
  }

  if (
    numericOwnerID === station.ownerID ||
    numericOwnerID === station.corporationID
  ) {
    return {
      ownerID: numericOwnerID,
      ownerName: station.corporationName || station.ownerName,
      typeID: 2,
      gender: 0,
      tickerName: station.corporationTicker || null,
    };
  }

  if (numericOwnerID === station.factionID) {
    return {
      ownerID: numericOwnerID,
      ownerName: station.factionName,
      typeID: 30,
      gender: 0,
      tickerName: null,
    };
  }

  return NPC_OWNER_OVERRIDES[numericOwnerID] || null;
}

function getStationServiceIdentifiers() {
  return STATION_SERVICES.map((service) => ({ ...service }));
}

function getStationServiceStates(session = null, overrideStationID = null) {
  const station = getStationRecord(session, overrideStationID);
  return STATION_SERVICES.map((service) => ({
    solarSystemID: station.solarSystemID,
    stationID: station.stationID,
    serviceID: service.serviceID,
    stationServiceItemID: service.stationServiceItemID,
    isEnabled: stationServiceIsEnabledForStationRecord(station, service.serviceID) ? 1 : 0,
  }));
}

function getStationServiceAccessRule(serviceID, ownerID = null) {
  const normalizedOwnerID = Number(ownerID) || null;
  const restrictionsByOwnerID = getStandingsRestrictions();
  const ownerRules = normalizedOwnerID
    ? restrictionsByOwnerID[String(normalizedOwnerID)] || restrictionsByOwnerID[normalizedOwnerID]
    : null;
  const minimumStanding = ownerRules && ownerRules[serviceID] != null
    ? Number(ownerRules[serviceID]) || 0
    : 0;

  return {
    serviceID: Number(serviceID) || 0,
    minimumStanding,
    minimumCharSecurity: 0.0,
    maximumCharSecurity: 0.0,
    minimumCorpSecurity: 0.0,
    maximumCorpSecurity: 0.0,
  };
}

function getStationManagementServiceCostModifiers() {
  return STATION_SERVICES.map((service) => ({
    serviceID: service.serviceID,
    discountPerGoodStandingPoint: 0.0,
    surchargePerBadStandingPoint: 0.0,
  }));
}

function getRentableItems(session = null, overrideStationID = null) {
  const station = getStationRecord(session, overrideStationID);
  return [
    {
      stationID: station.stationID,
      typeID: 27,
      rentedToID: null,
      publiclyAvailable: true,
    },
  ];
}

function buildStationServiceMask(session = null, overrideStationID = null) {
  const station = getStationRecord(session, overrideStationID);
  return STATION_SERVICES.reduce(
    (mask, service) =>
      stationServiceIsEnabledForStationRecord(station, service.serviceID)
        ? mask | Number(service.serviceID)
        : mask,
    0,
  );
}

function stationServiceIsEnabledForStationRecord(station, stationServiceID) {
  if (!station || station.isStructure !== true) {
    return true;
  }
  const structureServiceID =
    STATION_SERVICE_TO_STRUCTURE_SERVICE_ID[Number(stationServiceID) || 0];
  if (!structureServiceID) {
    return false;
  }
  return (
    Number(
      station.serviceStates &&
      station.serviceStates[String(structureServiceID)],
    ) === STRUCTURE_SERVICE_STATE.ONLINE
  );
}

module.exports = {
  DEFAULT_STATION,
  NPC_OWNER_OVERRIDES,
  STATION_SERVICES,
  STATION_SERVICE_TO_STRUCTURE_SERVICE_ID,
  clearStationStaticDataCache,
  getStationRecord,
  getStaticOwnerRecord,
  getStationServiceIdentifiers,
  getStationServiceStates,
  getStationServiceAccessRule,
  getStationManagementServiceCostModifiers,
  getRentableItems,
  buildStationServiceMask,
  stationServiceIsEnabledForStationRecord,
  currentFileTime,
};
