const path = require("path");

const {
  TABLE,
  readStaticRows,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));

const CATEGORY = Object.freeze({
  PLANETARY_INDUSTRY: 41,
  PLANETARY_RESOURCES: 42,
  PLANETARY_COMMODITIES: 43,
});

const GROUP = Object.freeze({
  EXTRACTOR_PINS: 1026,
  COMMAND_PINS: 1027,
  PROCESS_PINS: 1028,
  STORAGE_PINS: 1029,
  SPACEPORT_PINS: 1030,
  RESOURCE_SOLID: 1032,
  RESOURCE_LIQUID: 1033,
  COMMODITY_P2: 1034,
  RESOURCE_ORGANIC: 1035,
  LINK: 1036,
  COMMODITY_P3: 1040,
  COMMODITY_P4: 1041,
  COMMODITY_P1: 1042,
  EXTRACTION_CONTROL_UNIT_PINS: 1063,
});

const ATTRIBUTE = Object.freeze({
  POWER_OUTPUT: 11,
  POWER_LOAD: 15,
  CPU_OUTPUT: 48,
  CPU_LOAD: 49,
  HARVESTER_TYPE: 709,
  LOGISTICAL_CAPACITY: 1631,
  PLANET_RESTRICTION: 1632,
  POWER_LOAD_PER_KM: 1633,
  CPU_LOAD_PER_KM: 1634,
  CPU_LOAD_LEVEL_MODIFIER: 1635,
  POWER_LOAD_LEVEL_MODIFIER: 1636,
  IMPORT_TAX: 1638,
  EXPORT_TAX: 1639,
  IMPORT_TAX_MULTIPLIER: 1640,
  EXPORT_TAX_MULTIPLIER: 1641,
  PIN_EXTRACTION_QUANTITY: 1642,
  PIN_CYCLE_TIME: 1643,
  EXTRACTOR_DEPLETION_RANGE: 1644,
  EXTRACTOR_DEPLETION_RATE: 1645,
  ECU_DECAY_FACTOR: 1683,
  ECU_OVERLAP_FACTOR: 1685,
  ECU_NOISE_FACTOR: 1687,
  ECU_AREA_OF_INFLUENCE: 1689,
  EXTRACTOR_HEAD_CPU: 1690,
  EXTRACTOR_HEAD_POWER: 1691,
});

const RESOURCE_TYPE = Object.freeze({
  MICROORGANISMS: 2073,
  BASE_METALS: 2267,
  AQUEOUS_LIQUIDS: 2268,
  NOBLE_METALS: 2270,
  HEAVY_METALS: 2272,
  PLANKTIC_COLONIES: 2286,
  COMPLEX_ORGANISMS: 2287,
  CARBON_COMPOUNDS: 2288,
  AUTOTROPHS: 2305,
  NON_CS_CRYSTALS: 2306,
  FELSIC_MAGMA: 2307,
  SUSPENDED_PLASMA: 2308,
  IONIC_SOLUTIONS: 2309,
  NOBLE_GAS: 2310,
  REACTIVE_GAS: 2311,
});

const PLANET_RESOURCES_BY_TYPE_ID = Object.freeze({
  11: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.AUTOTROPHS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.COMPLEX_ORGANISMS,
    RESOURCE_TYPE.MICROORGANISMS,
  ],
  12: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.HEAVY_METALS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.NOBLE_GAS,
    RESOURCE_TYPE.PLANKTIC_COLONIES,
  ],
  13: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.IONIC_SOLUTIONS,
    RESOURCE_TYPE.NOBLE_GAS,
    RESOURCE_TYPE.REACTIVE_GAS,
  ],
  2014: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.COMPLEX_ORGANISMS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.PLANKTIC_COLONIES,
  ],
  2015: [
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.FELSIC_MAGMA,
    RESOURCE_TYPE.HEAVY_METALS,
    RESOURCE_TYPE.NON_CS_CRYSTALS,
    RESOURCE_TYPE.SUSPENDED_PLASMA,
  ],
  2016: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.NOBLE_METALS,
  ],
  2017: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.IONIC_SOLUTIONS,
    RESOURCE_TYPE.NOBLE_GAS,
    RESOURCE_TYPE.SUSPENDED_PLASMA,
  ],
  2063: [
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.HEAVY_METALS,
    RESOURCE_TYPE.NOBLE_METALS,
    RESOURCE_TYPE.NON_CS_CRYSTALS,
    RESOURCE_TYPE.SUSPENDED_PLASMA,
  ],
  56018: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.NOBLE_METALS,
  ],
  56019: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.HEAVY_METALS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.NOBLE_GAS,
    RESOURCE_TYPE.PLANKTIC_COLONIES,
  ],
  56020: [
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.FELSIC_MAGMA,
    RESOURCE_TYPE.HEAVY_METALS,
    RESOURCE_TYPE.NON_CS_CRYSTALS,
    RESOURCE_TYPE.SUSPENDED_PLASMA,
  ],
  56021: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.COMPLEX_ORGANISMS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.PLANKTIC_COLONIES,
  ],
  56022: [
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.HEAVY_METALS,
    RESOURCE_TYPE.NOBLE_METALS,
    RESOURCE_TYPE.NON_CS_CRYSTALS,
    RESOURCE_TYPE.SUSPENDED_PLASMA,
  ],
  56023: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.AUTOTROPHS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.COMPLEX_ORGANISMS,
    RESOURCE_TYPE.MICROORGANISMS,
  ],
  56024: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.IONIC_SOLUTIONS,
    RESOURCE_TYPE.NOBLE_GAS,
    RESOURCE_TYPE.SUSPENDED_PLASMA,
  ],
  73911: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.NOBLE_METALS,
  ],
});

