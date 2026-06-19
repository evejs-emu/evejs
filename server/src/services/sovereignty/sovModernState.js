const path = require("path");

const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const {
  findItemById,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getSovereigntyStaticSnapshot,
} = require(path.join(__dirname, "./sovStaticData"));
const {
  cloneValue,
  mergeSovereigntyTableDefaults,
  normalizeSemanticVersion,
  readSovereigntyTable,
  writeSovereigntyTable,
} = require(path.join(__dirname, "./sovStore"));
const {
  listStructures,
} = require(path.join(__dirname, "../structure/structureState"));

const POWER_STATE = Object.freeze({
  POWER_STATE_UNSPECIFIED: 0,
  POWER_STATE_OFFLINE: 1,
  POWER_STATE_ONLINE: 2,
  POWER_STATE_LOW: 3,
  POWER_STATE_PENDING: 4,
});

const SKYHOOK_ITEM_ID_OFFSET = 1000000000000;
const HOUR_MS = 60 * 60 * 1000;

let cache = null;

function getCharacterRecord(characterID) {
  const characterState = require(path.join(
    __dirname,
    "../character/characterState",
  ));
  return characterState && typeof characterState.getCharacterRecord === "function"
    ? characterState.getCharacterRecord(characterID)
    : null;
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizePositiveInteger(value, fallback = null) {
  const numericValue = normalizeInteger(value, 0);
  return numericValue > 0 ? numericValue : fallback;
}

function normalizePositiveArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(
    value
      .map((entry) => normalizePositiveInteger(entry, null))
    .filter(Boolean),
  )].sort((left, right) => left - right);
}

function resolveSessionInteger(session, names = []) {
  if (!session) {
    return null;
  }
  for (const name of names) {
    if (
      Object.prototype.hasOwnProperty.call(session, name) &&
      session[name] !== undefined &&
      session[name] !== null &&
      session[name] !== ""
    ) {
      return Math.max(0, normalizeInteger(session[name], 0));
    }
  }
  return null;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return Boolean(value);
}

function normalizeTimestampMs(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(numericValue));
}

function getStrategicIndexLevelForSystem(system = null) {
  return require(path.join(__dirname, "./sovState")).getStrategicIndexLevel(
    system &&
      system.devIndices &&
      system.devIndices.claimedForDays,
  );
}

function normalizeWorkforceConfiguration(value = {}, fallbackHubID = null) {
  const mode = String(value.mode || "").trim().toLowerCase();
  if (mode === "import") {
    return {
      hubID: normalizePositiveInteger(value.hubID, fallbackHubID),
      mode: "import",
      sourceSystemIDs: normalizePositiveArray(value.sourceSystemIDs),
      destinationSystemID: null,
      amount: 0,
    };
  }
  if (mode === "export") {
    return {
      hubID: normalizePositiveInteger(value.hubID, fallbackHubID),
      mode: "export",
      sourceSystemIDs: [],
      destinationSystemID: normalizePositiveInteger(value.destinationSystemID, null),
      amount: Math.max(0, normalizeInteger(value.amount, 0)),
    };
  }
  if (mode === "transit") {
    return {
      hubID: normalizePositiveInteger(value.hubID, fallbackHubID),
      mode: "transit",
      sourceSystemIDs: [],
      destinationSystemID: null,
      amount: 0,
    };
  }
  return {
    hubID: normalizePositiveInteger(value.hubID, fallbackHubID),
    mode: "inactive",
    sourceSystemIDs: [],
    destinationSystemID: null,
    amount: 0,
  };
}

function normalizeUpgradeInstallation(value = {}) {
  return {
    typeID: normalizePositiveInteger(value.typeID, null),
    online: normalizeBoolean(value.online, false),
  };
}

function normalizeFuelLedger(value = {}) {
  const normalized = {};
  if (!value || typeof value !== "object") {
    return normalized;
  }
  for (const [fuelTypeID, fuelEntry] of Object.entries(value)) {
    const numericFuelTypeID = normalizePositiveInteger(fuelTypeID, null);
    if (!numericFuelTypeID) {
      continue;
    }
    normalized[String(numericFuelTypeID)] = {
      amount: Math.max(
        0,
        normalizeInteger(fuelEntry && fuelEntry.amount, 0),
      ),
    };
  }
  return normalized;
}

function normalizeHubRecord(value = {}, fallback = {}) {
  const installedUpgrades = Array.isArray(value.installedUpgrades)
    ? value.installedUpgrades
        .map((entry) => normalizeUpgradeInstallation(entry))
        .filter((entry) => entry.typeID)
    : [];
  const uniqueUpgrades = [];
  const seenTypeIDs = new Set();
  for (const installation of installedUpgrades) {
    if (seenTypeIDs.has(installation.typeID)) {
      continue;
    }
    seenTypeIDs.add(installation.typeID);
    uniqueUpgrades.push(installation);
  }
  uniqueUpgrades.sort((left, right) => left.typeID - right.typeID);
  return {
    hubID: normalizePositiveInteger(value.hubID, fallback.hubID),
    solarSystemID: normalizePositiveInteger(
      value.solarSystemID,
      fallback.solarSystemID,
    ),
    corporationID: normalizePositiveInteger(
      value.corporationID,
      fallback.corporationID,
    ),
    allianceID: normalizePositiveInteger(value.allianceID, fallback.allianceID),
    installedUpgrades: uniqueUpgrades,
    fuelByTypeID: normalizeFuelLedger(value.fuelByTypeID),
    fuelLastUpdatedMs: normalizeTimestampMs(
      value.fuelLastUpdatedMs,
      fallback.fuelLastUpdatedMs || 0,
    ),
    workforceConfiguration: normalizeWorkforceConfiguration(
      value.workforceConfiguration,
      fallback.hubID,
    ),
    workforceLastUpdatedMs: normalizeTimestampMs(
      value.workforceLastUpdatedMs,
      fallback.workforceLastUpdatedMs || 0,
    ),
    upgradesLastUpdatedMs: normalizeTimestampMs(
      value.upgradesLastUpdatedMs,
      fallback.upgradesLastUpdatedMs || 0,
    ),
  };
}

function normalizeSkyhookRecord(value = {}, fallback = {}) {
  const rawDefinitions = Array.isArray(value.reagentDefinitions)
    ? value.reagentDefinitions
    : fallback.reagentDefinitions || [];
  const rawSimulations = Array.isArray(value.reagentSimulations)
    ? value.reagentSimulations
    : fallback.reagentSimulations || [];
  return {
    skyhookID: normalizePositiveInteger(value.skyhookID, fallback.skyhookID),
    solarSystemID: normalizePositiveInteger(
      value.solarSystemID,
      fallback.solarSystemID,
    ),
    planetID: normalizePositiveInteger(value.planetID, fallback.planetID),
    corporationID: normalizePositiveInteger(
      value.corporationID,
      fallback.corporationID,
    ),
    allianceID: normalizePositiveInteger(
      value.allianceID,
      fallback.allianceID,
    ),
    active: normalizeBoolean(value.active, fallback.active !== false),
    workforceAmount: normalizePositiveInteger(
      value.workforceAmount,
      fallback.workforceAmount || null,
    ),
    reagentDefinitions: rawDefinitions
      .map((entry) => ({
        reagentTypeID: normalizePositiveInteger(entry.reagentTypeID, null),
        amountPerCycle: Math.max(
          0,
          normalizeInteger(entry.amountPerCycle, 0),
        ),
        cyclePeriodSeconds: Math.max(
          0,
          normalizeInteger(entry.cyclePeriodSeconds, 0),
        ),
        securedPercentage: Math.max(
          0,
          normalizeInteger(entry.securedPercentage, 0),
        ),
        securedCapacity: Math.max(
          0,
          normalizeInteger(entry.securedCapacity, 0),
        ),
        unsecuredCapacity: Math.max(
          0,
          normalizeInteger(entry.unsecuredCapacity, 0),
        ),
      }))
      .filter((entry) => entry.reagentTypeID),
    reagentSimulations: rawSimulations
      .map((entry) => ({
        reagentTypeID: normalizePositiveInteger(entry.reagentTypeID, null),
        securedStock: Math.max(0, normalizeInteger(entry.securedStock, 0)),
        unsecuredStock: Math.max(0, normalizeInteger(entry.unsecuredStock, 0)),
        lastCycleMs: normalizeTimestampMs(entry.lastCycleMs, Date.now()),
      }))
      .filter((entry) => entry.reagentTypeID),
    theftVulnerability: {
      startMs: normalizeTimestampMs(
        value &&
          value.theftVulnerability &&
          value.theftVulnerability.startMs,
        fallback &&
          fallback.theftVulnerability &&
          fallback.theftVulnerability.startMs,
      ),
      endMs: normalizeTimestampMs(
        value &&
          value.theftVulnerability &&
          value.theftVulnerability.endMs,
        fallback &&
          fallback.theftVulnerability &&
          fallback.theftVulnerability.endMs,
      ),
    },
    lastUpdatedMs: normalizeTimestampMs(
      value.lastUpdatedMs,
      fallback.lastUpdatedMs || Date.now(),
    ),
  };
}

