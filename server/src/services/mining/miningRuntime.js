const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const {
  getActiveShipRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  ITEM_FLAGS,
  findShipItemById,
  getItemMutationVersion,
  grantItemsToCharacterLocation,
  listContainerItems,
  removeInventoryItem,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getFittedModuleItems,
  getLoadedChargeByFlag,
  getEffectTypeRecord,
  isChargeCompatibleWithModule,
  isModuleOnline,
  buildShipResourceState,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  MINING_HOLD_FLAGS,
} = require("./miningConstants");
const {
  getPreferredMiningHoldFlagForType,
  getShipHoldCapacityByFlag,
} = require("./miningInventory");
const {
  computeMiningResult,
} = require("./miningMath");
const {
  isMiningEffectRecord,
  buildMiningModuleSnapshot,
} = require("./miningDogma");
const commandBurstRuntime = require(path.join(
  __dirname,
  "../../space/modules/commandBurstRuntime",
));
const {
  getLocationModifierSourcesForSystem,
} = require(path.join(
  __dirname,
  "../exploration/wormholes/wormholeEnvironmentRuntime",
));
const {
  ensureSceneMiningState,
  getMineableState,
  applyMiningDelta,
  isMineableStaticEntity,
} = require("./miningRuntimeState");
const {
  getNpcFittedModuleItems,
  getNpcLoadedChargeForModule,
  isNativeNpcEntity,
} = require(path.join(__dirname, "../../space/npc/npcEquipment"));