const COMMAND_CENTER_INFO_BY_LEVEL = Object.freeze({
  0: Object.freeze({ powerOutput: 6000, cpuOutput: 1675, upgradeCost: 0 }),
  1: Object.freeze({ powerOutput: 9000, cpuOutput: 7057, upgradeCost: 580000 }),
  2: Object.freeze({ powerOutput: 12000, cpuOutput: 12136, upgradeCost: 1510000 }),
  3: Object.freeze({ powerOutput: 15000, cpuOutput: 17215, upgradeCost: 2710000 }),
  4: Object.freeze({ powerOutput: 17000, cpuOutput: 21315, upgradeCost: 4210000 }),
  5: Object.freeze({ powerOutput: 19000, cpuOutput: 25415, upgradeCost: 6310000 }),
});

const PIN_ENTITY_BY_GROUP_ID = Object.freeze({
  [GROUP.COMMAND_PINS]: "command",
  [GROUP.EXTRACTOR_PINS]: "extractor",
  [GROUP.PROCESS_PINS]: "process",
  [GROUP.SPACEPORT_PINS]: "spaceport",
  [GROUP.STORAGE_PINS]: "storage",
  [GROUP.EXTRACTION_CONTROL_UNIT_PINS]: "ecu",
  [GROUP.LINK]: "link",
});

const COMMODITY_TIER_BY_GROUP_ID = Object.freeze({
  [GROUP.COMMODITY_P1]: 1,
  [GROUP.COMMODITY_P2]: 2,
  [GROUP.COMMODITY_P3]: 3,
  [GROUP.COMMODITY_P4]: 4,
});

let itemTypeCache = null;
let typeDogmaCache = null;
let schematicCache = null;

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function getItemTypeByID() {
  if (itemTypeCache) {
    return itemTypeCache;
  }

  itemTypeCache = new Map();
  for (const row of readStaticRows(TABLE.ITEM_TYPES)) {
    const typeID = toInt(row.typeID ?? row._key, 0);
    if (typeID > 0) {
      itemTypeCache.set(typeID, row);
    }
  }
  return itemTypeCache;
}

function getTypeDogmaByID() {
  if (typeDogmaCache) {
    return typeDogmaCache;
  }

  const payload = readStaticTable(TABLE.TYPE_DOGMA);
  const rows = payload && payload.typesByTypeID && typeof payload.typesByTypeID === "object"
    ? payload.typesByTypeID
    : {};
  typeDogmaCache = new Map(
    Object.entries(rows).map(([typeID, row]) => [toInt(typeID, 0), row]),
  );
  return typeDogmaCache;
}

function normalizeSchematicRow(row = {}) {
  return {
    schematicID: toInt(row.schematicID ?? row._key, 0),
    name: String(row.name && row.name.en ? row.name.en : row.name || ""),
    cycleTime: toInt(row.cycleTime, 0),
    pinTypeIDs: [...new Set(
      (Array.isArray(row.pinTypeIDs) ? row.pinTypeIDs : row.pins || [])
        .map((typeID) => toInt(typeID, 0))
        .filter((typeID) => typeID > 0),
    )].sort((left, right) => left - right),
    inputs: (Array.isArray(row.inputs) ? row.inputs : [])
      .map((entry) => ({
        typeID: toInt(entry.typeID ?? entry._key, 0),
        quantity: toInt(entry.quantity, 0),
      }))
      .filter((entry) => entry.typeID > 0 && entry.quantity > 0)
      .sort((left, right) => left.typeID - right.typeID),
    outputs: (Array.isArray(row.outputs) ? row.outputs : [])
      .map((entry) => ({
        typeID: toInt(entry.typeID ?? entry._key, 0),
        quantity: toInt(entry.quantity, 0),
      }))
      .filter((entry) => entry.typeID > 0 && entry.quantity > 0)
      .sort((left, right) => left.typeID - right.typeID),
  };
}