function buildDefaultWorkforceConfigurationForHub(hubID) {
  if ((hubID || 0) % 2 === 0) {
    return {
      mode: "transit",
      sourceSystemIDs: [],
      destinationSystemID: null,
      amount: 0,
    };
  }
  return {
    mode: "inactive",
    sourceSystemIDs: [],
    destinationSystemID: null,
    amount: 0,
  };
}

function buildDefaultSkyhookWindow(skyhookID) {
  const now = Date.now();
  const remainder = normalizeInteger(skyhookID, 0) % 4;
  const startMs =
    now +
    [-HOUR_MS, HOUR_MS, 2 * HOUR_MS, -2 * HOUR_MS][remainder];
  return {
    startMs,
    endMs: startMs + HOUR_MS,
  };
}

function buildResourcesTableFromStatic(staticSnapshot) {
  return {
    planetDefinitions: cloneValue(staticSnapshot.planetDefinitions),
    planetDefinitionsVersion: normalizeSemanticVersion(
      staticSnapshot.planetDefinitionsVersion,
    ),
    starConfigurations: cloneValue(staticSnapshot.starConfigurations),
    upgradeDefinitions: cloneValue(staticSnapshot.upgradeDefinitions),
  };
}

function arrayShallowEquals(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (String(left[index]) !== String(right[index])) {
      return false;
    }
  }
  return true;
}

function semanticVersionEquals(left, right) {
  const normalizedLeft = normalizeSemanticVersion(left);
  const normalizedRight = normalizeSemanticVersion(right);
  return (
    normalizedLeft.major === normalizedRight.major &&
    normalizedLeft.minor === normalizedRight.minor &&
    normalizedLeft.patch === normalizedRight.patch &&
    arrayShallowEquals(normalizedLeft.prerelease_tags, normalizedRight.prerelease_tags) &&
    arrayShallowEquals(normalizedLeft.build_tags, normalizedRight.build_tags)
  );
}

function resourceRowsMatch(currentRows, targetRows, idName) {
  if (!Array.isArray(currentRows) || !Array.isArray(targetRows)) {
    return false;
  }
  if (currentRows.length !== targetRows.length) {
    return false;
  }
  if (currentRows.length === 0) {
    return true;
  }
  const targetByID = new Map(
    targetRows.map((row) => [normalizePositiveInteger(row && row[idName], null), row]),
  );
  for (const row of currentRows) {
    const id = normalizePositiveInteger(row && row[idName], null);
    const target = targetByID.get(id);
    if (!id || !target) {
      return false;
    }
    if (JSON.stringify(row) !== JSON.stringify(target)) {
      return false;
    }
  }
  return true;
}

function getSkyhookHarvestContribution(skyhook, staticSnapshot) {
  if (!skyhook || !skyhook.active) {
    return {
      power: 0,
      workforce: 0,
    };
  }

  const planetDefinition = staticSnapshot.planetDefinitionsByPlanetID.get(
    normalizePositiveInteger(skyhook.planetID, 0),
  );
  return {
    power: Number(planetDefinition && planetDefinition.power) || 0,
    workforce:
      normalizePositiveInteger(
        skyhook.workforceAmount,
        Number(planetDefinition && planetDefinition.workforce) || 0,
      ) || 0,
  };
}

function ensureStaticResources(table, staticSnapshot) {
  const needsBootstrap =
    !table.resources ||
    !Array.isArray(table.resources.planetDefinitions) ||
    !Array.isArray(table.resources.starConfigurations) ||
    !Array.isArray(table.resources.upgradeDefinitions) ||
    table.resources.planetDefinitions.length === 0 ||
    table.resources.starConfigurations.length === 0 ||
    table.resources.upgradeDefinitions.length === 0;
  if (needsBootstrap) {
    table.resources = buildResourcesTableFromStatic(staticSnapshot);
    return true;
  }

  if (
    !semanticVersionEquals(
      table.resources.planetDefinitionsVersion,
      staticSnapshot.planetDefinitionsVersion,
    ) ||
    !resourceRowsMatch(
      table.resources.planetDefinitions,
      staticSnapshot.planetDefinitions,
      "planetID",
    ) ||
    !resourceRowsMatch(
      table.resources.starConfigurations,
      staticSnapshot.starConfigurations,
      "starID",
    ) ||
    !resourceRowsMatch(
      table.resources.upgradeDefinitions,
      staticSnapshot.upgradeDefinitions,
      "installationTypeID",
    )
  ) {
    table.resources = buildResourcesTableFromStatic(staticSnapshot);
    return true;
  }
  return false;
}

function bootstrapHubsFromSystems(table) {
  let changed = false;
  const validHubKeys = new Set();
  for (const [solarSystemID, system] of Object.entries(table.systems || {})) {
    const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
    const hubID = normalizePositiveInteger(
      system && system.infrastructureHubID,
      null,
    );
    const allianceID = normalizePositiveInteger(system && system.allianceID, null);
    const corporationID = normalizePositiveInteger(
      system && system.corporationID,
      null,
    );
    if (!numericSolarSystemID || !hubID || !allianceID || !corporationID) {
      continue;
    }

    const key = String(hubID);
    validHubKeys.add(key);
    const fallback = {
      hubID,
      solarSystemID: numericSolarSystemID,
      corporationID,
      allianceID,
      installedUpgrades: [],
      fuelByTypeID: {},
      fuelLastUpdatedMs: 0,
      workforceConfiguration: buildDefaultWorkforceConfigurationForHub(hubID),
      workforceLastUpdatedMs: 0,
      upgradesLastUpdatedMs: 0,
    };
    const normalized = normalizeHubRecord(
      table.hubs && table.hubs[key] ? table.hubs[key] : {},
      fallback,
    );
    normalized.hubID = hubID;
    normalized.solarSystemID = numericSolarSystemID;
    normalized.corporationID = corporationID;
    normalized.allianceID = allianceID;
    if (
      !table.hubs[key] ||
      JSON.stringify(table.hubs[key]) !== JSON.stringify(normalized)
    ) {
      table.hubs[key] = normalized;
      changed = true;
    }
  }

  for (const structure of listStructures({
    includeDestroyed: false,
    refresh: false,
  })) {
    const hubID = normalizePositiveInteger(structure && structure.structureID, null);
    const solarSystemID = normalizePositiveInteger(
      structure && structure.solarSystemID,
      null,
    );
    const corporationID = normalizePositiveInteger(
      structure && (structure.ownerCorpID || structure.corporationID || structure.ownerID),
      null,
    );
    const allianceID = normalizePositiveInteger(
      structure && structure.allianceID,
      null,
    );
    if (
      Number(structure && structure.typeID) !== 32458 ||
      structure.published === false ||
      !hubID ||
      !solarSystemID ||
      !corporationID ||
      !allianceID
    ) {
      continue;
    }

    const key = String(hubID);
    validHubKeys.add(key);
    const fallback = {
      hubID,
      solarSystemID,
      corporationID,
      allianceID,
      installedUpgrades: [],
      fuelByTypeID: {},
      fuelLastUpdatedMs: 0,
      workforceConfiguration: buildDefaultWorkforceConfigurationForHub(hubID),
      workforceLastUpdatedMs: 0,
      upgradesLastUpdatedMs: 0,
    };
    const normalized = normalizeHubRecord(
      table.hubs && table.hubs[key] ? table.hubs[key] : {},
      fallback,
    );
    normalized.hubID = hubID;
    normalized.solarSystemID = solarSystemID;
    normalized.corporationID = corporationID;
    normalized.allianceID = allianceID;
    if (
      !table.hubs[key] ||
      JSON.stringify(table.hubs[key]) !== JSON.stringify(normalized)
    ) {
      table.hubs[key] = normalized;
      changed = true;
    }
  }

  for (const hubKey of Object.keys(table.hubs || {})) {
    if (validHubKeys.has(hubKey)) {
      continue;
    }
    delete table.hubs[hubKey];
    changed = true;
  }
  return changed;
}