const shipStorageSnapshotCache = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function distance(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function getSurfaceDistance(left, right) {
  return Math.max(
    0,
    distance(left && left.position, right && right.position) -
      Math.max(0, toFiniteNumber(left && left.radius, 0)) -
      Math.max(0, toFiniteNumber(right && right.radius, 0)),
  );
}

function getMiningCommandSurfaceDistance(scene, sourceEntity, targetEntity, nowMs = null) {
  if (
    scene &&
    typeof scene.getCommandTimeEntitySurfaceDistance === "function"
  ) {
    return scene.getCommandTimeEntitySurfaceDistance(
      sourceEntity,
      targetEntity,
      nowMs,
    );
  }
  if (scene && typeof scene.getEntitySurfaceDistance === "function") {
    return scene.getEntitySurfaceDistance(sourceEntity, targetEntity);
  }
  return getSurfaceDistance(sourceEntity, targetEntity);
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveEntityCharacterID(entity) {
  if (!entity || entity.kind !== "ship") {
    return 0;
  }
  return toInt(
    entity.session && entity.session.characterID
      ? entity.session.characterID
      : entity.characterID ?? entity.pilotCharacterID,
    0,
  );
}

function buildEphemeralShipItem(entity, characterID = 0) {
  return {
    itemID: toInt(entity && entity.itemID, 0),
    typeID: toInt(entity && entity.typeID, 0),
    ownerID: toInt(characterID, 0),
    locationID: toInt(entity && entity.systemID, 0),
    flagID: ITEM_FLAGS.HANGAR,
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    itemName: String(entity && entity.itemName || ""),
  };
}

function resolveEntityShipItem(entity) {
  const characterID = resolveEntityCharacterID(entity);
  if (characterID > 0) {
    return (
      getActiveShipRecord(characterID) ||
      findShipItemById(toInt(entity && entity.itemID, 0)) ||
      buildEphemeralShipItem(entity, characterID)
    );
  }
  return buildEphemeralShipItem(entity, characterID);
}

function resolveEntitySkillMap(entity) {
  const characterID = resolveEntityCharacterID(entity);
  return characterID > 0 ? getCharacterSkillMap(characterID) : new Map();
}

function resolveEntityFittedItems(entity) {
  if (!entity || entity.kind !== "ship") {
    return [];
  }
  if (isNativeNpcEntity(entity)) {
    return getNpcFittedModuleItems(entity);
  }
  const characterID = resolveEntityCharacterID(entity);
  if (characterID > 0) {
    return getFittedModuleItems(characterID, toInt(entity.itemID, 0));
  }
  return Array.isArray(entity.fittedItems) ? entity.fittedItems.map((item) => ({ ...item })) : [];
}

function resolveEntityModuleItem(entity, moduleID = 0, moduleFlagID = 0) {
  const normalizedModuleID = toInt(moduleID, 0);
  const normalizedModuleFlagID = toInt(moduleFlagID, 0);
  return resolveEntityFittedItems(entity).find((moduleItem) => (
    (
      normalizedModuleID > 0 &&
      toInt(moduleItem && moduleItem.itemID, 0) === normalizedModuleID
    ) ||
    (
      normalizedModuleFlagID > 0 &&
      toInt(moduleItem && moduleItem.flagID, 0) === normalizedModuleFlagID
    )
  )) || null;
}

function resolveEntityLoadedCharge(entity, moduleItem = null) {
  if (!entity || entity.kind !== "ship" || !moduleItem) {
    return null;
  }
  if (isNativeNpcEntity(entity)) {
    return getNpcLoadedChargeForModule(entity, moduleItem);
  }
  const characterID = resolveEntityCharacterID(entity);
  if (characterID <= 0) {
    return moduleItem.loadedChargeItem || null;
  }
  return getLoadedChargeByFlag(
    characterID,
    toInt(entity.itemID, 0),
    toInt(moduleItem.flagID, 0),
  );
}

function resolveEntityActiveModuleContexts(entity, excludeModuleID = 0) {
  if (!entity || !(entity.activeModuleEffects instanceof Map)) {
    return [];
  }
  const normalizedExcludeModuleID = toInt(excludeModuleID, 0);
  const contexts = [];
  for (const effectState of entity.activeModuleEffects.values()) {
    if (
      !effectState ||
      (
        normalizedExcludeModuleID > 0 &&
        toInt(effectState.moduleID, 0) === normalizedExcludeModuleID
      )
    ) {
      continue;
    }
    const effectRecord = getEffectTypeRecord(toInt(effectState.effectID, 0));
    const moduleItem = resolveEntityModuleItem(
      entity,
      effectState.moduleID,
      effectState.moduleFlagID,
    );
    if (!effectRecord || !moduleItem) {
      continue;
    }
    contexts.push({
      effectState,
      effectRecord,
      moduleItem,
      chargeItem: resolveEntityLoadedCharge(entity, moduleItem),
    });
  }
  return contexts;
}

function buildEntityMiningSnapshot(entity, moduleItem, effectRecord, options = {}) {
  const shipItem = resolveEntityShipItem(entity);
  const resolvedModuleItem = resolveEntityModuleItem(
    entity,
    moduleItem && moduleItem.itemID,
    moduleItem && moduleItem.flagID,
  ) || moduleItem;
  if (!shipItem || !resolvedModuleItem) {
    return null;
  }
  const additionalModifierEntries =
    commandBurstRuntime.collectModifierEntriesForItem(
      entity,
      resolvedModuleItem,
      options.nowMs,
    );
  return buildMiningModuleSnapshot({
    shipItem,
    moduleItem: resolvedModuleItem,
    effectRecord,
    chargeItem: resolveEntityLoadedCharge(entity, resolvedModuleItem),
    fittedItems: resolveEntityFittedItems(entity),
    skillMap: resolveEntitySkillMap(entity),
    activeModuleContexts: resolveEntityActiveModuleContexts(
      entity,
      resolvedModuleItem.itemID,
    ),
    additionalModifierEntries,
    additionalLocationModifierSources: getLocationModifierSourcesForSystem(
      entity && entity.systemID,
    ),
  });
}

function isMiningEffectState(effectState) {
  return Boolean(effectState && effectState.miningEffect === true);
}

function getTargetsForEntity(scene, entity) {
  return scene && typeof scene.getTargetsForEntity === "function"
    ? scene.getTargetsForEntity(entity)
    : [];
}

function computeUsedVolume(items = []) {
  return items.reduce((sum, item) => {
    if (!item) {
      return sum;
    }
    const units =
      toInt(item.singleton, 0) === 1
        ? 1
        : Math.max(0, toInt(item.stacksize ?? item.quantity, 0));
    const volume = Math.max(0, toFiniteNumber(item.volume, 0));
    return sum + (volume * units);
  }, 0);
}

function getPlayerShipStorageSnapshot(entity) {
  const characterID = resolveEntityCharacterID(entity);
  const shipID = toInt(entity && entity.itemID, 0);
  if (characterID <= 0 || shipID <= 0) {
    return null;
  }

  const mutationVersion = getItemMutationVersion();
  const cacheKey = `${characterID}:${shipID}:${mutationVersion}`;
  if (shipStorageSnapshotCache.has(cacheKey)) {
    return shipStorageSnapshotCache.get(cacheKey);
  }

  const shipItem = resolveEntityShipItem(entity);
  const resourceState = buildShipResourceState(characterID, shipItem, {
    fittedItems: resolveEntityFittedItems(entity),
    skillMap: resolveEntitySkillMap(entity),
  });
  const usedByFlag = new Map();
  for (const item of listContainerItems(characterID, shipID, null)) {
    const flagID = toInt(item && item.flagID, 0);
    usedByFlag.set(flagID, round6((usedByFlag.get(flagID) || 0) + computeUsedVolume([item])));
  }

  const snapshot = {
    characterID,
    shipID,
    resourceState,
    usedByFlag,
  };
  shipStorageSnapshotCache.set(cacheKey, snapshot);
  return snapshot;
}

function getAvailableVolumeForFlag(storageSnapshot, flagID) {
  if (!storageSnapshot || !storageSnapshot.resourceState) {
    return 0;
  }
  const normalizedFlagID = toInt(flagID, 0);
  const capacity =
    normalizedFlagID === ITEM_FLAGS.CARGO_HOLD
      ? toFiniteNumber(storageSnapshot.resourceState.cargoCapacity, 0)
      : getShipHoldCapacityByFlag(storageSnapshot.resourceState, normalizedFlagID);
  const used = toFiniteNumber(storageSnapshot.usedByFlag.get(normalizedFlagID), 0);
  return Math.max(0, round6(capacity - used));
}

function resolveDestinationFlagForPlayer(entity, yieldTypeID, yieldKind) {
  const storageSnapshot = getPlayerShipStorageSnapshot(entity);
  const preferredFlag = storageSnapshot
    ? getPreferredMiningHoldFlagForType(storageSnapshot.resourceState, yieldTypeID)
    : null;
  const orderedFlags = [
    preferredFlag,
    yieldKind === "ore" ? MINING_HOLD_FLAGS.SPECIALIZED_ASTEROID_HOLD : null,
    yieldKind === "gas" ? MINING_HOLD_FLAGS.SPECIALIZED_GAS_HOLD : null,
    yieldKind === "ice" ? MINING_HOLD_FLAGS.SPECIALIZED_ICE_HOLD : null,
    MINING_HOLD_FLAGS.GENERAL_MINING_HOLD,
    ITEM_FLAGS.CARGO_HOLD,
  ].filter((value, index, array) => value && array.indexOf(value) === index);

  for (const flagID of orderedFlags) {
    const availableVolume = getAvailableVolumeForFlag(storageSnapshot, flagID);
    if (availableVolume > 0) {
      return {
        flagID,
        availableVolume,
      };
    }
  }

  return {
    flagID: preferredFlag || ITEM_FLAGS.CARGO_HOLD,
    availableVolume: 0,
  };
}

function resolveLedgerObserverContext(scene, targetEntity) {
  const candidateIDs = [
    targetEntity && targetEntity.observerItemID,
    targetEntity && targetEntity.observerID,
    targetEntity && targetEntity.structureID,
    targetEntity && targetEntity.ownerStructureID,
    targetEntity && targetEntity.sourceStructureID,
    targetEntity && targetEntity.moonMiningStructureID,
    scene && scene.observerItemID,
    scene && scene.observerID,
    scene && scene.structureID,
  ];

  let observerItemID = 0;
  for (const candidate of candidateIDs) {
    const normalized = toInt(candidate, 0);
    if (normalized > 0) {
      observerItemID = normalized;
      break;
    }
  }

  const observerNameCandidates = [
    targetEntity && targetEntity.observerItemName,
    targetEntity && targetEntity.observerName,
    targetEntity && targetEntity.structureName,
    targetEntity && targetEntity.ownerStructureName,
    targetEntity && targetEntity.sourceStructureName,
    scene && scene.observerItemName,
    scene && scene.observerName,
    scene && scene.structureName,
  ];
  let observerItemName = "";
  for (const candidate of observerNameCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      observerItemName = candidate.trim();
      break;
    }
  }

  return {
    observerItemID,
    observerItemName,
  };
}

function syncInventoryChangesToSession(session, changes = []) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      {
        emitCfgLocation: true,
      },
    );
  }
}