function getSchematicCache() {
  if (schematicCache) {
    return schematicCache;
  }

  const schematics = readStaticRows(TABLE.PLANET_SCHEMATICS)
    .map(normalizeSchematicRow)
    .filter((row) => row.schematicID > 0);
  const byID = new Map();
  const byOutputTypeID = new Map();
  const byPinTypeID = new Map();

  for (const schematic of schematics) {
    byID.set(schematic.schematicID, schematic);
    for (const output of schematic.outputs) {
      if (!byOutputTypeID.has(output.typeID)) {
        byOutputTypeID.set(output.typeID, []);
      }
      byOutputTypeID.get(output.typeID).push(schematic);
    }
    for (const pinTypeID of schematic.pinTypeIDs) {
      if (!byPinTypeID.has(pinTypeID)) {
        byPinTypeID.set(pinTypeID, []);
      }
      byPinTypeID.get(pinTypeID).push(schematic);
    }
  }

  schematicCache = { schematics, byID, byOutputTypeID, byPinTypeID };
  return schematicCache;
}

function getType(typeID) {
  return getItemTypeByID().get(toInt(typeID, 0)) || null;
}

function getTypeDogma(typeID) {
  return getTypeDogmaByID().get(toInt(typeID, 0)) || null;
}

function getTypeAttributes(typeID) {
  const dogma = getTypeDogma(typeID);
  return dogma && dogma.attributes && typeof dogma.attributes === "object"
    ? dogma.attributes
    : {};
}

function getTypeAttribute(typeID, attributeID, fallback = 0) {
  const attributes = getTypeAttributes(typeID);
  const value = attributes[String(toInt(attributeID, 0))];
  return value === undefined || value === null ? fallback : toNumber(value, fallback);
}

function getPinEntityType(typeID) {
  const type = getType(typeID);
  return type ? PIN_ENTITY_BY_GROUP_ID[toInt(type.groupID, 0)] || null : null;
}

function getProcessorTier(typeID) {
  if (getPinEntityType(typeID) !== "process") {
    return null;
  }
  const typeName = String((getType(typeID) || {}).name || "").toLowerCase();
  if (typeName.includes("basic")) {
    return "basic";
  }
  if (typeName.includes("advanced")) {
    return "advanced";
  }
  if (typeName.includes("high-tech")) {
    return "highTech";
  }
  return null;
}

function getCommodityTier(typeID) {
  const type = getType(typeID);
  if (!type) {
    return null;
  }
  if (toInt(type.categoryID, 0) === CATEGORY.PLANETARY_RESOURCES) {
    return 0;
  }
  return COMMODITY_TIER_BY_GROUP_ID[toInt(type.groupID, 0)] ?? null;
}

function isPlanetaryCommodity(typeID) {
  const type = getType(typeID);
  return Boolean(type && toInt(type.categoryID, 0) === CATEGORY.PLANETARY_COMMODITIES);
}

function isPlanetaryResource(typeID) {
  const type = getType(typeID);
  return Boolean(type && toInt(type.categoryID, 0) === CATEGORY.PLANETARY_RESOURCES);
}

function isPlanetaryIndustryType(typeID) {
  const type = getType(typeID);
  return Boolean(type && toInt(type.categoryID, 0) === CATEGORY.PLANETARY_INDUSTRY);
}

function getPlanetResourceTypeIDs(planetTypeID) {
  return [...(PLANET_RESOURCES_BY_TYPE_ID[toInt(planetTypeID, 0)] || [])];
}

function getCommandCenterInfo(level) {
  return COMMAND_CENTER_INFO_BY_LEVEL[toInt(level, 0)] || null;
}

function getCommandCenterUpgradeCost(currentLevel, desiredLevel) {
  const current = getCommandCenterInfo(currentLevel);
  const desired = getCommandCenterInfo(desiredLevel);
  if (!current || !desired) {
    return 0;
  }
  return desired.upgradeCost - current.upgradeCost;
}

function getTypeBasePrice(typeID) {
  const type = getType(typeID);
  const basePrice = Number(type && type.basePrice);
  return Number.isFinite(basePrice) && basePrice > 0 ? basePrice : 0;
}

