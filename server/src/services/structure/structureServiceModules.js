const path = require("path");

const {
  listContainerItems,
  consumeInventoryItemQuantity,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  isFuelBayCompatibleItem,
  FUEL_BAY_FLAG: SHIP_FUEL_BAY_FLAG,
  STRUCTURE_FUEL_BAY_FLAG,
  CARGO_HOLD_FLAG,
} = require(path.join(__dirname, "../inventory/fuelBayInventory"));
const {
  getTypeAttributeValue,
  isEffectivelyOnlineModule,
  isShipFittingFlag,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(__dirname, "./structureConstants"));
const {
  MANAGED_SERVICE_IDS,
  SERVICE_IDS_BY_MODULE_TYPE_ID,
  getStructureServiceIDsForModuleType,
  isStructureServiceModuleType,
} = require(path.join(__dirname, "./structureServiceAuthority"));

const STRUCTURE_SERVICE_SLOT_FLAGS = Object.freeze([164, 165, 166, 167, 168, 169, 170, 171]);
const DEFAULT_SERVICE_ONLINE_FUEL_HOURS = 72;
const SERVICE_FUEL_CYCLE_MS = 60 * 60 * 1000;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function isStructureServiceSlotFlag(flagID) {
  return STRUCTURE_SERVICE_SLOT_FLAGS.includes(toInt(flagID, 0));
}

function isStructureServiceModuleItem(item) {
  return Boolean(
    item &&
    isStructureServiceSlotFlag(item.flagID) &&
    isStructureServiceModuleType(item.typeID),
  );
}

function listFittedStructureServiceModules(structureID) {
  const numericStructureID = toPositiveInt(structureID, 0);
  if (!numericStructureID) {
    return [];
  }
  return listContainerItems(null, numericStructureID, null)
    .filter((item) => item && isShipFittingFlag(item.flagID))
    .filter(isStructureServiceModuleItem)
    .sort((left, right) => (
      toInt(left.flagID, 0) - toInt(right.flagID, 0) ||
      toInt(left.itemID, 0) - toInt(right.itemID, 0)
    ));
}

function listOnlineStructureServiceModules(structureID) {
  return listFittedStructureServiceModules(structureID)
    .filter((item) => isEffectivelyOnlineModule(item));
}

function getStructureServiceModuleCycleFuelNeed(typeID) {
  return Math.max(0, toInt(
    getTypeAttributeValue(typeID, "serviceModuleFuelAmount", "Service Module Cycle Fuel Need"),
    0,
  ));
}

function getStructureServiceModuleFuelGroupID(typeID) {
  return Math.max(0, toInt(
    getTypeAttributeValue(
      typeID,
      "serviceModuleFuelConsumptionGroup",
      "Service Module Fuel Need",
    ),
    0,
  ));
}

function getStructureServiceModuleOnlineFuelNeed(typeID) {
  const explicitOnlineFuel = toInt(
    getTypeAttributeValue(
      typeID,
      "serviceModuleFuelOnlineAmount",
      "Service Module Online Fuel Need",
    ),
    0,
  );
  if (explicitOnlineFuel > 0) {
    return explicitOnlineFuel;
  }
  return getStructureServiceModuleCycleFuelNeed(typeID) * DEFAULT_SERVICE_ONLINE_FUEL_HOURS;
}

function isStructureServiceFuelItem(item, moduleTypeID = null) {
  if (!item || !isFuelBayCompatibleItem(item)) {
    return false;
  }
  const fuelGroupID = getStructureServiceModuleFuelGroupID(moduleTypeID);
  if (fuelGroupID <= 0) {
    return true;
  }
  return toPositiveInt(item.groupID, 0) === fuelGroupID;
}

function getStructureFuelCandidateItems(structureID, moduleTypeID = null) {
  const numericStructureID = toPositiveInt(structureID, 0);
  if (!numericStructureID) {
    return [];
  }
  const flags = [STRUCTURE_FUEL_BAY_FLAG, SHIP_FUEL_BAY_FLAG, CARGO_HOLD_FLAG];
  return flags
    .flatMap((flagID) => listContainerItems(null, numericStructureID, flagID))
    .filter((item) => isStructureServiceFuelItem(item, moduleTypeID))
    .sort((left, right) => (
      flags.indexOf(toInt(left.flagID, 0)) - flags.indexOf(toInt(right.flagID, 0)) ||
      toInt(left.itemID, 0) - toInt(right.itemID, 0)
    ));
}

function getStackQuantity(item) {
  if (!item) {
    return 0;
  }
  if (toInt(item.singleton, 0) === 1) {
    return 1;
  }
  return Math.max(0, toInt(item.stacksize ?? item.quantity, 0));
}

