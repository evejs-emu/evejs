const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  ITEM_FLAGS,
  buildInventoryItem,
  findItemById,
  getItemMetadata,
  grantItemsToCharacterLocation,
  removeInventoryItem,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  isInSameFleet,
} = require(path.join(__dirname, "../fleets/fleetHelpers"));
const {
  getDockedLocationID,
  getDockedLocationKind,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const {
  getStructureByID,
} = require(path.join(__dirname, "../structure/structureState"));
const {
  STRUCTURE_SERVICE_ID,
} = require(path.join(__dirname, "../structure/structureConstants"));
const {
  structureHasOnlineService,
} = require(path.join(__dirname, "../structure/structureServiceAuthority"));
const {
  getAdjustedAveragePrice,
  getCompressedTypeID,
  getCompressionSourceTypeIDs,
  getTypeMaterials,
  hasTypeMaterials,
  isCompressedType,
  isCompressibleType,
} = require("./miningStaticData");
const reprocessingRuntime = require(path.join(__dirname, "../reprocessing"));

const TYPE_REPROCESSING = 3385;
const TYPE_REPROCESSING_EFFICIENCY = 3389;
const TYPE_SCRAPMETAL_PROCESSING = 12196;
const TYPE_GAS_DECOMPRESSION_EFFICIENCY = 62452;
const CATEGORY_ASTEROID = 25;
const CATEGORY_HARVESTABLE_CLOUD = 2;
const DEFAULT_STATION_REPROCESSING_EFFICIENCY = 0.5;
const DEFAULT_STATION_REPROCESSING_TAX = 0.05;
const DEFAULT_STRUCTURE_REPROCESSING_EFFICIENCY = 0.5;
const DEFAULT_STRUCTURE_GAS_DECOMPRESSION_EFFICIENCY = 0.79;
const DEFAULT_IN_SPACE_COMPRESSION_RANGE_METERS = 250_000;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round2(value) {
  return Number(toFiniteNumber(value, 0).toFixed(2));
}

function getInventoryQuantity(item) {
  if (!item) {
    return 0;
  }
  return toInt(
    item.singleton === 1 ? 1 : item.stacksize ?? item.quantity,
    item.singleton === 1 ? 1 : 0,
  );
}

function getSkillLevel(skillMap, typeID) {
  const record = skillMap instanceof Map ? skillMap.get(toInt(typeID, 0)) : null;
  if (!record) {
    return 0;
  }
  return Math.max(
    0,
    toInt(
      record.effectiveSkillLevel ??
        record.trainedSkillLevel ??
        record.skillLevel,
      0,
    ),
  );
}

function getSkillBonusMultiplier(skillMap, skillTypeID) {
  const numericSkillTypeID = toInt(skillTypeID, 0);
  if (numericSkillTypeID <= 0) {
    return 1;
  }
  const level = getSkillLevel(skillMap, numericSkillTypeID);
  if (level <= 0) {
    return 1;
  }
  const percentagePerLevel = toFiniteNumber(
    getTypeAttributeValue(numericSkillTypeID, "refiningYieldMutator"),
    0,
  );
  return 1 + ((level * percentagePerLevel) / 100);
}

function getInSpaceCompressionRangeMeters(skillMap = null) {
  const baseRangeMeters = Math.max(
    1,
    toFiniteNumber(
      config.miningInSpaceCompressionRangeMeters,
      DEFAULT_IN_SPACE_COMPRESSION_RANGE_METERS,
    ),
  );
  const rangeBonusPerLevel = Math.max(
    0,
    toFiniteNumber(
      getTypeAttributeValue(62453, "fleetCompressionLogisticsRangeBonus"),
      0,
    ),
  );
  if (rangeBonusPerLevel <= 0) {
    return Math.round(baseRangeMeters);
  }

  const skillLevel = getSkillLevel(skillMap, 62453);
  return Math.max(
    1,
    Math.round(baseRangeMeters * (1 + ((rangeBonusPerLevel * skillLevel) / 100))),
  );
}

function typeHasSpecialReprocessingSkillBonuses(typeID) {
  return toInt(getTypeAttributeValue(typeID, "reprocessingSkillType"), 0) > 0;
}

function getReprocessingSkillMultiplierForType(typeID, skillMap, implants = []) {
  if (typeHasSpecialReprocessingSkillBonuses(typeID)) {
    const specificSkillTypeID = toInt(
      getTypeAttributeValue(typeID, "reprocessingSkillType"),
      0,
    );
    let multiplier =
      getSkillBonusMultiplier(skillMap, TYPE_REPROCESSING) *
      getSkillBonusMultiplier(skillMap, TYPE_REPROCESSING_EFFICIENCY) *
      getSkillBonusMultiplier(skillMap, specificSkillTypeID);
    for (const implant of Array.isArray(implants) ? implants : []) {
      const implantTypeID = toInt(implant && (implant.typeID ?? implant.itemID), 0);
      if (implantTypeID <= 0) {
        continue;
      }
      const implantBonus = toFiniteNumber(
        getTypeAttributeValue(implantTypeID, "refiningYieldMutator"),
        0,
      );
      if (implantBonus > 0) {
        multiplier *= 1 + (implantBonus / 100);
      }
    }
    return multiplier;
  }

  return getSkillBonusMultiplier(skillMap, TYPE_SCRAPMETAL_PROCESSING);
}

function getGasDecompressionCharacterEfficiency(skillMap) {
  const level = getSkillLevel(skillMap, TYPE_GAS_DECOMPRESSION_EFFICIENCY);
  if (level <= 0) {
    return 0;
  }
  const bonusPerLevelPercent = toFiniteNumber(
    getTypeAttributeValue(TYPE_GAS_DECOMPRESSION_EFFICIENCY, "gasDecompressionEfficiencyBonus"),
    0,
  );
  return Math.max(0, (level * bonusPerLevelPercent) / 100);
}

function isRefinableType(itemType) {
  if (!itemType || !hasTypeMaterials(itemType.typeID)) {
    return false;
  }
  return (
    toInt(itemType.categoryID, 0) === CATEGORY_ASTEROID ||
    toInt(itemType.categoryID, 0) === CATEGORY_HARVESTABLE_CLOUD ||
    typeHasSpecialReprocessingSkillBonuses(itemType.typeID) ||
    /^compressed /i.test(String(itemType.name || ""))
  );
}

function isRecyclableType(itemType) {
  return Boolean(itemType && hasTypeMaterials(itemType.typeID));
}

function resolveReprocessingContext(session) {
  const characterID = toInt(session && session.characterID, 0);
  if (characterID <= 0) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const dockedLocationID = toInt(getDockedLocationID(session), 0);
  if (dockedLocationID <= 0) {
    return {
      success: false,
      errorMsg: "NOT_DOCKED",
    };
  }

  const dockedKind = getDockedLocationKind(session);
  const stationRecord = getStationRecord(session, dockedLocationID);
  const structure =
    dockedKind === "structure"
      ? getStructureByID(dockedLocationID, { refresh: false })
      : null;
  if (dockedKind === "structure") {
    if (!structureHasOnlineService(structure, STRUCTURE_SERVICE_ID.REPROCESSING)) {
      return {
        success: false,
        errorMsg: "REPROCESSING_OFFLINE",
      };
    }
  }

  const characterRecord = getCharacterRecord(characterID) || {};
  const skillMap = getCharacterSkillMap(characterID);
  return {
    success: true,
    data: {
      characterID,
      dockedLocationID,
      dockedKind,
      stationRecord,
      structure,
      skillMap,
      implants: Array.isArray(characterRecord.implants) ? characterRecord.implants : [],
    },
  };
}

function getStationEfficiencyForTypeID(context, typeID) {
  if (!context) {
    return DEFAULT_STATION_REPROCESSING_EFFICIENCY;
  }
  if (context.dockedKind === "structure") {
    return Math.max(
      0,
      Math.min(
        1,
        toFiniteNumber(
          config.miningStructureReprocessingEfficiency,
          DEFAULT_STRUCTURE_REPROCESSING_EFFICIENCY,
        ),
      ),
    );
  }

  return Math.max(
    0,
    Math.min(
      1,
      toFiniteNumber(
        context.stationRecord && context.stationRecord.reprocessingEfficiency,
        DEFAULT_STATION_REPROCESSING_EFFICIENCY,
      ),
    ),
  );
}

function getStationTaxRate(context) {
  return Math.max(
    0,
    Math.min(
      1,
      toFiniteNumber(
        context &&
          context.stationRecord &&
          context.stationRecord.reprocessingStationsTake,
        DEFAULT_STATION_REPROCESSING_TAX,
      ),
    ),
  );
}

function getReprocessingYieldForType(context, typeID) {
  const stationEfficiency = getStationEfficiencyForTypeID(context, typeID);
  const characterMultiplier = getReprocessingSkillMultiplierForType(
    typeID,
    context && context.skillMap,
    context && context.implants,
  );
  return Math.max(0, Math.min(1, stationEfficiency * characterMultiplier));
}

function buildRecoverablesForItem(item, stationsTake, efficiency, portions) {
  const recoverables = [];
  let totalISKCost = 0;
  const materials = getTypeMaterials(item && item.typeID);
  if (materials.length <= 0 || portions <= 0) {
    return {
      recoverables,
      totalISKCost,
    };
  }

  for (const material of materials) {
    const quantity = Math.max(0, toInt(material.quantity, 0) * portions);
    const clientQuantity = Math.max(0, Math.floor(quantity * efficiency));
    const unrecoverableQuantity = Math.max(0, quantity - clientQuantity);
    const taxQuantity = clientQuantity * stationsTake;
    const iskCost = round2(getAdjustedAveragePrice(material.materialTypeID) * taxQuantity);
    totalISKCost += iskCost;
    recoverables.push({
      typeID: toInt(material.materialTypeID, 0),
      client: clientQuantity,
      unrecoverable: unrecoverableQuantity,
      iskCost,
    });
  }

  return {
    recoverables,
    totalISKCost: round2(totalISKCost),
  };
}

function buildReprocessingQuoteForItem(item, context) {
  const itemType = resolveItemByTypeID(toInt(item && item.typeID, 0));
  const quantity = getInventoryQuantity(item);
  if (!itemType || quantity <= 0) {
    return null;
  }

  const portionSize = Math.max(1, toInt(itemType.portionSize, 1));
  const portions = Math.floor(quantity / portionSize);
  const leftOvers = quantity % portionSize;
  const quantityToProcess = quantity - leftOvers;
  const stationsTake = getStationTaxRate(context);
  const efficiency = getReprocessingYieldForType(context, itemType.typeID);
  const recoverableResult = buildRecoverablesForItem(
    item,
    stationsTake,
    efficiency,
    portions,
  );

  return {
    itemID: toInt(item.itemID, 0),
    typeID: toInt(item.typeID, 0),
    quantityToProcess,
    leftOvers,
    portions,
    efficiency,
    recoverables: recoverableResult.recoverables,
    totalISKCost: recoverableResult.totalISKCost,
    stationTax: stationsTake,
    stationEfficiency: getStationEfficiencyForTypeID(context, itemType.typeID),
    itemType,
  };
}

function buildReprocessingOptionsForTypes(typeIDs = []) {
  const optionsByTypeID = new Map();
  for (const rawTypeID of Array.isArray(typeIDs) ? typeIDs : []) {
    const typeID = toInt(rawTypeID, 0);
    if (typeID <= 0 || optionsByTypeID.has(typeID)) {
      continue;
    }
    const itemType = resolveItemByTypeID(typeID);
    optionsByTypeID.set(typeID, {
      isRecyclable: isRecyclableType(itemType),
      isRefinable: isRefinableType(itemType),
    });
  }
  return optionsByTypeID;
}

function buildReprocessingQuotesForItems(session, itemIDs = []) {
  const contextResult = resolveReprocessingContext(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const quotesByItemID = new Map();
  for (const rawItemID of Array.isArray(itemIDs) ? itemIDs : []) {
    const itemID = toInt(rawItemID, 0);
    if (itemID <= 0 || quotesByItemID.has(itemID)) {
      continue;
    }
    const item = findItemById(itemID);
    if (!item || toInt(item.ownerID, 0) !== contextResult.data.characterID) {
      continue;
    }
    const quote = buildReprocessingQuoteForItem(item, contextResult.data);
    if (quote) {
      quotesByItemID.set(itemID, quote);
    }
  }

  return {
    success: true,
    data: {
      context: contextResult.data,
      quotesByItemID,
    },
  };
}

function mergeQuantityByType(targetMap, typeID, quantity) {
  const numericTypeID = toInt(typeID, 0);
  const numericQuantity = Math.max(0, toInt(quantity, 0));
  if (numericTypeID <= 0 || numericQuantity <= 0) {
    return;
  }
  targetMap.set(numericTypeID, (targetMap.get(numericTypeID) || 0) + numericQuantity);
}

function consumeReprocessedQuantity(item, quantityToProcess) {
  const currentQuantity = getInventoryQuantity(item);
  const consumeQuantity = Math.max(0, toInt(quantityToProcess, 0));
  if (consumeQuantity <= 0 || currentQuantity <= 0 || consumeQuantity > currentQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
    };
  }

  if (item.singleton === 1 || consumeQuantity === currentQuantity) {
    return removeInventoryItem(item.itemID, {
      removeContents: true,
    });
  }

  const nextQuantity = currentQuantity - consumeQuantity;
  return updateInventoryItem(item.itemID, (currentItem) => ({
    ...currentItem,
    quantity: nextQuantity,
    stacksize: nextQuantity,
    singleton: 0,
  }));
}

function reprocessItems(session, options = {}) {
  const itemIDs = Array.isArray(options.itemIDs) ? options.itemIDs : [];
  const fromLocationID = toInt(options.fromLocationID, 0);
  const explicitOutputLocationID = toInt(options.outputLocationID, 0);
  const explicitOutputFlagID =
    options.outputFlagID === null || options.outputFlagID === undefined
      ? null
      : toInt(options.outputFlagID, ITEM_FLAGS.HANGAR);
  const contextResult = resolveReprocessingContext(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const outputByTypeID = new Map();
  const inputChanges = [];
  const processedItemIDs = [];
  let outputLocationID = explicitOutputLocationID;
  let outputFlagID = explicitOutputFlagID;

  for (const rawItemID of itemIDs) {
    const itemID = toInt(rawItemID, 0);
    if (itemID <= 0) {
      continue;
    }
    const item = findItemById(itemID);
    if (
      !item ||
      toInt(item.ownerID, 0) !== contextResult.data.characterID ||
      (fromLocationID > 0 && toInt(item.locationID, 0) !== fromLocationID)
    ) {
      continue;
    }

    const quote = buildReprocessingQuoteForItem(item, contextResult.data);
    if (!quote || quote.quantityToProcess <= 0 || quote.portions <= 0) {
      continue;
    }

    if (!outputLocationID) {
      outputLocationID = toInt(item.locationID, contextResult.data.dockedLocationID);
    }
    if (outputFlagID === null) {
      outputFlagID = toInt(item.flagID, ITEM_FLAGS.HANGAR);
    }

    const consumeResult = consumeReprocessedQuantity(item, quote.quantityToProcess);
    if (!consumeResult.success) {
      return consumeResult;
    }

    if (consumeResult.data && Array.isArray(consumeResult.data.changes)) {
      inputChanges.push(...consumeResult.data.changes);
    } else if (consumeResult.success && consumeResult.data) {
      inputChanges.push({
        item: consumeResult.data,
        previousData: consumeResult.previousData || {},
      });
    }

    for (const recoverable of quote.recoverables) {
      mergeQuantityByType(outputByTypeID, recoverable.typeID, recoverable.client);
    }
    processedItemIDs.push(itemID);
  }

  const grantEntries = [...outputByTypeID.entries()].map(([typeID, quantity]) => ({
    itemType: typeID,
    quantity,
  }));
  const grantResult =
    grantEntries.length > 0
      ? grantItemsToCharacterLocation(
          contextResult.data.characterID,
          outputLocationID || contextResult.data.dockedLocationID,
          outputFlagID === null ? ITEM_FLAGS.HANGAR : outputFlagID,
          grantEntries,
        )
      : {
          success: true,
          data: {
            changes: [],
          },
        };
  if (!grantResult.success) {
    return grantResult;
  }

  return {
    success: true,
    data: {
      processedItemIDs,
      outputByTypeID: Object.fromEntries(outputByTypeID.entries()),
      inputChanges,
      outputChanges: Array.isArray(grantResult.data && grantResult.data.changes)
        ? grantResult.data.changes
        : [],
      outputLocationID: outputLocationID || contextResult.data.dockedLocationID,
      outputFlagID: outputFlagID === null ? ITEM_FLAGS.HANGAR : outputFlagID,
      context: contextResult.data,
    },
  };
}

function rebuildItemAsType(item, typeID, quantity) {
  const metadata = getItemMetadata(typeID);
  const numericQuantity = Math.max(0, toInt(quantity, 0));
  return buildInventoryItem({
    ...item,
    typeID: metadata.typeID,
    groupID: metadata.groupID,
    categoryID: metadata.categoryID,
    itemName: metadata.name,
    quantity: item.singleton === 1 ? null : numericQuantity,
    stacksize: item.singleton === 1 ? 1 : numericQuantity,
    singleton: item.singleton === 1 ? 1 : 0,
  });
}

function compressInventoryItem(itemID) {
  const item = findItemById(itemID);
  if (!item) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const compressedTypeID = getCompressedTypeID(item.typeID);
  if (!compressedTypeID) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_COMPRESSIBLE",
    };
  }

  const sourceQuantity = getInventoryQuantity(item);
  const updateResult = updateInventoryItem(item.itemID, (currentItem) => (
    rebuildItemAsType(currentItem, compressedTypeID, sourceQuantity)
  ));
  if (!updateResult.success) {
    return updateResult;
  }

  return {
    success: true,
    data: {
      sourceItemID: item.itemID,
      sourceTypeID: item.typeID,
      sourceQuantity,
      outputItemID: updateResult.data.itemID,
      outputTypeID: compressedTypeID,
      outputQuantity: sourceQuantity,
      change: {
        item: updateResult.data,
        previousData: updateResult.previousData || {},
      },
    },
  };
}

