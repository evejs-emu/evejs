const path = require("path");

const config = require(path.join(__dirname, "../../../config"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../../common/machoErrors"));
const {
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../../character/characterState"));
const {
  findItemById,
  removeInventoryItem,
  updateInventoryItem,
} = require(path.join(__dirname, "../../inventory/itemStore"));
const { getCharacterSkillMap } = require(path.join(__dirname, "../skillState"));
const {
  getExpertSystemByTypeID,
  getExpertSystemConstants,
  isExpertSystemType,
  listExpertSystems,
  resolveExpertSystemQuery,
} = require("./expertSystemCatalog");
const {
  clearCharacterExpertSystems,
  getCharacterExpertSystemEntries,
  getCharacterExpertSystemState,
  removeCharacterExpertSystem,
  upsertCharacterExpertSystem,
} = require("./expertSystemState");
const {
  emitExpertSystemsUpdated,
} = require("./expertSystemNotifications");
const {
  scheduleExpertSystemExpiry,
} = require("./expertSystemExpiryScheduler");

const DAY_MS = 24 * 60 * 60 * 1000;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function fail(errorMsg, message, options = {}) {
  if (options.throwOnError === true) {
    throwWrappedUserError("CustomNotify", {
      notify: message || errorMsg,
    });
  }
  return {
    success: false,
    errorMsg,
    message: message || errorMsg,
  };
}

function buildUpdateChange(updateResult) {
  if (!updateResult || !updateResult.success) {
    return [];
  }
  return [{ item: updateResult.data, previousData: updateResult.previousData || {} }];
}

function consumeStackQuantity(item, quantity = 1) {
  const normalizedQuantity = Math.max(1, toInt(quantity, 1));
  const currentItem = findItemById(item && item.itemID) || item;
  if (!currentItem) {
    return { success: false, errorMsg: "ITEM_NOT_FOUND" };
  }

  const currentQuantity =
    toInt(currentItem.singleton, 0) === 1
      ? 1
      : Math.max(0, toInt(currentItem.stacksize ?? currentItem.quantity, 0));
  if (currentQuantity < normalizedQuantity) {
    return { success: false, errorMsg: "INSUFFICIENT_ITEMS" };
  }

  if (currentQuantity === normalizedQuantity) {
    return removeInventoryItem(currentItem.itemID, { removeContents: false });
  }

  const updateResult = updateInventoryItem(currentItem.itemID, (existing) => ({
    ...existing,
    quantity: currentQuantity - normalizedQuantity,
    stacksize: currentQuantity - normalizedQuantity,
    singleton: 0,
  }));
  if (!updateResult.success) {
    return updateResult;
  }
  return {
    success: true,
    data: {
      quantity: normalizedQuantity,
      changes: buildUpdateChange(updateResult),
    },
  };
}

function syncInventoryChangesToSession(session, changes = []) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change) {
      continue;
    }
    if (change.item) {
      syncInventoryItemForSession(
        session,
        change.item,
        change.previousState || change.previousData || {},
      );
    } else if (change.removed && change.previousData) {
      syncInventoryItemForSession(
        session,
        { ...change.previousData, locationID: 6 },
        change.previousData,
      );
    }
  }
}

