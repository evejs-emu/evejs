const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  isSovereigntyClaimableSolarSystem,
} = require(path.join(__dirname, "./sovSystemRules"));
const {
  buildSovereigntyStaticSnapshotFromAuthority,
} = require(path.join(__dirname, "./sovStaticAuthority"));

const PLANET_DEFINITION_VERSION = Object.freeze({
  major: 24,
  minor: 1,
  patch: 0,
  prerelease_tags: [],
  build_tags: ["evejs", "ccp-equinox-resource-data4", "client-3396210"],
});

const UPGRADE_GROUP_IDS = new Set([4768, 4772, 4838, 4839]);
const FALLBACK_STAR_POWER_MIN = 500;
const FALLBACK_STAR_POWER_MAX = 1000;
const FALLBACK_STAR_POWER_BY_SPECTRAL_PREFIX = Object.freeze({
  O: 1000,
  B: 1000,
  A: 850,
  F: 780,
  G: 740,
  K: 620,
  M: 500,
});

const PLANET_FAKE_BY_REMAINDER = Object.freeze({
  0: Object.freeze({
    power: 0,
    workforce: 0,
    reagentDefinitions: [
      Object.freeze({
        reagentTypeID: 81143,
        amountPerCycle: 2001,
        cyclePeriodSeconds: 161,
        securedPercentage: 50,
        securedCapacity: 501,
        unsecuredCapacity: 601,
        securedStock: 40,
        unsecuredStock: 60,
      }),
    ],
  }),
  1: Object.freeze({
    power: 100,
    workforce: 0,
    reagentDefinitions: [],
  }),
  2: Object.freeze({
    power: 0,
    workforce: 500,
    reagentDefinitions: [],
  }),
  3: Object.freeze({
    power: 0,
    workforce: 0,
    reagentDefinitions: [
      Object.freeze({
        reagentTypeID: 81144,
        amountPerCycle: 1,
        cyclePeriodSeconds: 10,
        securedPercentage: 60,
        securedCapacity: 50,
        unsecuredCapacity: 1001,
        securedStock: 10,
        unsecuredStock: 100,
      }),
    ],
  }),
});

const PLANET_FAKE_OVERRIDES = Object.freeze({
  40030269: PLANET_FAKE_BY_REMAINDER[0],
  40239109: PLANET_FAKE_BY_REMAINDER[1],
  40239111: PLANET_FAKE_BY_REMAINDER[0],
  40239114: PLANET_FAKE_BY_REMAINDER[1],
  40239179: PLANET_FAKE_BY_REMAINDER[3],
  40239204: PLANET_FAKE_BY_REMAINDER[2],
  40267585: PLANET_FAKE_BY_REMAINDER[0],
  40267586: PLANET_FAKE_BY_REMAINDER[3],
  40267589: Object.freeze({ power: 0, workforce: 100, reagentDefinitions: [] }),
  40267590: Object.freeze({ power: 0, workforce: 50, reagentDefinitions: [] }),
  40267593: Object.freeze({ power: 0, workforce: 150, reagentDefinitions: [] }),
  40267597: PLANET_FAKE_BY_REMAINDER[0],
  40267600: Object.freeze({ power: 0, workforce: 400, reagentDefinitions: [] }),
  40267881: Object.freeze({ power: 0, workforce: 200, reagentDefinitions: [] }),
  40267883: Object.freeze({ power: 0, workforce: 500, reagentDefinitions: [] }),
  40267886: Object.freeze({ power: 100, workforce: 0, reagentDefinitions: [] }),
  40267909: Object.freeze({ power: 50, workforce: 0, reagentDefinitions: [] }),
  40267915: Object.freeze({ power: 25, workforce: 0, reagentDefinitions: [] }),
  40267940: PLANET_FAKE_BY_REMAINDER[3],
  40267943: Object.freeze({ power: 0, workforce: 375, reagentDefinitions: [] }),
});

