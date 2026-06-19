const path = require("path");

const {
  isNativeNpcEntity,
} = require(path.join(__dirname, "../npc/npcEquipment"));
const nativeNpcStore = require(path.join(__dirname, "../npc/nativeNpcStore"));
const {
  getFuelStorageFlagsForType,
} = require(path.join(
  __dirname,
  "../../services/inventory/fuelBayInventory",
));

function getItemStore() {
  return require(path.join(__dirname, "../../services/inventory/itemStore"));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function collectInventoryChanges(writeResult) {
  if (!writeResult || writeResult.success !== true) {
    return [];
  }
  if (writeResult.data && Array.isArray(writeResult.data.changes)) {
    return writeResult.data.changes;
  }
  if (writeResult.data) {
    return [{
      item: writeResult.data,
      previousData: writeResult.previousData || writeResult.previousState || {},
    }];
  }
  return [];
}

function buildFuelFlagSet(fuelTypeID, priorityFlags = []) {
  return new Set(getFuelStorageFlagsForType(fuelTypeID, priorityFlags));
}

function buildFuelFlagPriority(fuelTypeID, priorityFlags = []) {
  return new Map(
    getFuelStorageFlagsForType(fuelTypeID, priorityFlags)
      .map((flagID, index) => [flagID, index]),
  );
}

function filterNativeStacksByFuelFlags(stacks, fuelTypeID, priorityFlags = []) {
  const normalizedFuelTypeID = toInt(fuelTypeID, 0);
  const allowedFlags = buildFuelFlagSet(normalizedFuelTypeID, priorityFlags);
  if (normalizedFuelTypeID <= 0 || allowedFlags.size <= 0) {
    return [];
  }

  return (Array.isArray(stacks) ? stacks : [])
    .filter(
      (entry) =>
        toInt(entry && entry.typeID, 0) === normalizedFuelTypeID &&
        allowedFlags.has(toInt(entry && entry.flagID, 5)),
    )
    .map((entry) => ({ ...entry }));
}

function listCharacterFuelStacks(characterID, shipID, fuelTypeID, priorityFlags = []) {
  const numericCharacterID = toInt(characterID, 0);
  const numericShipID = toInt(shipID, 0);
  const normalizedFuelTypeID = toInt(fuelTypeID, 0);
  if (numericCharacterID <= 0 || numericShipID <= 0 || normalizedFuelTypeID <= 0) {
    return [];
  }

  const { listContainerItems } = getItemStore();
  const stacks = [];
  for (const flagID of getFuelStorageFlagsForType(normalizedFuelTypeID, priorityFlags)) {
    const items = listContainerItems(numericCharacterID, numericShipID, flagID)
      .filter((entry) => toInt(entry && entry.typeID, 0) === normalizedFuelTypeID);
    stacks.push(...items);
  }
  return stacks;
}

function getFuelStacksForShipStorage(entity, fuelTypeID, callbacks = {}, priorityFlags = []) {
  const normalizedFuelTypeID = toInt(fuelTypeID, 0);
  if (!entity || entity.kind !== "ship" || normalizedFuelTypeID <= 0) {
    return [];
  }

  if (isNativeNpcEntity(entity)) {
    const storeItems = filterNativeStacksByFuelFlags(
      nativeNpcStore.listNativeCargoForEntity(entity.itemID),
      normalizedFuelTypeID,
      priorityFlags,
    );
    if (storeItems.length > 0) {
      return storeItems;
    }
    return filterNativeStacksByFuelFlags(
      Array.isArray(entity.nativeCargoItems) ? entity.nativeCargoItems : [],
      normalizedFuelTypeID,
      priorityFlags,
    );
  }

  const characterID =
    callbacks.resolveCharacterID &&
    typeof callbacks.resolveCharacterID === "function"
      ? callbacks.resolveCharacterID(entity)
      : 0;
  return listCharacterFuelStacks(
    characterID,
    entity.itemID,
    normalizedFuelTypeID,
    priorityFlags,
  );
}

function getFuelQuantityFromStacks(stacks = []) {
  return stacks.reduce((sum, stack) => {
    const quantity = Math.max(
      0,
      toInt(stack && (stack.quantity ?? stack.stacksize), 0),
    );
    return sum + quantity;
  }, 0);
}

function applyNativeCargoQuantity(entity, stack, nextQuantity) {
  const cargoID = toInt(stack && (stack.cargoID ?? stack.itemID), 0);
  const nextStackQuantity = Math.max(0, toInt(nextQuantity, 0));

  const cargoRecord = nativeNpcStore.listNativeCargoForEntity(entity.itemID)
    .find((entry) => toInt(entry && entry.cargoID, 0) === cargoID) || null;
  if (cargoRecord) {
    const persistResult = nextStackQuantity > 0
      ? nativeNpcStore.upsertNativeCargo({
          ...cargoRecord,
          quantity: nextStackQuantity,
        }, {
          transient: cargoRecord.transient === true,
        })
      : nativeNpcStore.removeNativeCargo(cargoRecord.cargoID);
    if (!persistResult.success) {
      return persistResult;
    }
  }

  if (Array.isArray(entity.nativeCargoItems)) {
    entity.nativeCargoItems = entity.nativeCargoItems.flatMap((entry) => {
      const entryID = toInt(entry && (entry.cargoID ?? entry.itemID), 0);
      if (entryID !== cargoID) {
        return [entry];
      }
      if (nextStackQuantity <= 0) {
        return [];
      }
      return [{
        ...entry,
        quantity: nextStackQuantity,
        stacksize: nextStackQuantity,
      }];
    });
  }

  return {
    success: true,
    data: {
      changes: [],
    },
  };
}

function consumeFuelFromShipStorage(entity, fuelTypeID, quantity, callbacks = {}, priorityFlags = []) {
  const normalizedFuelTypeID = toInt(fuelTypeID, 0);
  const requestedQuantity = Math.max(0, toInt(quantity, 0));
  if (!entity || normalizedFuelTypeID <= 0 || requestedQuantity <= 0) {
    return {
      success: true,
      errorMsg: null,
      changes: [],
      consumedQuantity: 0,
    };
  }

  const flagPriority = buildFuelFlagPriority(normalizedFuelTypeID, priorityFlags);
  const fuelStacks = getFuelStacksForShipStorage(
    entity,
    normalizedFuelTypeID,
    callbacks,
    priorityFlags,
  ).sort((left, right) => {
    const leftPriority = flagPriority.get(toInt(left && left.flagID, 5)) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = flagPriority.get(toInt(right && right.flagID, 5)) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const leftQuantity = toInt(left && (left.quantity ?? left.stacksize), 0);
    const rightQuantity = toInt(right && (right.quantity ?? right.stacksize), 0);
    return rightQuantity - leftQuantity;
  });
  if (getFuelQuantityFromStacks(fuelStacks) < requestedQuantity) {
    return {
      success: false,
      errorMsg: "NO_FUEL",
      changes: [],
    };
  }

  const changes = [];
  let remaining = requestedQuantity;
  for (const stack of fuelStacks) {
    if (remaining <= 0) {
      break;
    }
    const stackQuantity = Math.max(
      0,
      toInt(stack && (stack.quantity ?? stack.stacksize), 0),
    );
    if (stackQuantity <= 0) {
      continue;
    }
    const nextQuantity = Math.max(
      0,
      stackQuantity - Math.min(stackQuantity, remaining),
    );
    if (isNativeNpcEntity(entity)) {
      const updateResult = applyNativeCargoQuantity(entity, stack, nextQuantity);
      if (!updateResult.success) {
        return {
          ...updateResult,
          changes,
        };
      }
    } else {
      const itemID = toInt(stack && stack.itemID, 0);
      if (itemID <= 0) {
        return {
          success: false,
          errorMsg: "NO_FUEL",
          changes,
        };
      }
      const { updateInventoryItem, removeInventoryItem } = getItemStore();
      const writeResult = nextQuantity > 0
        ? updateInventoryItem(itemID, (currentItem) => ({
            ...currentItem,
            quantity: nextQuantity,
            stacksize: nextQuantity,
          }))
        : removeInventoryItem(itemID);
      if (!writeResult.success) {
        return {
          success: false,
          errorMsg: writeResult.errorMsg || "NO_FUEL",
          changes,
        };
      }
      changes.push(...collectInventoryChanges(writeResult));
    }
    remaining -= (stackQuantity - nextQuantity);
  }

  return {
    success: remaining <= 0,
    errorMsg: remaining <= 0 ? null : "NO_FUEL",
    changes,
    consumedQuantity: requestedQuantity - Math.max(0, remaining),
  };
}

module.exports = {
  getFuelStacksForShipStorage,
  getFuelQuantityFromStacks,
  consumeFuelFromShipStorage,
};
