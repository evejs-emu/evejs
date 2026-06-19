const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../runtime"));
const {
  ITEM_FLAGS,
  getItemMetadata,
  grantItemToCharacterLocation,
} = require(path.join(__dirname, "../../services/inventory/itemStore"));
const {
  getSpaceDebrisLifetimeMs,
} = require(path.join(__dirname, "../../services/inventory/spaceDebrisState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
const {
  getNpcLootTable,
} = require(path.join(__dirname, "./npcData"));
const {
  rollNpcLootEntries,
} = require(path.join(__dirname, "./npcLoot"));
const {
  getControllerByEntityID,
  unregisterController,
} = require(path.join(__dirname, "./npcRegistry"));
const nativeNpcStore = require(path.join(__dirname, "./nativeNpcStore"));
const {
  buildDunRotationFromDirection,
  resolveEntityWreckType,
} = require(path.join(__dirname, "../wreckUtils"));

const DESTRUCTION_EFFECT_EXPLOSION = 3;

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
}

function normalizeWreckSingleton(value) {
  return value === true || Number(value) === 1;
}

function buildNativeWreckRuntimeEntity(wreckRecord, options = {}) {
  const wreckItemRecord = nativeNpcStore.buildNativeWreckInventoryItem(
    wreckRecord && wreckRecord.wreckID,
  );
  if (!wreckItemRecord) {
    return null;
  }

  const entity = spaceRuntime.buildRuntimeSpaceEntityFromItemRecord(
    wreckItemRecord,
    toPositiveInt(wreckRecord && wreckRecord.systemID, 0),
    toFiniteNumber(options.nowMs, Date.now()),
  );
  if (!entity) {
    return null;
  }

  entity.persistSpaceState = false;
  entity.lastPersistAt = 0;
  entity.spaceState = cloneValue(wreckItemRecord.spaceState || entity.spaceState || null);
  entity.conditionState = cloneValue(
    wreckItemRecord.conditionState || entity.conditionState || null,
  );
  entity.createdAtMs = toFiniteNumber(wreckRecord && wreckRecord.createdAtMs, 0) || null;
  entity.expiresAtMs = toFiniteNumber(wreckRecord && wreckRecord.expiresAtMs, 0) || null;
  entity.isEmpty =
    nativeNpcStore.listNativeWreckItemsForWreck(
      toPositiveInt(wreckRecord && wreckRecord.wreckID, 0),
    ).length === 0;
  entity.launcherID = toPositiveInt(wreckRecord && wreckRecord.launcherID, 0) || null;
  entity.dunRotation =
    Array.isArray(wreckRecord && wreckRecord.dunRotation)
      ? cloneValue(wreckRecord.dunRotation)
      : null;
  entity.nativeNpcWreck = true;
  entity.transient = wreckRecord && wreckRecord.transient === true;
  if (wreckRecord && wreckRecord.salvaged === true) {
    entity.kind = "container";
    entity.salvaged = true;
    entity.salvageComplete = true;
  }
  return entity;
}

function buildNativeWreckItemRecord(wreckRecord, itemType, options = {}) {
  const singleton = normalizeWreckSingleton(options.singleton);
  const quantity = singleton ? 1 : Math.max(1, toPositiveInt(options.quantity, 1));
  const metadata = getItemMetadata(itemType && itemType.typeID, itemType && itemType.name);
  const wreckItemIDResult = nativeNpcStore.allocateWreckItemID({
    transient: wreckRecord.transient === true,
  });
  if (!wreckItemIDResult.success || !wreckItemIDResult.data) {
    return wreckItemIDResult;
  }

  return {
    success: true,
    data: {
      wreckItemID: wreckItemIDResult.data,
      wreckID: wreckRecord.wreckID,
      ownerID: wreckRecord.ownerID,
      locationID: wreckRecord.wreckID,
      flagID: ITEM_FLAGS.HANGAR,
      typeID: toPositiveInt(itemType && itemType.typeID, 0),
      groupID: toPositiveInt(metadata && metadata.groupID, 0),
      categoryID: toPositiveInt(metadata && metadata.categoryID, 0),
      itemName: String(itemType && itemType.name || metadata && metadata.name || "Item"),
      quantity,
      singleton,
      customInfo: "",
      moduleState: options.moduleState ? cloneValue(options.moduleState) : null,
      sourceKind: String(options.sourceKind || "loot"),
      moduleID: toPositiveInt(options.moduleID, 0),
      volume: toFiniteNumber(metadata && metadata.volume, 0),
      transient: wreckRecord.transient === true,
    },
  };
}

function refreshNativeWreckRuntimeEntity(systemID, wreckID, options = {}) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  const normalizedWreckID = toPositiveInt(wreckID, 0);
  if (!normalizedSystemID || !normalizedWreckID) {
    return {
      success: false,
      errorMsg: "WRECK_NOT_FOUND",
    };
  }

  const scene = spaceRuntime.ensureScene(normalizedSystemID);
  const entity = scene ? scene.getEntityByID(normalizedWreckID) : null;
  const wreckRecord = nativeNpcStore.getNativeWreck(normalizedWreckID);
  if (!scene || !entity || !wreckRecord) {
    return {
      success: false,
      errorMsg: "WRECK_NOT_FOUND",
    };
  }

  entity.itemName = String(wreckRecord.itemName || entity.itemName || "Wreck");
  entity.isEmpty = nativeNpcStore.listNativeWreckItemsForWreck(normalizedWreckID).length === 0;
  if (options.broadcast === true) {
    scene.sendSlimItemChangesToAllSessions([entity]);
  }

  return {
    success: true,
    data: {
      scene,
      entity,
      wreckRecord,
    },
  };
}

