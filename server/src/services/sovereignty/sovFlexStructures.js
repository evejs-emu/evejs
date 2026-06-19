const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const structureState = require(path.join(
  __dirname,
  "../structure/structureState",
));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(__dirname, "../structure/structureConstants"));
const {
  buildAnchorLayout,
  cloneSpacePoint,
  normalizePositiveInteger,
} = require(path.join(__dirname, "./sovAnchorLayout"));
const {
  getStructurePositionsForSystem,
} = require(path.join(__dirname, "./sovAutoNavigation"));
const {
  getHubIDForSolarSystem,
  getHubUpgrades,
  seedHubFuelForInstalledUpgrades,
  setHubUpgradeInstallations,
} = require(path.join(__dirname, "./sovModernState"));
const {
  getSystemState,
} = require(path.join(__dirname, "./sovState"));
const {
  TYPE_ANSIBLEX_JUMP_BRIDGE,
  TYPE_ADVANCED_LOGISTICS_NETWORK_UPGRADE,
  TYPE_CYNO_NAVIGATION_UPGRADE,
  TYPE_CYNO_SUPPRESSION_UPGRADE,
  TYPE_PHAROLUX_CYNO_BEACON,
  TYPE_TENEBREX_CYNO_JAMMER,
  canSolarSystemSupportUpgrade,
} = require(path.join(__dirname, "./sovUpgradeSupport"));

const TYPE_LIQUID_OZONE = 16273;
const DEFAULT_SOV_FLEX_FUEL_HOURS = 168;
const HOUR_MS = 60 * 60 * 1000;
const FLEX_DEPLOY_FAST_FORWARD_SHORT_SECONDS = 901;
const FLEX_DEPLOY_FAST_FORWARD_LONG_SECONDS = 86_401;

const FLEX_DEFINITION_BY_KIND = Object.freeze({
  pharolux: Object.freeze({
    kind: "pharolux",
    label: "Pharolux Cyno Beacon",
    typeID: TYPE_PHAROLUX_CYNO_BEACON,
    serviceID: STRUCTURE_SERVICE_ID.CYNO_BEACON,
    requiredUpgradeTypeID: TYPE_CYNO_NAVIGATION_UPGRADE,
    offset: Object.freeze({ x: 95_000, y: 0, z: -70_000 }),
  }),
  ansiblex: Object.freeze({
    kind: "ansiblex",
    label: "Ansiblex Jump Bridge",
    typeID: TYPE_ANSIBLEX_JUMP_BRIDGE,
    serviceID: STRUCTURE_SERVICE_ID.JUMP_BRIDGE,
    requiredUpgradeTypeID: TYPE_ADVANCED_LOGISTICS_NETWORK_UPGRADE,
    offset: Object.freeze({ x: -95_000, y: 0, z: -70_000 }),
  }),
  tenebrex: Object.freeze({
    kind: "tenebrex",
    label: "Tenebrex Cyno Jammer",
    typeID: TYPE_TENEBREX_CYNO_JAMMER,
    serviceID: STRUCTURE_SERVICE_ID.CYNO_JAMMER,
    requiredUpgradeTypeID: TYPE_CYNO_SUPPRESSION_UPGRADE,
    offset: Object.freeze({ x: 50_000, y: 0, z: 40_000 }),
  }),
});

const FLEX_KIND_ORDER = Object.freeze(["pharolux", "ansiblex", "tenebrex"]);
const FLEX_TYPE_IDS = new Set(
  FLEX_KIND_ORDER.map((kind) => FLEX_DEFINITION_BY_KIND[kind].typeID),
);

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function clonePoint(value, fallback = null) {
  const point = cloneSpacePoint(value, fallback);
  return point ? { ...point } : fallback;
}

function addPoint(left, right) {
  const leftPoint = clonePoint(left, null);
  const rightPoint = clonePoint(right, null);
  if (!leftPoint || !rightPoint) {
    return null;
  }
  return {
    x: leftPoint.x + rightPoint.x,
    y: leftPoint.y + rightPoint.y,
    z: leftPoint.z + rightPoint.z,
  };
}

function getTypeDogmaRecord(typeID) {
  const dogma = readStaticTable(TABLE.TYPE_DOGMA);
  return (
    dogma &&
    dogma.typesByTypeID &&
    dogma.typesByTypeID[String(normalizePositiveInteger(typeID, 0))]
  ) || null;
}