function stripCrystalSuffix(name) {
  return String(name || "")
    .replace(/\s+Mining Crystal(?:\s+I{1,3}|\s+Type\s+[ABC])?$/i, "")
    .trim();
}

function isChargeHeuristicallyValidForYield(chargeItem, mineableState) {
  if (!chargeItem || !mineableState) {
    return true;
  }
  if (mineableState.yieldKind !== "ore") {
    return false;
  }
  const yieldType = resolveItemByTypeID(mineableState.yieldTypeID) || null;
  if (!yieldType) {
    return false;
  }

  const crystalName = String(chargeItem.itemName || "").trim();
  const crystalStem = normalizeText(stripCrystalSuffix(crystalName));
  const yieldName = normalizeText(yieldType.name);
  const yieldGroupName = normalizeText(yieldType.groupName);
  if (
    crystalStem === yieldName ||
    crystalStem === yieldGroupName ||
    yieldName.includes(crystalStem) ||
    yieldGroupName.includes(crystalStem)
  ) {
    return true;
  }

  return /asteroid mining crystal|mercoxit mining crystal/i.test(crystalName);
}

function isFamilyCompatibleWithYield(snapshot, mineableState) {
  if (!snapshot || !mineableState) {
    return false;
  }
  if (snapshot.family === "gas") {
    return mineableState.yieldKind === "gas";
  }
  if (snapshot.family === "ice") {
    return mineableState.yieldKind === "ice";
  }
  return mineableState.yieldKind === "ore";
}

