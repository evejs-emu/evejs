const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCharacterCreationRace,
} = require(path.join(__dirname, "../character/characterCreationData"));
const {
  ITEM_FLAGS,
  findCharacterShipByType,
  findCharacterShipItem,
  grantItemToCharacterLocation,
  setActiveShipForCharacter,
  updateInventoryItem,
  updateShipItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  listFittedItems,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  getDockedLocationID,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  ensureStarterShipDefaultFit,
  getStarterShipFitting,
} = require(path.join(__dirname, "./starterShipFittingState"));

const CHARACTERS_TABLE = "characters";
const CORVETTE_GROUP_ID = 237;
const DEFAULT_ROOKIE_SHIP_TYPE_ID = 606;
const DEFAULT_ROOKIE_SHIP_NAME = "Velator";
const rookieShipProfileCache = new Map();

function getCharacterStateService() {
  return require(path.join(__dirname, "../character/characterState"));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneValue(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function readCharacterRecord(characterID) {
  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return null;
  }

  const result = database.read(
    CHARACTERS_TABLE,
    `/${String(numericCharacterID)}`,
  );
  return result && result.success && result.data
    ? cloneValue(result.data)
    : null;
}

function clearRookieShipProfileCache(raceID = null) {
  const numericRaceID = toInt(raceID, 0);
  if (numericRaceID > 0) {
    rookieShipProfileCache.delete(numericRaceID);
    return;
  }
  rookieShipProfileCache.clear();
}

function getCachedRookieShipProfileForRace(raceID, options = {}) {
  const numericRaceID = toInt(raceID, 0);
  if (numericRaceID <= 0) {
    return null;
  }

  if (options && options.refresh) {
    clearRookieShipProfileCache(numericRaceID);
  }
  if (rookieShipProfileCache.has(numericRaceID)) {
    return cloneValue(rookieShipProfileCache.get(numericRaceID));
  }

  const raceProfile = getCharacterCreationRace(numericRaceID, options);
  if (!raceProfile || toInt(raceProfile.shipTypeID, 0) <= 0) {
    return null;
  }

  const shipTypeID = toInt(raceProfile.shipTypeID, 0);
  const shipType = resolveItemByTypeID(shipTypeID);
  const normalizedProfile = {
    raceID: numericRaceID,
    shipTypeID,
    shipName:
      String(raceProfile.shipName || "").trim() ||
      String((shipType && shipType.name) || DEFAULT_ROOKIE_SHIP_NAME),
  };
  rookieShipProfileCache.set(numericRaceID, normalizedProfile);
  return cloneValue(normalizedProfile);
}

function resolveRookieShipProfile(options = {}) {
  const characterRecord =
    options.characterRecord && typeof options.characterRecord === "object"
      ? options.characterRecord
      : readCharacterRecord(options.characterID);
  const raceID = toInt(
    options.raceID ??
      (characterRecord && characterRecord.raceID) ??
      (options.session && (options.session.raceID ?? options.session.raceid)),
    0,
  );
  const explicitShipTypeID = toInt(options.shipTypeID, 0);
  if (options.preferExplicitShipType === true && explicitShipTypeID > 0) {
    const explicitShipType = resolveItemByTypeID(explicitShipTypeID);
    return {
      raceID,
      shipTypeID: explicitShipTypeID,
      shipName:
        String(
          options.shipName ??
            (characterRecord && characterRecord.shipName) ??
            (explicitShipType && explicitShipType.name) ??
            DEFAULT_ROOKIE_SHIP_NAME,
        ).trim() || DEFAULT_ROOKIE_SHIP_NAME,
    };
  }

  const cachedProfile = getCachedRookieShipProfileForRace(raceID, options);
  if (cachedProfile) {
    return cachedProfile;
  }

  const fallbackShipTypeID = toInt(
    explicitShipTypeID ||
      (characterRecord && characterRecord.shipTypeID),
    DEFAULT_ROOKIE_SHIP_TYPE_ID,
  );
  const fallbackShipType = resolveItemByTypeID(fallbackShipTypeID);
  return {
    raceID,
    shipTypeID: fallbackShipTypeID,
    shipName:
      String(
        options.shipName ??
          (characterRecord && characterRecord.shipName) ??
          (fallbackShipType && fallbackShipType.name) ??
          DEFAULT_ROOKIE_SHIP_NAME,
      ).trim() || DEFAULT_ROOKIE_SHIP_NAME,
  };
}

function resolveRookieShipTypeID(session, characterRecord = null) {
  return resolveRookieShipProfile({
    session,
    characterRecord,
    characterID: toInt(session && session.characterID, 0),
  }).shipTypeID;
}

function isRookieShipItem(item) {
  if (!item) {
    return false;
  }

  const shipType = resolveItemByTypeID(toInt(item.typeID, 0));
  return (
    toInt(item.groupID, 0) === CORVETTE_GROUP_ID ||
    toInt(shipType && shipType.groupID, 0) === CORVETTE_GROUP_ID
  );
}

function getCurrentActiveShip(characterID, characterRecord = null) {
  const resolvedCharacterRecord =
    characterRecord && typeof characterRecord === "object"
      ? characterRecord
      : readCharacterRecord(characterID);
  const activeShipID = toInt(resolvedCharacterRecord && resolvedCharacterRecord.shipID, 0);
  if (activeShipID <= 0) {
    return null;
  }
  return findCharacterShipItem(characterID, activeShipID);
}

function syncInventoryChangesForSession(session, changes = []) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }

  const characterState = getCharacterStateService();
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    characterState.syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      {
        emitCfgLocation: true,
      },
    );
  }
}