const UPGRADE_FAKE_BY_REMAINDER = Object.freeze({
  0: Object.freeze({
    powerRequired: 100,
    workforceRequired: 200,
    fuelTypeID: 81144,
    fuelConsumptionPerHour: 5,
    fuelStartupCost: 1,
    mutuallyExclusiveGroup: "mutually_exclusive_group_A",
    powerProduced: 0,
    workforceProduced: 0,
  }),
  1: Object.freeze({
    powerRequired: 10,
    workforceRequired: 20,
    fuelTypeID: 81143,
    fuelConsumptionPerHour: 3,
    fuelStartupCost: 2,
    mutuallyExclusiveGroup: "mutually_exclusive_group_A",
    powerProduced: 0,
    workforceProduced: 0,
  }),
  2: Object.freeze({
    powerRequired: 30,
    workforceRequired: 15,
    fuelTypeID: 1230,
    fuelConsumptionPerHour: 1,
    fuelStartupCost: 1,
    mutuallyExclusiveGroup: "mutually_exclusive_group_B",
    powerProduced: 0,
    workforceProduced: 0,
  }),
  3: Object.freeze({
    powerRequired: 400,
    workforceRequired: 300,
    fuelTypeID: 81143,
    fuelConsumptionPerHour: 50,
    fuelStartupCost: 30,
    mutuallyExclusiveGroup: "mutually_exclusive_group_B",
    powerProduced: 0,
    workforceProduced: 0,
  }),
});

let staticSnapshotCache = null;

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function buildPlanetDefinitionFromSource(planet, source) {
  return {
    planetID: Number(planet.itemID || 0) || 0,
    solarSystemID: Number(planet.solarSystemID || 0) || 0,
    power: Number(source.power || 0) || 0,
    workforce: Number(source.workforce || 0) || 0,
    reagentDefinitions: (source.reagentDefinitions || []).map((definition) => ({
      reagentTypeID: Number(definition.reagentTypeID || 0) || 0,
      amountPerCycle: Number(definition.amountPerCycle || 0) || 0,
      cyclePeriodSeconds: Number(definition.cyclePeriodSeconds || 0) || 0,
      securedPercentage: Number(definition.securedPercentage || 0) || 0,
      securedCapacity: Number(definition.securedCapacity || 0) || 0,
      unsecuredCapacity: Number(definition.unsecuredCapacity || 0) || 0,
      securedStock: Number(definition.securedStock || 0) || 0,
      unsecuredStock: Number(definition.unsecuredStock || 0) || 0,
    })),
  };
}

function getPlanetResourceSource(planetID) {
  return (
    PLANET_FAKE_OVERRIDES[planetID] ||
    PLANET_FAKE_BY_REMAINDER[planetID % 4] ||
    PLANET_FAKE_BY_REMAINDER[0]
  );
}

function getSovNullSystems() {
  return worldData
    .getSolarSystems()
    .filter((system) => isSovereigntyClaimableSolarSystem(system))
    .sort(
      (left, right) =>
        Number(left && left.solarSystemID) - Number(right && right.solarSystemID),
    );
}

function buildPlanetDefinitionsAndIndex() {
  const planetDefinitions = [];
  const planetDefinitionsByPlanetID = new Map();
  const planetsBySolarSystemID = new Map();

  for (const system of getSovNullSystems()) {
    const solarSystemID = Number(system && system.solarSystemID) || 0;
    const planets = worldData
      .getCelestialsForSystem(solarSystemID)
      .filter(
        (celestial) =>
          Number(celestial && celestial.groupID) === 7 ||
          String(celestial && celestial.kind).toLowerCase() === "planet",
      )
      .sort((left, right) => Number(left.itemID || 0) - Number(right.itemID || 0));

    planetsBySolarSystemID.set(
      solarSystemID,
      planets.map((planet) => Number(planet.itemID || 0) || 0),
    );

    for (const planet of planets) {
      const planetID = Number(planet.itemID || 0) || 0;
      const definition = buildPlanetDefinitionFromSource(
        planet,
        getPlanetResourceSource(planetID),
      );
      planetDefinitions.push(definition);
      planetDefinitionsByPlanetID.set(planetID, definition);
    }
  }

  return {
    planetDefinitions,
    planetDefinitionsByPlanetID,
    planetsBySolarSystemID,
  };
}

function buildStarConfigurations() {
  const starConfigurations = [];
  const starConfigurationsByStarID = new Map();
  const starConfigurationsBySolarSystemID = new Map();
  for (const system of getSovNullSystems()) {
    const star = worldData
      .getCelestialsForSystem(system.solarSystemID)
      .find(
        (celestial) =>
          Number(celestial && celestial.groupID) === 6 ||
          String(celestial && celestial.kind).toLowerCase() === "sun",
      );
    if (!star) {
      continue;
    }
    const configuration = {
      starID: Number(star.itemID || 0) || 0,
      solarSystemID: Number(system.solarSystemID || 0) || 0,
      power: deriveFallbackStarPower(star),
    };
    starConfigurations.push(configuration);
    starConfigurationsByStarID.set(configuration.starID, configuration);
    starConfigurationsBySolarSystemID.set(configuration.solarSystemID, configuration);
  }
  return {
    starConfigurations,
    starConfigurationsByStarID,
    starConfigurationsBySolarSystemID,
  };
}