function isMiningSnapshotCompatibleWithState(snapshot, mineableState) {
  return isFamilyCompatibleWithYield(snapshot, mineableState);
}

function resolveMiningActivation(scene, entity, moduleItem, effectRecord, options = {}) {
  if (!isMiningEffectRecord(effectRecord, moduleItem)) {
    return { matched: false };
  }
  ensureSceneMiningState(scene);

  const targetID = toInt(options && options.targetID, 0);
  const targetEntity = scene.getEntityByID(targetID);
  const mineableState = getMineableState(scene, targetID);
  if (targetID <= 0) {
    return { matched: true, success: false, errorMsg: "TARGET_REQUIRED" };
  }
  if (!targetEntity || !mineableState || mineableState.remainingQuantity <= 0) {
    return { matched: true, success: false, errorMsg: "TARGET_NOT_FOUND" };
  }
  if (!getTargetsForEntity(scene, entity).includes(targetID)) {
    return { matched: true, success: false, errorMsg: "TARGET_NOT_LOCKED" };
  }

  const snapshot = buildEntityMiningSnapshot(entity, moduleItem, effectRecord, {
    nowMs:
      scene && typeof scene.getCurrentSimTimeMs === "function"
        ? scene.getCurrentSimTimeMs()
        : Date.now(),
  });
  if (!snapshot) {
    return { matched: true, success: false, errorMsg: "UNSUPPORTED_MODULE" };
  }
  if (!isFamilyCompatibleWithYield(snapshot, mineableState)) {
    return { matched: true, success: false, errorMsg: "TARGET_INVALID_FOR_MODULE" };
  }

  const chargeItem = resolveEntityLoadedCharge(entity, moduleItem);
  if (
    chargeItem &&
    !(
      isChargeCompatibleWithModule(moduleItem.typeID, chargeItem.typeID) &&
      isChargeHeuristicallyValidForYield(chargeItem, mineableState)
    )
  ) {
    return { matched: true, success: false, errorMsg: "CHARGE_NOT_COMPATIBLE" };
  }
  const commandTimeMs =
    scene && typeof scene.getCurrentSimTimeMs === "function"
      ? scene.getCurrentSimTimeMs()
      : Date.now();
  if (
    getMiningCommandSurfaceDistance(scene, entity, targetEntity, commandTimeMs) >
      snapshot.maxRangeMeters + 1
  ) {
    return { matched: true, success: false, errorMsg: "TARGET_OUT_OF_RANGE" };
  }

  return {
    matched: true,
    success: true,
    data: {
      targetEntity,
      mineableState,
      runtimeAttrs: {
        capNeed: snapshot.capNeed,
        durationMs: snapshot.durationMs,
        durationAttributeID: snapshot.durationAttributeID,
        reactivationDelayMs: snapshot.reactivationDelayMs,
        maxGroupActive: snapshot.maxGroupActive,
        weaponFamily: null,
        miningSnapshot: snapshot,
      },
    },
  };
}