function mergeReagentSimulationsWithDefinitions(currentSimulations, definitions) {
  const currentByTypeID = new Map();
  for (const simulation of Array.isArray(currentSimulations) ? currentSimulations : []) {
    const reagentTypeID = normalizePositiveInteger(
      simulation && simulation.reagentTypeID,
      null,
    );
    if (reagentTypeID) {
      currentByTypeID.set(reagentTypeID, simulation);
    }
  }
  return (Array.isArray(definitions) ? definitions : [])
    .map((reagent) => {
      const reagentTypeID = normalizePositiveInteger(
        reagent && reagent.reagentTypeID,
        null,
      );
      if (!reagentTypeID) {
        return null;
      }
      const current = currentByTypeID.get(reagentTypeID) || {};
      return {
        reagentTypeID,
        securedStock: Math.max(
          0,
          normalizeInteger(current.securedStock, reagent.securedStock || 0),
        ),
        unsecuredStock: Math.max(
          0,
          normalizeInteger(current.unsecuredStock, reagent.unsecuredStock || 0),
        ),
        lastCycleMs: normalizeTimestampMs(current.lastCycleMs, Date.now()),
      };
    })
    .filter(Boolean);
}

function bootstrapSkyhooksFromSystems(table, staticSnapshot, options = {}) {
  let changed = false;
  const refreshResourceDefinitions = Boolean(options.refreshResourceDefinitions);
  const validSkyhookKeys = new Set();
  for (const [solarSystemID, system] of Object.entries(table.systems || {})) {
    const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
    const allianceID = normalizePositiveInteger(system && system.allianceID, null);
    const corporationID = normalizePositiveInteger(
      system && system.corporationID,
      null,
    );
    if (!numericSolarSystemID || !allianceID || !corporationID) {
      continue;
    }

    const planetIDs =
      staticSnapshot.planetsBySolarSystemID.get(numericSolarSystemID) || [];
    for (const planetID of planetIDs) {
      const skyhookID = SKYHOOK_ITEM_ID_OFFSET + Number(planetID || 0);
      const definition = staticSnapshot.planetDefinitionsByPlanetID.get(planetID);
      const fallback = {
        skyhookID,
        solarSystemID: numericSolarSystemID,
        planetID,
        corporationID,
        allianceID,
        active: true,
        workforceAmount: definition && definition.workforce ? definition.workforce : null,
        reagentDefinitions: definition ? definition.reagentDefinitions : [],
        reagentSimulations: definition
          ? definition.reagentDefinitions.map((reagent) => ({
              reagentTypeID: reagent.reagentTypeID,
              securedStock: reagent.securedStock,
              unsecuredStock: reagent.unsecuredStock,
              lastCycleMs: Date.now(),
            }))
          : [],
        theftVulnerability: buildDefaultSkyhookWindow(skyhookID),
        lastUpdatedMs: Date.now(),
      };
      const key = String(skyhookID);
      validSkyhookKeys.add(key);
      const normalized = normalizeSkyhookRecord(
        table.skyhooks && table.skyhooks[key] ? table.skyhooks[key] : {},
        fallback,
      );
      normalized.skyhookID = skyhookID;
      normalized.solarSystemID = numericSolarSystemID;
      normalized.planetID = planetID;
      normalized.corporationID = corporationID;
      normalized.allianceID = allianceID;
      if (refreshResourceDefinitions) {
        normalized.workforceAmount = fallback.workforceAmount;
        normalized.reagentDefinitions = cloneValue(fallback.reagentDefinitions);
        normalized.reagentSimulations = mergeReagentSimulationsWithDefinitions(
          normalized.reagentSimulations,
          fallback.reagentDefinitions,
        );
      }
      if (!table.skyhooks[key]) {
        table.skyhooks[key] = normalized;
        changed = true;
        continue;
      }
      if (JSON.stringify(table.skyhooks[key]) !== JSON.stringify(normalized)) {
        table.skyhooks[key] = normalized;
        changed = true;
      }
    }
  }
  for (const skyhookKey of Object.keys(table.skyhooks || {})) {
    if (validSkyhookKeys.has(skyhookKey)) {
      continue;
    }
    delete table.skyhooks[skyhookKey];
    changed = true;
  }
  return changed;
}

function ensureBootstrappedTable() {
  const staticSnapshot = getSovereigntyStaticSnapshot();
  let table = readSovereigntyTable();
  let changed = false;
  const resourcesChanged = ensureStaticResources(table, staticSnapshot);
  changed = resourcesChanged || changed;
  changed = bootstrapHubsFromSystems(table) || changed;
  changed = bootstrapSkyhooksFromSystems(table, staticSnapshot, {
    refreshResourceDefinitions: resourcesChanged,
  }) || changed;
  if (changed) {
    table = writeSovereigntyTable(table);
  }
  return {
    table,
    staticSnapshot,
  };
}

function getHubLocalHarvest(hubRecord, stateCache) {
  const solarSystemID = normalizePositiveInteger(hubRecord && hubRecord.solarSystemID, 0);
  const starConfiguration =
    stateCache.staticSnapshot.starConfigurationsBySolarSystemID.get(solarSystemID) ||
    null;
  const harvested = stateCache.localHarvestBySolarSystemID.get(solarSystemID) || null;
  return {
    power:
      Number(harvested && harvested.power) ||
      Number(starConfiguration && starConfiguration.power) ||
      0,
    workforce: Number(harvested && harvested.workforce) || 0,
  };
}

function getHubImportAmount(sourceHub, stateCache) {
  if (!sourceHub) {
    return 0;
  }
  const sourceHarvest = getHubLocalHarvest(sourceHub, stateCache);
  return Math.max(0, Math.min(Number(sourceHarvest.workforce || 0), 1000));
}

function getHubTransferDelta(hubRecord, stateCache) {
  const configuration = normalizeWorkforceConfiguration(
    hubRecord && hubRecord.workforceConfiguration,
    hubRecord && hubRecord.hubID,
  );
  if (configuration.mode === "import") {
    return configuration.sourceSystemIDs.reduce((sum, sourceSystemID) => {
      const sourceHub = stateCache.hubsBySolarSystemID.get(sourceSystemID) || null;
      return sum + getHubImportAmount(sourceHub, stateCache);
    }, 0);
  }

  if (configuration.mode === "export") {
    return -Math.max(0, normalizeInteger(configuration.amount, 0));
  }

  return 0;
}

