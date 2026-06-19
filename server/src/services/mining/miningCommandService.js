const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const BaseService = require(path.join(__dirname, "../baseService"));
const {
  spawnShipInHangarForSession,
  activateShipForSession,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  ITEM_FLAGS,
  grantItemsToCharacterStationHangar,
  moveItemTypeFromCharacterLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveShipByName,
} = require(path.join(__dirname, "../chat/shipTypeRegistry"));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  buildShipResourceState,
  isChargeCompatibleWithModule,
  listFittedItems,
  selectAutoFitFlagForType,
  validateFitForShip,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  getDockedLocationID,
} = require(path.join(__dirname, "../structure/structureLocation"));
const npcService = require(path.join(__dirname, "../../space/npc"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  ONE_AU_IN_METERS,
  findSafeWarpOriginAnchor,
} = require(path.join(__dirname, "../../space/npc/npcWarpOrigins"));
const {
  resetSceneMiningState,
  summarizeSceneMiningState,
} = require("./miningRuntimeState");
const {
  handleMiningFleetCommand: executeMiningFleetCommand,
  handleMiningFleetAggroCommand: executeMiningFleetAggroCommand,
  handleMiningFleetClearCommand: executeMiningFleetClearCommand,
  handleMiningFleetStatusCommand: executeMiningFleetStatusCommand,
  handleMiningFleetRetreatCommand: executeMiningFleetRetreatCommand,
  handleMiningFleetResumeCommand: executeMiningFleetResumeCommand,
  handleMiningFleetHaulCommand: executeMiningFleetHaulCommand,
  getMiningFleetsForSystem: getTrackedMiningFleetsForSystem,
  pruneMiningFleet: pruneTrackedMiningFleet,
} = require("./miningNpcOperations");

const MAX_MINING_NPC_COMMAND_SPAWN_COUNT = 25;
const DEFAULT_MINER_SHIP_NAME = "Hulk";
const DEFAULT_MINER_MODULE_NAME = "Modulated Strip Miner II";
const DEFAULT_MINER_MODULE_COUNT = 2;
const DEFAULT_MINER_MOBILITY_MODULE_NAME = "Medium Micro Jump Drive";
const DEFAULT_MINER_MOBILITY_MODULE_COUNT = 1;
const DEFAULT_MINER_SUPPORT_MODULE_NAME = "Expanded Cargohold II";
const DEFAULT_MINER_SUPPORT_MODULE_COUNT = 3;
const DEFAULT_MINER_RIG_NAME = "Medium Cargohold Optimization I";
const DEFAULT_MINER_RIG_COUNT = 2;
const DEFAULT_MINER_CRYSTALS_PER_TYPE = 1;
const DEFAULT_MINING_FLEET_QUERY = "npc_mining_ops";
const DEFAULT_MINING_RESPONSE_QUERY = "npc_laser_hostiles";
const DEFAULT_MINING_FLEET_COUNT = 3;
const DEFAULT_MINING_RESPONSE_COUNT = 3;
const DEFAULT_MINING_WARP_INGRESS_DURATION_MS = 2_500;
const DEFAULT_MINING_WARP_LANDING_RADIUS_METERS = 2_500;
const DEFAULT_MINING_FLEET_SPREAD_METERS = 1_500;
const miningFleetStateByID = new Map();
let nextMiningFleetID = 1;
let compatibleChargeTypeCache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = toInt(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function dedupeItemTypes(itemTypes) {
  const seen = new Set();
  const deduped = [];
  for (const itemType of Array.isArray(itemTypes) ? itemTypes : []) {
    const typeID = toInt(itemType && itemType.typeID, 0);
    if (typeID <= 0 || seen.has(typeID)) {
      continue;
    }
    seen.add(typeID);
    deduped.push(itemType);
  }
  return deduped;
}

function sortItemTypesByName(left, right) {
  return String(left && left.name || "").localeCompare(String(right && right.name || ""));
}

function syncInventoryChangesToSession(session, changes = []) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      {
        emitCfgLocation: true,
      },
    );
  }
}

function parseAmount(value) {
  const text = String(value || "")
    .trim()
    .replace(/,/g, "")
    .replace(/_/g, "");
  if (!text) {
    return null;
  }

  const match = /^(-?\d+(?:\.\d+)?)([kmbt])?$/i.exec(text);
  if (!match) {
    return null;
  }

  const baseValue = Number(match[1]);
  if (!Number.isFinite(baseValue)) {
    return null;
  }

  const multiplier = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
    t: 1_000_000_000_000,
  };
  const suffix = String(match[2] || "").toLowerCase();
  return baseValue * (multiplier[suffix] || 1);
}

function parseNpcSpawnArguments(argumentText, defaultAmount = 1) {
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      success: true,
      amount: defaultAmount,
      query: "",
    };
  }

  const parts = trimmed.split(/\s+/);
  let amount = defaultAmount;
  let amountIndex = -1;
  for (let index = 0; index < parts.length; index += 1) {
    const parsed = parseAmount(parts[index]);
    if (parsed === null) {
      continue;
    }
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return {
        success: false,
        errorMsg: "INVALID_AMOUNT",
      };
    }
    amount = parsed;
    amountIndex = index;
    break;
  }

  return {
    success: true,
    amount,
    query: amountIndex >= 0
      ? parts.filter((_, index) => index !== amountIndex).join(" ").trim()
      : trimmed,
  };
}

function buildPlannedFittedModuleItem(charID, shipItem, itemType, flagID, itemID) {
  return {
    itemID,
    typeID: toInt(itemType && itemType.typeID, 0),
    groupID: toInt(itemType && itemType.groupID, 0),
    categoryID: toInt(itemType && itemType.categoryID, 0),
    flagID: toInt(flagID, 0),
    locationID: toInt(shipItem && shipItem.itemID, 0),
    ownerID: toInt(charID, 0),
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    itemName: String(itemType && itemType.name || ""),
    moduleState: {
      online: true,
    },
  };
}