function refreshShip(characterID, shipItem) {
  return (
    findCharacterShipItem(
      toInt(characterID, 0),
      toInt(shipItem && shipItem.itemID, 0),
    ) ||
    shipItem
  );
}

function repairShipAndFittedItemsForSession(session, shipItem) {
  if (!session || !shipItem || !shipItem.itemID) {
    return {
      success: false,
      errorMsg: "INVALID_REPAIR_REQUEST",
      data: {
        changes: [],
      },
    };
  }

  const characterState = getCharacterStateService();
  const changes = [];
  const shipUpdateResult = updateShipItem(shipItem.itemID, (currentShip) => ({
    ...currentShip,
    conditionState: {
      ...(currentShip.conditionState || {}),
      damage: 0.0,
      charge: 1.0,
      armorDamage: 0.0,
      shieldCharge: 1.0,
      incapacitated: false,
    },
  }));
  if (shipUpdateResult.success) {
    characterState.syncInventoryItemForSession(
      session,
      shipUpdateResult.data,
      shipUpdateResult.previousData || {},
      {
        emitCfgLocation: true,
      },
    );
    changes.push({
      item: shipUpdateResult.data,
      previousData: shipUpdateResult.previousData || {},
    });
  }

  const fittedItems = listFittedItems(
    toInt(session.characterID, 0),
    shipItem.itemID,
  );
  for (const fittedItem of fittedItems) {
    const moduleUpdateResult = updateInventoryItem(
      fittedItem.itemID,
      (currentItem) => ({
        ...currentItem,
        moduleState: {
          ...(currentItem.moduleState || {}),
          damage: 0.0,
          armorDamage: 0.0,
          incapacitated: false,
        },
      }),
    );
    if (!moduleUpdateResult.success) {
      continue;
    }
    characterState.syncInventoryItemForSession(
      session,
      moduleUpdateResult.data,
      moduleUpdateResult.previousData || {},
      {
        emitCfgLocation: false,
      },
    );
    changes.push({
      item: moduleUpdateResult.data,
      previousData: moduleUpdateResult.previousData || {},
    });
  }
  return {
    success: true,
    data: {
      changes,
    },
  };
}

function createRookieShipInHangar(characterID, dockedLocationID, profile) {
  const shipType = resolveItemByTypeID(toInt(profile && profile.shipTypeID, 0));
  if (!shipType) {
    return {
      success: false,
      errorMsg: "ROOKIE_SHIP_TYPE_NOT_FOUND",
      data: {
        shipTypeID: toInt(profile && profile.shipTypeID, 0),
      },
    };
  }

  const grantResult = grantItemToCharacterLocation(
    characterID,
    dockedLocationID,
    ITEM_FLAGS.HANGAR,
    shipType,
    1,
    {
      singleton: 1,
      itemName: profile.shipName,
    },
  );
  if (!grantResult.success) {
    return grantResult;
  }

  return {
    success: true,
    data: {
      ship: grantResult.data && Array.isArray(grantResult.data.items)
        ? grantResult.data.items[0] || null
        : null,
      changes: (grantResult.data && grantResult.data.changes) || [],
    },
  };
}