function consumeStructureServiceFuelQuantity(structureID, moduleItem, requiredQuantity, options = {}) {
  const normalizedRequiredQuantity = Math.max(0, toInt(requiredQuantity, 0));
  const moduleTypeID = moduleItem && moduleItem.typeID;
  const fuelGroupID = getStructureServiceModuleFuelGroupID(moduleTypeID);
  if (normalizedRequiredQuantity <= 0) {
    return {
      success: true,
      requiredQuantity: 0,
      fuelGroupID,
      consumedQuantity: 0,
      changes: [],
    };
  }

  const fuelItems = getStructureFuelCandidateItems(structureID, moduleTypeID);
  const availableQuantity = fuelItems.reduce(
    (total, item) => total + getStackQuantity(item),
    0,
  );
  if (availableQuantity < normalizedRequiredQuantity) {
    return {
      success: false,
      errorMsg: "NOT_ENOUGH_FUEL",
      requiredQuantity: normalizedRequiredQuantity,
      fuelGroupID,
      availableQuantity,
      consumedQuantity: 0,
      changes: [],
    };
  }

  let remaining = normalizedRequiredQuantity;
  const changes = [];
  for (const item of fuelItems) {
    if (remaining <= 0) {
      break;
    }
    const take = Math.min(remaining, getStackQuantity(item));
    const result = consumeInventoryItemQuantity(item.itemID, take, options);
    if (!result || result.success !== true) {
      return {
        success: false,
        errorMsg: result && result.errorMsg ? result.errorMsg : "FUEL_CONSUME_FAILED",
        requiredQuantity: normalizedRequiredQuantity,
        fuelGroupID,
        availableQuantity,
        consumedQuantity: normalizedRequiredQuantity - remaining,
        changes,
      };
    }
    changes.push(...((result.data && result.data.changes) || []));
    remaining -= take;
  }

  return {
    success: true,
    requiredQuantity: normalizedRequiredQuantity,
    fuelGroupID,
    availableQuantity,
    consumedQuantity: normalizedRequiredQuantity,
    changes,
  };
}

function consumeStructureServiceModuleOnlineFuel(structureID, moduleItem, options = {}) {
  const requiredQuantity = getStructureServiceModuleOnlineFuelNeed(moduleItem && moduleItem.typeID);
  const fuelResult = consumeStructureServiceFuelQuantity(
    structureID,
    moduleItem,
    requiredQuantity,
    options,
  );
  if (!fuelResult || fuelResult.success !== true) {
    return fuelResult;
  }

  const nowMs = toInt(options.nowMs, Date.now());
  const nextCycleAt = nowMs + SERVICE_FUEL_CYCLE_MS;
  const updateResult = updateInventoryItem(moduleItem.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      serviceFuelOnlineAt: nowMs,
      serviceFuelNextCycleAt: nextCycleAt,
    },
  }));
  return {
    ...fuelResult,
    moduleUpdate: updateResult && updateResult.success ? updateResult.data : null,
    moduleUpdateResult: updateResult,
  };
}

function ensureStructureServiceFuelCycleStamp(moduleItem, nowMs) {
  const nextCycleAt = toInt(
    moduleItem && moduleItem.moduleState && moduleItem.moduleState.serviceFuelNextCycleAt,
    0,
  );
  if (nextCycleAt > 0) {
    return {
      success: true,
      changed: false,
      moduleItem,
      changes: [],
    };
  }
  const updateResult = updateInventoryItem(moduleItem.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      serviceFuelOnlineAt: toInt(
        currentItem.moduleState && currentItem.moduleState.serviceFuelOnlineAt,
        nowMs,
      ),
      serviceFuelNextCycleAt: nowMs + SERVICE_FUEL_CYCLE_MS,
    },
  }));
  return {
    success: updateResult && updateResult.success === true,
    changed: updateResult && updateResult.success === true,
    moduleItem: updateResult && updateResult.success ? updateResult.data : moduleItem,
    changes: updateResult && updateResult.success
      ? [{ previousData: updateResult.previousData || moduleItem, item: updateResult.data }]
      : [],
    errorMsg: updateResult && updateResult.errorMsg,
  };
}