function validateExpertSystemInstall(characterID, expertSystemTypeID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const expertSystem = getExpertSystemByTypeID(expertSystemTypeID);
  if (numericCharacterID <= 0) {
    return fail("INVALID_CHARACTER", "Select a character first.", options);
  }
  if (!expertSystem) {
    return fail("EXPERT_SYSTEM_NOT_FOUND", "Expert System type not found.", options);
  }
  if (config.expertSystemsEnabled === false && options.force !== true) {
    return fail(
      "EXPERT_SYSTEMS_DISABLED",
      "Expert Systems are disabled in server config.",
      options,
    );
  }
  if ((expertSystem.hidden || expertSystem.retired) && options.force !== true) {
    return fail(
      "EXPERT_SYSTEM_NOT_ACTIVATABLE",
      "That Expert System is hidden or retired and cannot be activated normally.",
      options,
    );
  }

  const nowMs = Math.max(0, toFiniteNumber(options.nowMs, Date.now()));
  const constants = getExpertSystemConstants();
  const activeEntries = getCharacterExpertSystemEntries(numericCharacterID, {
    nowMs,
    pruneExpired: true,
  });
  const existingEntry = activeEntries.find((entry) => (
    toInt(entry.typeID, 0) === expertSystem.typeID
  )) || null;
  const isTopUp = Boolean(existingEntry);
  const maxInstallations = Math.max(1, toInt(constants.maxCharacterInstallations, 3));
  const topUpWindowMs =
    Math.max(1, toInt(constants.maxInstalledDurationToAllowTopUpDays, 30)) * DAY_MS;

  if (!isTopUp && activeEntries.length >= maxInstallations && options.force !== true) {
    return fail(
      "EXPERT_SYSTEM_INSTALLATION_LIMIT",
      `You already have ${activeEntries.length}/${maxInstallations} Expert Systems installed.`,
      options,
    );
  }

  if (
    isTopUp &&
    existingEntry.expiresAtMs - nowMs > topUpWindowMs &&
    options.force !== true
  ) {
    return fail(
      "EXPERT_SYSTEM_TOP_UP_TOO_EARLY",
      "That Expert System cannot be extended until it has 30 days or less remaining.",
      options,
    );
  }

  return {
    success: true,
    data: { expertSystem, existingEntry, isTopUp, nowMs },
  };
}

function installExpertSystemForCharacter(characterID, expertSystemTypeID, options = {}) {
  const validation = validateExpertSystemInstall(characterID, expertSystemTypeID, options);
  if (!validation.success) {
    return validation;
  }

  const numericCharacterID = toInt(characterID, 0);
  const { expertSystem, existingEntry, isTopUp, nowMs } = validation.data;
  const previousSkillMap =
    options.emitNotifications === false
      ? null
      : getCharacterSkillMap(numericCharacterID);
  const durationDays = Math.max(
    1,
    toFiniteNumber(options.durationDays, expertSystem.durationDays),
  );
  const durationMs = Math.round(durationDays * DAY_MS);
  const baseExpiryMs = isTopUp
    ? Math.max(nowMs, toFiniteNumber(existingEntry.expiresAtMs, nowMs))
    : nowMs;
  const installedAtMs = isTopUp
    ? toFiniteNumber(existingEntry.installedAtMs, nowMs)
    : nowMs;

  const installEntry = {
    typeID: expertSystem.typeID,
    installedAtMs,
    expiresAtMs: baseExpiryMs + durationMs,
    sourceItemID: toInt(options.sourceItemID, 0) || null,
    grantReason: String(options.grantReason || (options.force ? "gm" : "item")),
    updatedAtMs: nowMs,
  };
  const writeResult = upsertCharacterExpertSystem(numericCharacterID, installEntry);
  if (!writeResult.success) {
    return fail("WRITE_ERROR", "Failed to save the Expert System install.", options);
  }

  if (options.emitNotifications !== false) {
    emitExpertSystemsUpdated(numericCharacterID, {
      session: options.session || null,
      expertSystemAdded: !isTopUp,
      expertSystemTypeID: expertSystem.typeID,
      previousSkillMap,
    });
  }
  scheduleExpertSystemExpiry(numericCharacterID, { nowMs });

  return {
    success: true,
    data: {
      expertSystem,
      installEntry: cloneValue(installEntry),
      isTopUp,
    },
  };
}