function computeHubUpgradeSnapshot(hubRecord, stateCache) {
  const localHarvest = getHubLocalHarvest(hubRecord, stateCache);
  const powerLocalHarvest = Number(localHarvest.power || 0);
  const workforceLocalHarvest = Number(localHarvest.workforce || 0);
  const workforceTransferDelta = getHubTransferDelta(hubRecord, stateCache);

  let powerAvailable = powerLocalHarvest;
  let workforceAvailable = Math.max(
    0,
    workforceLocalHarvest + workforceTransferDelta,
  );
  let powerAllocated = 0;
  let workforceAllocated = 0;
  const upgrades = [];

  for (const installation of hubRecord.installedUpgrades) {
    const definition = stateCache.staticSnapshot.upgradeDefinitionsByTypeID.get(
      installation.typeID,
    );
    if (!definition) {
      continue;
    }

    let powerState = POWER_STATE.POWER_STATE_OFFLINE;
    if (installation.online) {
      const canPower =
        powerAllocated + definition.powerRequired <= powerAvailable;
      const canWorkforce =
        workforceAllocated + definition.workforceRequired <= workforceAvailable;
      if (canPower && canWorkforce) {
        powerState = POWER_STATE.POWER_STATE_ONLINE;
        powerAllocated += definition.powerRequired;
        workforceAllocated += definition.workforceRequired;
        powerAvailable += definition.powerProduced;
        workforceAvailable += definition.workforceProduced;
      } else {
        powerState = POWER_STATE.POWER_STATE_LOW;
      }
    }

    upgrades.push({
      typeID: installation.typeID,
      definition,
      powerState,
    });
  }

  upgrades.sort((left, right) => left.typeID - right.typeID);

  return {
    resources: {
      power: {
        available: powerAvailable,
        allocated: powerAllocated,
        localHarvest: powerLocalHarvest,
      },
      workforce: {
        available: workforceAvailable,
        allocated: workforceAllocated,
        localHarvest: workforceLocalHarvest,
      },
    },
    upgrades,
  };
}

function buildWorkforceState(configuration, hubRecord, identityCache) {
  if (configuration.mode === "import") {
    const sources = configuration.sourceSystemIDs.map((sourceSystemID) => {
      const sourceHub =
        identityCache.hubsBySolarSystemID.get(sourceSystemID) || null;
      return {
        sourceSystemID,
        amount: getHubImportAmount(sourceHub, identityCache),
      };
    });
    return {
      mode: "import",
      sources,
      destinationSystemID: null,
      amount: 0,
      connected: false,
    };
  }

  if (configuration.mode === "export") {
    const connected =
      configuration.destinationSystemID &&
      identityCache.hubsBySolarSystemID.has(configuration.destinationSystemID);
    return {
      mode: "export",
      sources: [],
      destinationSystemID: configuration.destinationSystemID,
      amount: configuration.amount,
      connected,
    };
  }

  if (configuration.mode === "transit") {
    return {
      mode: "transit",
      sources: [],
      destinationSystemID: null,
      amount: 0,
      connected: false,
    };
  }

  return {
    mode: "inactive",
    sources: [],
    destinationSystemID: null,
    amount: 0,
    connected: false,
  };
}

function deriveSkyhookTheftVulnerability(skyhook) {
  const now = Date.now();
  const startMs = normalizeTimestampMs(
    skyhook &&
      skyhook.theftVulnerability &&
      skyhook.theftVulnerability.startMs,
    0,
  );
  const endMs = normalizeTimestampMs(
    skyhook &&
      skyhook.theftVulnerability &&
      skyhook.theftVulnerability.endMs,
    0,
  );
  return {
    vulnerable:
      Boolean(skyhook && skyhook.active) &&
      startMs > 0 &&
      endMs > 0 &&
      now >= startMs &&
      now <= endMs,
    startMs,
    endMs,
  };
}

function ensureLoaded() {
  const { table, staticSnapshot } = ensureBootstrappedTable();
  const updatedAt = table && table._meta ? table._meta.updatedAt : null;
  if (cache && cache.updatedAt === updatedAt) {
    return cache;
  }

  const nextCache = {
    updatedAt,
    staticSnapshot,
    table,
    hubsByID: new Map(),
    hubsBySolarSystemID: new Map(),
    skyhooksByID: new Map(),
    skyhooksBySolarSystemID: new Map(),
    skyhooksByCorporationID: new Map(),
    vulnerableSkyhooksBySolarSystemID: new Map(),
    localHarvestBySolarSystemID: new Map(),
    hubSnapshotsByID: new Map(),
  };

  for (const [hubID, rawHub] of Object.entries(table.hubs || {})) {
    const normalizedHub = normalizeHubRecord(rawHub, {
      hubID: normalizePositiveInteger(hubID, null),
    });
    if (!normalizedHub.hubID || !normalizedHub.solarSystemID) {
      continue;
    }
    nextCache.hubsByID.set(normalizedHub.hubID, normalizedHub);
    nextCache.hubsBySolarSystemID.set(
      normalizedHub.solarSystemID,
      normalizedHub,
    );
  }

  for (const [skyhookID, rawSkyhook] of Object.entries(table.skyhooks || {})) {
    const normalizedSkyhook = normalizeSkyhookRecord(rawSkyhook, {
      skyhookID: normalizePositiveInteger(skyhookID, null),
    });
    if (
      !normalizedSkyhook.skyhookID ||
      !normalizedSkyhook.solarSystemID ||
      !normalizedSkyhook.planetID
    ) {
      continue;
    }

    nextCache.skyhooksByID.set(normalizedSkyhook.skyhookID, normalizedSkyhook);
    if (!nextCache.skyhooksBySolarSystemID.has(normalizedSkyhook.solarSystemID)) {
      nextCache.skyhooksBySolarSystemID.set(normalizedSkyhook.solarSystemID, []);
    }
    nextCache.skyhooksBySolarSystemID
      .get(normalizedSkyhook.solarSystemID)
      .push(normalizedSkyhook);

    if (!nextCache.skyhooksByCorporationID.has(normalizedSkyhook.corporationID)) {
      nextCache.skyhooksByCorporationID.set(normalizedSkyhook.corporationID, []);
    }
    nextCache.skyhooksByCorporationID
      .get(normalizedSkyhook.corporationID)
      .push(normalizedSkyhook);

    if (!nextCache.localHarvestBySolarSystemID.has(normalizedSkyhook.solarSystemID)) {
      const starConfiguration =
        staticSnapshot.starConfigurationsBySolarSystemID.get(
          normalizedSkyhook.solarSystemID,
        ) || null;
      nextCache.localHarvestBySolarSystemID.set(normalizedSkyhook.solarSystemID, {
        power: Number(starConfiguration && starConfiguration.power) || 0,
        workforce: 0,
      });
    }
    const localHarvest = nextCache.localHarvestBySolarSystemID.get(
      normalizedSkyhook.solarSystemID,
    );
    const contribution = getSkyhookHarvestContribution(
      normalizedSkyhook,
      staticSnapshot,
    );
    localHarvest.power += Number(contribution.power || 0);
    localHarvest.workforce += Number(contribution.workforce || 0);

    const vulnerability = deriveSkyhookTheftVulnerability(normalizedSkyhook);
    if (vulnerability.endMs > Date.now()) {
      if (
        !nextCache.vulnerableSkyhooksBySolarSystemID.has(
          normalizedSkyhook.solarSystemID,
        )
      ) {
        nextCache.vulnerableSkyhooksBySolarSystemID.set(
          normalizedSkyhook.solarSystemID,
          [],
        );
      }
      nextCache.vulnerableSkyhooksBySolarSystemID
        .get(normalizedSkyhook.solarSystemID)
        .push({
          skyhookID: normalizedSkyhook.skyhookID,
          planetID: normalizedSkyhook.planetID,
          startMs: vulnerability.startMs,
          endMs: vulnerability.endMs,
        });
    }
  }

  for (const list of nextCache.skyhooksBySolarSystemID.values()) {
    list.sort((left, right) => left.skyhookID - right.skyhookID);
  }
  for (const list of nextCache.skyhooksByCorporationID.values()) {
    list.sort((left, right) => left.skyhookID - right.skyhookID);
  }
  for (const list of nextCache.vulnerableSkyhooksBySolarSystemID.values()) {
    list.sort((left, right) => left.skyhookID - right.skyhookID);
  }
  for (const hub of nextCache.hubsByID.values()) {
    nextCache.hubSnapshotsByID.set(
      hub.hubID,
      computeHubUpgradeSnapshot(hub, nextCache),
    );
  }

  cache = nextCache;
  return cache;
}

