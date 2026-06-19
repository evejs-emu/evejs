const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const {
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  ITEM_FLAGS,
  findItemById,
  updateInventoryItem,
  grantItemToCharacterLocation,
  grantItemsToCharacterLocation,
  listContainerItems,
  buildRemovedItemNotificationState,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  TOKEN_TYPE_ID,
  SEEDED_TOKEN_STACK_SIZE,
  RAFFLE_ESCROW_FLAG,
  SEED_FALLBACK_STATION_ID,
} = require(path.join(__dirname, "./raffleConstants"));
const {
  normalizeInteger,
} = require(path.join(__dirname, "./raffleHelpers"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));

function getCharacterSessions(characterId, options = {}) {
  const normalizedCharacterId = normalizeInteger(characterId, 0);
  const recipients = new Map();
  const excludedSession = options.excludeSession || null;

  const addSession = (session) => {
    if (
      session === excludedSession ||
      !session ||
      !session.socket ||
      session.socket.destroyed ||
      typeof session.sendNotification !== "function"
    ) {
      return;
    }

    const clientId = normalizeInteger(session.clientID || session.clientId, 0);
    if (clientId <= 0) {
      return;
    }

    recipients.set(clientId, session);
  };

  addSession(options.includeSession);
  for (const session of sessionRegistry.getSessions()) {
    if (
      normalizeInteger(session.characterID || session.charid, 0) ===
      normalizedCharacterId
    ) {
      addSession(session);
    }
  }

  return [...recipients.values()];
}

function markItemTransient(itemId) {
  const normalizedItemId = normalizeInteger(itemId, 0);
  if (normalizedItemId > 0) {
    database.setTransientPath("items", `/${String(normalizedItemId)}`, true);
  }
}

function markWalletTransient(charId) {
  const normalizedCharacterId = normalizeInteger(charId, 0);
  if (normalizedCharacterId <= 0) {
    return;
  }

  for (const pathKey of ["balance", "balanceChange", "walletJournal"]) {
    database.setTransientPath(
      "characters",
      `/${String(normalizedCharacterId)}/${pathKey}`,
      true,
    );
  }
}

function buildChangeEntry(item, previousData = {}) {
  return {
    item,
    previousData,
  };
}

function notifyInventoryChange(session, item, previousData = {}) {
  if (
    !session ||
    !item ||
    typeof session.sendNotification !== "function"
  ) {
    return;
  }

  syncInventoryItemForSession(session, item, previousData);
}

function resolveInventoryChangeNotificationItem(change) {
  if (!change || typeof change !== "object") {
    return null;
  }
  if (change.item && typeof change.item === "object") {
    return change.item;
  }
  if (change.removed === true && change.previousData && typeof change.previousData === "object") {
    return buildRemovedItemNotificationState(change.previousData);
  }
  return null;
}

function notifyInventoryChangesToCharacter(charId, changes = [], options = {}) {
  const sessions = getCharacterSessions(charId, options);
  for (const session of sessions) {
    for (const change of Array.isArray(changes) ? changes : []) {
      const notificationItem = resolveInventoryChangeNotificationItem(change);
      if (!notificationItem) {
        continue;
      }
      notifyInventoryChange(session, notificationItem, change.previousData || {});
    }
  }
}

function resolveCharacterStationId(sessionOrCharId) {
  if (sessionOrCharId && typeof sessionOrCharId === "object") {
    const stationId = normalizeInteger(
      sessionOrCharId.stationid || sessionOrCharId.stationID,
      0,
    );
    if (stationId > 0) {
      return stationId;
    }
    return resolveCharacterStationId(
      sessionOrCharId.characterID || sessionOrCharId.charid,
    );
  }

  const characterRecord = getCharacterRecord(normalizeInteger(sessionOrCharId, 0));
  return normalizeInteger(
    characterRecord &&
      (characterRecord.stationID || characterRecord.homeStationID),
    SEED_FALLBACK_STATION_ID,
  );
}

function getLargestTokenStack(charId, stationId = null) {
  const normalizedCharacterId = normalizeInteger(charId, 0);
  const normalizedStationId = normalizeInteger(
    stationId,
    resolveCharacterStationId(normalizedCharacterId),
  );
  if (normalizedCharacterId <= 0 || normalizedStationId <= 0) {
    return null;
  }

  return listContainerItems(
    normalizedCharacterId,
    normalizedStationId,
    ITEM_FLAGS.HANGAR,
  )
    .filter((item) => (
      normalizeInteger(item && item.typeID, 0) === TOKEN_TYPE_ID &&
      normalizeInteger(item && item.stacksize, 0) > 0
    ))
    .sort((left, right) => (
      normalizeInteger(right && right.stacksize, 0) -
      normalizeInteger(left && left.stacksize, 0)
    ))[0] || null;
}