function spawnNativeWreck(systemID, wreckID, options = {}) {
  const wreckRecord = nativeNpcStore.getNativeWreck(wreckID);
  if (!wreckRecord) {
    return {
      success: false,
      errorMsg: "WRECK_NOT_FOUND",
    };
  }

  const scene = spaceRuntime.ensureScene(toPositiveInt(systemID, wreckRecord.systemID));
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const existingEntity = scene.getEntityByID(wreckRecord.wreckID);
  if (existingEntity && existingEntity.nativeNpcWreck === true) {
    return refreshNativeWreckRuntimeEntity(scene.systemID, wreckRecord.wreckID, options);
  }

  const entity = buildNativeWreckRuntimeEntity(wreckRecord, {
    nowMs:
      typeof scene.getCurrentSimTimeMs === "function"
        ? scene.getCurrentSimTimeMs()
        : Date.now(),
  });
  if (!entity) {
    return {
      success: false,
      errorMsg: "WRECK_BUILD_FAILED",
    };
  }
  const spawnOptions = {
    ...options,
  };
  const broadcastOptions =
    options.broadcastOptions && typeof options.broadcastOptions === "object"
      ? { ...options.broadcastOptions }
      : {};
  if (broadcastOptions.freshAcquire === undefined) {
    // Native NPC wrecks are the follow-on to an already visible explosion /
    // RemoveBalls handoff, just like the player-ship /deathtest path. Using the
    // lighter immediate lane avoids bootstrap-acquire backsteps that make the
    // wreck disappear until the next full scene refresh.
    broadcastOptions.freshAcquire = false;
  }
  if (Object.keys(broadcastOptions).length > 0) {
    spawnOptions.broadcastOptions = broadcastOptions;
  }
  return scene.spawnDynamicEntity(entity, spawnOptions);
}

function destroyNativeWreck(wreckID, options = {}) {
  const wreckRecord = nativeNpcStore.getNativeWreck(wreckID);
  if (!wreckRecord) {
    return {
      success: false,
      errorMsg: "WRECK_NOT_FOUND",
    };
  }

  const systemID = toPositiveInt(options.systemID, toPositiveInt(wreckRecord.systemID, 0));
  if (systemID > 0) {
    spaceRuntime.removeDynamicEntity(systemID, wreckRecord.wreckID, {
      allowSessionOwned: true,
    });
  }
  nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);
  return {
    success: true,
    data: {
      wreckID: wreckRecord.wreckID,
    },
  };
}