function canPlannedModulesStayOnline(charID, shipItem, plannedModules) {
  const resourceState = buildShipResourceState(charID, shipItem, {
    fittedItems: plannedModules,
  });
  return {
    resourceState,
    success:
      resourceState.cpuLoad <= resourceState.cpuOutput + 1e-6 &&
      resourceState.powerLoad <= resourceState.powerOutput + 1e-6 &&
      resourceState.upgradeLoad <= resourceState.upgradeCapacity + 1e-6,
  };
}

function tryPlanNextModuleFit(charID, shipItem, itemType, fittedItems) {
  const nextFlagID = selectAutoFitFlagForType(
    shipItem,
    fittedItems,
    toInt(itemType && itemType.typeID, 0),
  );
  if (!nextFlagID) {
    return {
      success: false,
      errorMsg: "NO_SLOT_AVAILABLE",
    };
  }

  const probeItem = buildPlannedFittedModuleItem(
    charID,
    shipItem,
    itemType,
    nextFlagID,
    -1000 - (Array.isArray(fittedItems) ? fittedItems.length : 0),
  );
  const validation = validateFitForShip(
    charID,
    shipItem,
    probeItem,
    nextFlagID,
    fittedItems,
  );
  if (!validation.success && validation.errorMsg !== "SKILL_REQUIRED") {
    return validation;
  }

  const plannedItems = [...(Array.isArray(fittedItems) ? fittedItems : []), probeItem];
  const resourceCheck = canPlannedModulesStayOnline(charID, shipItem, plannedItems);
  if (!resourceCheck.success) {
    if (resourceCheck.resourceState.upgradeLoad > resourceCheck.resourceState.upgradeCapacity + 1e-6) {
      return {
        success: false,
        errorMsg: "NOT_ENOUGH_UPGRADE_CAPACITY",
        data: {
          resourceState: resourceCheck.resourceState,
        },
      };
    }

    return {
      success: false,
      errorMsg:
        resourceCheck.resourceState.cpuLoad > resourceCheck.resourceState.cpuOutput + 1e-6
          ? "NOT_ENOUGH_CPU"
          : "NOT_ENOUGH_POWER",
      data: {
        resourceState: resourceCheck.resourceState,
      },
    };
  }

  return {
    success: true,
    data: {
      flagID: nextFlagID,
      plannedItems,
      resourceState: resourceCheck.resourceState,
    },
  };
}

function tryPlanNextModuleFitWithOptions(
  charID,
  shipItem,
  itemType,
  fittedItems,
  options = {},
) {
  const nextFit = tryPlanNextModuleFit(charID, shipItem, itemType, fittedItems);
  if (nextFit.success || options.forceFit !== true) {
    return nextFit;
  }

  const forcedFlagID = selectAutoFitFlagForType(
    shipItem,
    fittedItems,
    toInt(itemType && itemType.typeID, 0),
  );
  if (!forcedFlagID) {
    return nextFit;
  }

  const plannedItems = [
    ...(Array.isArray(fittedItems) ? fittedItems : []),
    buildPlannedFittedModuleItem(
      charID,
      shipItem,
      itemType,
      forcedFlagID,
      -1000 - (Array.isArray(fittedItems) ? fittedItems.length : 0),
    ),
  ];
  return {
    success: true,
    data: {
      flagID: forcedFlagID,
      plannedItems,
      resourceState: buildShipResourceState(charID, shipItem, {
        fittedItems: plannedItems,
      }),
      forced: true,
    },
  };
}

function ensureCompatibleChargeTypeCache() {
  if (compatibleChargeTypeCache) {
    return compatibleChargeTypeCache;
  }

  compatibleChargeTypeCache = new Map();
  const itemRows = readStaticRows(TABLE.ITEM_TYPES) || [];
  const chargeTypes = itemRows
    .filter((row) => toInt(row && row.categoryID, 0) === 8)
    .filter((row) => row.published !== false)
    .filter((row) => !/blueprint/i.test(String(row && row.name || "")))
    .map((row) => resolveItemByTypeID(row.typeID))
    .filter(Boolean)
    .sort(sortItemTypesByName);

  compatibleChargeTypeCache.set("__allCharges", chargeTypes);
  return compatibleChargeTypeCache;
}

function getCompatibleModuleChargeTypes(moduleTypeID) {
  const numericModuleTypeID = toInt(moduleTypeID, 0);
  if (numericModuleTypeID <= 0) {
    return [];
  }

  const cache = ensureCompatibleChargeTypeCache();
  if (cache.has(numericModuleTypeID)) {
    return cache.get(numericModuleTypeID);
  }

  const chargeTypes = dedupeItemTypes(
    (cache.get("__allCharges") || []).filter((itemType) =>
      isChargeCompatibleWithModule(numericModuleTypeID, itemType.typeID),
    ),
  );
  cache.set(numericModuleTypeID, chargeTypes);
  return chargeTypes;
}

function grantStationHangarBatchAndSyncSession(session, stationID, grantEntries) {
  const result = grantItemsToCharacterStationHangar(
    session.characterID,
    stationID,
    grantEntries,
  );
  if (!result.success) {
    return result;
  }

  syncInventoryChangesToSession(session, result.data && result.data.changes);
  return result;
}