function getDogmaAttributeValue(typeID, attributeID, fallback = 0) {
  const record = getTypeDogmaRecord(typeID);
  const attributes = record && record.attributes ? record.attributes : null;
  const rawValue =
    attributes && Object.prototype.hasOwnProperty.call(attributes, String(attributeID))
      ? attributes[String(attributeID)]
      : fallback;
  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeSovereigntyFlexKind(token) {
  const normalized = String(token || "").trim().toLowerCase();
  if (!normalized || normalized === "all" || normalized === "flex" || normalized === "flexes") {
    return "all";
  }
  if (normalized === "beacon") {
    return "pharolux";
  }
  if (normalized === "bridge" || normalized === "jumpbridge") {
    return "ansiblex";
  }
  if (normalized === "jammer") {
    return "tenebrex";
  }
  return Object.prototype.hasOwnProperty.call(FLEX_DEFINITION_BY_KIND, normalized)
    ? normalized
    : null;
}

function getSovereigntyFlexDefinitions(kind = "all") {
  const normalizedKind = normalizeSovereigntyFlexKind(kind);
  if (!normalizedKind) {
    return [];
  }
  if (normalizedKind === "all") {
    return FLEX_KIND_ORDER.map((entry) => FLEX_DEFINITION_BY_KIND[entry]);
  }
  return [FLEX_DEFINITION_BY_KIND[normalizedKind]];
}

function listSovereigntyFlexStructuresForSystem(solarSystemID) {
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, null);
  if (!numericSolarSystemID) {
    return [];
  }
  return structureState.listStructuresForSystem(numericSolarSystemID, {
    includeDestroyed: true,
    refresh: false,
  }).filter((structure) =>
    FLEX_TYPE_IDS.has(normalizePositiveInteger(structure && structure.typeID, 0)));
}

function getFlexStructureByKind(solarSystemID, kind) {
  const definition = FLEX_DEFINITION_BY_KIND[String(kind || "").trim().toLowerCase()] || null;
  if (!definition) {
    return null;
  }
  return listSovereigntyFlexStructuresForSystem(solarSystemID).find(
    (structure) => normalizePositiveInteger(structure && structure.typeID, 0) === definition.typeID,
  ) || null;
}

function getFlexFuelProfile(definition) {
  const serviceModuleTypeID = normalizePositiveInteger(
    getDogmaAttributeValue(definition.typeID, 2792, 0),
    null,
  );
  const hourlyAmount = Math.max(
    0,
    getDogmaAttributeValue(serviceModuleTypeID, 2109, 0),
  );
  const onlineAmount = Math.max(
    0,
    getDogmaAttributeValue(serviceModuleTypeID, 2110, 0),
  );
  return {
    serviceModuleTypeID,
    fuelTypeID: TYPE_LIQUID_OZONE,
    hourlyAmount,
    onlineAmount,
  };
}

function buildFlexPosition(solarSystemID, definition) {
  const currentPositions = getStructurePositionsForSystem(solarSystemID);
  const basePoint = clonePoint(
    currentPositions.positionsByKind.ihub || currentPositions.positionsByKind.tcu,
    null,
  );
  if (basePoint) {
    return addPoint(basePoint, definition.offset);
  }
  return addPoint(
    buildAnchorLayout(solarSystemID).primaryPoint,
    definition.offset,
  );
}

function normalizePoint(value, fallback = null) {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return fallback;
  }
  return { x, y, z };
}

function getJumpBridgeDestinationSolarSystemID(structure) {
  const devFlags =
    structure && structure.devFlags && typeof structure.devFlags === "object"
      ? structure.devFlags
      : {};
  return normalizePositiveInteger(
    devFlags.destinationSolarsystemID ||
    devFlags.sovereigntyJumpBridgeDestinationSolarsystemID,
    null,
  );
}

function syncStructureRuntime(structureOrSystemID) {
  const solarSystemID =
    typeof structureOrSystemID === "object" && structureOrSystemID !== null
      ? normalizePositiveInteger(structureOrSystemID.solarSystemID, 0)
      : normalizePositiveInteger(structureOrSystemID, 0);
  if (!solarSystemID) {
    return;
  }
  if (typeof spaceRuntime.syncStructureSceneState === "function") {
    spaceRuntime.syncStructureSceneState(solarSystemID);
  }
}

function advanceStructureTimers(structureID, seconds) {
  const result = structureState.fastForwardStructure(structureID, seconds);
  if (!result.success) {
    return result;
  }
  structureState.tickStructures(Date.now());
  const structure = structureState.getStructureByID(structureID, { refresh: false });
  syncStructureRuntime(structure || result.data);
  return {
    success: true,
    data: structure || result.data,
  };
}

