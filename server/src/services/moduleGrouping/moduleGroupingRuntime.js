const path = require("path");

const {
  findItemById,
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  compareModuleSortOrder,
  isGroupableModuleItem,
  canModulesGroupTogether,
  buildModuleGroupingCompatibilityKey,
} = require(path.join(__dirname, "./moduleGroupingRules"));
const {
  getShipWeaponBanks,
  getCharacterWeaponBanks,
  setShipWeaponBanks,
  clearModuleFromBanks,
} = require(path.join(__dirname, "./moduleGroupingState"));
const {
  buildWeaponBankStateDict,
} = require(path.join(__dirname, "./moduleGroupingBootstrap"));

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getBankEntry(banks, masterID) {
  if (!banks || typeof banks !== "object") {
    return [];
  }
  return Array.isArray(banks[String(masterID)]) ? banks[String(masterID)] : [];
}

function buildShipModuleIndex(shipID) {
  const moduleIndex = new Map();
  const modules = listContainerItems(null, toNumber(shipID, 0), null)
    .filter((item) => toNumber(item && item.categoryID, 0) === 7)
    .sort((left, right) => compareModuleSortOrder(left, right));
  for (const moduleItem of modules) {
    moduleIndex.set(toNumber(moduleItem && moduleItem.itemID, 0), moduleItem);
  }
  return moduleIndex;
}

function getShipGroupableModules(shipID, options = {}) {
  return listContainerItems(null, toNumber(shipID, 0), null)
    .filter((item) => isGroupableModuleItem(item, options))
    .sort((left, right) => compareModuleSortOrder(left, right));
}

function sortModuleIDs(shipID, moduleIDs) {
  const moduleIndex = buildShipModuleIndex(shipID);
  return [...new Set(
    (Array.isArray(moduleIDs) ? moduleIDs : [])
      .map((moduleID) => toNumber(moduleID, 0))
      .filter((moduleID) => moduleID > 0),
  )].sort((leftID, rightID) => compareModuleSortOrder(
    moduleIndex.get(leftID),
    moduleIndex.get(rightID),
    leftID,
    rightID,
  ));
}

function getMasterModuleID(shipID, moduleID, banks = null) {
  const numericModuleID = toNumber(moduleID, 0);
  if (numericModuleID <= 0) {
    return 0;
  }

  const currentBanks = banks || getShipWeaponBanks(shipID);
  if (Array.isArray(currentBanks[String(numericModuleID)])) {
    return numericModuleID;
  }

  for (const [masterID, slaveIDs] of Object.entries(currentBanks || {})) {
    if ((Array.isArray(slaveIDs) ? slaveIDs : []).includes(numericModuleID)) {
      return toNumber(masterID, 0);
    }
  }

  return 0;
}

function getModulesInBank(shipID, moduleID, banks = null) {
  const currentBanks = banks || getShipWeaponBanks(shipID);
  const masterID = getMasterModuleID(shipID, moduleID, currentBanks);
  if (masterID <= 0) {
    return [];
  }
  return [
    masterID,
    ...getBankEntry(currentBanks, masterID),
  ];
}

function collectBankModuleIDs(shipID, moduleIDs = [], banks = null) {
  const currentBanks = banks || getShipWeaponBanks(shipID);
  const collectedIDs = new Set();
  for (const rawModuleID of Array.isArray(moduleIDs) ? moduleIDs : [moduleIDs]) {
    const numericModuleID = toNumber(rawModuleID, 0);
    if (numericModuleID <= 0) {
      continue;
    }
    collectedIDs.add(numericModuleID);
    for (const bankModuleID of getModulesInBank(shipID, numericModuleID, currentBanks)) {
      const numericBankModuleID = toNumber(bankModuleID, 0);
      if (numericBankModuleID > 0) {
        collectedIDs.add(numericBankModuleID);
      }
    }
  }
  return sortModuleIDs(shipID, [...collectedIDs]);
}

function collectAllBankedModuleIDs(shipID, banks = null) {
  const currentBanks = banks || getShipWeaponBanks(shipID);
  const collectedIDs = new Set();
  for (const [masterID, slaveIDs] of Object.entries(currentBanks || {})) {
    const numericMasterID = toNumber(masterID, 0);
    if (numericMasterID > 0) {
      collectedIDs.add(numericMasterID);
    }
    for (const slaveID of Array.isArray(slaveIDs) ? slaveIDs : []) {
      const numericSlaveID = toNumber(slaveID, 0);
      if (numericSlaveID > 0) {
        collectedIDs.add(numericSlaveID);
      }
    }
  }
  return sortModuleIDs(shipID, [...collectedIDs]);
}