function appendNpcCargo(entity, typeID, quantity) {
  const miningNpcOperations = require("./miningNpcOperations");
  miningNpcOperations.appendNpcMiningCargo(entity, typeID, quantity);
}

function applyCrystalVolatility(entity, moduleItem, snapshot, efficiency = 1) {
  if (!entity || !moduleItem || !snapshot || snapshot.chargeTypeID <= 0) {
    return;
  }
  if (
    snapshot.crystalVolatilityChance <= 0 ||
    snapshot.crystalVolatilityDamage <= 0 ||
    isNativeNpcEntity(entity)
  ) {
    return;
  }
  const effectiveVolatilityChance =
    snapshot.crystalVolatilityChance *
    Math.min(1, Math.max(0, toFiniteNumber(efficiency, 1)));
  if (Math.random() > effectiveVolatilityChance) {
    return;
  }

  const chargeItem = resolveEntityLoadedCharge(entity, moduleItem);
  if (!chargeItem) {
    return;
  }

  const session = entity.session || null;
  const currentQuantity = Math.max(0, toInt(chargeItem.stacksize ?? chargeItem.quantity, 0));
  if (currentQuantity <= 1) {
    const removeResult = removeInventoryItem(chargeItem.itemID, {
      removeContents: true,
    });
    if (removeResult && removeResult.success && session) {
      syncInventoryChangesToSession(session, removeResult.data.changes);
    }
    return;
  }

  const updateResult = updateInventoryItem(chargeItem.itemID, (item) => ({
    ...item,
    quantity: currentQuantity - 1,
    stacksize: currentQuantity - 1,
  }));
  if (updateResult && updateResult.success && session) {
    syncInventoryItemForSession(
      session,
      updateResult.data,
      updateResult.previousData || {},
      {
        emitCfgLocation: true,
      },
    );
  }
}