function buildWreckItemLikeRow(wreckItemRecord) {
  const wreckID = toPositiveInt(wreckItemRecord && wreckItemRecord.wreckID, 0);
  const singleton = normalizeWreckSingleton(wreckItemRecord && wreckItemRecord.singleton);
  const quantity = singleton
    ? 1
    : Math.max(1, toPositiveInt(wreckItemRecord && wreckItemRecord.quantity, 1));
  return {
    itemID: toPositiveInt(wreckItemRecord && wreckItemRecord.wreckItemID, 0),
    typeID: toPositiveInt(wreckItemRecord && wreckItemRecord.typeID, 0),
    ownerID: toPositiveInt(wreckItemRecord && wreckItemRecord.ownerID, 0),
    locationID: wreckID,
    flagID: toPositiveInt(wreckItemRecord && wreckItemRecord.flagID, ITEM_FLAGS.HANGAR),
    quantity: singleton ? -1 : quantity,
    stacksize: singleton ? 1 : quantity,
    singleton: singleton ? 1 : 0,
    groupID: toPositiveInt(wreckItemRecord && wreckItemRecord.groupID, 0),
    categoryID: toPositiveInt(wreckItemRecord && wreckItemRecord.categoryID, 0),
    itemName: String(wreckItemRecord && wreckItemRecord.itemName || ""),
    customInfo: String(wreckItemRecord && wreckItemRecord.customInfo || ""),
    volume: toFiniteNumber(wreckItemRecord && wreckItemRecord.volume, 0),
    moduleState: cloneValue(wreckItemRecord && wreckItemRecord.moduleState || null),
  };
}

function transferNativeWreckItemToCharacterLocation(options = {}) {
  const characterID = toPositiveInt(options.characterID, 0);
  const wreckID = toPositiveInt(options.wreckID, 0);
  const wreckItemID = toPositiveInt(options.wreckItemID, 0);
  const destinationLocationID = toPositiveInt(options.destinationLocationID, 0);
  const destinationFlagID = toPositiveInt(options.destinationFlagID, ITEM_FLAGS.HANGAR);
  if (!characterID || !wreckID || !wreckItemID || !destinationLocationID) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const wreckRecord = nativeNpcStore.getNativeWreck(wreckID);
  const wreckItemRecord = nativeNpcStore.getNativeWreckItem(wreckItemID);
  if (!wreckRecord || !wreckItemRecord || toPositiveInt(wreckItemRecord.wreckID, 0) !== wreckID) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const singleton = normalizeWreckSingleton(wreckItemRecord.singleton);
  const availableQuantity = singleton
    ? 1
    : Math.max(1, toPositiveInt(wreckItemRecord.quantity, 1));
  const requestedQuantity = options.quantity === null || options.quantity === undefined
    ? availableQuantity
    : Math.max(1, toPositiveInt(options.quantity, 1));
  if (requestedQuantity > availableQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
    };
  }

  const itemType = resolveItemByTypeID(wreckItemRecord.typeID) || {
    typeID: wreckItemRecord.typeID,
    name: wreckItemRecord.itemName,
  };
  const grantResult = grantItemToCharacterLocation(
    characterID,
    destinationLocationID,
    destinationFlagID,
    itemType,
    singleton ? 1 : requestedQuantity,
    {
      singleton,
      moduleState: wreckItemRecord.moduleState ? cloneValue(wreckItemRecord.moduleState) : undefined,
    },
  );
  if (!grantResult.success) {
    return grantResult;
  }

  const previousData = buildWreckItemLikeRow(wreckItemRecord);
  let sourceChange = null;
  if (singleton || requestedQuantity === availableQuantity) {
    nativeNpcStore.removeNativeWreckItem(wreckItemID);
    sourceChange = {
      removed: true,
      previousData,
      item: null,
    };
  } else {
    const updatedRecord = {
      ...wreckItemRecord,
      quantity: availableQuantity - requestedQuantity,
    };
    const updateResult = nativeNpcStore.upsertNativeWreckItem(updatedRecord, {
      transient: wreckRecord.transient === true,
    });
    if (!updateResult.success) {
      return updateResult;
    }
    sourceChange = {
      removed: false,
      previousData,
      item: buildWreckItemLikeRow(updatedRecord),
    };
  }

  refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID);
  return {
    success: true,
    data: {
      quantity: requestedQuantity,
      changes: [
        sourceChange,
        ...((grantResult.data && grantResult.data.changes) || []),
      ].filter(Boolean),
    },
  };
}