function fitGrantedItemTypeToShip(session, stationID, shipItem, itemType, count, options = {}) {
  const numericCount = Math.max(1, toInt(count, 1));
  const forceFit = options.forceFit === true;
  let fittedCount = 0;
  let latestResourceState = null;

  for (let index = 0; index < numericCount; index += 1) {
    const fittedItems = listFittedItems(session.characterID, shipItem.itemID);
    const nextFit = tryPlanNextModuleFitWithOptions(
      session.characterID,
      shipItem,
      itemType,
      fittedItems,
      {
        forceFit,
      },
    );
    if (!nextFit.success) {
      break;
    }

    const moveResult = moveItemTypeFromCharacterLocation(
      session.characterID,
      stationID,
      ITEM_FLAGS.HANGAR,
      shipItem.itemID,
      nextFit.data.flagID,
      itemType.typeID,
      1,
    );
    if (!moveResult.success) {
      return {
        success: false,
        errorMsg: moveResult.errorMsg || "FIT_MOVE_FAILED",
      };
    }

    syncInventoryChangesToSession(session, moveResult.data && moveResult.data.changes);
    fittedCount += 1;
    latestResourceState = nextFit.data.resourceState;
  }

  return {
    success: true,
    data: {
      fittedCount,
      resourceState: latestResourceState,
    },
  };
}

function moveGrantedItemTypeToShipCargo(session, stationID, shipItem, itemType, quantity) {
  const moveResult = moveItemTypeFromCharacterLocation(
    session.characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    itemType.typeID,
    quantity,
  );
  if (!moveResult.success) {
    return moveResult;
  }

  syncInventoryChangesToSession(session, moveResult.data && moveResult.data.changes);
  return moveResult;
}

function resolveMinerCommandPreset() {
  return {
    shipName: String(config.miningCommandShipName || DEFAULT_MINER_SHIP_NAME),
    moduleName: String(config.miningCommandModuleName || DEFAULT_MINER_MODULE_NAME),
    moduleCount: Math.max(1, toInt(config.miningCommandModuleCount, DEFAULT_MINER_MODULE_COUNT)),
    mobilityModuleName: String(
      config.miningCommandMobilityModuleName || DEFAULT_MINER_MOBILITY_MODULE_NAME,
    ),
    mobilityModuleCount: Math.max(
      0,
      toInt(
        config.miningCommandMobilityModuleCount,
        DEFAULT_MINER_MOBILITY_MODULE_COUNT,
      ),
    ),
    supportModuleName: String(
      config.miningCommandSupportModuleName || DEFAULT_MINER_SUPPORT_MODULE_NAME,
    ),
    supportModuleCount: Math.max(
      0,
      toInt(
        config.miningCommandSupportModuleCount,
        DEFAULT_MINER_SUPPORT_MODULE_COUNT,
      ),
    ),
    rigName: String(config.miningCommandRigName || DEFAULT_MINER_RIG_NAME),
    rigCount: Math.max(0, toInt(config.miningCommandRigCount, DEFAULT_MINER_RIG_COUNT)),
    crystalsPerType: Math.max(
      1,
      toInt(config.miningCommandCrystalQuantityPerType, DEFAULT_MINER_CRYSTALS_PER_TYPE),
    ),
  };
}

function buildMinerCommandPlan(charID, shipItem) {
  const preset = resolveMinerCommandPreset();
  const moduleLookup = resolveItemByName(preset.moduleName);
  if (!moduleLookup || !moduleLookup.success || !moduleLookup.match) {
    return {
      success: false,
      errorMsg: "MINER_COMMAND_MODULE_NOT_FOUND",
    };
  }

  const supportModuleLookup = preset.supportModuleCount > 0
    ? resolveItemByName(preset.supportModuleName)
    : null;
  if (
    preset.supportModuleCount > 0 &&
    (!supportModuleLookup || !supportModuleLookup.success || !supportModuleLookup.match)
  ) {
    return {
      success: false,
      errorMsg: "MINER_COMMAND_SUPPORT_MODULE_NOT_FOUND",
    };
  }

  const rigLookup = preset.rigCount > 0
    ? resolveItemByName(preset.rigName)
    : null;
  if (preset.rigCount > 0 && (!rigLookup || !rigLookup.success || !rigLookup.match)) {
    return {
      success: false,
      errorMsg: "MINER_COMMAND_RIG_NOT_FOUND",
    };
  }

  const mobilityModuleLookup = preset.mobilityModuleCount > 0
    ? resolveItemByName(preset.mobilityModuleName)
    : null;
  if (
    preset.mobilityModuleCount > 0 &&
    (!mobilityModuleLookup || !mobilityModuleLookup.success || !mobilityModuleLookup.match)
  ) {
    return {
      success: false,
      errorMsg: "MINER_COMMAND_MOBILITY_MODULE_NOT_FOUND",
    };
  }

  let plannedItems = [];
  let latestResourceState = buildShipResourceState(charID, shipItem);
  for (let index = 0; index < preset.moduleCount; index += 1) {
    const nextFit = tryPlanNextModuleFit(
      charID,
      shipItem,
      moduleLookup.match,
      plannedItems,
    );
    if (!nextFit.success) {
      return {
        success: false,
        errorMsg: nextFit.errorMsg || "MINER_COMMAND_MODULE_FIT_FAILED",
        data: {
          fittedModuleCount: index,
        },
      };
    }

    plannedItems = nextFit.data.plannedItems;
    latestResourceState = nextFit.data.resourceState;
  }

  for (let index = 0; index < preset.supportModuleCount; index += 1) {
    const nextFit = tryPlanNextModuleFit(
      charID,
      shipItem,
      supportModuleLookup.match,
      plannedItems,
    );
    if (!nextFit.success) {
      return {
        success: false,
        errorMsg: nextFit.errorMsg || "MINER_COMMAND_SUPPORT_MODULE_FIT_FAILED",
        data: {
          fittedSupportModuleCount: index,
        },
      };
    }

    plannedItems = nextFit.data.plannedItems;
    latestResourceState = nextFit.data.resourceState;
  }

  for (let index = 0; index < preset.rigCount; index += 1) {
    const nextFit = tryPlanNextModuleFit(
      charID,
      shipItem,
      rigLookup.match,
      plannedItems,
    );
    if (!nextFit.success) {
      return {
        success: false,
        errorMsg: nextFit.errorMsg || "MINER_COMMAND_RIG_FIT_FAILED",
        data: {
          fittedRigCount: index,
        },
      };
    }

    plannedItems = nextFit.data.plannedItems;
    latestResourceState = nextFit.data.resourceState;
  }

  for (let index = 0; index < preset.mobilityModuleCount; index += 1) {
    const nextFit = tryPlanNextModuleFitWithOptions(
      charID,
      shipItem,
      mobilityModuleLookup.match,
      plannedItems,
      {
        forceFit: true,
      },
    );
    if (!nextFit.success) {
      return {
        success: false,
        errorMsg: nextFit.errorMsg || "MINER_COMMAND_MOBILITY_MODULE_FIT_FAILED",
        data: {
          fittedMobilityModuleCount: index,
        },
      };
    }

    plannedItems = nextFit.data.plannedItems;
    latestResourceState = nextFit.data.resourceState;
  }

  const chargeTypes = getCompatibleModuleChargeTypes(moduleLookup.match.typeID);
  if (chargeTypes.length <= 0) {
    return {
      success: false,
      errorMsg: "MINER_COMMAND_CRYSTALS_NOT_FOUND",
    };
  }

  const totalCrystalVolume = chargeTypes.reduce(
    (sum, itemType) =>
      sum + (toFiniteNumber(itemType && itemType.volume, 0) * preset.crystalsPerType),
    0,
  );
  if (totalCrystalVolume > latestResourceState.cargoCapacity + 1e-6) {
    return {
      success: false,
      errorMsg: "MINER_COMMAND_CARGO_TOO_SMALL",
      data: {
        requiredVolume: totalCrystalVolume,
        cargoCapacity: latestResourceState.cargoCapacity,
      },
    };
  }

  return {
    success: true,
    data: {
      preset,
      moduleType: moduleLookup.match,
      mobilityModuleType: mobilityModuleLookup ? mobilityModuleLookup.match : null,
      supportModuleType: supportModuleLookup ? supportModuleLookup.match : null,
      rigType: rigLookup ? rigLookup.match : null,
      plannedItems,
      resourceState: latestResourceState,
      chargeTypes,
    },
  };
}