function getCPUAndPowerForPinType(typeID) {
  return {
    cpuUsage: toInt(getTypeAttribute(typeID, ATTRIBUTE.CPU_LOAD, 0), 0),
    powerUsage: toInt(getTypeAttribute(typeID, ATTRIBUTE.POWER_LOAD, 0), 0),
    cpuOutput: toInt(getTypeAttribute(typeID, ATTRIBUTE.CPU_OUTPUT, 0), 0),
    powerOutput: toInt(getTypeAttribute(typeID, ATTRIBUTE.POWER_OUTPUT, 0), 0),
  };
}

function getUsageParametersForLinkType(typeID) {
  return {
    basePowerUsage: toInt(getTypeAttribute(typeID, ATTRIBUTE.POWER_LOAD, 0), 0),
    baseCpuUsage: toInt(getTypeAttribute(typeID, ATTRIBUTE.CPU_LOAD, 0), 0),
    powerUsagePerKm: getTypeAttribute(typeID, ATTRIBUTE.POWER_LOAD_PER_KM, 0),
    cpuUsagePerKm: getTypeAttribute(typeID, ATTRIBUTE.CPU_LOAD_PER_KM, 0),
    powerUsageLevelModifier: getTypeAttribute(typeID, ATTRIBUTE.POWER_LOAD_LEVEL_MODIFIER, 0),
    cpuUsageLevelModifier: getTypeAttribute(typeID, ATTRIBUTE.CPU_LOAD_LEVEL_MODIFIER, 0),
    logisticalCapacity: getTypeAttribute(typeID, ATTRIBUTE.LOGISTICAL_CAPACITY, 0),
  };
}

function getPITypeInfo(typeID) {
  const normalizedTypeID = toInt(typeID, 0);
  const type = getType(normalizedTypeID);
  if (!type) {
    return null;
  }
  const categoryID = toInt(type.categoryID, 0);
  const groupID = toInt(type.groupID, 0);
  if (
    categoryID !== CATEGORY.PLANETARY_INDUSTRY &&
    categoryID !== CATEGORY.PLANETARY_RESOURCES &&
    categoryID !== CATEGORY.PLANETARY_COMMODITIES
  ) {
    return null;
  }

  return {
    typeID: normalizedTypeID,
    typeName: String(type.name || ""),
    groupID,
    categoryID,
    published: type.published === true,
    capacity: type.capacity ?? null,
    volume: type.volume ?? null,
    basePrice: type.basePrice ?? null,
    pinEntityType: getPinEntityType(normalizedTypeID),
    processorTier: getProcessorTier(normalizedTypeID),
    commodityTier: getCommodityTier(normalizedTypeID),
    planetRestrictionTypeID: toInt(
      getTypeAttribute(normalizedTypeID, ATTRIBUTE.PLANET_RESTRICTION, 0),
      0,
    ) || null,
    attributes: getTypeAttributes(normalizedTypeID),
  };
}

function listPITypeInfos() {
  return [...getItemTypeByID().keys()]
    .map(getPITypeInfo)
    .filter(Boolean)
    .sort((left, right) => left.typeID - right.typeID);
}

function getAllSchematics() {
  return [...getSchematicCache().schematics];
}

function getSchematicByID(schematicID) {
  return getSchematicCache().byID.get(toInt(schematicID, 0)) || null;
}

function getSchematicsByOutputTypeID(typeID) {
  return [...(getSchematicCache().byOutputTypeID.get(toInt(typeID, 0)) || [])];
}

function getSchematicsForPinType(typeID) {
  return [...(getSchematicCache().byPinTypeID.get(toInt(typeID, 0)) || [])];
}

function clearCaches() {
  itemTypeCache = null;
  typeDogmaCache = null;
  schematicCache = null;
}

module.exports = {
  CATEGORY,
  GROUP,
  ATTRIBUTE,
  RESOURCE_TYPE,
  PLANET_RESOURCES_BY_TYPE_ID,
  COMMAND_CENTER_INFO_BY_LEVEL,
  getType,
  getTypeDogma,
  getTypeAttributes,
  getTypeAttribute,
  getPinEntityType,
  getProcessorTier,
  getCommodityTier,
  isPlanetaryCommodity,
  isPlanetaryResource,
  isPlanetaryIndustryType,
  getPlanetResourceTypeIDs,
  getCommandCenterInfo,
  getCommandCenterUpgradeCost,
  getTypeBasePrice,
  getCPUAndPowerForPinType,
  getUsageParametersForLinkType,
  getPITypeInfo,
  listPITypeInfos,
  getAllSchematics,
  getSchematicByID,
  getSchematicsByOutputTypeID,
  getSchematicsForPinType,
  clearCaches,
};