function consumeStructureServiceModuleCycleFuel(structureID, moduleItem, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const stampResult = ensureStructureServiceFuelCycleStamp(moduleItem, nowMs);
  if (!stampResult || stampResult.success !== true) {
    return stampResult || { success: false, errorMsg: "FUEL_CYCLE_STAMP_FAILED" };
  }
  const stampedModule = stampResult.moduleItem || moduleItem;
  const nextCycleAt = toInt(
    stampedModule && stampedModule.moduleState && stampedModule.moduleState.serviceFuelNextCycleAt,
    0,
  );
  if (nextCycleAt <= 0 || nowMs < nextCycleAt) {
    return {
      success: true,
      moduleItem: stampedModule,
      cycleCount: 0,
      changes: stampResult.changes || [],
    };
  }

  const cycleFuelNeed = getStructureServiceModuleCycleFuelNeed(stampedModule.typeID);
  if (cycleFuelNeed <= 0) {
    return {
      success: true,
      moduleItem: stampedModule,
      cycleCount: 0,
      changes: stampResult.changes || [],
    };
  }

  const cycleCount = Math.max(1, Math.floor((nowMs - nextCycleAt) / SERVICE_FUEL_CYCLE_MS) + 1);
  const requiredQuantity = cycleFuelNeed * cycleCount;
  const fuelResult = consumeStructureServiceFuelQuantity(
    structureID,
    stampedModule,
    requiredQuantity,
    options,
  );
  if (!fuelResult || fuelResult.success !== true) {
    const offlineResult = updateInventoryItem(stampedModule.itemID, (currentItem) => ({
      ...currentItem,
      moduleState: {
        ...(currentItem.moduleState || {}),
        online: false,
        serviceFuelNextCycleAt: null,
      },
    }));
    return {
      ...(fuelResult || {}),
      success: false,
      errorMsg: fuelResult && fuelResult.errorMsg ? fuelResult.errorMsg : "NOT_ENOUGH_FUEL",
      moduleItem: offlineResult && offlineResult.success ? offlineResult.data : stampedModule,
      offlined: true,
      cycleCount,
      changes: [
        ...(stampResult.changes || []),
        ...((fuelResult && fuelResult.changes) || []),
        ...(offlineResult && offlineResult.success
          ? [{ previousData: offlineResult.previousData || stampedModule, item: offlineResult.data }]
          : []),
      ],
    };
  }

  const updateResult = updateInventoryItem(stampedModule.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem.moduleState || {}),
      serviceFuelLastCycleAt: nowMs,
      serviceFuelNextCycleAt: nextCycleAt + (cycleCount * SERVICE_FUEL_CYCLE_MS),
    },
  }));
  return {
    ...fuelResult,
    success: true,
    moduleItem: updateResult && updateResult.success ? updateResult.data : stampedModule,
    cycleCount,
    changes: [
      ...(stampResult.changes || []),
      ...(fuelResult.changes || []),
      ...(updateResult && updateResult.success
        ? [{ previousData: updateResult.previousData || stampedModule, item: updateResult.data }]
        : []),
    ],
  };
}

function syncStructureServiceModuleState(structureID, options = {}) {
  const numericStructureID = toPositiveInt(structureID, 0);
  if (!numericStructureID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const rawOnlineModules = listOnlineStructureServiceModules(numericStructureID);
  const onlineModules = [];
  const fuelCycleChanges = [];
  const offlinedModuleIDs = [];
  const applyFuelCycles = options.applyFuelCycles !== false;
  for (const moduleItem of rawOnlineModules) {
    if (!applyFuelCycles) {
      onlineModules.push(moduleItem);
      continue;
    }
    const fuelCycleResult = consumeStructureServiceModuleCycleFuel(
      numericStructureID,
      moduleItem,
      options,
    );
    fuelCycleChanges.push(...((fuelCycleResult && fuelCycleResult.changes) || []));
    if (fuelCycleResult && fuelCycleResult.success === true) {
      onlineModules.push(fuelCycleResult.moduleItem || moduleItem);
    } else {
      offlinedModuleIDs.push(toPositiveInt(moduleItem.itemID, 0));
    }
  }
  const onlineServiceIDs = new Set();
  for (const moduleItem of onlineModules) {
    for (const serviceID of getStructureServiceIDsForModuleType(moduleItem.typeID)) {
      onlineServiceIDs.add(serviceID);
    }
  }

  const updateResult = structureState.updateStructureRecord(numericStructureID, (current) => {
    const nextServiceStates = {
      ...(current.serviceStates || {}),
    };
    for (const serviceID of MANAGED_SERVICE_IDS) {
      if (Object.prototype.hasOwnProperty.call(nextServiceStates, String(serviceID))) {
        nextServiceStates[String(serviceID)] = onlineServiceIDs.has(serviceID)
          ? STRUCTURE_SERVICE_STATE.ONLINE
          : STRUCTURE_SERVICE_STATE.OFFLINE;
      }
    }
    return {
      ...current,
      serviceStates: nextServiceStates,
      upkeepState:
        onlineModules.length > 0
          ? STRUCTURE_UPKEEP_STATE.FULL_POWER
          : STRUCTURE_UPKEEP_STATE.LOW_POWER,
    };
  });
  return {
    ...updateResult,
    fuelCycleChanges,
    offlinedModuleIDs,
  };
}

module.exports = {
  DEFAULT_SERVICE_ONLINE_FUEL_HOURS,
  MANAGED_SERVICE_IDS,
  SERVICE_IDS_BY_MODULE_TYPE_ID,
  SERVICE_FUEL_CYCLE_MS,
  STRUCTURE_FUEL_BAY_FLAG,
  STRUCTURE_SERVICE_SLOT_FLAGS,
  consumeStructureServiceFuelQuantity,
  consumeStructureServiceModuleCycleFuel,
  consumeStructureServiceModuleOnlineFuel,
  getStructureFuelCandidateItems,
  getStructureServiceIDsForModuleType,
  getStructureServiceModuleCycleFuelNeed,
  getStructureServiceModuleFuelGroupID,
  getStructureServiceModuleOnlineFuelNeed,
  isStructureServiceModuleItem,
  isStructureServiceModuleType,
  isStructureServiceFuelItem,
  isStructureServiceSlotFlag,
  listFittedStructureServiceModules,
  listOnlineStructureServiceModules,
  syncStructureServiceModuleState,
};