function validateOnlineModules(shipID, moduleIDs = [], banks = null) {
  for (const moduleID of collectBankModuleIDs(shipID, moduleIDs, banks)) {
    const moduleItem = findItemById(moduleID);
    if (!isGroupableModuleItem(moduleItem, { requireOnline: true })) {
      return {
        success: false,
        errorMsg: "MODULES_MUST_BE_ONLINE",
        data: {
          moduleID,
        },
      };
    }
  }
  return { success: true };
}

function notifyWeaponBanksChanged(session, shipID, banks = null, options = {}) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }
  const payload = buildWeaponBankStateDict(shipID, {
    banks: banks || getShipWeaponBanks(shipID, options),
  });
  session.sendNotification("OnWeaponBanksChanged", "clientID", [
    toNumber(shipID, 0),
    payload,
  ]);
  return true;
}

function buildOperationResult(result, fallbackBanks = {}) {
  if (result && result.success) {
    return result;
  }
  return {
    success: false,
    errorMsg: (result && result.errorMsg) || "GROUPING_FAILED",
    data: {
      banks: cloneValue(fallbackBanks),
      changed: false,
    },
  };
}

function linkWeapons(shipID, masterModuleID, slaveModuleID, options = {}) {
  const numericShipID = toNumber(shipID, 0);
  const currentBanks = getShipWeaponBanks(numericShipID, options);
  const resolvedMasterID =
    getMasterModuleID(numericShipID, masterModuleID, currentBanks) ||
    toNumber(masterModuleID, 0);
  const numericSlaveID = toNumber(slaveModuleID, 0);
  const masterItem = findItemById(resolvedMasterID);
  const slaveItem = findItemById(numericSlaveID);
  const onlineValidation = validateOnlineModules(
    numericShipID,
    [resolvedMasterID, numericSlaveID],
    currentBanks,
  );
  if (!onlineValidation.success) {
    return buildOperationResult(onlineValidation, currentBanks);
  }
  const validation = canModulesGroupTogether(
    numericShipID,
    masterItem,
    slaveItem,
    { requireOnline: true },
  );
  if (!validation.success) {
    return buildOperationResult(
      { success: false, errorMsg: validation.errorMsg },
      currentBanks,
    );
  }
  if (getMasterModuleID(numericShipID, numericSlaveID, currentBanks) > 0) {
    return {
      success: true,
      data: {
        banks: cloneValue(currentBanks),
        changed: false,
      },
    };
  }

  const nextBanks = cloneValue(currentBanks);
  nextBanks[String(resolvedMasterID)] = sortModuleIDs(numericShipID, [
    ...getBankEntry(nextBanks, resolvedMasterID),
    numericSlaveID,
  ]).filter((moduleID) => moduleID !== resolvedMasterID);
  return setShipWeaponBanks(numericShipID, nextBanks, options);
}

function mergeModuleGroups(shipID, targetMasterID, sourceMasterID, options = {}) {
  const numericShipID = toNumber(shipID, 0);
  const currentBanks = getShipWeaponBanks(numericShipID, options);
  const resolvedTargetMasterID =
    getMasterModuleID(numericShipID, targetMasterID, currentBanks) ||
    toNumber(targetMasterID, 0);
  const resolvedSourceMasterID =
    getMasterModuleID(numericShipID, sourceMasterID, currentBanks) ||
    toNumber(sourceMasterID, 0);
  if (
    resolvedTargetMasterID <= 0 ||
    resolvedSourceMasterID <= 0 ||
    resolvedTargetMasterID === resolvedSourceMasterID
  ) {
    return {
      success: true,
      data: {
        banks: cloneValue(currentBanks),
        changed: false,
      },
    };
  }

  const targetItem = findItemById(resolvedTargetMasterID);
  const sourceMasterItem = findItemById(resolvedSourceMasterID);
  const onlineValidation = validateOnlineModules(
    numericShipID,
    [resolvedTargetMasterID, resolvedSourceMasterID],
    currentBanks,
  );
  if (!onlineValidation.success) {
    return buildOperationResult(onlineValidation, currentBanks);
  }
  const validation = canModulesGroupTogether(
    numericShipID,
    targetItem,
    sourceMasterItem,
    { requireOnline: true },
  );
  if (!validation.success) {
    return buildOperationResult(
      { success: false, errorMsg: validation.errorMsg },
      currentBanks,
    );
  }

  const nextBanks = cloneValue(currentBanks);
  nextBanks[String(resolvedTargetMasterID)] = sortModuleIDs(numericShipID, [
    ...getBankEntry(nextBanks, resolvedTargetMasterID),
    resolvedSourceMasterID,
    ...getBankEntry(nextBanks, resolvedSourceMasterID),
  ]).filter((moduleID) => moduleID !== resolvedTargetMasterID);
  delete nextBanks[String(resolvedSourceMasterID)];
  return setShipWeaponBanks(numericShipID, nextBanks, options);
}