function spawnRookieShipForCharacter(
  characterID,
  dockedLocationID,
  options = {},
) {
  const numericCharacterID = toInt(characterID, 0);
  const numericDockedLocationID = toInt(dockedLocationID, 0);
  if (numericCharacterID <= 0 || numericDockedLocationID <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_ROOKIE_SHIP_REQUEST",
    };
  }

  const session = options.session || null;
  const characterRecord =
    options.characterRecord && typeof options.characterRecord === "object"
      ? options.characterRecord
      : readCharacterRecord(numericCharacterID);
  const profile = resolveRookieShipProfile({
    ...options,
    session,
    characterID: numericCharacterID,
    characterRecord,
  });
  const activeShip = getCurrentActiveShip(numericCharacterID, characterRecord);
  if (
    options.autoBoard === true &&
    activeShip &&
    isRookieShipItem(activeShip)
  ) {
    if (options.allowAlreadyInNewbieShip === true) {
      return {
        success: true,
        data: {
          ship: activeShip,
          corvetteTypeID: toInt(activeShip.typeID, 0),
          reusedExistingShip: true,
          alreadyInNewbieShip: true,
          starterShipFitResult: null,
          rookieShipProfile: profile,
        },
      };
    }
    return {
      success: false,
      errorMsg: "ALREADY_IN_NEWBIE_SHIP",
      data: {
        ship: activeShip,
      },
    };
  }

  let rookieShip =
    options.reuseExistingShip === false
      ? null
      : findCharacterShipByType(
        numericCharacterID,
        profile.shipTypeID,
        numericDockedLocationID,
      );
  let createdShip = false;
  const reusedExistingShip = Boolean(rookieShip);

  if (!rookieShip) {
    const createResult = createRookieShipInHangar(
      numericCharacterID,
      numericDockedLocationID,
      profile,
    );
    if (!createResult.success || !createResult.data || !createResult.data.ship) {
      log.warn(
        `[RookieShipRuntime] ${String(options.logLabel || "SpawnRookieShip")} failed to create rookie ship for char=${numericCharacterID} typeID=${profile.shipTypeID} error=${createResult.errorMsg}`,
      );
      return {
        success: false,
        errorMsg: "CORVETTE_CREATE_FAILED",
        data: {
          corvetteTypeID: profile.shipTypeID,
          innerErrorMsg: createResult.errorMsg || null,
        },
      };
    }
    rookieShip = createResult.data.ship;
    createdShip = true;
    if (options.emitNotifications !== false) {
      syncInventoryChangesForSession(session, createResult.data.changes);
    }
  }

  let activeRookieShip = refreshShip(numericCharacterID, rookieShip);
  if (
    options.autoBoard === true &&
    reusedExistingShip &&
    options.repairExistingShip !== false
  ) {
    repairShipAndFittedItemsForSession(session, activeRookieShip);
    activeRookieShip = refreshShip(numericCharacterID, activeRookieShip);
  }

  const fitResult = ensureStarterShipDefaultFit(
    numericCharacterID,
    numericDockedLocationID,
    activeRookieShip,
    {
      logFailures: true,
    },
  );
  if (
    options.emitNotifications !== false &&
    options.autoBoard !== true &&
    fitResult &&
    fitResult.data &&
    fitResult.data.applied === true
  ) {
    syncInventoryChangesForSession(session, fitResult.data.changes);
  }
  activeRookieShip = refreshShip(numericCharacterID, activeRookieShip);

  if (!fitResult.success) {
    log.warn(
      `[RookieShipRuntime] ${String(options.logLabel || "SpawnRookieShip")} starter fit incomplete for char=${numericCharacterID} ship=${activeRookieShip.itemID} typeID=${activeRookieShip.typeID} error=${fitResult.errorMsg}`,
    );
  }

  let activationResult = null;
  if (options.autoBoard === true) {
    const characterState = getCharacterStateService();
    activationResult = characterState.activateShipForSession(
      session,
      activeRookieShip.itemID,
      {
        emitNotifications: options.emitNotifications !== false,
        logSelection: options.logSelection !== false,
      },
    );
    if (!activationResult.success) {
      log.warn(
        `[RookieShipRuntime] ${String(options.logLabel || "SpawnRookieShip")} failed to activate rookie ship=${activeRookieShip.itemID} char=${numericCharacterID} error=${activationResult.errorMsg}`,
      );
      return {
        success: false,
        errorMsg: "SHIP_ACTIVATION_FAILED",
        data: {
          corvetteTypeID: profile.shipTypeID,
          ship: activeRookieShip,
          innerErrorMsg: activationResult.errorMsg || null,
        },
      };
    }
    activeRookieShip = refreshShip(
      numericCharacterID,
      activationResult.activeShip || activeRookieShip,
    );
  } else if (options.setActiveShip !== false) {
    const setActiveResult = setActiveShipForCharacter(
      numericCharacterID,
      activeRookieShip.itemID,
    );
    if (!setActiveResult.success) {
      return setActiveResult;
    }
    activeRookieShip = refreshShip(numericCharacterID, activeRookieShip);
  }

  return {
    success: true,
    data: {
      ship: activeRookieShip,
      corvetteTypeID: profile.shipTypeID,
      reusedExistingShip,
      createdShip,
      alreadyInNewbieShip: false,
      starterShipFitResult: fitResult && fitResult.data ? fitResult.data : null,
      rookieShipProfile: {
        ...profile,
        starterFitting: getStarterShipFitting(profile.shipTypeID),
      },
      activationChanged:
        activationResult && typeof activationResult.changed === "boolean"
          ? activationResult.changed
          : options.autoBoard === true,
    },
  };
}

function boardRookieShipForSession(session, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }
  if (!isDockedSession(session)) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  return spawnRookieShipForCharacter(
    toInt(session.characterID, 0),
    getDockedLocationID(session),
    {
      ...options,
      session,
      autoBoard: true,
    },
  );
}

module.exports = {
  CORVETTE_GROUP_ID,
  DEFAULT_ROOKIE_SHIP_NAME,
  DEFAULT_ROOKIE_SHIP_TYPE_ID,
  boardRookieShipForSession,
  clearRookieShipProfileCache,
  getCachedRookieShipProfileForRace,
  isRookieShipItem,
  readCharacterRecord,
  repairShipAndFittedItemsForSession,
  resolveRookieShipProfile,
  resolveRookieShipTypeID,
  spawnRookieShipForCharacter,
};