function seedSovereigntyFlexFuel(structureID, hours = DEFAULT_SOV_FLEX_FUEL_HOURS) {
  const structure = structureState.getStructureByID(structureID, { refresh: false });
  if (!structure) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  const definition = getSovereigntyFlexDefinitions().find(
    (entry) => entry.typeID === normalizePositiveInteger(structure.typeID, 0),
  );
  if (!definition) {
    return {
      success: false,
      errorMsg: "SOV_FLEX_TYPE_NOT_FOUND",
    };
  }
  const fuelProfile = getFlexFuelProfile(definition);
  const seededHours = Math.max(1, normalizeInteger(hours, DEFAULT_SOV_FLEX_FUEL_HOURS));
  const liquidOzoneQty = Math.ceil(
    Math.max(0, fuelProfile.onlineAmount) +
    (Math.max(0, fuelProfile.hourlyAmount) * seededHours),
  );
  const fuelExpiresAt = Date.now() + (seededHours * HOUR_MS);
  const updateResult = structureState.updateStructureRecord(structureID, (current) => ({
    ...current,
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
    fuelExpiresAt,
    liquidOzoneQty,
  }));
  if (!updateResult.success) {
    return updateResult;
  }
  syncStructureRuntime(updateResult.data);
  return {
    success: true,
    data: {
      ...updateResult.data,
      fuelTypeID: fuelProfile.fuelTypeID,
      fuelHours: seededHours,
      liquidOzoneQty,
      fuelExpiresAt,
    },
  };
}

function ensureFlexUpgradeOnline(solarSystemID, definition, identity, fuelHours) {
  const hubID = normalizePositiveInteger(getHubIDForSolarSystem(solarSystemID), null);
  if (!hubID) {
    return {
      success: false,
      errorMsg: "HUB_NOT_FOUND",
    };
  }
  if (!canSolarSystemSupportUpgrade(solarSystemID, definition.requiredUpgradeTypeID)) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_LOCAL_CAPACITY",
    };
  }
  const upgradeResult = setHubUpgradeInstallations(
    hubID,
    [{ typeID: definition.requiredUpgradeTypeID, online: true }],
    identity,
  );
  if (!upgradeResult.ok) {
    return {
      success: false,
      errorMsg: upgradeResult.errorCode || "HUB_UPGRADE_CONFIGURATION_FAILED",
    };
  }
  const upgradeSnapshot = getHubUpgrades(hubID, identity);
  const requiredUpgrade =
    upgradeSnapshot &&
    Array.isArray(upgradeSnapshot.upgrades)
      ? upgradeSnapshot.upgrades.find(
        (entry) => Number(entry && entry.typeID) === definition.requiredUpgradeTypeID,
      ) || null
      : null;
  if (!requiredUpgrade || Number(requiredUpgrade.powerState) !== 2) {
    return {
      success: false,
      errorMsg: "REQUIRED_HUB_UPGRADE_NOT_ONLINE",
    };
  }
  const seedFuelResult = seedHubFuelForInstalledUpgrades(
    hubID,
    fuelHours,
    identity,
  );
  return {
    success: true,
    data: {
      hubID,
      requiredUpgrade,
      hubFuel: seedFuelResult && seedFuelResult.ok ? seedFuelResult : null,
    },
  };
}