function handleMinerCommand(session) {
  if (!session || !session.characterID) {
    return {
      success: false,
      message: "Select a character before using /miner.",
    };
  }

  const stationID = toInt(getDockedLocationID(session) || 0, 0);
  if (stationID <= 0) {
    return {
      success: false,
      message: "You must be docked before using /miner.",
    };
  }

  const preset = resolveMinerCommandPreset();
  const shipLookup = resolveShipByName(preset.shipName);
  if (!shipLookup || !shipLookup.success || !shipLookup.match) {
    return {
      success: false,
      message: `Ship type not found for /miner: ${preset.shipName}.`,
    };
  }

  const spawnResult = spawnShipInHangarForSession(session, shipLookup.match);
  if (!spawnResult.success || !spawnResult.ship) {
    return {
      success: false,
      message: "Failed to spawn the /miner hull in your station hangar.",
    };
  }

  const shipItem = spawnResult.ship;
  const planResult = buildMinerCommandPlan(session.characterID, shipItem);
  if (!planResult.success || !planResult.data) {
    return {
      success: false,
      message: `Unable to build the /miner fit: ${planResult.errorMsg || "PLAN_FAILED"}.`,
    };
  }

  const fitPlan = planResult.data;
  const grantEntries = [
    {
      itemType: fitPlan.moduleType,
      quantity: fitPlan.preset.moduleCount,
    },
    ...(fitPlan.mobilityModuleType && fitPlan.preset.mobilityModuleCount > 0
      ? [{
          itemType: fitPlan.mobilityModuleType,
          quantity: fitPlan.preset.mobilityModuleCount,
        }]
      : []),
    ...(fitPlan.supportModuleType && fitPlan.preset.supportModuleCount > 0
      ? [{
          itemType: fitPlan.supportModuleType,
          quantity: fitPlan.preset.supportModuleCount,
        }]
      : []),
    ...(fitPlan.rigType && fitPlan.preset.rigCount > 0
      ? [{
          itemType: fitPlan.rigType,
          quantity: fitPlan.preset.rigCount,
        }]
      : []),
    ...fitPlan.chargeTypes.map((itemType) => ({
      itemType,
      quantity: fitPlan.preset.crystalsPerType,
    })),
  ];
  const grantResult = grantStationHangarBatchAndSyncSession(
    session,
    stationID,
    grantEntries,
  );
  if (!grantResult.success) {
    return {
      success: false,
      message: `Unable to seed the /miner fit and crystals: ${grantResult.errorMsg || "WRITE_ERROR"}.`,
    };
  }

  const fitResult = fitGrantedItemTypeToShip(
    session,
    stationID,
    shipItem,
    fitPlan.moduleType,
    fitPlan.preset.moduleCount,
  );
  if (!fitResult.success || !fitResult.data || fitResult.data.fittedCount !== fitPlan.preset.moduleCount) {
    return {
      success: false,
      message: `The /miner hull spawned, but the miner fit failed: ${fitResult.errorMsg || "FIT_FAILED"}.`,
    };
  }

  let supportFitCount = 0;
  if (fitPlan.supportModuleType && fitPlan.preset.supportModuleCount > 0) {
    const supportFitResult = fitGrantedItemTypeToShip(
      session,
      stationID,
      shipItem,
      fitPlan.supportModuleType,
      fitPlan.preset.supportModuleCount,
    );
    if (
      !supportFitResult.success ||
      !supportFitResult.data ||
      supportFitResult.data.fittedCount !== fitPlan.preset.supportModuleCount
    ) {
      return {
        success: false,
        message: `The /miner hull spawned, but the cargohold module fit failed: ${supportFitResult.errorMsg || "FIT_FAILED"}.`,
      };
    }
    supportFitCount = supportFitResult.data.fittedCount;
  }

  let rigFitCount = 0;
  if (fitPlan.rigType && fitPlan.preset.rigCount > 0) {
    const rigFitResult = fitGrantedItemTypeToShip(
      session,
      stationID,
      shipItem,
      fitPlan.rigType,
      fitPlan.preset.rigCount,
    );
    if (
      !rigFitResult.success ||
      !rigFitResult.data ||
      rigFitResult.data.fittedCount !== fitPlan.preset.rigCount
    ) {
      return {
        success: false,
        message: `The /miner hull spawned, but the cargohold rig fit failed: ${rigFitResult.errorMsg || "FIT_FAILED"}.`,
      };
    }
    rigFitCount = rigFitResult.data.fittedCount;
  }

  let mobilityFitCount = 0;
  if (fitPlan.mobilityModuleType && fitPlan.preset.mobilityModuleCount > 0) {
    const mobilityFitResult = fitGrantedItemTypeToShip(
      session,
      stationID,
      shipItem,
      fitPlan.mobilityModuleType,
      fitPlan.preset.mobilityModuleCount,
      {
        forceFit: true,
      },
    );
    if (
      !mobilityFitResult.success ||
      !mobilityFitResult.data ||
      mobilityFitResult.data.fittedCount !== fitPlan.preset.mobilityModuleCount
    ) {
      return {
        success: false,
        message: `The /miner hull spawned, but the mobility module fit failed: ${mobilityFitResult.errorMsg || "FIT_FAILED"}.`,
      };
    }
    mobilityFitCount = mobilityFitResult.data.fittedCount;
  }

  for (const crystalType of fitPlan.chargeTypes) {
    const cargoMoveResult = moveGrantedItemTypeToShipCargo(
      session,
      stationID,
      shipItem,
      crystalType,
      fitPlan.preset.crystalsPerType,
    );
    if (!cargoMoveResult.success) {
      return {
        success: false,
        message: `The /miner hull spawned, but crystal cargo seeding failed on ${crystalType.name}: ${cargoMoveResult.errorMsg || "MOVE_FAILED"}.`,
      };
    }
  }

  const activationResult = activateShipForSession(session, shipItem.itemID, {
    emitNotifications: true,
    logSelection: false,
  });
  if (!activationResult.success) {
    return {
      success: false,
      message: `The /miner ship was spawned and fitted, but boarding it failed: ${activationResult.errorMsg || "BOARD_FAILED"}.`,
    };
  }

  const finalResourceState = buildShipResourceState(session.characterID, shipItem);
  const remainingCpu = finalResourceState.cpuOutput - finalResourceState.cpuLoad;
  const remainingPower = finalResourceState.powerOutput - finalResourceState.powerLoad;
  const remainingUpgrade = finalResourceState.upgradeCapacity - finalResourceState.upgradeLoad;
  return {
    success: true,
    message: [
      `${shipLookup.match.name} was added to your ship hangar as ship ${shipItem.itemID}.`,
      `Fitted ${fitResult.data.fittedCount}x ${fitPlan.moduleType.name}${mobilityFitCount > 0 ? `, ${mobilityFitCount}x ${fitPlan.mobilityModuleType.name}` : ""}${supportFitCount > 0 ? `, ${supportFitCount}x ${fitPlan.supportModuleType.name}` : ""}${rigFitCount > 0 ? `, and ${rigFitCount}x ${fitPlan.rigType.name}` : ""}.`,
      `Loaded cargo with ${fitPlan.preset.crystalsPerType} of every compatible mining crystal type (${fitPlan.chargeTypes.length} total types).`,
      "Boarded your client into the new mining hull in station.",
      `Remaining fitting: ${remainingCpu.toFixed(2)} CPU, ${remainingPower.toFixed(2)} PG, ${remainingUpgrade.toFixed(2)} calibration.`,
    ].join(" "),
  };
}

