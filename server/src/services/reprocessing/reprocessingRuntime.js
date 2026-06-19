const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(__dirname, "../character/characterState"));
const standingRuntime = require(path.join(
  __dirname,
  "../character/standingRuntime",
));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  ITEM_FLAGS,
  CLIENT_INVENTORY_STACK_LIMIT,
  findItemById,
  getItemMetadata,
  grantItemsToOwnerLocation,
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
  getFacilityTaxRate,
} = require(path.join(__dirname, "../industry/industryFacilityState"));
const {
  canTakeFromOwnerLocation,
  canViewOwnerLocation,
  getSessionCharacterID,
  getSessionCorporationID,
} = require(path.join(__dirname, "../industry/industryAccess"));
const {
  getCorporationOfficeByInventoryID,
} = require(path.join(__dirname, "../corporation/corporationRuntimeState"));
const {
  adjustCharacterBalance,
  buildNotEnoughMoneyUserErrorValues,
  getCharacterWallet,
  JOURNAL_ENTRY_TYPE,
} = require(path.join(__dirname, "../account/walletState"));
const {
  adjustCorporationWalletDivisionBalance,
} = require(path.join(__dirname, "../corporation/corpWalletState"));
const {
  ATTRIBUTE_GAS_DECOMPRESSION_EFFICIENCY_BONUS,
  ATTRIBUTE_REFINING_YIELD_MUTATOR,
  DEFAULT_IN_SPACE_COMPRESSION_RANGE_METERS,
  DEFAULT_STATION_REPROCESSING_EFFICIENCY,
  DEFAULT_STATION_REPROCESSING_TAX,
  NPC_STANDING_TAX_ZERO_POINT,
  STRUCTURE_DEFAULT_GAS_DECOMPRESSION_EFFICIENCY,
  STRUCTURE_DEFAULT_REPROCESSING_EFFICIENCY,
  TYPE_GAS_DECOMPRESSION_EFFICIENCY,
  TYPE_REPROCESSING,
  TYPE_REPROCESSING_EFFICIENCY,
  TYPE_SCRAPMETAL_PROCESSING,
} = require("./reprocessingConstants");
const {
  getAdjustedAveragePrice,
  getCompressionSourceTypeIDs,
  getCompressedTypeID,
  getReprocessingRigProfile,
  getReprocessingProfile,
  getStructureReprocessingProfile,
  getTypeMaterials,
  getTypeRandomizedMaterials,
  hasTypeMaterials,
  isCompressedType,
  isCompressibleType,
  pickRandomizedMaterialTypesByWeight,
  typeHasRandomizedMaterials,
  getAverageRandomizedMaterialsPerBatch,
} = require("./reprocessingStaticData");
const {
  getReprocessingFacilityRigTypeIDs,
} = require("./reprocessingFacilityState");
const {
  publishReprocessedNotice,
} = require("./reprocessingNotices");

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

function isClientSafeRecoverableQuantity(value) {
  return (
    Number.isFinite(Number(value)) &&
    Number(value) >= 0 &&
    Number(value) <= CLIENT_INVENTORY_STACK_LIMIT
  );
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

function getSkillLevel(skillMap, skillTypeID) {
  const numericSkillTypeID = toInt(skillTypeID, 0);
  if (numericSkillTypeID <= 0 || !(skillMap instanceof Map)) {
    return 0;
  }
  const record = skillMap.get(numericSkillTypeID);
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
    getTypeAttributeValue(numericSkillTypeID, ATTRIBUTE_REFINING_YIELD_MUTATOR),
    0,
  );
  return 1 + ((level * percentagePerLevel) / 100);
}

function typeHasSpecialReprocessingSkillBonuses(typeID) {
  const profile = getReprocessingProfile(typeID);
  return Boolean(profile && toInt(profile.reprocessingSkillType, 0) > 0);
}