function ensureCharacterTokenStack(session, options = {}) {
  const characterId = normalizeInteger(
    session && (session.characterID || session.charid),
    0,
  );
  if (characterId <= 0) {
    return null;
  }

  const stationId = resolveCharacterStationId(session);
  if (stationId <= 0) {
    return null;
  }

  const minimumTokens = Math.max(
    1,
    normalizeInteger(options.minimumTokens, SEEDED_TOKEN_STACK_SIZE),
  );
  const existingStack = getLargestTokenStack(characterId, stationId);
  if (existingStack && normalizeInteger(existingStack.stacksize, 0) >= minimumTokens) {
    return existingStack;
  }

  if (existingStack) {
    markItemTransient(existingStack.itemID);
  }

  const quantityToGrant = existingStack
    ? Math.max(0, minimumTokens - normalizeInteger(existingStack.stacksize, 0))
    : minimumTokens;
  if (quantityToGrant <= 0) {
    return existingStack;
  }

  const grantResult = grantItemToCharacterLocation(
    characterId,
    stationId,
    ITEM_FLAGS.HANGAR,
    TOKEN_TYPE_ID,
    quantityToGrant,
    { transient: true },
  );
  if (!grantResult.success) {
    return existingStack;
  }

  const changes = (grantResult.data && grantResult.data.changes) || [];
  notifyInventoryChangesToCharacter(characterId, changes, {
    includeSession: session,
  });

  return getLargestTokenStack(characterId, stationId);
}

function consumeTokenStack(tokenItemId, tokenCount, options = {}) {
  const currentToken = findItemById(tokenItemId);
  const normalizedTokenCount = Math.max(0, normalizeInteger(tokenCount, 0));
  if (
    !currentToken ||
    normalizeInteger(currentToken.typeID, 0) !== TOKEN_TYPE_ID ||
    normalizedTokenCount <= 0
  ) {
    return {
      success: false,
      errorMsg: "TOKEN_NOT_FOUND",
    };
  }

  if (normalizeInteger(currentToken.stacksize, 0) < normalizedTokenCount) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_TOKENS",
    };
  }

  if (options.transient === true) {
    markItemTransient(currentToken.itemID);
  }
  const remaining = Math.max(
    0,
    normalizeInteger(currentToken.stacksize, 0) - normalizedTokenCount,
  );
  const updateResult = updateInventoryItem(currentToken.itemID, {
    ...currentToken,
    quantity: remaining,
    stacksize: remaining,
    singleton: 0,
  });
  if (!updateResult.success) {
    return updateResult;
  }

  return {
    success: true,
    data: {
      token: updateResult.data,
      previousData: updateResult.previousData,
      change: buildChangeEntry(updateResult.data, updateResult.previousData),
    },
  };
}

function moveItemToRaffleEscrow(itemId, options = {}) {
  const currentItem = findItemById(itemId);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  if (options.transient === true) {
    markItemTransient(currentItem.itemID);
  }
  const updateResult = updateInventoryItem(currentItem.itemID, {
    ...currentItem,
    flagID: RAFFLE_ESCROW_FLAG,
  });
  if (!updateResult.success) {
    return updateResult;
  }

  return {
    success: true,
    data: {
      item: updateResult.data,
      previousData: updateResult.previousData,
      change: buildChangeEntry(updateResult.data, updateResult.previousData),
    },
  };
}

function restoreEscrowedItem(
  itemId,
  locationId,
  flagId = ITEM_FLAGS.HANGAR,
  options = {},
) {
  const currentItem = findItemById(itemId);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  if (options.transient === true) {
    markItemTransient(currentItem.itemID);
  }
  const updateResult = updateInventoryItem(currentItem.itemID, {
    ...currentItem,
    locationID: normalizeInteger(locationId, currentItem.locationID),
    flagID: normalizeInteger(flagId, ITEM_FLAGS.HANGAR),
  });
  if (!updateResult.success) {
    return updateResult;
  }

  return {
    success: true,
    data: {
      item: updateResult.data,
      previousData: updateResult.previousData,
      change: buildChangeEntry(updateResult.data, updateResult.previousData),
    },
  };
}