function consumeExpertSystemItem(characterID, itemID, session = null, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const item = findItemById(toInt(itemID, 0));
  if (!item || toInt(item.ownerID, 0) !== numericCharacterID) {
    return fail(
      "EXPERT_SYSTEM_ITEM_NOT_FOUND",
      "Expert System item was not found in your inventory.",
      options,
    );
  }
  if (!isExpertSystemType(item.typeID)) {
    return fail("EXPERT_SYSTEM_ITEM_TYPE_MISMATCH", "That item is not an Expert System.", options);
  }

  const validation = validateExpertSystemInstall(numericCharacterID, item.typeID, options);
  if (!validation.success) {
    return validation;
  }

  const rollbackEntry = validation.data && validation.data.existingEntry
    ? cloneValue(validation.data.existingEntry)
    : null;
  const previousSkillMap =
    options.emitNotifications === false
      ? null
      : getCharacterSkillMap(numericCharacterID);
  const installResult = installExpertSystemForCharacter(
    numericCharacterID,
    item.typeID,
    {
      ...options,
      session,
      sourceItemID: item.itemID,
      grantReason: "item",
      emitNotifications: false,
    },
  );
  if (!installResult.success) {
    return installResult;
  }

  const consumeResult = consumeStackQuantity(item, 1);
  if (!consumeResult.success) {
    if (rollbackEntry) {
      upsertCharacterExpertSystem(numericCharacterID, rollbackEntry);
    } else {
      removeCharacterExpertSystem(numericCharacterID, item.typeID);
    }
    scheduleExpertSystemExpiry(numericCharacterID);
    return fail(
      consumeResult.errorMsg || "EXPERT_SYSTEM_ITEM_CONSUME_FAILED",
      "Failed to consume the Expert System item.",
      options,
    );
  }

  syncInventoryChangesToSession(
    session,
    (consumeResult.data && consumeResult.data.changes) || [],
  );
  if (options.emitNotifications !== false) {
    emitExpertSystemsUpdated(numericCharacterID, {
      session,
      expertSystemAdded: !installResult.data.isTopUp,
      expertSystemTypeID: installResult.data.expertSystem.typeID,
      previousSkillMap,
    });
  }
  scheduleExpertSystemExpiry(numericCharacterID);

  return {
    ...installResult,
    data: {
      ...installResult.data,
      consumedItem: cloneValue(item),
      inventoryChanges: (consumeResult.data && consumeResult.data.changes) || [],
    },
  };
}

function removeExpertSystemFromCharacter(characterID, expertSystemTypeID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const numericTypeID = toInt(expertSystemTypeID, 0);
  const previousSkillMap =
    options.emitNotifications === false
      ? null
      : getCharacterSkillMap(numericCharacterID);

  const removeResult = removeCharacterExpertSystem(numericCharacterID, numericTypeID);
  if (!removeResult.success) {
    return fail("WRITE_ERROR", "Failed to remove the Expert System.", options);
  }
  if (removeResult.removed && options.emitNotifications !== false) {
    emitExpertSystemsUpdated(numericCharacterID, {
      session: options.session || null,
      expertSystemAdded: false,
      expertSystemTypeID: numericTypeID,
      previousSkillMap,
      expired: Boolean(options.expired),
    });
  }
  scheduleExpertSystemExpiry(numericCharacterID);
  return {
    success: true,
    removed: Boolean(removeResult.removed),
    data: removeResult.data || null,
  };
}

function clearExpertSystemsForCharacter(characterID, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const previousSkillMap =
    options.emitNotifications === false
      ? null
      : getCharacterSkillMap(numericCharacterID);
  const clearResult = clearCharacterExpertSystems(numericCharacterID);
  if (!clearResult.success) {
    return fail("WRITE_ERROR", "Failed to clear Expert Systems.", options);
  }
  if (
    options.emitNotifications !== false &&
    Array.isArray(clearResult.previousEntries) &&
    clearResult.previousEntries.length > 0
  ) {
    emitExpertSystemsUpdated(numericCharacterID, {
      session: options.session || null,
      expertSystemAdded: false,
      expertSystemTypeID: null,
      previousSkillMap,
    });
  }
  scheduleExpertSystemExpiry(numericCharacterID);
  return { success: true, data: clearResult.previousEntries || [] };
}

function getActiveExpertSystemsForCharacter(characterID, options = {}) {
  return getCharacterExpertSystemEntries(characterID, options)
    .map((entry) => ({
      ...entry,
      expertSystem: getExpertSystemByTypeID(entry.typeID),
    }))
    .filter((entry) => entry.expertSystem);
}

function getExpertSystemStatus(characterID, options = {}) {
  const activeEntries = getActiveExpertSystemsForCharacter(characterID, options);
  return {
    characterID: toInt(characterID, 0),
    activeEntries,
    rawState: getCharacterExpertSystemState(characterID),
    catalogCount: listExpertSystems({ includeHidden: true, includeRetired: true }).length,
  };
}

module.exports = {
  clearExpertSystemsForCharacter,
  consumeExpertSystemItem,
  getActiveExpertSystemsForCharacter,
  getExpertSystemStatus,
  installExpertSystemForCharacter,
  removeExpertSystemFromCharacter,
  resolveExpertSystemQuery,
  validateExpertSystemInstall,
};