function getReprocessingSkillMultiplierForType(typeID, skillMap, implants = []) {
  if (typeHasSpecialReprocessingSkillBonuses(typeID)) {
    const profile = getReprocessingProfile(typeID);
    let multiplier =
      getSkillBonusMultiplier(skillMap, TYPE_REPROCESSING) *
      getSkillBonusMultiplier(skillMap, TYPE_REPROCESSING_EFFICIENCY) *
      getSkillBonusMultiplier(skillMap, profile && profile.reprocessingSkillType);
    for (const implant of Array.isArray(implants) ? implants : []) {
      const implantTypeID = toInt(implant && (implant.typeID ?? implant.itemID), 0);
      if (implantTypeID <= 0) {
        continue;
      }
      const implantBonus = toFiniteNumber(
        getTypeAttributeValue(implantTypeID, ATTRIBUTE_REFINING_YIELD_MUTATOR),
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
    getTypeAttributeValue(
      TYPE_GAS_DECOMPRESSION_EFFICIENCY,
      ATTRIBUTE_GAS_DECOMPRESSION_EFFICIENCY_BONUS,
    ),
    0,
  );
  return Math.max(0, (level * bonusPerLevelPercent) / 100);
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

function resolveReprocessingContext(session) {
  const characterID = getSessionCharacterID(session);
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
  return {
    success: true,
    data: {
      characterID,
      corporationID: getSessionCorporationID(session),
      dockedLocationID,
      dockedKind,
      stationRecord,
      structure,
      skillMap: getCharacterSkillMap(characterID),
      implants: Array.isArray(characterRecord.implants) ? characterRecord.implants : [],
      standing: standingRuntime.resolveBestStandingValue(
        characterID,
        stationRecord && stationRecord.ownerID,
      ).standing,
    },
  };
}

function resolveStructureSecurityBand(context) {
  if (!context || context.dockedKind !== "structure") {
    return null;
  }

  const solarSystemID = toInt(
    context.structure && context.structure.solarSystemID,
    context.stationRecord && context.stationRecord.solarSystemID,
  );
  const solarSystem = worldData.getSolarSystemByID(solarSystemID);
  const security = toFiniteNumber(
    solarSystem && solarSystem.security,
    toFiniteNumber(context.stationRecord && context.stationRecord.security, 0),
  );
  if (security >= 0.45) {
    return "high";
  }
  if (security > 0) {
    return "low";
  }
  return "null";
}

function resolveStructureReprocessingProfile(context) {
  if (!context || context.dockedKind !== "structure") {
    return null;
  }
  const structureTypeID = toInt(
    context.structure && context.structure.typeID,
    context.stationRecord && context.stationRecord.stationTypeID,
  );
  return getStructureReprocessingProfile(structureTypeID);
}

function resolveStructureRigProfiles(context) {
  if (!context || context.dockedKind !== "structure") {
    return [];
  }

  const facilityID = toInt(context.dockedLocationID, 0);
  const structureProfile = resolveStructureReprocessingProfile(context);
  const rigSize = Math.max(
    0,
    toInt(
      structureProfile && structureProfile.rigSize,
      0,
    ),
  );
  return getReprocessingFacilityRigTypeIDs(facilityID)
    .map((typeID) => getReprocessingRigProfile(typeID))
    .filter((profile) => profile && (rigSize <= 0 || profile.rigSize === rigSize));
}

function resolveStructureRigEfficiency(context, reprocessingProfile) {
  if (!context || context.dockedKind !== "structure" || !reprocessingProfile) {
    return null;
  }

  const yieldClass = String(reprocessingProfile.reprocessingFamily || "").trim();
  if (yieldClass !== "ore" && yieldClass !== "moon_ore" && yieldClass !== "ice") {
    return null;
  }

  const securityBand = resolveStructureSecurityBand(context) || "high";
  let best = null;
  for (const rigProfile of resolveStructureRigProfiles(context)) {
    if (!Array.isArray(rigProfile.yieldClasses) || !rigProfile.yieldClasses.includes(yieldClass)) {
      continue;
    }
    const securityMultiplier = toFiniteNumber(
      rigProfile.securityMultipliers && rigProfile.securityMultipliers[securityBand],
      1,
    );
    const efficiency = rigProfile.refiningYieldMultiplierBase * securityMultiplier;
    if (!best || efficiency > best.efficiency) {
      best = {
        rigProfile,
        securityBand,
        efficiency,
      };
    }
  }
  return best;
}

function getStationEfficiencyForTypeID(context, typeID) {
  if (!context) {
    return DEFAULT_STATION_REPROCESSING_EFFICIENCY;
  }

  if (context.dockedKind === "structure") {
    const reprocessingProfile = getReprocessingProfile(typeID);
    const structureProfile = resolveStructureReprocessingProfile(context);
    let efficiency = STRUCTURE_DEFAULT_REPROCESSING_EFFICIENCY;
    if (reprocessingProfile) {
      const rigResult = resolveStructureRigEfficiency(context, reprocessingProfile);
      if (rigResult && rigResult.efficiency > 0) {
        efficiency = rigResult.efficiency;
      }
      if (structureProfile && (reprocessingProfile.reprocessingFamily === "ore" ||
        reprocessingProfile.reprocessingFamily === "moon_ore" ||
        reprocessingProfile.reprocessingFamily === "ice")) {
        efficiency *= 1 + (
          toFiniteNumber(structureProfile.reprocessingYieldBonusPercent, 0) / 100
        );
      }
    }
    return Math.max(0, Math.min(1, efficiency));
  }

  const profile = getReprocessingProfile(typeID);
  return Math.max(
    0,
    Math.min(
      1,
      toFiniteNumber(
        context.stationRecord && context.stationRecord.reprocessingEfficiency,
        profile ? DEFAULT_STATION_REPROCESSING_EFFICIENCY : DEFAULT_STATION_REPROCESSING_EFFICIENCY,
      ),
    ),
  );
}

function getStationTaxRate(context) {
  if (!context) {
    return DEFAULT_STATION_REPROCESSING_TAX;
  }

  if (context.dockedKind === "structure") {
    return Math.max(
      0,
      Math.min(
        1,
        toFiniteNumber(
          getFacilityTaxRate(
            context.dockedLocationID,
            context.structure
              ? {
                facilityID: context.dockedLocationID,
                ownerID: toInt(context.structure.ownerCorpID || context.structure.ownerID, 0),
                tax: 0,
              }
              : {
                facilityID: context.dockedLocationID,
                ownerID: toInt(context.stationRecord && context.stationRecord.ownerID, 0),
                tax: 0,
              },
          ),
          0,
        ),
      ),
    );
  }

  const baseTax = Math.max(
    0,
    Math.min(
      1,
      toFiniteNumber(
        context.stationRecord && context.stationRecord.reprocessingStationsTake,
        DEFAULT_STATION_REPROCESSING_TAX,
      ),
    ),
  );
  const standing = Math.max(0, toFiniteNumber(context.standing, 0));
  if (standing <= 0) {
    return baseTax;
  }
  const reductionScale = Math.max(
    0,
    1 - Math.min(standing, NPC_STANDING_TAX_ZERO_POINT) / NPC_STANDING_TAX_ZERO_POINT,
  );
  return round2(baseTax * reductionScale);
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

function getStructureGasDecompressionEfficiency(context) {
  if (!context || context.dockedKind !== "structure") {
    return 0;
  }
  const structureProfile = resolveStructureReprocessingProfile(context);
  return Math.max(
    0,
    Math.min(
      1,
      toFiniteNumber(
        structureProfile && structureProfile.gasDecompressionEfficiencyBase,
        STRUCTURE_DEFAULT_GAS_DECOMPRESSION_EFFICIENCY,
      ) +
        toFiniteNumber(
          structureProfile && structureProfile.gasDecompressionEfficiencyBonusAdd,
          0,
        ),
    ),
  );
}

function isRefinableType(itemType) {
  const profile = getReprocessingProfile(itemType && itemType.typeID);
  return Boolean(profile && profile.isRefinable === true);
}

function isRecyclableType(itemType) {
  const profile = getReprocessingProfile(itemType && itemType.typeID);
  return Boolean(profile && profile.isRecyclable === true);
}

function buildFixedRecoverables(item, stationsTake, portions, efficiency) {
  const recoverables = [];
  if (!item || !portions) {
    return {
      recoverables,
      totalISKCost: 0,
    };
  }

  let totalISKCost = 0;
  for (const material of getTypeMaterials(item.typeID)) {
    const quantity = Math.max(0, toInt(material.quantity, 0) * portions);
    if (quantity > Number.MAX_SAFE_INTEGER) {
      return {
        errorMsg: "REPROCESSING_SPLIT_REQUIRED",
      };
    }
    const clientQuantity = Math.max(0, Math.floor(quantity * efficiency));
    const unrecoverableQuantity = Math.max(0, quantity - clientQuantity);
    if (
      !isClientSafeRecoverableQuantity(clientQuantity) ||
      !isClientSafeRecoverableQuantity(unrecoverableQuantity)
    ) {
      return {
        errorMsg: "REPROCESSING_SPLIT_REQUIRED",
      };
    }
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

function buildPreviewRandomizedRecoverables(item, stationsTake, portions, efficiency, includeRecoverables) {
  const recoverables = [];
  if (!item || !portions || !typeHasRandomizedMaterials(item.typeID)) {
    return {
      recoverables,
      totalISKCost: 0,
    };
  }

  const expectedMarketValuePerBatch = Object.entries(
    getAverageRandomizedMaterialsPerBatch(item.typeID),
  ).reduce(
    (sum, [materialTypeID, averageQuantity]) =>
      sum + getAdjustedAveragePrice(materialTypeID) * toFiniteNumber(averageQuantity, 0),
    0,
  );
  const totalISKCost = round2(portions * expectedMarketValuePerBatch * stationsTake * efficiency);

  if (!includeRecoverables) {
    return {
      recoverables,
      totalISKCost,
    };
  }

  for (const material of getTypeRandomizedMaterials(item.typeID)) {
    const averageQuantity = ((material.quantityMin + material.quantityMax) / 2) * portions;
    const maxQuantity = Math.max(0, toInt(material.quantityMax, 0) * portions);
    if (maxQuantity > Number.MAX_SAFE_INTEGER) {
      return {
        errorMsg: "REPROCESSING_SPLIT_REQUIRED",
      };
    }
    const maxClientQuantity = Math.max(0, Math.floor(maxQuantity * efficiency));
    const maxUnrecoverableQuantity = Math.max(0, Math.round(maxQuantity - maxClientQuantity));
    if (
      !isClientSafeRecoverableQuantity(maxClientQuantity) ||
      !isClientSafeRecoverableQuantity(maxUnrecoverableQuantity)
    ) {
      return {
        errorMsg: "REPROCESSING_SPLIT_REQUIRED",
      };
    }
    const clientQuantity = Math.max(0, Math.floor(averageQuantity * efficiency));
    const unrecoverableQuantity = Math.max(0, Math.round(averageQuantity - clientQuantity));
    if (
      !isClientSafeRecoverableQuantity(clientQuantity) ||
      !isClientSafeRecoverableQuantity(unrecoverableQuantity)
    ) {
      return {
        errorMsg: "REPROCESSING_SPLIT_REQUIRED",
      };
    }
    recoverables.push({
      typeID: toInt(material.materialTypeID, 0),
      client: clientQuantity,
      unrecoverable: unrecoverableQuantity,
      iskCost: 0,
    });
  }

  return {
    recoverables,
    totalISKCost,
  };
}

function buildReprocessingQuoteForItem(item, context, options = {}) {
  const profile = getReprocessingProfile(toInt(item && item.typeID, 0));
  const quantity = getInventoryQuantity(item);
  if (!profile || quantity <= 0) {
    return null;
  }

  const portionSize = Math.max(1, toInt(profile.portionSize, 1));
  const portions = Math.floor(quantity / portionSize);
  const leftOvers = quantity % portionSize;
  const quantityToProcess = quantity - leftOvers;
  const stationsTake = getStationTaxRate(context);
  const efficiency = getReprocessingYieldForType(context, profile.typeID);
  const includeRecoverablesFromRandomizedOutputs =
    options.includeRecoverablesFromRandomizedOutputs === true;

  let recoverableResult = buildFixedRecoverables(
    item,
    stationsTake,
    portions,
    efficiency,
  );
  if (recoverableResult && recoverableResult.errorMsg) {
    return recoverableResult;
  }
  if (recoverableResult.recoverables.length <= 0 && typeHasRandomizedMaterials(profile.typeID)) {
    recoverableResult = buildPreviewRandomizedRecoverables(
      item,
      stationsTake,
      portions,
      efficiency,
      includeRecoverablesFromRandomizedOutputs,
    );
  }

  return {
    itemID: toInt(item && item.itemID, 0),
    typeID: profile.typeID,
    quantityToProcess,
    leftOvers,
    portions,
    numPortions: portions,
    efficiency,
    recoverables: Array.isArray(recoverableResult.recoverables)
      ? recoverableResult.recoverables
      : [],
    totalISKCost: round2(recoverableResult.totalISKCost),
    stationTax: stationsTake,
    stationEfficiency: getStationEfficiencyForTypeID(context, profile.typeID),
    itemType: resolveItemByTypeID(profile.typeID) || {
      typeID: profile.typeID,
      name: profile.name,
      groupID: profile.groupID,
      categoryID: profile.categoryID,
      portionSize: profile.portionSize,
    },
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

function resolveAccessibleInventoryItem(session, itemReference) {
  const itemID = toInt(itemReference && (itemReference.itemID ?? itemReference), 0);
  if (itemID <= 0) {
    return null;
  }

  const item = findItemById(itemID);
  if (!item) {
    return null;
  }

  const characterID = getSessionCharacterID(session);
  const corporationID = getSessionCorporationID(session);
  const ownerID = toInt(item.ownerID, 0);
  if (ownerID === characterID) {
    return item;
  }
  const office = getCorporationOfficeByInventoryID(ownerID, item.locationID);
  const accessLocationID = office ? toInt(office.stationID, item.locationID) : item.locationID;
  if (
    ownerID === corporationID &&
    canTakeFromOwnerLocation(session, ownerID, accessLocationID, item.flagID)
  ) {
    return item;
  }
  return null;
}

function buildReprocessingQuotesForItems(session, itemReferences = [], options = {}) {
  const contextResult = resolveReprocessingContext(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const quotesByItemID = new Map();
  for (const itemReference of Array.isArray(itemReferences) ? itemReferences : []) {
    const item = resolveAccessibleInventoryItem(session, itemReference);
    const itemID = toInt(item && item.itemID, 0);
    if (!item || itemID <= 0 || quotesByItemID.has(itemID)) {
      continue;
    }
    const quote = buildReprocessingQuoteForItem(item, contextResult.data, options);
    if (quote && quote.errorMsg) {
      return {
        success: false,
        errorMsg: quote.errorMsg,
      };
    }
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

function randomIntegerInclusive(minValue, maxValue) {
  const min = Math.max(0, toInt(minValue, 0));
  const max = Math.max(min, toInt(maxValue, min));
  return min + Math.floor(Math.random() * ((max - min) + 1));
}

function buildExecutedRecoverables(item, quote) {
  if (!item || !quote || quote.portions <= 0) {
    return [];
  }
  if (!typeHasRandomizedMaterials(item.typeID)) {
    return Array.isArray(quote.recoverables) ? quote.recoverables : [];
  }

  const pickedMaterials = pickRandomizedMaterialTypesByWeight(item.typeID, quote.portions);
  return pickedMaterials.map(({ material, numOutputPortions }) => {
    let quantity = 0;
    for (let index = 0; index < numOutputPortions; index += 1) {
      quantity += randomIntegerInclusive(material.quantityMin, material.quantityMax);
    }
    const clientQuantity = Math.max(0, Math.floor(quantity * quote.efficiency));
    const unrecoverableQuantity = Math.max(0, Math.round(quantity - clientQuantity));
    return {
      typeID: toInt(material.materialTypeID, 0),
      client: clientQuantity,
      unrecoverable: unrecoverableQuantity,
      iskCost: 0,
    };
  });
}

function resolveReprocessingOutputTarget(session, context, sampleItem, options = {}) {
  const explicitOutputLocationID =
    options.outputLocationID === null || options.outputLocationID === undefined
      ? null
      : toInt(options.outputLocationID, 0);
  const explicitOutputFlagID =
    options.outputFlagID === null || options.outputFlagID === undefined
      ? null
      : toInt(options.outputFlagID, ITEM_FLAGS.HANGAR);
  const explicitOwnerID =
    options.ownerID === null || options.ownerID === undefined
      ? null
      : toInt(options.ownerID, 0);
  if (!sampleItem) {
    return {
      success: false,
      errorMsg: "OUTPUT_LOCATION_INVALID",
    };
  }

  if (explicitOutputLocationID === null && explicitOutputFlagID === null) {
    const ownerID = toInt(sampleItem.ownerID, 0);
    if (
      explicitOwnerID !== null &&
      explicitOwnerID > 0 &&
      explicitOwnerID !== ownerID
    ) {
      return {
        success: false,
        errorMsg: "OUTPUT_LOCATION_INVALID",
      };
    }
    return {
      success: true,
      data: {
        ownerID,
        locationID: toInt(sampleItem.locationID, 0),
        flagID: toInt(sampleItem.flagID, ITEM_FLAGS.HANGAR),
      },
    };
  }

  const dockedLocationID = toInt(context && context.dockedLocationID, 0);
  const outputLocationID = explicitOutputLocationID;
  const outputFlagID = explicitOutputFlagID === null ? ITEM_FLAGS.HANGAR : explicitOutputFlagID;
  if (outputLocationID === dockedLocationID && outputFlagID === ITEM_FLAGS.HANGAR) {
    const ownerID = getSessionCharacterID(session);
    if (
      explicitOwnerID !== null &&
      explicitOwnerID > 0 &&
      explicitOwnerID !== ownerID
    ) {
      return {
        success: false,
        errorMsg: "OUTPUT_LOCATION_INVALID",
      };
    }
    return {
      success: true,
      data: {
        ownerID,
        locationID: outputLocationID,
        flagID: ITEM_FLAGS.HANGAR,
      },
    };
  }

  const corporationID = getSessionCorporationID(session);
  const office = getCorporationOfficeByInventoryID(corporationID, outputLocationID);
  if (
    office &&
    toInt(office.stationID, 0) === dockedLocationID &&
    canViewOwnerLocation(session, corporationID, office.stationID, outputFlagID)
  ) {
    const ownerID = corporationID;
    if (
      explicitOwnerID !== null &&
      explicitOwnerID > 0 &&
      explicitOwnerID !== ownerID
    ) {
      return {
        success: false,
        errorMsg: "OUTPUT_LOCATION_INVALID",
      };
    }
    return {
      success: true,
      data: {
        ownerID,
        locationID: outputLocationID,
        flagID: outputFlagID,
      },
    };
  }

  return {
    success: false,
    errorMsg: "OUTPUT_LOCATION_INVALID",
  };
}

function reprocessItems(session, options = {}) {
  const itemReferences = Array.isArray(options.itemIDs) ? options.itemIDs : [];
  const fromLocationID = toInt(options.fromLocationID, 0);
  const contextResult = resolveReprocessingContext(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const activeShip = getActiveShipRecord(contextResult.data.characterID);
  const activeShipID = toInt(activeShip && activeShip.itemID, 0);
  for (const itemReference of itemReferences) {
    const itemID = toInt(itemReference && (itemReference.itemID ?? itemReference), 0);
    if (itemID > 0 && itemID === activeShipID) {
      return {
        success: false,
        errorMsg: "ACTIVE_SHIP",
      };
    }
  }

  const items = [];
  for (const itemReference of itemReferences) {
    const item = resolveAccessibleInventoryItem(session, itemReference);
    if (!item) {
      continue;
    }
    if (fromLocationID > 0 && toInt(item.locationID, 0) !== fromLocationID) {
      continue;
    }
    items.push(item);
  }
  if (items.length <= 0) {
    return {
      success: true,
      data: {
        processedItemIDs: [],
        outputByTypeID: {},
        inputChanges: [],
        outputChanges: [],
        reprocessedEvents: [],
        outputLocationID: fromLocationID || contextResult.data.dockedLocationID,
        outputFlagID: ITEM_FLAGS.HANGAR,
        context: contextResult.data,
      },
    };
  }

  const targetResult = resolveReprocessingOutputTarget(
    session,
    contextResult.data,
    items[0],
    options,
  );
  if (!targetResult.success || !targetResult.data) {
    return targetResult;
  }

  const processedItemIDs = [];
  const inputChanges = [];
  const outputByTypeID = new Map();
  const reprocessedEvents = [];
  const quotes = [];
  let totalISKCost = 0;

  for (const item of items) {
    const quote = buildReprocessingQuoteForItem(item, contextResult.data, {
      includeRecoverablesFromRandomizedOutputs: false,
    });
    if (!quote) {
      continue;
    }
    if (quote.errorMsg) {
      return {
        success: false,
        errorMsg: quote.errorMsg,
      };
    }
    if (quote.quantityToProcess <= 0 || quote.portions <= 0) {
      continue;
    }
    quotes.push({ item, quote });
    totalISKCost += quote.totalISKCost;
  }

  if (quotes.length <= 0) {
    return {
      success: true,
      data: {
        processedItemIDs: [],
        outputByTypeID: {},
        inputChanges: [],
        outputChanges: [],
        reprocessedEvents: [],
        outputLocationID: targetResult.data.locationID,
        outputFlagID: targetResult.data.flagID,
        context: contextResult.data,
      },
    };
  }

  if (round2(totalISKCost) > 0) {
    const normalizedTotalISKCost = round2(totalISKCost);
    const wallet = getCharacterWallet(contextResult.data.characterID);
    const currentBalance = Number(wallet && wallet.balance) || 0;
    if (normalizedTotalISKCost - currentBalance > 0.0001) {
      return {
        success: false,
        errorMsg: "INSUFFICIENT_FUNDS",
        errorValues: buildNotEnoughMoneyUserErrorValues(
          normalizedTotalISKCost,
          currentBalance,
        ),
      };
    }

    const debitResult = adjustCharacterBalance(
      contextResult.data.characterID,
      -normalizedTotalISKCost,
      {
        description: "Reprocessing tax",
        ownerID1: contextResult.data.characterID,
        ownerID2: toInt(contextResult.data.stationRecord && contextResult.data.stationRecord.ownerID, 0),
        referenceID: contextResult.data.dockedLocationID,
        entryTypeID: JOURNAL_ENTRY_TYPE.TRANSACTION_TAX,
      },
    );
    if (!debitResult.success) {
      return {
        success: false,
        errorMsg: debitResult.errorMsg || "INSUFFICIENT_FUNDS",
        errorValues: buildNotEnoughMoneyUserErrorValues(
          normalizedTotalISKCost,
          currentBalance,
        ),
      };
    }

    if (contextResult.data.dockedKind === "structure") {
      const ownerCorporationID = toInt(
        contextResult.data.structure &&
          (contextResult.data.structure.ownerCorpID || contextResult.data.structure.ownerID),
        0,
      );
      if (ownerCorporationID > 0) {
        adjustCorporationWalletDivisionBalance(
          ownerCorporationID,
          1000,
          normalizedTotalISKCost,
          {
            description: "Reprocessing tax income",
            ownerID1: contextResult.data.characterID,
            ownerID2: ownerCorporationID,
            referenceID: contextResult.data.dockedLocationID,
            entryTypeID: JOURNAL_ENTRY_TYPE.TRANSACTION_TAX,
          },
        );
      }
    }
  }

  for (const { item, quote } of quotes) {
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

    const executedRecoverables = buildExecutedRecoverables(item, quote);
    for (const recoverable of executedRecoverables) {
      mergeQuantityByType(outputByTypeID, recoverable.typeID, recoverable.client);
    }
    reprocessedEvents.push({
      characterID: contextResult.data.characterID,
      dockedKind: contextResult.data.dockedKind,
      dockedLocationID: contextResult.data.dockedLocationID,
      inputTypeID: toInt(item.typeID, 0),
      quantity: Math.max(0, toInt(quote.quantityToProcess, 0)),
      outputs: executedRecoverables
        .map((recoverable) => ({
          outputTypeID: toInt(recoverable.typeID, 0),
          quantity: Math.max(0, toInt(recoverable.client, 0)),
        }))
        .filter((entry) => entry.outputTypeID > 0 && entry.quantity > 0),
    });
    processedItemIDs.push(item.itemID);
  }

  const grantEntries = [...outputByTypeID.entries()].map(([typeID, quantity]) => ({
    itemType: typeID,
    quantity,
  }));
  const grantResult =
    grantEntries.length > 0
      ? grantItemsToOwnerLocation(
          targetResult.data.ownerID,
          targetResult.data.locationID,
          targetResult.data.flagID,
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

  for (const event of reprocessedEvents) {
    publishReprocessedNotice(event, {
      publishGatewayNotice: options.publishGatewayNotice,
    });
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
      outputLocationID: targetResult.data.locationID,
      outputFlagID: targetResult.data.flagID,
      outputOwnerID: targetResult.data.ownerID,
      reprocessedEvents,
      context: contextResult.data,
    },
  };
}

function throwReprocessingError(errorMsg, values = {}) {
  switch (String(errorMsg || "")) {
    case "ACTIVE_SHIP":
      throwWrappedUserError("CannotReprocessActive");
      break;
    case "REPROCESSING_SPLIT_REQUIRED":
      throwWrappedUserError("ReprocessingPleaseSplit");
      break;
    case "INSUFFICIENT_FUNDS":
      throwWrappedUserError(
        "NotEnoughMoney",
        buildNotEnoughMoneyUserErrorValues(
          values.amount,
          values.balance,
        ),
      );
      break;
    case "REPROCESSING_OFFLINE":
      throwWrappedUserError("CustomNotify", {
        notify: "The reprocessing service is offline at this structure.",
      });
      break;
    case "NOT_DOCKED":
      throwWrappedUserError("CustomNotify", {
        notify: "You must be docked to use reprocessing.",
      });
      break;
    case "OUTPUT_LOCATION_INVALID":
      throwWrappedUserError("CustomNotify", {
        notify: "The selected output location cannot receive reprocessing output.",
      });
      break;
    default:
      throwWrappedUserError("CustomNotify", {
        notify: "Reprocessing failed.",
      });
      break;
  }
}

module.exports = {
  buildReprocessingOptionsForTypes,
  buildReprocessingQuoteForItem,
  buildReprocessingQuotesForItems,
  getGasDecompressionCharacterEfficiency,
  getInSpaceCompressionRangeMeters,
  getReprocessingYieldForType,
  resolveAccessibleInventoryItem,
  getStationEfficiencyForTypeID,
  getStationTaxRate,
  getStructureGasDecompressionEfficiency,
  reprocessItems,
  resolveReprocessingContext,
  throwReprocessingError,
  TYPE_GAS_DECOMPRESSION_EFFICIENCY,
};