function resolveGasDecompressionSourceType(typeID) {
  const sourceTypeIDs = getCompressionSourceTypeIDs(typeID);
  if (sourceTypeIDs.length !== 1) {
    return null;
  }
  const sourceType = resolveItemByTypeID(sourceTypeIDs[0]);
  if (!sourceType) {
    return null;
  }
  const groupName = String(sourceType.groupName || "").trim().toLowerCase();
  return groupName.includes("gas") || groupName.includes("cloud")
    ? sourceType
    : null;
}

function getStructureGasDecompressionEfficiency(context) {
  if (!context || context.dockedKind !== "structure") {
    return 0;
  }
  return Math.max(
    0,
    Math.min(
      1,
      toFiniteNumber(
        config.miningStructureGasDecompressionEfficiency,
        DEFAULT_STRUCTURE_GAS_DECOMPRESSION_EFFICIENCY,
      ),
    ),
  );
}

function decompressGasInStructure(session, itemID) {
  const contextResult = reprocessingRuntime.resolveReprocessingContext(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }
  if (contextResult.data.dockedKind !== "structure") {
    return {
      success: false,
      errorMsg: "NOT_IN_STRUCTURE",
    };
  }

  const item = findItemById(itemID);
  if (!item || toInt(item.ownerID, 0) !== contextResult.data.characterID) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }
  if (!isCompressedType(item.typeID)) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_COMPRESSED",
    };
  }

  const sourceType = resolveGasDecompressionSourceType(item.typeID);
  if (!sourceType) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_DECOMPRESSIBLE_GAS",
    };
  }

  const sourceQuantity = getInventoryQuantity(item);
  const structureEfficiency = reprocessingRuntime.getStructureGasDecompressionEfficiency(contextResult.data);
  const characterEfficiency = reprocessingRuntime.getGasDecompressionCharacterEfficiency(contextResult.data.skillMap);
  const totalEfficiency = Math.min(1, structureEfficiency + characterEfficiency);
  const outputQuantity = Math.max(0, Math.floor(sourceQuantity * totalEfficiency));

  if (outputQuantity <= 0) {
    const removeResult = removeInventoryItem(item.itemID, {
      removeContents: true,
    });
    if (!removeResult.success) {
      return removeResult;
    }
    return {
      success: true,
      data: {
        sourceItemID: item.itemID,
        sourceTypeID: item.typeID,
        sourceQuantity,
        outputItemID: null,
        outputTypeID: sourceType.typeID,
        outputQuantity: 0,
        structureEfficiency,
        characterEfficiency,
        changes: removeResult.data && removeResult.data.changes ? removeResult.data.changes : [],
      },
    };
  }

  const updateResult = updateInventoryItem(item.itemID, (currentItem) => (
    rebuildItemAsType(currentItem, sourceType.typeID, outputQuantity)
  ));
  if (!updateResult.success) {
    return updateResult;
  }

  return {
    success: true,
    data: {
      sourceItemID: item.itemID,
      sourceTypeID: item.typeID,
      sourceQuantity,
      outputItemID: updateResult.data.itemID,
      outputTypeID: sourceType.typeID,
      outputQuantity,
      structureEfficiency,
      characterEfficiency,
      changes: [{
        item: updateResult.data,
        previousData: updateResult.previousData || {},
      }],
    },
  };
}

