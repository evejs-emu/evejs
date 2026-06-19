const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
  moveItemToLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getFittedModuleItems,
  getSlotFlagsForFamily,
  selectAutoFitFlagForType,
  validateFitForShip,
} = require(path.join(__dirname, "../fitting/liveFittingState"));

const STARTER_SHIP_FITTINGS_TABLE = "starterShipFittings";
const VALID_SLOT_FAMILIES = new Set(["low", "med", "high", "rig", "subsystem"]);
const starterShipFittingCache = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneValue(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function normalizeSlotFamily(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return VALID_SLOT_FAMILIES.has(normalized) ? normalized : "";
}

function normalizeStarterShipFittingEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const typeID = toInt(entry.typeID, 0);
  if (typeID <= 0) {
    return null;
  }

  const normalizedEntry = {
    typeID,
    quantity: Math.max(1, toInt(entry.quantity, 1)),
  };
  const flagID = toInt(entry.flagID, 0);
  if (flagID > 0) {
    normalizedEntry.flagID = flagID;
  }
  const slotFamily = normalizeSlotFamily(entry.slotFamily);
  if (slotFamily) {
    normalizedEntry.slotFamily = slotFamily;
  }
  return normalizedEntry;
}

function normalizeStarterShipFitting(entry, shipTypeID) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const normalizedShipTypeID = toInt(
    entry.shipTypeID,
    toInt(shipTypeID, 0),
  );
  if (normalizedShipTypeID <= 0) {
    return null;
  }

  return {
    shipTypeID: normalizedShipTypeID,
    modules: (Array.isArray(entry.modules) ? entry.modules : [])
      .map((moduleEntry) => normalizeStarterShipFittingEntry(moduleEntry))
      .filter(Boolean),
  };
}

function clearStarterShipFittingCache(shipTypeID = null) {
  const numericShipTypeID = toInt(shipTypeID, 0);
  if (numericShipTypeID > 0) {
    starterShipFittingCache.delete(numericShipTypeID);
    return;
  }
  starterShipFittingCache.clear();
}

function getStarterShipFitting(shipTypeID, options = {}) {
  const numericShipTypeID = toInt(shipTypeID, 0);
  if (numericShipTypeID <= 0) {
    return null;
  }

  if (options && options.refresh) {
    clearStarterShipFittingCache(numericShipTypeID);
  }
  if (starterShipFittingCache.has(numericShipTypeID)) {
    return cloneValue(starterShipFittingCache.get(numericShipTypeID));
  }

  const result = database.read(
    STARTER_SHIP_FITTINGS_TABLE,
    `/${String(numericShipTypeID)}`,
  );
  const normalizedFitting =
    result && result.success && result.data
      ? normalizeStarterShipFitting(result.data, numericShipTypeID)
      : null;
  if (!normalizedFitting) {
    return null;
  }

  starterShipFittingCache.set(numericShipTypeID, normalizedFitting);
  return cloneValue(normalizedFitting);
}

function tryResolveTargetFlag(characterID, shipItem, fittedItems, itemType, entry) {
  const numericCharacterID = toInt(characterID, 0);
  const explicitFlagID = toInt(entry && entry.flagID, 0);
  if (explicitFlagID > 0) {
    const explicitValidation = validateFitForShip(
      numericCharacterID,
      shipItem,
      {
        itemID: -1,
        typeID: itemType.typeID,
        groupID: itemType.groupID,
        categoryID: itemType.categoryID,
        flagID: explicitFlagID,
      },
      explicitFlagID,
      fittedItems,
    );
    if (explicitValidation.success) {
      return {
        success: true,
        flagID: explicitFlagID,
      };
    }
  }

  const slotFamily = normalizeSlotFamily(entry && entry.slotFamily);
  if (slotFamily) {
    const candidateFlags = getSlotFlagsForFamily(
      slotFamily,
      toInt(shipItem && shipItem.typeID, 0),
    );
    for (const candidateFlagID of candidateFlags) {
      const validation = validateFitForShip(
        numericCharacterID,
        shipItem,
        {
          itemID: -1,
          typeID: itemType.typeID,
          groupID: itemType.groupID,
          categoryID: itemType.categoryID,
          flagID: candidateFlagID,
        },
        candidateFlagID,
        fittedItems,
      );
      if (validation.success) {
        return {
          success: true,
          flagID: candidateFlagID,
        };
      }
    }
  }

  const autoFlagID = toInt(
    selectAutoFitFlagForType(shipItem, fittedItems, itemType.typeID),
    0,
  );
  if (autoFlagID <= 0) {
    return {
      success: false,
      errorMsg: "NO_SLOT_AVAILABLE",
    };
  }

  const autoValidation = validateFitForShip(
    numericCharacterID,
    shipItem,
    {
      itemID: -1,
      typeID: itemType.typeID,
      groupID: itemType.groupID,
      categoryID: itemType.categoryID,
      flagID: autoFlagID,
    },
    autoFlagID,
    fittedItems,
  );
  if (!autoValidation.success) {
    return {
      success: false,
      errorMsg: autoValidation.errorMsg || "FIT_VALIDATION_FAILED",
      data: autoValidation.data || null,
    };
  }

  return {
    success: true,
    flagID: autoFlagID,
  };
}

