const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  findShipItemById,
  listContainerItems,
  moveItemToLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  isChargeCompatibleWithModule,
  isFittedChargeItem,
  isFittedModuleItem,
} = require(path.join(__dirname, "./liveFittingState"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function resolveShipItem(shipItemOrID) {
  if (shipItemOrID && typeof shipItemOrID === "object") {
    return shipItemOrID;
  }
  return findShipItemById(shipItemOrID);
}

function ensureShipFittingInventoryParity(characterID, shipItemOrID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const shipItem = resolveShipItem(shipItemOrID);
  const shipID = toInt(shipItem && shipItem.itemID, 0);
  if (numericCharacterID <= 0 || shipID <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_SHIP_FITTING_PARITY_REQUEST",
      data: { changes: [], issues: [] },
    };
  }

  const fittedItems = listContainerItems(numericCharacterID, shipID, null);
  const moduleByFlag = new Map(
    fittedItems
      .filter((item) => isFittedModuleItem(item))
      .map((item) => [toInt(item.flagID, 0), item]),
  );
  const changes = [];
  const issues = [];

  for (const chargeItem of fittedItems.filter((item) => isFittedChargeItem(item))) {
    const flagID = toInt(chargeItem && chargeItem.flagID, 0);
    const moduleItem = moduleByFlag.get(flagID) || null;
    if (
      moduleItem &&
      isChargeCompatibleWithModule(moduleItem.typeID, chargeItem.typeID)
    ) {
      continue;
    }

    const moveResult = moveItemToLocation(
      chargeItem.itemID,
      shipID,
      ITEM_FLAGS.CARGO_HOLD,
    );
    if (!moveResult.success) {
      issues.push({
        itemID: toInt(chargeItem && chargeItem.itemID, 0),
        typeID: toInt(chargeItem && chargeItem.typeID, 0),
        flagID,
        errorMsg: moveResult.errorMsg || "INVALID_LOADED_CHARGE_MOVE_FAILED",
      });
      continue;
    }
    changes.push(...((moveResult.data && moveResult.data.changes) || []));
  }

  if (issues.length > 0 && options.logFailures !== false) {
    log.warn(
      `[FittingIntegrity] active ship fitting parity failed char=${numericCharacterID} ` +
      `ship=${shipID} issues=${JSON.stringify(issues)}`,
    );
  }

  return {
    success: issues.length === 0,
    errorMsg: issues.length === 0 ? null : "SHIP_FITTING_PARITY_FAILED",
    data: { changes, issues },
  };
}

module.exports = {
  ensureShipFittingInventoryParity,
};