function resolveInSpaceCompressionContext(session, facilityBallID) {
  const systemID = toInt(session && session._space && session._space.systemID, 0);
  const shipID = toInt(session && session._space && session._space.shipID, 0);
  const characterID = toInt(session && session.characterID, 0);
  if (systemID <= 0 || shipID <= 0) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
  const scene = spaceRuntime.ensureScene(systemID);
  const shipEntity = scene && scene.getEntityByID(shipID);
  const facilityEntity = scene && scene.getEntityByID(toInt(facilityBallID, 0));
  if (!scene || !shipEntity || !facilityEntity) {
    return {
      success: false,
      errorMsg: "FACILITY_NOT_FOUND",
    };
  }
  const facilityTypelists =
    typeof spaceRuntime.resolveCompressionFacilityTypelistsForEntity === "function"
      ? spaceRuntime.resolveCompressionFacilityTypelistsForEntity(facilityEntity)
      : Array.isArray(facilityEntity.compressionFacilityTypelists)
        ? facilityEntity.compressionFacilityTypelists
        : null;
  if (!Array.isArray(facilityTypelists) || facilityTypelists.length <= 0) {
    return {
      success: false,
      errorMsg: "FACILITY_NOT_ACTIVE",
    };
  }

  const facilityCharacterID = toInt(
    facilityEntity && (
      facilityEntity.characterID ??
      facilityEntity.pilotCharacterID
    ),
    0,
  );
  if (
    toInt(facilityEntity.itemID, 0) !== shipID &&
    (
      characterID <= 0 ||
      facilityCharacterID <= 0 ||
      !isInSameFleet(characterID, facilityCharacterID)
    )
  ) {
    return {
      success: false,
      errorMsg: "FACILITY_NOT_ACTIVE",
    };
  }

  const dx = toFiniteNumber(shipEntity.position && shipEntity.position.x, 0) -
    toFiniteNumber(facilityEntity.position && facilityEntity.position.x, 0);
  const dy = toFiniteNumber(shipEntity.position && shipEntity.position.y, 0) -
    toFiniteNumber(facilityEntity.position && facilityEntity.position.y, 0);
  const dz = toFiniteNumber(shipEntity.position && shipEntity.position.z, 0) -
    toFiniteNumber(facilityEntity.position && facilityEntity.position.z, 0);
  const centerDistance = Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
  const surfaceDistance = Math.max(
    0,
    centerDistance -
      Math.max(0, toFiniteNumber(shipEntity.radius, 0)) -
      Math.max(0, toFiniteNumber(facilityEntity.radius, 0)),
  );
  const maxRangeMeters = Math.max(
    1,
    ...facilityTypelists.map((entry) => Math.max(0, toFiniteNumber(entry && entry[1], 0))),
  );
  if (surfaceDistance > maxRangeMeters) {
    return {
      success: false,
      errorMsg: "FACILITY_OUT_OF_RANGE",
    };
  }

  return {
    success: true,
    data: {
      scene,
      shipEntity,
      facilityEntity,
      facilityTypelists,
      maxRangeMeters,
    },
  };
}