function resolveSessionShipEntity(session) {
  if (!session || !session._space) {
    return null;
  }
  return spaceRuntime.getEntity(session, session._space.shipID) || null;
}

function resolveSessionScene(session) {
  if (!session || !session._space) {
    return null;
  }
  return spaceRuntime.ensureScene(
    normalizePositiveInteger(session._space.systemID, 0),
  );
}

function buildMiningWarpLandingPoint(center, index = 0, total = 1, radiusMeters = DEFAULT_MINING_FLEET_SPREAD_METERS) {
  const divisor = Math.max(1, toInt(total, 1));
  const angle = ((Math.PI * 2) / divisor) * Math.max(0, index);
  const resolvedRadius = Math.max(0, toFiniteNumber(radiusMeters, DEFAULT_MINING_FLEET_SPREAD_METERS));
  return {
    x: toFiniteNumber(center && center.x, 0) + (Math.cos(angle) * resolvedRadius),
    y: toFiniteNumber(center && center.y, 0),
    z: toFiniteNumber(center && center.z, 0) + (Math.sin(angle) * resolvedRadius),
  };
}

function createMiningFleetRecord(session, spawnResult, originAnchor) {
  const spawnedEntries =
    spawnResult &&
    spawnResult.data &&
    Array.isArray(spawnResult.data.spawned)
      ? spawnResult.data.spawned
      : [];
  const minerEntityIDs = spawnedEntries
    .map((entry) => normalizePositiveInteger(entry && entry.entity && entry.entity.itemID, null))
    .filter(Boolean);
  const fleetRecord = {
    fleetID: nextMiningFleetID++,
    createdByCharacterID: normalizePositiveInteger(session && session.characterID, 0),
    systemID: normalizePositiveInteger(session && session._space && session._space.systemID, 0),
    targetShipID: normalizePositiveInteger(session && session._space && session._space.shipID, 0),
    minerEntityIDs,
    responseEntityIDs: [],
    spawnSelectionName:
      spawnResult &&
      spawnResult.data &&
      spawnResult.data.selectionName
        ? String(spawnResult.data.selectionName)
        : null,
    responseSelectionName: null,
    originAnchor: originAnchor || null,
    state: "mining",
    createdAtMs: Date.now(),
  };
  miningFleetStateByID.set(fleetRecord.fleetID, fleetRecord);
  return fleetRecord;
}

