const path = require("path");

const {
  isShipFittingFlag,
  isModuleOnline,
  getLoadedChargeByFlag,
} = require(path.join(__dirname, "../fitting/liveFittingState"));

const MODULE_CATEGORY_ID = 7;
const GROUPABLE_GROUP_IDS = new Set([
  53, // Energy Weapon
  55, // Projectile Weapon
  74, // Hybrid Weapon
  506, // Missile Launcher Cruise
  507, // Missile Launcher Rocket
  508, // Missile Launcher Torpedo
  509, // Missile Launcher Light
  510, // Missile Launcher Heavy
  511, // Missile Launcher Rapid Light
  512, // Missile Launcher Defender
  524, // Missile Launcher XL Torpedo
  771, // Missile Launcher Heavy Assault
  1245, // Missile Launcher Rapid Heavy
  1327, // Structure XL Missile Launcher
  1328, // Structure Guided Bomb Launcher
  1562, // Structure Multirole Missile Launcher
  1673, // Missile Launcher Rapid Torpedo
  1674, // Missile Launcher XL Cruise
]);

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function compareModuleSortOrder(
  leftItem,
  rightItem,
  leftFallbackItemID = 0,
  rightFallbackItemID = 0,
) {
  const leftFlag = toNumber(leftItem && leftItem.flagID, 0);
  const rightFlag = toNumber(rightItem && rightItem.flagID, 0);
  if (leftFlag !== rightFlag) {
    return leftFlag - rightFlag;
  }

  const leftItemID = toNumber(
    leftItem && leftItem.itemID,
    leftFallbackItemID,
  );
  const rightItemID = toNumber(
    rightItem && rightItem.itemID,
    rightFallbackItemID,
  );
  return leftItemID - rightItemID;
}

function isGroupableModuleItem(item, options = {}) {
  if (!item || typeof item !== "object") {
    return false;
  }
  if (toNumber(item.categoryID, 0) !== MODULE_CATEGORY_ID) {
    return false;
  }
  if (!isShipFittingFlag(item.flagID)) {
    return false;
  }
  if (!GROUPABLE_GROUP_IDS.has(toNumber(item.groupID, 0))) {
    return false;
  }
  if (options.requireOffline === true && isModuleOnline(item)) {
    return false;
  }
  if (options.requireOnline === true && !isModuleOnline(item)) {
    return false;
  }
  return true;
}

function getModuleLoadedChargeSignature(shipID, moduleItem) {
  const numericShipID = toNumber(shipID, 0);
  const numericOwnerID = toNumber(moduleItem && moduleItem.ownerID, 0);
  const numericFlagID = toNumber(moduleItem && moduleItem.flagID, 0);
  if (numericShipID <= 0 || numericOwnerID <= 0 || numericFlagID <= 0) {
    return {
      chargeTypeID: 0,
      quantity: 0,
    };
  }

  const loadedCharge = getLoadedChargeByFlag(
    numericOwnerID,
    numericShipID,
    numericFlagID,
  );
  const quantity = Math.max(
    0,
    toNumber(
      loadedCharge && (loadedCharge.stacksize ?? loadedCharge.quantity),
      0,
    ),
  );
  return {
    chargeTypeID: quantity > 0 ? toNumber(loadedCharge && loadedCharge.typeID, 0) : 0,
    quantity,
  };
}

function buildModuleGroupingCompatibilityKey(shipID, moduleItem) {
  const numericTypeID = toNumber(moduleItem && moduleItem.typeID, 0);
  const chargeSignature = getModuleLoadedChargeSignature(shipID, moduleItem);
  return [
    numericTypeID,
    chargeSignature.chargeTypeID,
    chargeSignature.quantity,
  ].join(":");
}

function canModulesGroupTogether(shipID, masterItem, slaveItem, options = {}) {
  const numericShipID = toNumber(shipID, 0);
  if (!numericShipID) {
    return {
      success: false,
      errorMsg: "INVALID_SHIP",
    };
  }
  if (!isGroupableModuleItem(masterItem, options)) {
    return {
      success: false,
      errorMsg: "MASTER_NOT_GROUPABLE",
    };
  }
  if (!isGroupableModuleItem(slaveItem, options)) {
    return {
      success: false,
      errorMsg: "SLAVE_NOT_GROUPABLE",
    };
  }
  if (toNumber(masterItem.itemID, 0) === toNumber(slaveItem.itemID, 0)) {
    return {
      success: false,
      errorMsg: "MODULE_ALREADY_GROUPED",
    };
  }
  if (
    toNumber(masterItem.locationID, 0) !== numericShipID ||
    toNumber(slaveItem.locationID, 0) !== numericShipID
  ) {
    return {
      success: false,
      errorMsg: "MODULE_NOT_ON_SHIP",
    };
  }
  if (toNumber(masterItem.ownerID, 0) !== toNumber(slaveItem.ownerID, 0)) {
    return {
      success: false,
      errorMsg: "MODULE_OWNER_MISMATCH",
    };
  }
  if (toNumber(masterItem.typeID, 0) !== toNumber(slaveItem.typeID, 0)) {
    return {
      success: false,
      errorMsg: "MODULE_TYPE_MISMATCH",
    };
  }

  const masterChargeSignature = getModuleLoadedChargeSignature(
    numericShipID,
    masterItem,
  );
  const slaveChargeSignature = getModuleLoadedChargeSignature(
    numericShipID,
    slaveItem,
  );
  if (
    masterChargeSignature.chargeTypeID !== slaveChargeSignature.chargeTypeID ||
    masterChargeSignature.quantity !== slaveChargeSignature.quantity
  ) {
    return {
      success: false,
      errorMsg: "MODULE_CHARGE_MISMATCH",
    };
  }

  return {
    success: true,
    data: {
      shipID: numericShipID,
      typeID: toNumber(masterItem.typeID, 0),
      ownerID: toNumber(masterItem.ownerID, 0),
      chargeTypeID: masterChargeSignature.chargeTypeID,
      chargeQuantity: masterChargeSignature.quantity,
    },
  };
}

module.exports = {
  GROUPABLE_GROUP_IDS,
  buildModuleGroupingCompatibilityKey,
  compareModuleSortOrder,
  isGroupableModuleItem,
  canModulesGroupTogether,
};