function executeMiningCycle(
  scene,
  entity,
  effectState,
  cycleBoundaryMs,
  options = {},
) {
  if (!scene || !entity || !effectState) {
    return { success: false, stopReason: "module" };
  }
  const efficiency = Math.min(
    1,
    Math.max(0, toFiniteNumber(options.efficiency, 1)),
  );
  if (efficiency <= 0) {
    return { success: false, stopReason: "cycle" };
  }

  const targetID = toInt(effectState.targetID, 0);
  const targetEntity = scene.getEntityByID(targetID);
  const mineableState = getMineableState(scene, targetID);
  if (!targetEntity || !mineableState || mineableState.remainingQuantity <= 0) {
    return { success: false, stopReason: "target" };
  }
  if (!getTargetsForEntity(scene, entity).includes(targetID)) {
    return { success: false, stopReason: "target" };
  }

  const moduleItem = resolveEntityModuleItem(
    entity,
    effectState.moduleID,
    effectState.moduleFlagID,
  );
  if (!moduleItem || !isModuleOnline(moduleItem)) {
    return { success: false, stopReason: "module" };
  }

  const effectRecord = getEffectTypeRecord(toInt(effectState.effectID, 0));
  const snapshot = buildEntityMiningSnapshot(entity, moduleItem, effectRecord, {
    nowMs: cycleBoundaryMs,
  });
  if (!snapshot || !isFamilyCompatibleWithYield(snapshot, mineableState)) {
    return { success: false, stopReason: "module" };
  }
  if (
    getMiningCommandSurfaceDistance(scene, entity, targetEntity, cycleBoundaryMs) >
      snapshot.maxRangeMeters + 1
  ) {
    return { success: false, stopReason: "range" };
  }

  const chargeItem = resolveEntityLoadedCharge(entity, moduleItem);
  if (
    chargeItem &&
    !(
      isChargeCompatibleWithModule(moduleItem.typeID, chargeItem.typeID) &&
      isChargeHeuristicallyValidForYield(chargeItem, mineableState)
    )
  ) {
    return { success: false, stopReason: "charge" };
  }

  effectState.chargeTypeID = snapshot.chargeTypeID;
  let destinationFlagID = ITEM_FLAGS.CARGO_HOLD;
  let availableVolume = Number.POSITIVE_INFINITY;
  if (!isNativeNpcEntity(entity)) {
    const destination = resolveDestinationFlagForPlayer(
      entity,
      mineableState.yieldTypeID,
      mineableState.yieldKind,
    );
    destinationFlagID = destination.flagID;
    availableVolume = destination.availableVolume;
    if (availableVolume <= 0) {
      return { success: false, stopReason: "cargo" };
    }
  }

  const miningVolume = Math.max(0, snapshot.miningAmountM3);
  const effectiveMiningVolume = miningVolume * efficiency;
  const quantityVolumeAvailable = mineableState.remainingQuantity * mineableState.unitVolume;
  const clampFactor = Math.min(
    1,
    quantityVolumeAvailable / effectiveMiningVolume,
    availableVolume / effectiveMiningVolume,
  );
  if (clampFactor <= 0) {
    return {
      success: false,
      stopReason: quantityVolumeAvailable <= 0 ? "target" : "cargo",
    };
  }

  const miningResult = computeMiningResult({
    clampFactor,
    volume: miningVolume,
    unitVolume: mineableState.unitVolume,
    asteroidQuantity: mineableState.remainingQuantity,
    wasteVolumeMultiplier: snapshot.wasteVolumeMultiplier,
    wasteProbability: snapshot.wasteProbability,
    critQuantityMultiplier: snapshot.critQuantityMultiplier,
    critProbability: snapshot.critChance,
    efficiency,
  });
  const normalVolume = miningResult.normalQuantity * mineableState.unitVolume;
  const remainingBonusVolume = Math.max(0, availableVolume - normalVolume);
  const maximumBonusQuantity = Number.isFinite(remainingBonusVolume)
    ? Math.floor(remainingBonusVolume / mineableState.unitVolume)
    : miningResult.criticalHitQuantity;
  miningResult.criticalHitQuantity = Math.max(
    0,
    Math.min(miningResult.criticalHitQuantity, maximumBonusQuantity),
  );
  miningResult.criticalHitVolume = miningResult.criticalHitQuantity * mineableState.unitVolume;

  const transferredQuantity = miningResult.getTotalTransferredQuantity();
  if (transferredQuantity <= 0 && miningResult.wastedQuantity <= 0) {
    return { success: false, stopReason: "cargo" };
  }

  if (isNativeNpcEntity(entity)) {
    appendNpcCargo(entity, mineableState.yieldTypeID, transferredQuantity);
  } else {
    const grantResult = grantItemsToCharacterLocation(
      resolveEntityCharacterID(entity),
      toInt(entity.itemID, 0),
      destinationFlagID,
      [{
        itemType: mineableState.yieldTypeID,
        quantity: transferredQuantity,
      }],
    );
    if (!grantResult.success || !grantResult.data) {
      return { success: false, stopReason: "cargo" };
    }
    if (entity.session) {
      syncInventoryChangesToSession(entity.session, grantResult.data.changes);
    }
  }

  const deltaResult = applyMiningDelta(
    scene,
    targetEntity,
    miningResult.normalQuantity,
    miningResult.wastedQuantity,
    {
      broadcast: true,
      nowMs: cycleBoundaryMs,
      sourceEntity: entity,
      moduleItem,
      quantityAdded: transferredQuantity,
      amountWasted: miningResult.wastedQuantity,
      amountCritBonus: miningResult.criticalHitQuantity,
      hasRewards: miningResult.rewardedQuantity > 0,
    },
  );
  if (!deltaResult.success) {
    return { success: false, stopReason: "target" };
  }

  if (!isNativeNpcEntity(entity)) {
    const miningLedgerState = require("./miningLedgerState");
    const observerContext = resolveLedgerObserverContext(scene, targetEntity);
    miningLedgerState.recordMiningLedgerEvent({
      characterID: resolveEntityCharacterID(entity),
      corporationID: toInt(
        entity &&
          entity.session &&
          (entity.session.corporationID || entity.session.corpid),
        0,
      ),
      solarSystemID: toInt(
        scene && (scene.systemID || scene.solarSystemID),
        toInt(entity && entity.systemID, 0),
      ),
      typeID: mineableState.yieldTypeID,
      quantity: transferredQuantity,
      quantityWasted: miningResult.wastedQuantity,
      quantityCritical: miningResult.criticalHitQuantity,
      shipTypeID: toInt(entity && entity.typeID, 0),
      moduleTypeID: toInt(moduleItem && moduleItem.typeID, 0),
      observerItemID: observerContext.observerItemID,
      observerItemName: observerContext.observerItemName,
      yieldKind: mineableState.yieldKind,
      eventDateMs: cycleBoundaryMs,
    });
  }

  applyCrystalVolatility(entity, moduleItem, snapshot, efficiency);
  return {
    success: true,
    data: {
      targetID,
      yieldTypeID: mineableState.yieldTypeID,
      transferredQuantity,
      normalQuantity: miningResult.normalQuantity,
      criticalHitQuantity: miningResult.criticalHitQuantity,
      wastedQuantity: miningResult.wastedQuantity,
      efficiency,
      partialCycle: options.partialCycle === true,
      depleted: Boolean(deltaResult.data && deltaResult.data.depleted),
    },
  };
}