function peelAndLink(shipID, targetMasterID, sourceMasterID, options = {}) {
  const numericShipID = toNumber(shipID, 0);
  const currentBanks = getShipWeaponBanks(numericShipID, options);
  const resolvedTargetMasterID =
    getMasterModuleID(numericShipID, targetMasterID, currentBanks) ||
    toNumber(targetMasterID, 0);
  const resolvedSourceMasterID =
    getMasterModuleID(numericShipID, sourceMasterID, currentBanks) ||
    toNumber(sourceMasterID, 0);
  const sourceSlaveIDs = getBankEntry(currentBanks, resolvedSourceMasterID);
  if (
    resolvedTargetMasterID <= 0 ||
    resolvedSourceMasterID <= 0 ||
    resolvedTargetMasterID === resolvedSourceMasterID ||
    sourceSlaveIDs.length <= 0
  ) {
    return {
      success: true,
      data: {
        banks: cloneValue(currentBanks),
        changed: false,
      },
    };
  }

  const targetItem = findItemById(resolvedTargetMasterID);
  const peeledModuleID = sortModuleIDs(
    numericShipID,
    sourceSlaveIDs,
  )[0];
  const peeledItem = findItemById(peeledModuleID);
  const onlineValidation = validateOnlineModules(
    numericShipID,
    [resolvedTargetMasterID, resolvedSourceMasterID],
    currentBanks,
  );
  if (!onlineValidation.success) {
    return buildOperationResult(onlineValidation, currentBanks);
  }
  const validation = canModulesGroupTogether(
    numericShipID,
    targetItem,
    peeledItem,
    { requireOnline: true },
  );
  if (!validation.success) {
    return buildOperationResult(
      { success: false, errorMsg: validation.errorMsg },
      currentBanks,
    );
  }

  const nextBanks = cloneValue(currentBanks);
  nextBanks[String(resolvedTargetMasterID)] = sortModuleIDs(numericShipID, [
    ...getBankEntry(nextBanks, resolvedTargetMasterID),
    peeledModuleID,
  ]).filter((moduleID) => moduleID !== resolvedTargetMasterID);

  const remainingSourceSlaveIDs = getBankEntry(
    currentBanks,
    resolvedSourceMasterID,
  ).filter((moduleID) => moduleID !== peeledModuleID);
  if (remainingSourceSlaveIDs.length > 0) {
    nextBanks[String(resolvedSourceMasterID)] = remainingSourceSlaveIDs;
  } else {
    delete nextBanks[String(resolvedSourceMasterID)];
  }
  return setShipWeaponBanks(numericShipID, nextBanks, options);
}

function unlinkModuleFromBank(shipID, masterModuleID, options = {}) {
  const numericShipID = toNumber(shipID, 0);
  const currentBanks = getShipWeaponBanks(numericShipID, options);
  const resolvedMasterID =
    getMasterModuleID(numericShipID, masterModuleID, currentBanks) ||
    toNumber(masterModuleID, 0);
  const sourceSlaveIDs = sortModuleIDs(
    numericShipID,
    getBankEntry(currentBanks, resolvedMasterID),
  );
  if (resolvedMasterID <= 0 || sourceSlaveIDs.length <= 0) {
    return {
      success: false,
      errorMsg: "BANK_NOT_FOUND",
      data: {
        banks: cloneValue(currentBanks),
        changed: false,
        peeledModuleID: 0,
      },
    };
  }

  const peeledModuleID = sourceSlaveIDs[0];
  const remainingSlaveIDs = sourceSlaveIDs.slice(1);
  const nextBanks = cloneValue(currentBanks);
  if (remainingSlaveIDs.length > 0) {
    nextBanks[String(resolvedMasterID)] = remainingSlaveIDs;
  } else {
    delete nextBanks[String(resolvedMasterID)];
  }
  const result = setShipWeaponBanks(numericShipID, nextBanks, options);
  return {
    success: result.success,
    errorMsg: result.errorMsg || null,
    data: {
      ...(result.data || {}),
      peeledModuleID,
    },
  };
}