function mutateTable(mutator) {
  const { table } = ensureBootstrappedTable();
  const workingTable = mergeSovereigntyTableDefaults(table);
  const result = mutator(workingTable) || {};
  const persistedTable = writeSovereigntyTable(workingTable);
  cache = null;
  return {
    ...result,
    table: persistedTable,
  };
}

function findLiveSessionByCharacterID(characterID) {
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  if (!numericCharacterID) {
    return null;
  }
  return sessionRegistry.findSessionByCharacterID(numericCharacterID) || null;
}

function getActiveCharacterIdentity(characterID) {
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  const record = numericCharacterID ? getCharacterRecord(numericCharacterID) || {} : {};
  const liveSession = numericCharacterID
    ? findLiveSessionByCharacterID(numericCharacterID)
    : null;
  const liveCorporationID = resolveSessionInteger(liveSession, [
    "corporationID",
    "corpid",
  ]);
  const liveAllianceID = resolveSessionInteger(liveSession, [
    "allianceID",
    "allianceid",
  ]);
  const liveSolarSystemID = resolveSessionInteger(liveSession, [
    "solarsystemid2",
    "solarsystemid",
  ]);
  return {
    characterID: numericCharacterID || 0,
    corporationID:
      liveCorporationID !== null
        ? liveCorporationID
        : normalizePositiveInteger(record && record.corporationID, 0) || 0,
    allianceID:
      liveAllianceID !== null
        ? liveAllianceID
        : normalizePositiveInteger(record && record.allianceID, 0) || 0,
    solarSystemID:
      liveSolarSystemID !== null
        ? liveSolarSystemID
        : normalizePositiveInteger(record && record.solarSystemID, 0) || 0,
  };
}

function getHubIDForSolarSystem(solarSystemID) {
  const hub =
    ensureLoaded().hubsBySolarSystemID.get(
      normalizePositiveInteger(solarSystemID, 0),
    ) || null;
  return hub ? hub.hubID : null;
}

function hasAllianceOrCorporationAccess(owner, identity) {
  if (!owner || !identity) {
    return false;
  }
  if (
    normalizePositiveInteger(owner.corporationID, 0) > 0 &&
    normalizePositiveInteger(identity.corporationID, 0) ===
      normalizePositiveInteger(owner.corporationID, 0)
  ) {
    return true;
  }
  return (
    normalizePositiveInteger(owner.allianceID, 0) > 0 &&
    normalizePositiveInteger(identity.allianceID, 0) ===
      normalizePositiveInteger(owner.allianceID, 0)
  );
}

function getHubRecord(hubID) {
  return ensureLoaded().hubsByID.get(normalizePositiveInteger(hubID, 0)) || null;
}

function requireHubAccess(hubID, identity, requireOwnership = false) {
  const hub = getHubRecord(hubID);
  if (!hub) {
    return {
      ok: false,
      statusCode: 404,
      errorCode: "HUB_NOT_FOUND",
      hub: null,
    };
  }
  if (!requireOwnership || hasAllianceOrCorporationAccess(hub, identity)) {
    return {
      ok: true,
      hub,
    };
  }
  return {
    ok: false,
    statusCode: 403,
    errorCode: "FORBIDDEN_REQUEST",
    hub,
  };
}

function requireSkyhookAccess(skyhookID, identity, options = {}) {
  const skyhook =
    ensureLoaded().skyhooksByID.get(normalizePositiveInteger(skyhookID, 0)) || null;
  if (!skyhook) {
    return {
      ok: false,
      statusCode: 404,
      errorCode: "SKYHOOK_NOT_FOUND",
      skyhook: null,
    };
  }
  if (
    options.allowLocalSystem &&
    normalizePositiveInteger(identity && identity.solarSystemID, 0) ===
      normalizePositiveInteger(skyhook.solarSystemID, 0)
  ) {
    return {
      ok: true,
      skyhook,
    };
  }
  if (!options.requireOwnership || hasAllianceOrCorporationAccess(skyhook, identity)) {
    return {
      ok: true,
      skyhook,
    };
  }
  return {
    ok: false,
    statusCode: 403,
    errorCode: "FORBIDDEN_REQUEST",
    skyhook,
  };
}

function buildHubUpgradePayloadState(hubID) {
  const stateCache = ensureLoaded();
  const hub = stateCache.hubsByID.get(normalizePositiveInteger(hubID, 0)) || null;
  if (!hub) {
    return null;
  }
  const upgradeSnapshot =
    stateCache.hubSnapshotsByID.get(hub.hubID) ||
    computeHubUpgradeSnapshot(hub, stateCache);
  return {
    hubID: hub.hubID,
    solarSystemID: hub.solarSystemID,
    resources: upgradeSnapshot.resources,
    upgrades: upgradeSnapshot.upgrades.map((upgrade) => ({
      hubID: hub.hubID,
      typeID: upgrade.typeID,
      installationTypeID: upgrade.definition.installationTypeID,
      powerState: upgrade.powerState,
      definition: upgrade.definition,
    })),
    lastUpdatedMs: hub.upgradesLastUpdatedMs || 0,
  };
}

function getHubResources(hubID, identity = null) {
  if (identity) {
    const access = requireHubAccess(hubID, identity, true);
    if (!access.ok) {
      return access;
    }
  }
  const payloadState = buildHubUpgradePayloadState(hubID);
  if (!payloadState) {
    return null;
  }
  return {
    hubID: payloadState.hubID,
    solarSystemID: payloadState.solarSystemID,
    power: cloneValue(payloadState.resources.power),
    workforce: cloneValue(payloadState.resources.workforce),
  };
}

function listUpgradeDefinitions() {
  return cloneValue(ensureLoaded().staticSnapshot.upgradeDefinitions);
}

function getHubUpgrades(hubID, identity = null) {
  if (identity) {
    const access = requireHubAccess(hubID, identity, true);
    if (!access.ok) {
      return access;
    }
  }
  const payloadState = buildHubUpgradePayloadState(hubID);
  if (!payloadState) {
    return null;
  }
  return cloneValue(payloadState);
}

function validateUpgradeConfiguration(installations, staticSnapshot, system = null) {
  const strategicLevel = getStrategicIndexLevelForSystem(system);
  const onlineCountsByGroup = new Map();
  for (const installation of installations) {
    if (!installation.online) {
      continue;
    }
    const definition = staticSnapshot.upgradeDefinitionsByTypeID.get(installation.typeID);
    if (!definition) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: "INVALID_DATA",
      };
    }
    const requiredStrategicIndex = Math.max(
      0,
      normalizeInteger(definition.requiredStrategicIndex, 0),
    );
    if (strategicLevel < requiredStrategicIndex) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: "CONFLICT",
      };
    }
    const groupName = String(definition.mutuallyExclusiveGroup || "").trim();
    if (!groupName) {
      continue;
    }
    const count = (onlineCountsByGroup.get(groupName) || 0) + 1;
    onlineCountsByGroup.set(groupName, count);
    if (count > 1) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: "CONFLICT",
      };
    }
  }
  return {
    ok: true,
  };
}