function resolveSceneForSession(session) {
  if (!session || !session._space) {
    return null;
  }
  const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
  return spaceRuntime.ensureScene(toInt(session._space.systemID, 0));
}

function buildScanResultsForSession(session) {
  const scene = resolveSceneForSession(session);
  if (!scene) {
    return [];
  }
  ensureSceneMiningState(scene);
  const shipEntity = scene.getShipEntityForSession(session);
  if (!shipEntity) {
    return [];
  }

  const maxDistanceMeters = Math.max(
    1,
    toFiniteNumber(config.miningSurveyScanDistanceMeters, 250_000),
  );
  const scanResults = [];
  for (const entity of scene.getVisibleEntitiesForSession(session)) {
    if (!isMineableStaticEntity(entity)) {
      continue;
    }
    const state = getMineableState(scene, entity.itemID);
    if (!state || state.remainingQuantity <= 0) {
      continue;
    }
    if (getSurfaceDistance(shipEntity, entity) > maxDistanceMeters) {
      continue;
    }
    scanResults.push({
      entityID: toInt(entity.itemID, 0),
      yieldTypeID: toInt(state.yieldTypeID, 0),
      remainingQuantity: toInt(state.remainingQuantity, 0),
      distance: getSurfaceDistance(shipEntity, entity),
    });
  }

  scanResults.sort(
    (left, right) =>
      left.distance - right.distance ||
      left.entityID - right.entityID,
  );
  return scanResults.map((entry) => [
    entry.entityID,
    entry.yieldTypeID,
    entry.remainingQuantity,
  ]);
}