function destroyNativeNpcEntityWithWreck(systemID, shipEntity, options = {}) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  const entityID = toPositiveInt(shipEntity && shipEntity.itemID, 0);
  if (!normalizedSystemID || !entityID || !shipEntity || shipEntity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const nativeEntityRecord = nativeNpcStore.getNativeEntity(entityID);
  const wreckType = resolveEntityWreckType({
    nativeNpc: true,
    profileID: nativeEntityRecord && nativeEntityRecord.profileID,
    shipTypeID: shipEntity && shipEntity.typeID,
    itemName: shipEntity && shipEntity.itemName,
    groupName: nativeEntityRecord && nativeEntityRecord.slimGroupName,
    classID: nativeEntityRecord && nativeEntityRecord.capitalClassID,
    factionName: nativeEntityRecord && nativeEntityRecord.factionName,
    npcEntityType: nativeEntityRecord && nativeEntityRecord.npcEntityType,
  });
  if (!wreckType) {
    return {
      success: false,
      errorMsg: "WRECK_TYPE_NOT_FOUND",
    };
  }

  const scene = spaceRuntime.ensureScene(normalizedSystemID);
  const nowMs = scene ? scene.getCurrentSimTimeMs() : Date.now();
  const controller = getControllerByEntityID(entityID);
  let destroyedFighterCount = 0;
  if (
    scene &&
    controller &&
    Array.isArray(
      controller.behaviorProfile &&
      controller.behaviorProfile.capitalFighterWingTypeIDs,
    )
  ) {
    const {
      resetNpcSupercarrierWing,
    } = require(path.join(
      __dirname,
      "../../services/fighter/npc/npcSupercarrierDirector",
    ));
    const cleanupResult = resetNpcSupercarrierWing(
      scene,
      shipEntity,
      controller,
      {
        removeContents: options.removeContents !== false,
      },
    );
    destroyedFighterCount = Number(
      cleanupResult &&
      cleanupResult.success &&
      cleanupResult.data &&
      cleanupResult.data.destroyedCount,
    ) || 0;
  }
  const wreckIDResult = nativeNpcStore.allocateWreckID({
    transient: shipEntity.transient === true,
  });
  if (!wreckIDResult.success || !wreckIDResult.data) {
    return wreckIDResult;
  }

  const wreckRecord = {
    wreckID: wreckIDResult.data,
    sourceEntityID: entityID,
    systemID: normalizedSystemID,
    profileID: nativeEntityRecord && nativeEntityRecord.profileID || null,
    loadoutID: nativeEntityRecord && nativeEntityRecord.loadoutID || null,
    lootTableID: nativeEntityRecord && nativeEntityRecord.lootTableID || null,
    npcEntityType: nativeEntityRecord && nativeEntityRecord.npcEntityType || null,
    typeID: toPositiveInt(wreckType.typeID, 0),
    groupID: toPositiveInt(wreckType.groupID, 0),
    categoryID: toPositiveInt(wreckType.categoryID, 0),
    itemName: String(wreckType.name || "Wreck"),
    ownerID: toPositiveInt(shipEntity.ownerID, 0),
    position: cloneVector(shipEntity.position),
    velocity: { x: 0, y: 0, z: 0 },
    direction: cloneVector(shipEntity.direction, { x: 1, y: 0, z: 0 }),
    targetPoint: cloneVector(shipEntity.position),
    mode: "STOP",
    speedFraction: 0,
    radius: Math.max(0, toFiniteNumber(shipEntity.radius, 0)),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + getSpaceDebrisLifetimeMs(),
    launcherID: entityID,
    dunRotation: buildDunRotationFromDirection(shipEntity.direction),
    transient: shipEntity.transient === true,
    conditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 0,
      incapacitated: false,
    },
  };
  const wreckWriteResult = nativeNpcStore.upsertNativeWreck(wreckRecord, {
    transient: wreckRecord.transient,
  });
  if (!wreckWriteResult.success) {
    return wreckWriteResult;
  }

  const cargoDrops = nativeNpcStore.buildNativeCargoItems(entityID);
  for (const cargoEntry of cargoDrops) {
    const itemType = resolveItemByTypeID(cargoEntry.typeID) || {
      typeID: cargoEntry.typeID,
      name: cargoEntry.itemName,
    };
    const wreckItemResult = buildNativeWreckItemRecord(wreckRecord, itemType, {
      quantity: cargoEntry.quantity,
      singleton: cargoEntry.singleton,
      moduleState: cargoEntry.moduleState,
      moduleID: cargoEntry.moduleID,
      sourceKind: "cargo",
    });
    if (!wreckItemResult.success || !wreckItemResult.data) {
      nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);
      return wreckItemResult;
    }
    const writeResult = nativeNpcStore.upsertNativeWreckItem(wreckItemResult.data, {
      transient: wreckRecord.transient,
    });
    if (!writeResult.success) {
      nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);
      return writeResult;
    }
  }

  const lootTable = nativeEntityRecord && nativeEntityRecord.lootTableID
    ? getNpcLootTable(nativeEntityRecord.lootTableID)
    : null;
  const rolledLootEntries = rollNpcLootEntries(lootTable);
  for (const lootEntry of rolledLootEntries) {
    const wreckItemResult = buildNativeWreckItemRecord(wreckRecord, lootEntry.itemType, {
      quantity: lootEntry.quantity,
      singleton: lootEntry.singleton,
      sourceKind: "loot",
    });
    if (!wreckItemResult.success || !wreckItemResult.data) {
      nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);
      return wreckItemResult;
    }
    const writeResult = nativeNpcStore.upsertNativeWreckItem(wreckItemResult.data, {
      transient: wreckRecord.transient,
    });
    if (!writeResult.success) {
      nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);
      return writeResult;
    }
  }

  const removeResult = spaceRuntime.removeDynamicEntity(normalizedSystemID, entityID, {
    allowSessionOwned: false,
    terminalDestructionEffectID: DESTRUCTION_EFFECT_EXPLOSION,
  });
  if (!removeResult.success) {
    nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);
    return removeResult;
  }

  unregisterController(entityID);
  nativeNpcStore.removeNativeEntityCascade(entityID);

  const wreckSpawnResult = spawnNativeWreck(normalizedSystemID, wreckRecord.wreckID);
  if (!wreckSpawnResult.success) {
    return wreckSpawnResult;
  }

  return {
    success: true,
    data: {
      wreck: wreckRecord,
      shipID: entityID,
      destroyedFighterCount,
      wreckItems: nativeNpcStore.listNativeWreckItemsForWreck(wreckRecord.wreckID),
      rolledLootEntries: rolledLootEntries.map((entry) => ({
        typeID: entry.typeID,
        name: entry.name,
        quantity: entry.quantity,
      })),
    },
  };
}

module.exports = {
  buildNativeWreckRuntimeEntity,
  refreshNativeWreckRuntimeEntity,
  spawnNativeWreck,
  destroyNativeWreck,
  transferNativeWreckItemToCharacterLocation,
  destroyNativeNpcEntityWithWreck,
};