function findMiningFleetsForSystem(systemID) {
  const normalizedSystemID = normalizePositiveInteger(systemID, 0);
  return [...miningFleetStateByID.values()].filter(
    (fleetRecord) => normalizePositiveInteger(fleetRecord && fleetRecord.systemID, 0) === normalizedSystemID,
  );
}

function pruneMiningFleet(fleetRecord) {
  if (!fleetRecord) {
    return null;
  }

  fleetRecord.minerEntityIDs = (Array.isArray(fleetRecord.minerEntityIDs) ? fleetRecord.minerEntityIDs : [])
    .filter((entityID) => npcService.getControllerByEntityID(entityID));
  fleetRecord.responseEntityIDs = (Array.isArray(fleetRecord.responseEntityIDs) ? fleetRecord.responseEntityIDs : [])
    .filter((entityID) => npcService.getControllerByEntityID(entityID));

  if (fleetRecord.minerEntityIDs.length === 0 && fleetRecord.responseEntityIDs.length === 0) {
    miningFleetStateByID.delete(fleetRecord.fleetID);
    return null;
  }

  return fleetRecord;
}

function applyPassiveMiningFleetOverrides(entityID) {
  npcService.setBehaviorOverrides(entityID, {
    autoAggro: false,
    autoActivateWeapons: false,
    autoAggroTargetClasses: [],
    targetPreference: "none",
    movementMode: "orbit",
    orbitDistanceMeters: 1_200,
    followRangeMeters: 800,
    idleAnchorOrbit: true,
    idleAnchorOrbitDistanceMeters: 1_200,
    returnToHomeWhenIdle: false,
    leashRangeMeters: 0,
  });
  npcService.issueManualOrder(entityID, {
    type: "stop",
  });
}

function handleMiningFleetCommand(session, argumentText) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      message: "You must be in space before using /npcminer.",
    };
  }

  const parsedArguments = parseNpcSpawnArguments(
    argumentText,
    Math.max(1, toInt(config.miningNpcFleetDefaultCount, DEFAULT_MINING_FLEET_COUNT)),
  );
  if (!parsedArguments.success) {
    return {
      success: false,
      message: "Usage: /npcminer [amount] [profile|pool|group]",
    };
  }
  if (parsedArguments.amount > MAX_MINING_NPC_COMMAND_SPAWN_COUNT) {
    return {
      success: false,
      message: `Mining fleet spawn count must be between 1 and ${MAX_MINING_NPC_COMMAND_SPAWN_COUNT}.`,
    };
  }

  const shipEntity = resolveSessionShipEntity(session);
  if (!shipEntity || !shipEntity.position) {
    return {
      success: false,
      message: "Active ship was not found in space.",
    };
  }

  const systemID = normalizePositiveInteger(session._space.systemID, 0);
  const scene = spaceRuntime.ensureScene(systemID);
  const originAnchor = findSafeWarpOriginAnchor(scene, shipEntity, {
    clearanceMeters: Math.max(
      ONE_AU_IN_METERS,
      toFiniteNumber(config.miningNpcWarpOriginClearanceMeters, ONE_AU_IN_METERS),
    ),
    minDistanceMeters: toFiniteNumber(
      config.miningNpcWarpOriginMinDistanceMeters,
      ONE_AU_IN_METERS * 2,
    ),
    maxDistanceMeters: toFiniteNumber(
      config.miningNpcWarpOriginMaxDistanceMeters,
      ONE_AU_IN_METERS * 4,
    ),
    stepMeters: toFiniteNumber(
      config.miningNpcWarpOriginStepMeters,
      ONE_AU_IN_METERS / 2,
    ),
  });

  const spawnResult = npcService.spawnNpcBatchInSystem(systemID, {
    profileQuery: parsedArguments.query || String(config.miningNpcFleetProfileOrPool || DEFAULT_MINING_FLEET_QUERY),
    amount: parsedArguments.amount,
    transient: true,
    broadcast: false,
    skipInitialBehaviorTick: true,
    preferredTargetID: normalizePositiveInteger(session._space.shipID, 0),
    anchorDescriptor: {
      kind: "coordinates",
      position: originAnchor.position,
      direction: originAnchor.direction,
      name: "Mining Fleet Warp Origin",
    },
  });
  if (!spawnResult.success || !spawnResult.data || !Array.isArray(spawnResult.data.spawned) || spawnResult.data.spawned.length <= 0) {
    const suggestions = Array.isArray(spawnResult && spawnResult.suggestions)
      ? ` Suggestions: ${spawnResult.suggestions.join(", ")}`
      : "";
    return {
      success: false,
      message: `Mining fleet spawn failed: ${spawnResult.errorMsg || "UNKNOWN_ERROR"}.${suggestions}`.trim(),
    };
  }

  const landingRadiusMeters = Math.max(
    500,
    toFiniteNumber(
      config.miningNpcFleetLandingRadiusMeters,
      DEFAULT_MINING_WARP_LANDING_RADIUS_METERS,
    ),
  );
  const warpRequests = spawnResult.data.spawned.map((entry, index, list) => ({
    entityID: normalizePositiveInteger(entry && entry.entity && entry.entity.itemID, 0),
    point: buildMiningWarpLandingPoint(
      shipEntity.position,
      index,
      list.length,
      landingRadiusMeters,
    ),
    options: {
      forceImmediateStart: true,
      broadcastWarpStartToVisibleSessions: true,
      visibilitySuppressMs: 250,
      ingressDurationMs: Math.max(
        250,
        toFiniteNumber(
          config.miningNpcWarpIngressDurationMs,
          DEFAULT_MINING_WARP_INGRESS_DURATION_MS,
        ),
      ),
    },
  }));
  const warpResult = npcService.runtime.warpBatchToPoints(warpRequests, {
    groupWake: true,
  });
  if (!warpResult.success) {
    return {
      success: false,
      message: `Mining fleet warp-in failed: ${warpResult.errorMsg || "WARP_FAILED"}.`,
    };
  }

  for (const entry of spawnResult.data.spawned) {
    const entityID = normalizePositiveInteger(entry && entry.entity && entry.entity.itemID, 0);
    if (!entityID) {
      continue;
    }
    applyPassiveMiningFleetOverrides(entityID);
  }

  const fleetRecord = createMiningFleetRecord(session, spawnResult, originAnchor);
  return {
    success: true,
    message: [
      `Spawned mining fleet ${fleetRecord.fleetID} with ${fleetRecord.minerEntityIDs.length} hull${fleetRecord.minerEntityIDs.length === 1 ? "" : "s"}.`,
      `Selection: ${fleetRecord.spawnSelectionName || parsedArguments.query || String(config.miningNpcFleetProfileOrPool || DEFAULT_MINING_FLEET_QUERY)}.`,
      "The fleet warped in from a safe off-grid origin and is currently staged in passive mining mode.",
      "Use /npcmineraggro to simulate player aggression and call the configured response fleet.",
    ].join(" "),
  };
}