function processHubUpgradeConfiguration(
  hubID,
  newUpgradeItemIDs,
  configurations,
  identity,
) {
  const access = requireHubAccess(hubID, identity, true);
  if (!access.ok) {
    return access;
  }

  const staticSnapshot = ensureLoaded().staticSnapshot;
  try {
    return mutateTable((table) => {
      const hub = normalizeHubRecord(table.hubs[String(access.hub.hubID)], access.hub);
      const installationsByTypeID = new Map(
        hub.installedUpgrades.map((installation) => [installation.typeID, installation]),
      );

      for (const itemID of newUpgradeItemIDs || []) {
        const item = findItemById(itemID);
        if (!item) {
          throw {
            statusCode: 404,
            errorCode: "NOT_FOUND",
          };
        }
        const typeID = normalizePositiveInteger(item.typeID, null);
        if (!staticSnapshot.upgradeDefinitionsByTypeID.has(typeID)) {
          throw {
            statusCode: 400,
            errorCode: "INVALID_DATA",
          };
        }
        if (!installationsByTypeID.has(typeID)) {
          installationsByTypeID.set(typeID, {
            typeID,
            online: false,
          });
        }
      }

      for (const configuration of configurations || []) {
        const typeID = normalizePositiveInteger(configuration.typeID, null);
        if (!typeID || !installationsByTypeID.has(typeID)) {
          throw {
            statusCode: 404,
            errorCode: "NOT_FOUND",
          };
        }
        installationsByTypeID.set(typeID, {
          typeID,
          online: Boolean(configuration.online),
        });
      }

      const installations = [...installationsByTypeID.values()].sort(
        (left, right) => left.typeID - right.typeID,
      );
      const system = table.systems[String(hub.solarSystemID)] || {
        solarSystemID: hub.solarSystemID,
      };
      const validation = validateUpgradeConfiguration(
        installations,
        staticSnapshot,
        system,
      );
      if (!validation.ok) {
        throw validation;
      }

      hub.installedUpgrades = installations;
      hub.upgradesLastUpdatedMs = Date.now();
      table.hubs[String(hub.hubID)] = hub;

      return {
        ok: true,
        hubID: hub.hubID,
        solarSystemID: hub.solarSystemID,
      };
    });
  } catch (error) {
    return {
      ok: false,
      statusCode: error && error.statusCode ? error.statusCode : 500,
      errorCode: error && error.errorCode ? error.errorCode : "INTERNAL_SERVER_ERROR",
      hub: access.hub,
    };
  }
}

function setHubUpgradeInstallations(
  hubID,
  installations,
  identity,
) {
  const access = requireHubAccess(hubID, identity, true);
  if (!access.ok) {
    return access;
  }

  const staticSnapshot = ensureLoaded().staticSnapshot;
  try {
    return mutateTable((table) => {
      const hub = normalizeHubRecord(table.hubs[String(access.hub.hubID)], access.hub);
      const installationsByTypeID = new Map(
        hub.installedUpgrades.map((installation) => [installation.typeID, installation]),
      );

      for (const installation of installations || []) {
        const typeID = normalizePositiveInteger(installation && installation.typeID, null);
        if (!typeID || !staticSnapshot.upgradeDefinitionsByTypeID.has(typeID)) {
          throw {
            statusCode: 404,
            errorCode: "NOT_FOUND",
          };
        }
        installationsByTypeID.set(typeID, {
          typeID,
          online: Boolean(installation && installation.online),
        });
      }

      const nextInstallations = [...installationsByTypeID.values()].sort(
        (left, right) => left.typeID - right.typeID,
      );
      const system = table.systems[String(hub.solarSystemID)] || {
        solarSystemID: hub.solarSystemID,
      };
      const validation = validateUpgradeConfiguration(
        nextInstallations,
        staticSnapshot,
        system,
      );
      if (!validation.ok) {
        throw validation;
      }

      hub.installedUpgrades = nextInstallations;
      hub.upgradesLastUpdatedMs = Date.now();
      table.hubs[String(hub.hubID)] = hub;
      return {
        ok: true,
        hubID: hub.hubID,
        solarSystemID: hub.solarSystemID,
      };
    });
  } catch (error) {
    return {
      ok: false,
      statusCode: error && error.statusCode ? error.statusCode : 500,
      errorCode: error && error.errorCode ? error.errorCode : "INTERNAL_SERVER_ERROR",
      hub: access.hub,
    };
  }
}

function uninstallHubUpgrade(hubID, upgradeTypeID, identity) {
  const access = requireHubAccess(hubID, identity, true);
  if (!access.ok) {
    return access;
  }

  const numericUpgradeTypeID = normalizePositiveInteger(upgradeTypeID, null);
  if (!numericUpgradeTypeID) {
    return {
      ok: false,
      statusCode: 404,
      errorCode: "NOT_FOUND",
      hub: access.hub,
    };
  }

  try {
    return mutateTable((table) => {
      const hub = normalizeHubRecord(table.hubs[String(access.hub.hubID)], access.hub);
      const beforeCount = hub.installedUpgrades.length;
      hub.installedUpgrades = hub.installedUpgrades.filter(
        (installation) => installation.typeID !== numericUpgradeTypeID,
      );
      if (hub.installedUpgrades.length === beforeCount) {
        throw {
          statusCode: 404,
          errorCode: "NOT_FOUND",
        };
      }
      hub.upgradesLastUpdatedMs = Date.now();
      table.hubs[String(hub.hubID)] = hub;
      return {
        ok: true,
        hubID: hub.hubID,
        solarSystemID: hub.solarSystemID,
        upgradeTypeID: numericUpgradeTypeID,
      };
    });
  } catch (error) {
    return {
      ok: false,
      statusCode: error && error.statusCode ? error.statusCode : 500,
      errorCode: error && error.errorCode ? error.errorCode : "INTERNAL_SERVER_ERROR",
      hub: access.hub,
    };
  }
}

function getHubFuel(hubID, identity = null) {
  if (identity) {
    const access = requireHubAccess(hubID, identity, true);
    if (!access.ok) {
      return access;
    }
  }
  const hub = getHubRecord(hubID);
  if (!hub) {
    return null;
  }
  const upgradeState = buildHubUpgradePayloadState(hubID) || {
    upgrades: [],
  };
  const burnedPerHourByFuelType = new Map();
  for (const upgrade of upgradeState.upgrades || []) {
    if (upgrade.powerState !== POWER_STATE.POWER_STATE_ONLINE) {
      continue;
    }
    const definition = upgrade.definition;
    const currentBurn = burnedPerHourByFuelType.get(definition.fuelTypeID) || 0;
    burnedPerHourByFuelType.set(
      definition.fuelTypeID,
      currentBurn + Number(definition.fuelConsumptionPerHour || 0),
    );
  }

  const fuelTypeIDs = new Set([
    ...Object.keys(hub.fuelByTypeID || {}).map((entry) => Number(entry) || 0),
    ...burnedPerHourByFuelType.keys(),
  ]);

  return {
    hubID: hub.hubID,
    solarSystemID: hub.solarSystemID,
    lastUpdatedMs: hub.fuelLastUpdatedMs || 0,
    fuels: [...fuelTypeIDs]
      .filter((typeID) => typeID > 0)
      .sort((left, right) => left - right)
      .map((typeID) => ({
        fuelTypeID: typeID,
        amount: Number(
          hub.fuelByTypeID &&
            hub.fuelByTypeID[String(typeID)] &&
            hub.fuelByTypeID[String(typeID)].amount,
        ) || 0,
        burnedPerHour: burnedPerHourByFuelType.get(typeID) || 0,
      })),
  };
}

function addHubFuel(hubID, fuelItemID, amount, identity) {
  const access = requireHubAccess(hubID, identity, true);
  if (!access.ok) {
    return access;
  }
  const numericAmount = Math.max(0, normalizeInteger(amount, 0));
  const fuelItem = findItemById(fuelItemID);
  if (!fuelItem) {
    return {
      ok: false,
      statusCode: 404,
      errorCode: "NOT_FOUND",
      hub: access.hub,
    };
  }
  const fuelTypeID = normalizePositiveInteger(fuelItem.typeID, null);
  if (!fuelTypeID) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: "INVALID_DATA",
      hub: access.hub,
    };
  }

  return mutateTable((table) => {
    const hub = normalizeHubRecord(table.hubs[String(access.hub.hubID)], access.hub);
    const currentEntry = hub.fuelByTypeID[String(fuelTypeID)] || { amount: 0 };
    hub.fuelByTypeID[String(fuelTypeID)] = {
      amount: currentEntry.amount + numericAmount,
    };
    hub.fuelLastUpdatedMs = Date.now();
    table.hubs[String(hub.hubID)] = hub;
    return {
      ok: true,
      hubID: hub.hubID,
      solarSystemID: hub.solarSystemID,
      fuelTypeID,
    };
  });
}