function ensureStarterShipDefaultFit(
  characterID,
  dockedLocationID,
  shipItem,
  options = {},
) {
  const numericCharacterID = toInt(characterID, 0);
  const numericDockedLocationID = toInt(dockedLocationID, 0);
  const resolvedShipItem = shipItem && typeof shipItem === "object" ? shipItem : null;
  if (
    numericCharacterID <= 0 ||
    numericDockedLocationID <= 0 ||
    !resolvedShipItem ||
    toInt(resolvedShipItem.itemID, 0) <= 0
  ) {
    return {
      success: false,
      errorMsg: "INVALID_STARTER_SHIP_REQUEST",
      data: {
        applied: false,
        changes: [],
        issues: [],
      },
    };
  }

  if (
    toInt(resolvedShipItem.flagID, ITEM_FLAGS.HANGAR) !== ITEM_FLAGS.HANGAR ||
    toInt(resolvedShipItem.locationID, numericDockedLocationID) !== numericDockedLocationID
  ) {
    return {
      success: true,
      data: {
        applied: false,
        shipConfigured: false,
        changes: [],
        issues: [],
        reason: "SHIP_NOT_DOCKED_IN_HANGAR",
      },
    };
  }

  const fitting = getStarterShipFitting(resolvedShipItem.typeID);
  if (!fitting || !Array.isArray(fitting.modules) || fitting.modules.length === 0) {
    return {
      success: true,
      data: {
        applied: false,
        shipConfigured: false,
        changes: [],
        issues: [],
        reason: "NO_STARTER_FIT_CONFIGURED",
      },
    };
  }

  const changes = [];
  const issues = [];
  const ensuredModules = [];

  for (const entry of fitting.modules) {
    const typeID = toInt(entry && entry.typeID, 0);
    const requiredQuantity = Math.max(1, toInt(entry && entry.quantity, 1));
    const itemType = typeID > 0 ? resolveItemByTypeID(typeID) : null;
    if (!itemType) {
      issues.push({
        typeID,
        errorMsg: "ITEM_TYPE_NOT_FOUND",
      });
      continue;
    }

    let existingCount = getFittedModuleItems(
      numericCharacterID,
      resolvedShipItem.itemID,
    ).filter((item) => toInt(item && item.typeID, 0) === typeID).length;

    while (existingCount < requiredQuantity) {
      const fittedItems = getFittedModuleItems(
        numericCharacterID,
        resolvedShipItem.itemID,
      );
      const targetFlagResult = tryResolveTargetFlag(
        numericCharacterID,
        resolvedShipItem,
        fittedItems,
        itemType,
        entry,
      );
      if (!targetFlagResult.success || toInt(targetFlagResult.flagID, 0) <= 0) {
        issues.push({
          typeID,
          itemName: itemType.name,
          errorMsg: targetFlagResult.errorMsg || "NO_SLOT_AVAILABLE",
          data: targetFlagResult.data || null,
        });
        break;
      }

      const grantResult = grantItemToCharacterLocation(
        numericCharacterID,
        numericDockedLocationID,
        ITEM_FLAGS.HANGAR,
        itemType,
        1,
      );
      if (!grantResult.success) {
        issues.push({
          typeID,
          itemName: itemType.name,
          errorMsg: grantResult.errorMsg || "GRANT_FAILED",
        });
        break;
      }

      changes.push(...((grantResult.data && grantResult.data.changes) || []));
      const grantedItem =
        grantResult.data &&
        Array.isArray(grantResult.data.items)
          ? grantResult.data.items[0] || null
          : null;
      if (!grantedItem || toInt(grantedItem.itemID, 0) <= 0) {
        issues.push({
          typeID,
          itemName: itemType.name,
          errorMsg: "GRANTED_ITEM_MISSING",
        });
        break;
      }

      const moveResult = moveItemToLocation(
        grantedItem.itemID,
        resolvedShipItem.itemID,
        targetFlagResult.flagID,
      );
      if (!moveResult.success) {
        issues.push({
          typeID,
          itemName: itemType.name,
          errorMsg: moveResult.errorMsg || "FIT_MOVE_FAILED",
        });
        break;
      }

      changes.push(...((moveResult.data && moveResult.data.changes) || []));
      ensuredModules.push({
        typeID,
        itemName: itemType.name,
        flagID: targetFlagResult.flagID,
      });
      existingCount += 1;
    }
  }

  const success = issues.length === 0;
  if (!success && options.logFailures !== false) {
    log.warn(
      `[StarterShipFit] Incomplete default fit for char=${numericCharacterID} ship=${toInt(resolvedShipItem.itemID, 0)} typeID=${toInt(resolvedShipItem.typeID, 0)} issues=${JSON.stringify(issues)}`,
    );
  }

  return {
    success,
    errorMsg: success ? null : "STARTER_SHIP_FIT_INCOMPLETE",
    data: {
      applied: changes.length > 0,
      shipConfigured: true,
      changes,
      issues,
      ensuredModules,
      fitting,
    },
  };
}

module.exports = {
  STARTER_SHIP_FITTINGS_TABLE,
  clearStarterShipFittingCache,
  getStarterShipFitting,
  ensureStarterShipDefaultFit,
};