function findMiningEffectRecordForModule(moduleItem) {
  const { getTypeEffectRecords: getEffects } = require(path.join(
    __dirname,
    "../fitting/liveFittingState",
  ));
  return getEffects(toInt(moduleItem && moduleItem.typeID, 0))
    .find((effectRecord) => isMiningEffectRecord(effectRecord, moduleItem)) || null;
}

function findFirstMiningModule(entity) {
  return resolveEntityFittedItems(entity)
    .find((moduleItem) => isModuleOnline(moduleItem) && findMiningEffectRecordForModule(moduleItem))
    || null;
}

function resolveMineableCandidates(scene) {
  ensureSceneMiningState(scene);
  return scene.staticEntities
    .filter((entity) => isMineableStaticEntity(entity))
    .map((entity) => ({
      entity,
      state: getMineableState(scene, entity.itemID),
    }))
    .filter((entry) => entry.state && entry.state.remainingQuantity > 0);
}

function chooseMineableTargetForFleet(scene, fleetRecord) {
  const candidates = resolveMineableCandidates(scene);
  if (candidates.length <= 0) {
    return null;
  }

  const preferredTarget = scene.getEntityByID(toInt(fleetRecord && fleetRecord.targetShipID, 0));
  const referencePosition =
    (preferredTarget && preferredTarget.position) ||
    (
      fleetRecord &&
      fleetRecord.originAnchor &&
      fleetRecord.originAnchor.position
    ) ||
    { x: 0, y: 0, z: 0 };

  candidates.sort(
    (left, right) =>
      distance(left.entity.position, referencePosition) -
        distance(right.entity.position, referencePosition) ||
      toInt(left.entity.itemID, 0) - toInt(right.entity.itemID, 0),
  );
  return candidates[0].entity || null;
}

function buildNpcPseudoSession(entity) {
  return {
    characterID: toInt(entity && (entity.pilotCharacterID ?? entity.characterID), 0),
    corporationID: toInt(entity && entity.corporationID, 0),
    allianceID: toInt(entity && entity.allianceID, 0),
    _space: {
      systemID: toInt(entity && entity.systemID, 0),
      shipID: toInt(entity && entity.itemID, 0),
    },
  };
}

function handleSceneCreated(scene) {
  const miningResourceSiteService = require("./miningResourceSiteService");
  if (
    miningResourceSiteService &&
    typeof miningResourceSiteService.handleSceneCreated === "function"
  ) {
    miningResourceSiteService.handleSceneCreated(scene);
  }
  ensureSceneMiningState(scene);
  const miningNpcOperations = require("./miningNpcOperations");
  if (typeof miningNpcOperations.handleSceneCreated === "function") {
    miningNpcOperations.handleSceneCreated(scene);
  }
}

function tickScene(scene, now) {
  ensureSceneMiningState(scene);
  if (config.miningNpcFleetAutoMineEnabled !== true) {
    return;
  }

  const miningNpcOperations = require("./miningNpcOperations");
  if (typeof miningNpcOperations.tickScene === "function") {
    miningNpcOperations.tickScene(scene, now, {
      chooseMineableTargetForFleet,
      findMiningEffectRecordForModule,
      buildEntityMiningSnapshot,
      isMiningSnapshotCompatibleWithState,
      getSurfaceDistance,
      getTargetsForEntity,
      buildNpcPseudoSession,
    });
  }
}

module.exports = {
  handleSceneCreated,
  tickScene,
  isMiningEffectRecord,
  isMiningEffectState,
  isMiningSnapshotCompatibleWithState,
  resolveMiningActivation,
  executeMiningCycle,
  buildScanResultsForSession,
};