function seedHubFuelForInstalledUpgrades(hubID, hours = 168, identity = null) {
  let access = null;
  if (identity) {
    access = requireHubAccess(hubID, identity, true);
    if (!access.ok) {
      return access;
    }
  } else {
    const hub = getHubRecord(hubID);
    if (!hub) {
      return null;
    }
    access = {
      ok: true,
      hub,
    };
  }

  const seededHours = Math.max(1, normalizeInteger(hours, 168));
  const payloadState = buildHubUpgradePayloadState(access.hub.hubID);
  if (!payloadState) {
    return null;
  }

  const seededAmountsByFuelType = new Map();
  for (const upgrade of payloadState.upgrades || []) {
    if (upgrade.powerState !== POWER_STATE.POWER_STATE_ONLINE) {
      continue;
    }
    const definition = upgrade.definition || {};
    const fuelTypeID = normalizePositiveInteger(definition.fuelTypeID, null);
    if (!fuelTypeID) {
      continue;
    }
    const amountToSeed =
      Math.max(0, Number(definition.fuelStartupCost || 0)) +
      (Math.max(0, Number(definition.fuelConsumptionPerHour || 0)) * seededHours);
    seededAmountsByFuelType.set(
      fuelTypeID,
      (seededAmountsByFuelType.get(fuelTypeID) || 0) + amountToSeed,
    );
  }

  return mutateTable((table) => {
    const hub = normalizeHubRecord(table.hubs[String(access.hub.hubID)], access.hub);
    for (const [fuelTypeID, amount] of seededAmountsByFuelType.entries()) {
      const currentEntry = hub.fuelByTypeID[String(fuelTypeID)] || { amount: 0 };
      hub.fuelByTypeID[String(fuelTypeID)] = {
        amount: Math.max(
          normalizeInteger(currentEntry.amount, 0),
          Math.ceil(Math.max(0, Number(amount) || 0)),
        ),
      };
    }
    hub.fuelLastUpdatedMs = Date.now();
    table.hubs[String(hub.hubID)] = hub;
    return {
      ok: true,
      hubID: hub.hubID,
      solarSystemID: hub.solarSystemID,
      seededHours,
      fuelByTypeID: cloneValue(hub.fuelByTypeID),
    };
  });
}

function getWorkforceConfiguration(hubID, identity = null) {
  if (identity) {
    const access = requireHubAccess(hubID, identity, true);
    if (!access.ok) {
      return access;
    }
  }
  const hub = getHubRecord(hubID);
  if (!hub) {
    return null;
  }
  return {
    hubID: hub.hubID,
    solarSystemID: hub.solarSystemID,
    configuration: cloneValue(hub.workforceConfiguration),
    lastUpdatedMs: hub.workforceLastUpdatedMs || 0,
  };
}

function getWorkforceState(hubID, identity = null) {
  if (identity) {
    const access = requireHubAccess(hubID, identity, true);
    if (!access.ok) {
      return access;
    }
  }
  const stateCache = ensureLoaded();
  const hub = stateCache.hubsByID.get(normalizePositiveInteger(hubID, 0)) || null;
  if (!hub) {
    return null;
  }
  return {
    hubID: hub.hubID,
    solarSystemID: hub.solarSystemID,
    state: buildWorkforceState(
      hub.workforceConfiguration,
      hub,
      stateCache,
    ),
    lastUpdatedMs: hub.workforceLastUpdatedMs || 0,
  };
}

function configureWorkforce(hubID, configuration, identity) {
  const access = requireHubAccess(hubID, identity, true);
  if (!access.ok) {
    return access;
  }
  const normalizedConfiguration = normalizeWorkforceConfiguration(
    configuration,
    access.hub.hubID,
  );
  const previousState = getWorkforceState(access.hub.hubID);
  return mutateTable((table) => {
    const hub = normalizeHubRecord(table.hubs[String(access.hub.hubID)], access.hub);
    const previousConfiguration = cloneValue(hub.workforceConfiguration);
    hub.workforceConfiguration = normalizedConfiguration;
    hub.workforceLastUpdatedMs = Date.now();
    table.hubs[String(hub.hubID)] = hub;
    const refreshedState = buildWorkforceState(
      normalizedConfiguration,
      hub,
      ensureLoaded(),
    );
    return {
      ok: true,
      hubID: hub.hubID,
      solarSystemID: hub.solarSystemID,
      previousConfiguration,
      nextConfiguration: cloneValue(normalizedConfiguration),
      previousState: previousState ? previousState.state : null,
      nextState: refreshedState,
    };
  });
}

function listNetworkableHubs(hubID, identity = null) {
  if (identity) {
    const access = requireHubAccess(hubID, identity, true);
    if (!access.ok) {
      return access;
    }
  }
  const stateCache = ensureLoaded();
  const hub = stateCache.hubsByID.get(normalizePositiveInteger(hubID, 0)) || null;
  if (!hub) {
    return null;
  }
  const hubs = [...stateCache.hubsByID.values()]
    .filter(
      (candidate) =>
        candidate.hubID !== hub.hubID &&
        candidate.allianceID === hub.allianceID,
    )
    .sort((left, right) => left.solarSystemID - right.solarSystemID)
    .map((candidate) => ({
      hubID: candidate.hubID,
      solarSystemID: candidate.solarSystemID,
      configuration: cloneValue(candidate.workforceConfiguration),
      state: buildWorkforceState(
        candidate.workforceConfiguration,
        candidate,
        stateCache,
      ),
    }));
  return {
    hubID: hub.hubID,
    solarSystemID: hub.solarSystemID,
    hubs,
  };
}

function buildSkyhookGatewayState(skyhook) {
  const stateCache = ensureLoaded();
  const vulnerability = deriveSkyhookTheftVulnerability(skyhook);
  return {
    skyhookID: skyhook.skyhookID,
    solarSystemID: skyhook.solarSystemID,
    planetID: skyhook.planetID,
    corporationID: skyhook.corporationID,
    allianceID: skyhook.allianceID,
    active: skyhook.active,
    workforceAmount: skyhook.workforceAmount,
    reagentDefinitions: cloneValue(skyhook.reagentDefinitions),
    reagentSimulations: cloneValue(skyhook.reagentSimulations),
    theftVulnerability: vulnerability,
    planetResourcesVersion: cloneValue(
      stateCache.staticSnapshot.planetDefinitionsVersion,
    ),
  };
}

function getSkyhook(skyhookID, identity) {
  const access = requireSkyhookAccess(skyhookID, identity, {
    allowLocalSystem: true,
    requireOwnership: true,
  });
  if (!access.ok) {
    return access;
  }
  return {
    ok: true,
    skyhook: buildSkyhookGatewayState(access.skyhook),
  };
}

function listLocalSkyhooks(identity) {
  const solarSystemID = normalizePositiveInteger(identity && identity.solarSystemID, 0);
  return {
    solarSystemID,
    skyhooks: cloneValue(
      (ensureLoaded().skyhooksBySolarSystemID.get(solarSystemID) || []).map(
        buildSkyhookGatewayState,
      ),
    ),
  };
}

function listSkyhooksByCorporation(corporationID, identity) {
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  if (!numericCorporationID) {
    return {
      ok: false,
      statusCode: 404,
      errorCode: "NOT_FOUND",
    };
  }
  if (numericCorporationID !== normalizePositiveInteger(identity && identity.corporationID, 0)) {
    return {
      ok: false,
      statusCode: 403,
      errorCode: "FORBIDDEN_REQUEST",
    };
  }
  return {
    ok: true,
    corporationID: numericCorporationID,
    skyhooks: cloneValue(
      (ensureLoaded().skyhooksByCorporationID.get(numericCorporationID) || []).map(
        buildSkyhookGatewayState,
      ),
    ),
  };
}

function setSkyhookActivation(skyhookID, active, identity) {
  const access = requireSkyhookAccess(skyhookID, identity, {
    requireOwnership: true,
  });
  if (!access.ok) {
    return access;
  }
  return mutateTable((table) => {
    const skyhook = normalizeSkyhookRecord(
      table.skyhooks[String(access.skyhook.skyhookID)],
      access.skyhook,
    );
    skyhook.active = Boolean(active);
    skyhook.lastUpdatedMs = Date.now();
    table.skyhooks[String(skyhook.skyhookID)] = skyhook;
    return {
      ok: true,
      skyhookID: skyhook.skyhookID,
      solarSystemID: skyhook.solarSystemID,
      planetID: skyhook.planetID,
      skyhook: buildSkyhookGatewayState(skyhook),
    };
  });
}