function handleMiningFleetAggroCommand(session, argumentText) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      message: "You must be in space before using /npcmineraggro.",
    };
  }

  const fleets = findMiningFleetsForSystem(session._space.systemID)
    .map((fleetRecord) => pruneMiningFleet(fleetRecord))
    .filter(Boolean);
  if (fleets.length <= 0) {
    return {
      success: false,
      message: "No tracked mining fleets are active in your current system.",
    };
  }

  const parsedArguments = parseNpcSpawnArguments(
    argumentText,
    Math.max(1, toInt(config.miningNpcResponseDefaultCount, DEFAULT_MINING_RESPONSE_COUNT)),
  );
  if (!parsedArguments.success) {
    return {
      success: false,
      message: "Usage: /npcmineraggro [amount] [profile|pool|group]",
    };
  }
  if (parsedArguments.amount > MAX_MINING_NPC_COMMAND_SPAWN_COUNT) {
    return {
      success: false,
      message: `Mining response spawn count must be between 1 and ${MAX_MINING_NPC_COMMAND_SPAWN_COUNT}.`,
    };
  }

  let retreatedCount = 0;
  for (const fleetRecord of fleets) {
    if (fleetRecord.originAnchor && fleetRecord.originAnchor.position) {
      for (const entityID of fleetRecord.minerEntityIDs) {
        const controller = npcService.getControllerByEntityID(entityID);
        if (!controller) {
          continue;
        }
        npcService.runtime.warpToPoint(entityID, fleetRecord.originAnchor.position, {
          forceImmediateStart: true,
          broadcastWarpStartToVisibleSessions: true,
          visibilitySuppressMs: 250,
          ingressDurationMs: Math.max(
            250,
            toFiniteNumber(
              config.miningNpcWarpIngressDurationMs,
              DEFAULT_MINING_WARP_INGRESS_DURATION_MS,
            ),
          ),
        });
        retreatedCount += 1;
      }
    }
    fleetRecord.state = "aggressed";
  }

  const responseResult = npcService.runtime.spawnWarpBatchForSession(session, {
    profileQuery: parsedArguments.query || String(config.miningNpcResponseProfileOrPool || DEFAULT_MINING_RESPONSE_QUERY),
    amount: parsedArguments.amount,
    transient: true,
    defaultPoolID: String(config.miningNpcResponseDefaultPoolID || DEFAULT_MINING_RESPONSE_QUERY),
    fallbackProfileID: String(config.miningNpcResponseFallbackProfileID || "generic_hostile"),
  });
  if (!responseResult.success || !responseResult.data) {
    return {
      success: false,
      message: `Mining response spawn failed: ${responseResult.errorMsg || "UNKNOWN_ERROR"}.`,
    };
  }

  const responseEntityIDs = Array.isArray(responseResult.data.spawned)
    ? responseResult.data.spawned
      .map((entry) => normalizePositiveInteger(entry && entry.entity && entry.entity.itemID, null))
      .filter(Boolean)
    : [];
  for (const fleetRecord of fleets) {
    fleetRecord.responseEntityIDs.push(...responseEntityIDs);
    fleetRecord.responseSelectionName = responseResult.data.selectionName || null;
  }

  return {
    success: true,
    message: [
      `Simulated aggression against ${fleets.length} tracked mining fleet${fleets.length === 1 ? "" : "s"}.`,
      retreatedCount > 0
        ? `${retreatedCount} miner hull${retreatedCount === 1 ? "" : "s"} initiated retreat warp.`
        : "No miner retreat warp was needed.",
      `Spawned ${responseEntityIDs.length} response hull${responseEntityIDs.length === 1 ? "" : "s"} from ${responseResult.data.selectionName || parsedArguments.query || String(config.miningNpcResponseProfileOrPool || DEFAULT_MINING_RESPONSE_QUERY)}.`,
    ].join(" "),
  };
}