function deploySovereigntyFlexStructure(session, kind, options = {}) {
  const definition = getSovereigntyFlexDefinitions(kind)[0] || null;
  if (!definition) {
    return {
      success: false,
      errorMsg: "SOV_FLEX_KIND_NOT_FOUND",
    };
  }

  const solarSystemID = normalizePositiveInteger(
    options.solarSystemID || (session && (session.solarsystemid2 || session.solarsystemid)),
    null,
  );
  if (!solarSystemID) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_REQUIRED",
    };
  }

  const system = getSystemState(solarSystemID) || null;
  const allianceID = normalizePositiveInteger(
    options.allianceID || (system && system.allianceID) || (session && (session.allianceID || session.allianceid)),
    null,
  );
  const corporationID = normalizePositiveInteger(
    options.ownerCorpID || options.corporationID || (system && system.corporationID) || (session && (session.corporationID || session.corpid)),
    null,
  );
  if (
    !system ||
    !normalizePositiveInteger(system.infrastructureHubID, null) ||
    !normalizePositiveInteger(system.allianceID, null)
  ) {
    return {
      success: false,
      errorMsg: "SOV_HUB_REQUIRED",
    };
  }
  if (!allianceID || !corporationID) {
    return {
      success: false,
      errorMsg: "TARGET_OWNER_REQUIRED",
    };
  }

  const existing = getFlexStructureByKind(solarSystemID, definition.kind);
  if (existing && options.reuseExisting !== true) {
    return {
      success: false,
      errorMsg: "STRUCTURE_ALREADY_EXISTS",
      data: {
        structure: existing,
      },
    };
  }

  const identity = {
    characterID: normalizePositiveInteger(
      session && (session.characterID || session.charid || session.userid),
      0,
    ) || 0,
    solarSystemID,
    allianceID,
    corporationID,
  };
  const fuelHours = Math.max(
    1,
    normalizeInteger(options.fuelHours, DEFAULT_SOV_FLEX_FUEL_HOURS),
  );
  const upgradeResult = ensureFlexUpgradeOnline(
    solarSystemID,
    definition,
    identity,
    fuelHours,
  );
  if (!upgradeResult.success) {
    return upgradeResult;
  }

  if (existing) {
    const refuelResult = seedSovereigntyFlexFuel(existing.structureID, fuelHours);
    return refuelResult.success
      ? {
        success: true,
        data: {
          structure: refuelResult.data,
          created: false,
          definition,
          hubID: upgradeResult.data.hubID,
          requiredUpgrade: upgradeResult.data.requiredUpgrade,
        },
      }
      : refuelResult;
  }

  const seedResult = structureState.seedStructureForSession(
    session || {},
    definition.typeID,
    {
      solarSystemID,
      ownerCorpID: corporationID,
      allianceID,
      position: normalizePoint(
        options.position,
        buildFlexPosition(solarSystemID, definition),
      ),
      name: options.name || definition.label,
      itemName: options.name || definition.label,
      profileID: options.profileID,
      reinforceWeekday: options.reinforceWeekday,
      reinforceHour: options.reinforceHour,
      devFlags: {
        sovereigntyFlex: true,
        sovereigntyFlexKind: definition.kind,
        ...(normalizePositiveInteger(options.destinationSolarsystemID, null)
          ? {
            destinationSolarsystemID: normalizePositiveInteger(options.destinationSolarsystemID, null),
            sovereigntyJumpBridgeDestinationSolarsystemID: normalizePositiveInteger(options.destinationSolarsystemID, null),
          }
          : {}),
        ...(options.devFlags || {}),
      },
    },
  );
  if (!seedResult.success) {
    return seedResult;
  }
  syncStructureRuntime(seedResult.data);

  const structureID = seedResult.data.structureID;
  const anchorResult = structureState.startAnchoring(structureID);
  if (!anchorResult.success) {
    return anchorResult;
  }
  syncStructureRuntime(anchorResult.data);

  const fastForwardShortResult = advanceStructureTimers(
    structureID,
    FLEX_DEPLOY_FAST_FORWARD_SHORT_SECONDS,
  );
  if (!fastForwardShortResult.success) {
    return fastForwardShortResult;
  }

  const fastForwardLongResult = advanceStructureTimers(
    structureID,
    FLEX_DEPLOY_FAST_FORWARD_LONG_SECONDS,
  );
  if (!fastForwardLongResult.success) {
    return fastForwardLongResult;
  }

  const coreResult = structureState.setStructureQuantumCoreInstalled(structureID, true);
  if (!coreResult.success) {
    return coreResult;
  }
  syncStructureRuntime(coreResult.data);

  const serviceResult = structureState.setStructureServiceState(
    structureID,
    definition.serviceID,
    STRUCTURE_SERVICE_STATE.ONLINE,
  );
  if (!serviceResult.success) {
    return serviceResult;
  }
  syncStructureRuntime(serviceResult.data);

  const serviceFastForwardResult = advanceStructureTimers(
    structureID,
    FLEX_DEPLOY_FAST_FORWARD_SHORT_SECONDS,
  );
  if (!serviceFastForwardResult.success) {
    return serviceFastForwardResult;
  }

  const fuelResult = seedSovereigntyFlexFuel(structureID, fuelHours);
  if (!fuelResult.success) {
    return fuelResult;
  }

  return {
    success: true,
    data: {
      structure: fuelResult.data,
      created: true,
      definition,
      hubID: upgradeResult.data.hubID,
      requiredUpgrade: upgradeResult.data.requiredUpgrade,
    },
  };
}

module.exports = {
  DEFAULT_SOV_FLEX_FUEL_HOURS,
  TYPE_LIQUID_OZONE,
  deploySovereigntyFlexStructure,
  getFlexStructureByKind,
  getJumpBridgeDestinationSolarSystemID,
  getSovereigntyFlexDefinitions,
  listSovereigntyFlexStructuresForSystem,
  normalizeSovereigntyFlexKind,
  seedSovereigntyFlexFuel,
};