function destroyWeaponBank(shipID, masterModuleID, options = {}) {
  const numericShipID = toNumber(shipID, 0);
  const currentBanks = getShipWeaponBanks(numericShipID, options);
  const resolvedMasterID =
    getMasterModuleID(numericShipID, masterModuleID, currentBanks) ||
    toNumber(masterModuleID, 0);
  if (resolvedMasterID <= 0 || !Array.isArray(currentBanks[String(resolvedMasterID)])) {
    return {
      success: true,
      data: {
        banks: cloneValue(currentBanks),
        changed: false,
      },
    };
  }
  const nextBanks = cloneValue(currentBanks);
  delete nextBanks[String(resolvedMasterID)];
  return setShipWeaponBanks(numericShipID, nextBanks, options);
}

function linkAllWeapons(shipID, options = {}) {
  const numericShipID = toNumber(shipID, 0);
  const currentBanks = getShipWeaponBanks(numericShipID, options);
  const groupableModules = getShipGroupableModules(numericShipID, {
    requireOnline: true,
  });
  const groupedByCompatibilityKey = new Map();

  for (const moduleItem of groupableModules) {
    const compatibilityKey = buildModuleGroupingCompatibilityKey(
      numericShipID,
      moduleItem,
    );
    if (!compatibilityKey) {
      continue;
    }
    if (!groupedByCompatibilityKey.has(compatibilityKey)) {
      groupedByCompatibilityKey.set(compatibilityKey, []);
    }
    groupedByCompatibilityKey.get(compatibilityKey).push(moduleItem);
  }

  const nextBanks = {};
  for (const modules of groupedByCompatibilityKey.values()) {
    if (!Array.isArray(modules) || modules.length <= 1) {
      continue;
    }
    const existingMaster = modules.find((moduleItem) => (
      Array.isArray(currentBanks[String(toNumber(moduleItem && moduleItem.itemID, 0))])
    ));
    const masterItem = existingMaster || modules[0];
    const masterID = toNumber(masterItem && masterItem.itemID, 0);
    const slaveIDs = modules
      .map((moduleItem) => toNumber(moduleItem && moduleItem.itemID, 0))
      .filter((moduleID) => moduleID > 0 && moduleID !== masterID);
    if (slaveIDs.length > 0) {
      nextBanks[String(masterID)] = slaveIDs;
    }
  }

  return setShipWeaponBanks(numericShipID, nextBanks, options);
}

function unlinkAllWeaponBanks(shipID, options = {}) {
  return setShipWeaponBanks(shipID, {}, options);
}

function clearModuleFromBanksAndNotify(
  session,
  shipID,
  moduleIDs,
  options = {},
) {
  const result = clearModuleFromBanks(shipID, moduleIDs, options);
  if (result.success && result.data && result.data.changed) {
    notifyWeaponBanksChanged(session, shipID, result.data.banks, options);
  }
  return result;
}

function destroyWeaponBankAndNotify(
  session,
  shipID,
  masterModuleID,
  options = {},
) {
  const result = destroyWeaponBank(shipID, masterModuleID, options);
  if (result.success && result.data && result.data.changed) {
    notifyWeaponBanksChanged(session, shipID, result.data.banks, options);
  }
  return result;
}

module.exports = {
  buildWeaponBankStateDict,
  getShipWeaponBanks,
  getCharacterWeaponBanks,
  getMasterModuleID,
  getModulesInBank,
  notifyWeaponBanksChanged,
  linkWeapons,
  mergeModuleGroups,
  peelAndLink,
  unlinkModuleFromBank,
  linkAllWeapons,
  unlinkAllWeaponBanks,
  destroyWeaponBank,
  clearModuleFromBanksAndNotify,
  destroyWeaponBankAndNotify,
};