function handleMiningFleetClearCommand(session) {
  const systemID = normalizePositiveInteger(
    session &&
      session._space &&
      session._space.systemID,
    0,
  );
  if (!systemID) {
    return {
      success: false,
      message: "You must be in space before using /npcminerclear.",
    };
  }

  const fleets = findMiningFleetsForSystem(systemID);
  let destroyedCount = 0;
  for (const fleetRecord of fleets) {
    const entityIDs = [
      ...(Array.isArray(fleetRecord.minerEntityIDs) ? fleetRecord.minerEntityIDs : []),
      ...(Array.isArray(fleetRecord.responseEntityIDs) ? fleetRecord.responseEntityIDs : []),
    ];
    for (const entityID of entityIDs) {
      const destroyResult = npcService.destroyNpcControllerByEntityID(entityID, {
        removeContents: true,
      });
      if (destroyResult && destroyResult.success) {
        destroyedCount += 1;
      }
    }
    miningFleetStateByID.delete(fleetRecord.fleetID);
  }

  return {
    success: true,
    message: `Cleared ${fleets.length} tracked mining fleet${fleets.length === 1 ? "" : "s"} and destroyed ${destroyedCount} associated NPC hull${destroyedCount === 1 ? "" : "s"}.`,
  };
}

function handleMiningFleetStatusCommand(session) {
  const systemID = normalizePositiveInteger(
    session &&
      session._space &&
      session._space.systemID,
    0,
  );
  if (!systemID) {
    return {
      success: false,
      message: "You must be in space before using /npcminerstatus.",
    };
  }

  const fleets = findMiningFleetsForSystem(systemID)
    .map((fleetRecord) => pruneMiningFleet(fleetRecord))
    .filter(Boolean);
  if (fleets.length <= 0) {
    return {
      success: true,
      message: "No tracked mining fleets are active in your current system.",
    };
  }

  const summary = fleets.map((fleetRecord) => (
    `fleet ${fleetRecord.fleetID}: miners=${fleetRecord.minerEntityIDs.length}, response=${fleetRecord.responseEntityIDs.length}, state=${fleetRecord.state}`
  ));
  return {
    success: true,
    message: `Tracked mining fleets in system ${systemID}: ${summary.join("; ")}.`,
  };
}

function handleMiningStateStatusCommand(session) {
  const scene = resolveSessionScene(session);
  if (!scene) {
    return {
      success: false,
      message: "You must be in space before using /miningstatus.",
    };
  }

  const summary = summarizeSceneMiningState(scene);
  if (!summary) {
    return {
      success: false,
      message: "Mining runtime state is unavailable for the current scene.",
    };
  }

  return {
    success: true,
    message: [
      `Mining state for system ${summary.systemID}:`,
      `${summary.activeCount} active mineables tracked across ${summary.activeAsteroidEntityCount} asteroid entities.`,
      `${summary.depletedCount} depleted runtime records are cached.`,
      `Composition: ore=${summary.oreCount}, ice=${summary.iceCount}, gas=${summary.gasCount}.`,
    ].join(" "),
  };
}

function handleMiningStateResetCommand(session) {
  const scene = resolveSessionScene(session);
  if (!scene) {
    return {
      success: false,
      message: "You must be in space before using /miningreset.",
    };
  }

  const resetResult = resetSceneMiningState(scene, {
    rebuildAsteroids: true,
    broadcast: true,
    nowMs:
      scene && typeof scene.getCurrentSimTimeMs === "function"
        ? scene.getCurrentSimTimeMs()
        : Date.now(),
  });
  if (!resetResult.success || !resetResult.data) {
    return {
      success: false,
      message: `Mining reset failed: ${resetResult.errorMsg || "UNKNOWN_ERROR"}.`,
    };
  }

  const summary = resetResult.data.summary || summarizeSceneMiningState(scene);
  const asteroidReset = resetResult.data.asteroidResetResult || null;
  return {
    success: true,
    message: [
      `Reset mining runtime state for system ${resetResult.data.systemID}.`,
      asteroidReset
        ? `Rebuilt ${asteroidReset.spawned.length} generated asteroid entities after removing ${asteroidReset.removedCount}.`
        : "Asteroid field rebuild was skipped.",
      summary
        ? `Scene now tracks ${summary.activeCount} active mineables with ${summary.depletedCount} depleted cached records.`
        : "Mining state summary is unavailable after reset.",
    ].join(" "),
  };
}

class MiningCommandService extends BaseService {
  constructor() {
    super("miningCommand");
  }
}

module.exports = MiningCommandService;
module.exports.handleMinerCommand = handleMinerCommand;
module.exports.handleMiningFleetCommand = executeMiningFleetCommand;
module.exports.handleMiningFleetAggroCommand = executeMiningFleetAggroCommand;
module.exports.handleMiningFleetClearCommand = executeMiningFleetClearCommand;
module.exports.handleMiningFleetStatusCommand = executeMiningFleetStatusCommand;
module.exports.handleMiningFleetRetreatCommand = executeMiningFleetRetreatCommand;
module.exports.handleMiningFleetResumeCommand = executeMiningFleetResumeCommand;
module.exports.handleMiningFleetHaulCommand = executeMiningFleetHaulCommand;
module.exports.handleMiningStateStatusCommand = handleMiningStateStatusCommand;
module.exports.handleMiningStateResetCommand = handleMiningStateResetCommand;
module.exports.buildMinerCommandPlan = buildMinerCommandPlan;
module.exports.getCompatibleModuleChargeTypes = getCompatibleModuleChargeTypes;
module.exports.getMiningFleetsForSystem = getTrackedMiningFleetsForSystem;
module.exports.pruneMiningFleet = pruneTrackedMiningFleet;