function listSolarSystemsWithTheftVulnerableSkyhooks() {
  return [...ensureLoaded().vulnerableSkyhooksBySolarSystemID.keys()].sort(
    (left, right) => left - right,
  );
}

function listTheftVulnerableSkyhooksInSolarSystem(solarSystemID) {
  return cloneValue(
    ensureLoaded().vulnerableSkyhooksBySolarSystemID.get(
      normalizePositiveInteger(solarSystemID, 0),
    ) || [],
  );
}

function modifySkyhookReagents(skyhookID, reagentStates, identity) {
  const access = requireSkyhookAccess(skyhookID, identity, {
    requireOwnership: true,
  });
  if (!access.ok) {
    return access;
  }
  return mutateTable((table) => {
    const skyhook = normalizeSkyhookRecord(
      table.skyhooks[String(access.skyhook.skyhookID)],
      access.skyhook,
    );
    for (const reagentState of reagentStates || []) {
      const reagentTypeID = normalizePositiveInteger(reagentState.reagentTypeID, null);
      if (!reagentTypeID) {
        continue;
      }
      const existingIndex = skyhook.reagentSimulations.findIndex(
        (entry) => entry.reagentTypeID === reagentTypeID,
      );
      const updatedEntry = {
        reagentTypeID,
        securedStock: Math.max(0, normalizeInteger(reagentState.securedStock, 0)),
        unsecuredStock: Math.max(
          0,
          normalizeInteger(reagentState.unsecuredStock, 0),
        ),
        lastCycleMs: normalizeTimestampMs(
          reagentState.timestampMs,
          Date.now(),
        ),
      };
      if (existingIndex >= 0) {
        skyhook.reagentSimulations[existingIndex] = updatedEntry;
      } else {
        skyhook.reagentSimulations.push(updatedEntry);
      }
    }
    skyhook.reagentSimulations.sort(
      (left, right) => left.reagentTypeID - right.reagentTypeID,
    );
    skyhook.lastUpdatedMs = Date.now();
    table.skyhooks[String(skyhook.skyhookID)] = skyhook;
    return {
      ok: true,
      skyhookID: skyhook.skyhookID,
      solarSystemID: skyhook.solarSystemID,
      planetID: skyhook.planetID,
      skyhook: buildSkyhookGatewayState(skyhook),
    };
  });
}

function getFuelAccessGroupID(solarSystemID) {
  const table = readSovereigntyTable();
  const system = table.systems[String(normalizePositiveInteger(solarSystemID, 0))] || null;
  return normalizePositiveInteger(system && system.fuelAccessGroupID, null);
}

function setFuelAccessGroupID(solarSystemID, fuelAccessGroupID) {
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  if (!numericSolarSystemID) {
    return null;
  }
  const normalizedGroupID = normalizePositiveInteger(fuelAccessGroupID, null);
  const result = mutateTable((table) => {
    const systemKey = String(numericSolarSystemID);
    const currentSystem = table.systems[systemKey] || {
      solarSystemID: numericSolarSystemID,
    };
    table.systems[systemKey] = {
      ...currentSystem,
      fuelAccessGroupID: normalizedGroupID,
    };
    return {
      ok: true,
    };
  });
  return result && result.ok ? normalizedGroupID : null;
}

function isOnLocalFuelAccessGroup(session) {
  const solarSystemID = normalizePositiveInteger(
    session && (session.solarsystemid2 || session.solarsystemid),
    0,
  );
  const fuelAccessGroupID = getFuelAccessGroupID(solarSystemID);
  if (!fuelAccessGroupID) {
    return true;
  }
  const system = readSovereigntyTable().systems[String(solarSystemID)] || null;
  if (!system) {
    return false;
  }
  const corporationID = normalizePositiveInteger(
    session && (session.corporationID || session.corpid),
    0,
  );
  const allianceID = normalizePositiveInteger(
    session && (session.allianceID || session.allianceid),
    0,
  );
  return (
    corporationID === normalizePositiveInteger(system.corporationID, 0) ||
    allianceID === normalizePositiveInteger(system.allianceID, 0)
  );
}

function acquireSkyhooks(skyhookIDs, fuelAccessGroupID, session) {
  const systemSolarSystemID = normalizePositiveInteger(
    session && (session.solarsystemid2 || session.solarsystemid),
    0,
  );
  const corporationID = normalizePositiveInteger(
    session && (session.corporationID || session.corpid),
    0,
  );
  const allianceID = normalizePositiveInteger(
    session && (session.allianceID || session.allianceid),
    0,
  );
  if (!systemSolarSystemID || !corporationID || !allianceID) {
    return [];
  }
  const normalizedSkyhookIDs = normalizePositiveArray(skyhookIDs);
  if (normalizedSkyhookIDs.length === 0) {
    if (fuelAccessGroupID !== undefined) {
      setFuelAccessGroupID(systemSolarSystemID, fuelAccessGroupID);
    }
    return [];
  }

  const result = mutateTable((table) => {
    const processed = [];
    for (const skyhookID of normalizedSkyhookIDs) {
      const existing = table.skyhooks[String(skyhookID)];
      if (!existing) {
        continue;
      }
      const skyhook = normalizeSkyhookRecord(existing, existing);
      skyhook.solarSystemID = systemSolarSystemID;
      skyhook.corporationID = corporationID;
      skyhook.allianceID = allianceID;
      skyhook.lastUpdatedMs = Date.now();
      table.skyhooks[String(skyhookID)] = skyhook;
      processed.push(skyhookID);
    }
    const systemKey = String(systemSolarSystemID);
    table.systems[systemKey] = {
      ...(table.systems[systemKey] || { solarSystemID: systemSolarSystemID }),
      fuelAccessGroupID: normalizePositiveInteger(fuelAccessGroupID, null),
    };
    return {
      ok: true,
      processed,
    };
  });
  return cloneValue(result.processed || []);
}

function destroySkyhooks(skyhookIDs) {
  const normalizedSkyhookIDs = normalizePositiveArray(skyhookIDs);
  if (normalizedSkyhookIDs.length === 0) {
    return [];
  }
  const result = mutateTable((table) => {
    const processed = [];
    for (const skyhookID of normalizedSkyhookIDs) {
      if (!table.skyhooks[String(skyhookID)]) {
        continue;
      }
      delete table.skyhooks[String(skyhookID)];
      processed.push(skyhookID);
    }
    return {
      ok: true,
      processed,
    };
  });
  return cloneValue(result.processed || []);
}

function resetSovereigntyModernStateForTests() {
  cache = null;
}

function invalidateSovereigntyModernStateCache() {
  cache = null;
}

module.exports = {
  POWER_STATE,
  acquireSkyhooks,
  addHubFuel,
  configureWorkforce,
  destroySkyhooks,
  getActiveCharacterIdentity,
  getFuelAccessGroupID,
  getHubFuel,
  getHubIDForSolarSystem,
  getHubResources,
  getHubUpgrades,
  getSkyhook,
  getWorkforceConfiguration,
  getWorkforceState,
  isOnLocalFuelAccessGroup,
  listLocalSkyhooks,
  listNetworkableHubs,
  listSkyhooksByCorporation,
  listSolarSystemsWithTheftVulnerableSkyhooks,
  listTheftVulnerableSkyhooksInSolarSystem,
  listUpgradeDefinitions,
  modifySkyhookReagents,
  processHubUpgradeConfiguration,
  resetSovereigntyModernStateForTests,
  invalidateSovereigntyModernStateCache,
  seedHubFuelForInstalledUpgrades,
  setHubUpgradeInstallations,
  setFuelAccessGroupID,
  setSkyhookActivation,
  uninstallHubUpgrade,
};