module.exports = {
  TYPE_REPROCESSING,
  TYPE_REPROCESSING_EFFICIENCY,
  TYPE_SCRAPMETAL_PROCESSING,
  TYPE_GAS_DECOMPRESSION_EFFICIENCY,
  resolveReprocessingContext: reprocessingRuntime.resolveReprocessingContext,
  getStationEfficiencyForTypeID: reprocessingRuntime.getStationEfficiencyForTypeID,
  getStationTaxRate: reprocessingRuntime.getStationTaxRate,
  getReprocessingYieldForType: reprocessingRuntime.getReprocessingYieldForType,
  getGasDecompressionCharacterEfficiency: reprocessingRuntime.getGasDecompressionCharacterEfficiency,
  getStructureGasDecompressionEfficiency: reprocessingRuntime.getStructureGasDecompressionEfficiency,
  buildReprocessingOptionsForTypes: reprocessingRuntime.buildReprocessingOptionsForTypes,
  buildReprocessingQuoteForItem: reprocessingRuntime.buildReprocessingQuoteForItem,
  buildReprocessingQuotesForItems: reprocessingRuntime.buildReprocessingQuotesForItems,
  reprocessItems: reprocessingRuntime.reprocessItems,
  compressInventoryItem,
  decompressGasInStructure,
  resolveGasDecompressionSourceType,
  resolveInSpaceCompressionContext,
  getInSpaceCompressionRangeMeters: reprocessingRuntime.getInSpaceCompressionRangeMeters,
  isCompressibleType,
  isCompressedType,
};