function deriveFallbackStarPower(star) {
  const typeRecord = resolveItemByTypeID(star && star.typeID);
  const typeName = String(typeRecord && typeRecord.name || "");
  const spectralPrefix = (typeName.match(/\bSun\s+([OBAFGKM])/i) || [])[1];
  if (spectralPrefix) {
    return FALLBACK_STAR_POWER_BY_SPECTRAL_PREFIX[spectralPrefix.toUpperCase()] ||
      FALLBACK_STAR_POWER_MIN;
  }
  const typeID = Number(star && star.typeID) || 0;
  const starID = Number(star && star.itemID) || 0;
  const bucket = Math.abs((typeID * 31 + starID) % 11);
  return Math.max(
    FALLBACK_STAR_POWER_MIN,
    Math.min(FALLBACK_STAR_POWER_MAX, FALLBACK_STAR_POWER_MIN + (bucket * 50)),
  );
}

function buildUpgradeDefinitions() {
  const upgradeDefinitions = [];
  const upgradeDefinitionsByTypeID = new Map();
  const itemTypes = readStaticRows(TABLE.ITEM_TYPES)
    .filter(
      (type) =>
        Boolean(type && type.published) &&
        UPGRADE_GROUP_IDS.has(Number(type && type.groupID)),
    )
    .sort((left, right) => Number(left.typeID || 0) - Number(right.typeID || 0));

  for (const itemType of itemTypes) {
    const typeID = Number(itemType && itemType.typeID) || 0;
    const fakeDefinition =
      UPGRADE_FAKE_BY_REMAINDER[typeID % 4] || UPGRADE_FAKE_BY_REMAINDER[0];
    const definition = {
      installationTypeID: typeID,
      powerRequired: Number(fakeDefinition.powerRequired || 0) || 0,
      workforceRequired: Number(fakeDefinition.workforceRequired || 0) || 0,
      fuelTypeID: Number(fakeDefinition.fuelTypeID || 0) || 0,
      fuelConsumptionPerHour:
        Number(fakeDefinition.fuelConsumptionPerHour || 0) || 0,
      fuelStartupCost: Number(fakeDefinition.fuelStartupCost || 0) || 0,
      mutuallyExclusiveGroup: String(
        fakeDefinition.mutuallyExclusiveGroup || "",
      ),
      powerProduced: Number(fakeDefinition.powerProduced || 0) || 0,
      workforceProduced: Number(fakeDefinition.workforceProduced || 0) || 0,
      typeName: String(itemType && itemType.name ? itemType.name : ""),
      groupID: Number(itemType && itemType.groupID) || 0,
    };
    upgradeDefinitions.push(definition);
    upgradeDefinitionsByTypeID.set(typeID, definition);
  }

  return {
    upgradeDefinitions,
    upgradeDefinitionsByTypeID,
  };
}

function buildSovereigntyStaticSnapshot() {
  const authoritySnapshot = buildSovereigntyStaticSnapshotFromAuthority();
  if (authoritySnapshot) {
    return authoritySnapshot;
  }

  const planetData = buildPlanetDefinitionsAndIndex();
  const starData = buildStarConfigurations();
  const upgradeData = buildUpgradeDefinitions();
  return {
    planetDefinitions: planetData.planetDefinitions,
    planetDefinitionsByPlanetID: planetData.planetDefinitionsByPlanetID,
    planetDefinitionsVersion: cloneValue(PLANET_DEFINITION_VERSION),
    planetsBySolarSystemID: planetData.planetsBySolarSystemID,
    starConfigurations: starData.starConfigurations,
    starConfigurationsByStarID: starData.starConfigurationsByStarID,
    starConfigurationsBySolarSystemID: starData.starConfigurationsBySolarSystemID,
    upgradeDefinitions: upgradeData.upgradeDefinitions,
    upgradeDefinitionsByTypeID: upgradeData.upgradeDefinitionsByTypeID,
  };
}

function getSovereigntyStaticSnapshot() {
  if (!staticSnapshotCache) {
    staticSnapshotCache = buildSovereigntyStaticSnapshot();
  }
  return staticSnapshotCache;
}

module.exports = {
  PLANET_DEFINITION_VERSION,
  buildSovereigntyStaticSnapshot,
  getSovereigntyStaticSnapshot,
};