function deliverRaffleItemToCharacterStation(
  itemId,
  ownerId,
  stationId,
  flagId = ITEM_FLAGS.HANGAR,
  options = {},
) {
  const currentItem = findItemById(itemId);
  const normalizedOwnerId = normalizeInteger(ownerId, 0);
  const normalizedStationId = normalizeInteger(stationId, 0);
  const normalizedFlagId = normalizeInteger(flagId, ITEM_FLAGS.HANGAR);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  if (normalizedOwnerId <= 0 || normalizedStationId <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_DESTINATION",
    };
  }

  if (
    normalizeInteger(currentItem.ownerID, 0) === normalizedOwnerId &&
    normalizeInteger(currentItem.locationID, 0) === normalizedStationId &&
    normalizeInteger(currentItem.flagID, 0) === normalizedFlagId
  ) {
    return {
      success: true,
      data: {
        item: currentItem,
        previousData: currentItem,
        change: buildChangeEntry(currentItem, currentItem),
      },
    };
  }

  if (options.transient === true) {
    markItemTransient(currentItem.itemID);
  }

  const updateResult = updateInventoryItem(currentItem.itemID, {
    ...currentItem,
    ownerID: normalizedOwnerId,
    locationID: normalizedStationId,
    flagID: normalizedFlagId,
  });
  if (!updateResult.success) {
    return updateResult;
  }

  return {
    success: true,
    data: {
      item: updateResult.data,
      previousData: updateResult.previousData,
      change: buildChangeEntry(updateResult.data, updateResult.previousData),
    },
  };
}

function seedShipsForCharacter(charId, stationId, shipTypes = [], options = {}) {
  const normalizedCharacterId = normalizeInteger(charId, 0);
  const normalizedStationId = normalizeInteger(stationId, 0);
  if (normalizedCharacterId <= 0 || normalizedStationId <= 0) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
      data: {
        items: [],
        changes: [],
      },
    };
  }

  const grantEntries = (Array.isArray(shipTypes) ? shipTypes : [])
    .filter((shipType) => shipType && normalizeInteger(shipType.typeID, 0) > 0)
    .map((shipType) => ({
      itemType: shipType,
      quantity: 1,
      options: {
        singleton: 1,
        transient: options.transient === true,
      },
    }));

  if (grantEntries.length === 0) {
    return {
      success: true,
      data: {
        items: [],
        changes: [],
      },
    };
  }

  return grantItemsToCharacterLocation(
    normalizedCharacterId,
    normalizedStationId,
    ITEM_FLAGS.HANGAR,
    grantEntries,
  );
}

function seedItemsForCharacter(charId, stationId, itemTypes = [], options = {}) {
  const normalizedCharacterId = normalizeInteger(charId, 0);
  const normalizedStationId = normalizeInteger(stationId, 0);
  if (normalizedCharacterId <= 0 || normalizedStationId <= 0) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
      data: {
        items: [],
        changes: [],
      },
    };
  }

  const grantEntries = (Array.isArray(itemTypes) ? itemTypes : [])
    .filter((itemType) => itemType && normalizeInteger(itemType.typeID, 0) > 0)
    .map((itemType) => ({
      itemType,
      quantity: Math.max(1, normalizeInteger(itemType.quantity, 1)),
      options: {
        singleton: normalizeInteger(itemType.singleton, 0) > 0 ? 1 : 0,
        transient: options.transient === true,
      },
    }));

  if (grantEntries.length === 0) {
    return {
      success: true,
      data: {
        items: [],
        changes: [],
      },
    };
  }

  return grantItemsToCharacterLocation(
    normalizedCharacterId,
    normalizedStationId,
    ITEM_FLAGS.HANGAR,
    grantEntries,
  );
}

function resolveStationSolarSystemId(stationId, fallbackSystemId = 0) {
  const station = worldData.getStationByID(stationId);
  return normalizeInteger(station && station.solarSystemID, fallbackSystemId);
}

module.exports = {
  ITEM_FLAGS,
  getCharacterSessions,
  markItemTransient,
  markWalletTransient,
  notifyInventoryChangesToCharacter,
  resolveCharacterStationId,
  getLargestTokenStack,
  ensureCharacterTokenStack,
  consumeTokenStack,
  moveItemToRaffleEscrow,
  restoreEscrowedItem,
  deliverRaffleItemToCharacterStation,
  seedShipsForCharacter,
  seedItemsForCharacter,
  resolveStationSolarSystemId,
};
