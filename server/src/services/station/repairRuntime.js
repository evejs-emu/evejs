const path = require("path");

const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const standingRuntime = require(path.join(
  __dirname,
  "../character/standingRuntime",
));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getDockedLocationID,
  getDockedLocationKind,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  getStationRecord,
  getStationServiceAccessRule,
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
  getFittedModuleItems,
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
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
  getFacilityTaxRate,
} = require(path.join(__dirname, "../industry/industryFacilityState"));
const {
  findItemById,
  ITEM_FLAGS,
  normalizeShipConditionState,
  updateInventoryItem,
  updateShipItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getAdjustedAveragePrice,
} = require(path.join(__dirname, "../reprocessing/reprocessingStaticData"));

const CATEGORY_SHIP = 6;
const CATEGORY_MODULE = 7;
const CATEGORY_DRONE = 18;
const CATEGORY_DEPLOYABLE = 22;
const CATEGORY_STARBASE = 23;
const CATEGORY_STRUCTURE_MODULE = 66;

const GROUP_CARGO_CONTAINER = 12;
const GROUP_TOOL = 332;
const GROUP_SECURE_CARGO_CONTAINER = 340;
const GROUP_AUDIT_LOG_SECURE_CONTAINER = 448;
const GROUP_FREIGHT_CONTAINER = 649;

const REPAIR_SERVICE_ID = 13;
const STRUCTURE_REPAIR_SERVICE_ID = STRUCTURE_SERVICE_ID.REPAIR;
const STATION_REPAIR_COST_MULTIPLIER = 0.1;
const AIR_TRADE_HUB_TYPE_ID = 92885;
const DOCKED_SHIP_REPAIR_ALIAS_OFFSET = 4_000_000_000_000_000;

const REPAIRABLE_GROUP_IDS = new Set([
  GROUP_CARGO_CONTAINER,
  GROUP_SECURE_CARGO_CONTAINER,
  GROUP_AUDIT_LOG_SECURE_CONTAINER,
  GROUP_FREIGHT_CONTAINER,
  GROUP_TOOL,
]);

const REPAIRABLE_CATEGORY_IDS = new Set([
  CATEGORY_DEPLOYABLE,
  CATEGORY_SHIP,
  CATEGORY_DRONE,
  CATEGORY_STARBASE,
  CATEGORY_MODULE,
  CATEGORY_STRUCTURE_MODULE,
]);

function getFallbackRepairBasePrice(item) {
  const itemType = resolveItemByTypeID(toInt(item && item.typeID, 0));
  const categoryID = toInt(
    item && item.categoryID !== undefined
      ? item.categoryID
      : itemType && itemType.categoryID,
    0,
  );
  const volume = Math.max(
    0,
    toFiniteNumber(
      item && item.volume !== undefined ? item.volume : itemType && itemType.volume,
      0,
    ),
  );

  if (categoryID === CATEGORY_SHIP) {
    return Math.max(10000, volume > 0 ? volume : 0);
  }
  if (categoryID === CATEGORY_MODULE || categoryID === CATEGORY_STRUCTURE_MODULE) {
    return Math.max(1000, volume > 0 ? volume * 100 : 0);
  }
  if (categoryID === CATEGORY_DRONE) {
    return Math.max(500, volume > 0 ? volume * 100 : 0);
  }
  return Math.max(100, volume > 0 ? volume * 25 : 0);
}

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

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function clampRatio(value, fallback = 0) {
  return Math.max(0, Math.min(1, toFiniteNumber(value, fallback)));
}

function normalizeModuleConditionState(item) {
  const moduleState =
    item && item.moduleState && typeof item.moduleState === "object"
      ? item.moduleState
      : {};

  return {
    damage: clampRatio(moduleState.damage, 0),
    charge: clampRatio(moduleState.charge, 0),
    armorDamage: clampRatio(moduleState.armorDamage, 0),
    shieldCharge: clampRatio(moduleState.shieldCharge, 1),
    incapacitated: moduleState.incapacitated === true,
  };
}

function normalizeRepairConditionState(item) {
  if (item && item.conditionState && typeof item.conditionState === "object") {
    return normalizeShipConditionState(item.conditionState);
  }
  return normalizeModuleConditionState(item);
}

function isRepairableInventoryItem(item) {
  if (!item || typeof item !== "object") {
    return false;
  }
  if (!item.singleton) {
    return false;
  }

  const groupID = toInt(item.groupID, 0);
  const categoryID = toInt(item.categoryID, 0);
  return (
    REPAIRABLE_GROUP_IDS.has(groupID) ||
    REPAIRABLE_CATEGORY_IDS.has(categoryID)
  );
}

function getItemDockedAncestorInfo(item) {
  const chain = [];
  let current = item && typeof item === "object" ? item : null;
  const seen = new Set();

  while (current && toInt(current.itemID, 0) > 0 && !seen.has(toInt(current.itemID, 0))) {
    chain.push(current);
    seen.add(toInt(current.itemID, 0));
    const parent = findItemById(current.locationID);
    if (!parent) {
      break;
    }
    current = parent;
  }

  const leaf = chain[0] || item || null;
  const rootItem = chain.length > 0 ? chain[chain.length - 1] : null;
  const rootLocationID = toInt(
    rootItem ? rootItem.locationID : leaf && leaf.locationID,
    0,
  );

  return {
    chain,
    leaf,
    rootItem,
    rootLocationID,
  };
}

function isItemAccessibleForRepair(item, context) {
  if (!item || !context) {
    return false;
  }
  if (!isRepairableInventoryItem(item)) {
    return false;
  }
  if (toInt(item.ownerID, 0) !== toInt(context.characterID, 0)) {
    return false;
  }

  const ancestorInfo = getItemDockedAncestorInfo(item);
  return ancestorInfo.rootLocationID === toInt(context.dockedLocationID, 0);
}

function isItemDirectlyInPersonalHangar(item, context) {
  if (!item || !context) {
    return false;
  }
  return (
    isRepairableInventoryItem(item) &&
    toInt(item.ownerID, 0) === toInt(context.characterID, 0) &&
    toInt(item.locationID, 0) === toInt(context.dockedLocationID, 0) &&
    toInt(item.flagID, 0) === ITEM_FLAGS.HANGAR
  );
}

function getItemHealthSnapshot(item) {
  const conditionState = normalizeRepairConditionState(item);
  const shieldCapacity = Math.max(
    0,
    toFiniteNumber(getTypeAttributeValue(item && item.typeID, "shieldCapacity"), 0),
  );
  const armorHP = Math.max(
    0,
    toFiniteNumber(getTypeAttributeValue(item && item.typeID, "armorHP"), 0),
  );
  const structureHP = Math.max(
    0,
    toFiniteNumber(getTypeAttributeValue(item && item.typeID, "hp", "structureHP"), 0),
  );

  const shieldDamage = shieldCapacity * (1 - clampRatio(conditionState.shieldCharge, 1));
  const armorDamage = armorHP * clampRatio(conditionState.armorDamage, 0);
  const structureDamage = structureHP * clampRatio(conditionState.damage, 0);
  const maxHealth = shieldCapacity + armorHP + structureHP;
  const damage = shieldDamage + armorDamage + structureDamage;

  return {
    conditionState,
    shieldCapacity,
    armorHP,
    structureHP,
    shieldDamage,
    armorDamage,
    structureDamage,
    maxHealth,
    damage,
  };
}

function getStructureRepairTaxRate(context) {
  if (!context || context.dockedKind !== "structure") {
    return 0;
  }

  return Math.max(
    0,
    toFiniteNumber(
      getFacilityTaxRate(
        context.dockedLocationID,
        context.structure
          ? {
              facilityID: context.dockedLocationID,
              ownerID: toInt(
                context.structure.ownerCorpID || context.structure.ownerID,
                0,
              ),
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
  );
}

function getRepairCostProfile(item, context) {
  const health = getItemHealthSnapshot(item);
  const maxHealth = Math.max(0, toFiniteNumber(health.maxHealth, 0));
  if (!(maxHealth > 0)) {
    return {
      maxHealth: 0,
      damage: 0,
      baseUnitCost: 0,
      unitCost: 0,
      structureTaxRate: 0,
    };
  }

  const staticBasePrice = Math.max(
    0,
    toFiniteNumber(getAdjustedAveragePrice(item.typeID), 0),
  );
  const basePrice =
    staticBasePrice > 0 ? staticBasePrice : getFallbackRepairBasePrice(item);
  const baseUnitCost = basePrice > 0
    ? (basePrice * STATION_REPAIR_COST_MULTIPLIER) / maxHealth
    : 0;
  const structureTaxRate = getStructureRepairTaxRate(context);
  const unitCost =
    context && context.dockedKind === "structure"
      ? baseUnitCost * (1 + structureTaxRate)
      : baseUnitCost;

  return {
    ...health,
    basePrice,
    baseUnitCost: round6(baseUnitCost),
    unitCost: round6(unitCost),
    structureTaxRate,
  };
}

function buildQuoteRecord(item, context) {
  if (!item || !context || !isItemAccessibleForRepair(item, context)) {
    return null;
  }

  const costProfile = getRepairCostProfile(item, context);
  if (!(costProfile.maxHealth > 0) || !(costProfile.damage > 0)) {
    return null;
  }

  return {
    itemID: toInt(item.itemID, 0),
    typeID: toInt(item.typeID, 0),
    groupID: toInt(item.groupID, 0),
    categoryID: toInt(item.categoryID, 0),
    damage: round6(costProfile.damage),
    maxHealth: round6(costProfile.maxHealth),
    costToRepairOneUnitOfDamage: round6(costProfile.unitCost),
    structureTaxRate: round6(costProfile.structureTaxRate),
    baseCostToRepairOneUnitOfDamage: round6(costProfile.baseUnitCost),
  };
}

function shouldAliasDockedShipRepairQuote(context, session) {
  return (
    context &&
    context.dockedKind === "station" &&
    toInt(context.stationRecord && context.stationRecord.stationTypeID, 0) ===
      AIR_TRADE_HUB_TYPE_ID &&
    toInt(session && (session.shipid || session.shipID || session.activeShipID), 0) > 0
  );
}

function encodeDockedShipRepairQuoteItemID(itemID) {
  const numericItemID = toInt(itemID, 0);
  if (numericItemID <= 0) {
    return 0;
  }

  return DOCKED_SHIP_REPAIR_ALIAS_OFFSET + numericItemID;
}

function decodeDockedShipRepairQuoteItemID(itemID) {
  const numericItemID = toInt(itemID, 0);
  if (numericItemID < DOCKED_SHIP_REPAIR_ALIAS_OFFSET) {
    return numericItemID;
  }

  return numericItemID - DOCKED_SHIP_REPAIR_ALIAS_OFFSET;
}

function resolveQuotedRepairItemID(session, context, itemID) {
  const numericItemID = toInt(itemID, 0);
  if (numericItemID <= 0) {
    return 0;
  }

  const activeShipID = toInt(
    session && (session.shipid || session.shipID || session.activeShipID),
    0,
  );
  if (
    activeShipID > 0 &&
    shouldAliasDockedShipRepairQuote(context, session) &&
    numericItemID === activeShipID
  ) {
    return encodeDockedShipRepairQuoteItemID(numericItemID);
  }

  return numericItemID;
}

function resolveRepairContext(session) {
  const characterID = toInt(
    session && (session.characterID || session.charid),
    0,
  );
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
    if (!structureHasOnlineService(structure, STRUCTURE_REPAIR_SERVICE_ID)) {
      return {
        success: false,
        errorMsg: "REPAIR_OFFLINE",
      };
    }
  }

  const standingInfo = standingRuntime.getCharacterEffectiveStanding(
    characterID,
    stationRecord && stationRecord.ownerID,
  );

  return {
    success: true,
    data: {
      characterID,
      dockedLocationID,
      dockedKind,
      stationRecord,
      structure,
      standing: toFiniteNumber(standingInfo && standingInfo.standing, 0),
    },
  };
}

function throwRepairError(errorMsg, values = {}) {
  switch (String(errorMsg || "")) {
    case "CHARACTER_NOT_FOUND":
      throwWrappedUserError("CustomNotify", {
        notify: "Select a character before using repair services.",
      });
      break;
    case "NOT_DOCKED":
      throwWrappedUserError("CustomNotify", {
        notify: "You must be docked to use repair services.",
      });
      break;
    case "REPAIR_OFFLINE":
      throwWrappedUserError("CustomNotify", {
        notify: "The repair service is offline at this structure.",
      });
      break;
    case "REPAIR_STATION_ONLY":
      throwWrappedUserError("CustomNotify", {
        notify: "This repair call is only valid while docked in a station.",
      });
      break;
    case "REPAIR_STRUCTURE_ONLY":
      throwWrappedUserError("CustomNotify", {
        notify: "This repair call is only valid while docked in a structure.",
      });
      break;
    case "MODULE_PARTIAL_REPAIR":
      throwWrappedUserError("CustomNotify", {
        notify: "Modules must be repaired in full.",
      });
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
    default:
      throwWrappedUserError("CustomNotify", {
        notify:
          typeof values.notify === "string" && values.notify.trim() !== ""
            ? values.notify
            : "Repair service failed.",
      });
      break;
  }
}

function enforceRepairAccess(context) {
  if (!context) {
    throwRepairError("NOT_DOCKED");
  }

  if (context.dockedKind !== "station") {
    return;
  }

  const rule = getStationServiceAccessRule(
    REPAIR_SERVICE_ID,
    context.stationRecord && context.stationRecord.ownerID,
  );
  const minimumStanding = toFiniteNumber(rule && rule.minimumStanding, 0);
  if (minimumStanding !== 0 && toFiniteNumber(context.standing, 0) < minimumStanding) {
    throwWrappedUserError("CustomNotify", {
      notify: "Your standings are too low to access this service.",
    });
  }

  const character = getCharacterRecord(context.characterID) || {};
  const securityStatus = toFiniteNumber(
    character.securityStatus ?? character.securityRating,
    0,
  );
  const minimumCharSecurity = toFiniteNumber(rule && rule.minimumCharSecurity, 0);
  const maximumCharSecurity = toFiniteNumber(rule && rule.maximumCharSecurity, 0);

  if (minimumCharSecurity !== 0 && securityStatus < minimumCharSecurity) {
    throwWrappedUserError("CustomNotify", {
      notify: "Your security status is too low to access this service.",
    });
  }
  if (maximumCharSecurity !== 0 && securityStatus > maximumCharSecurity) {
    throwWrappedUserError("CustomNotify", {
      notify: "Your security status is too high to access this service.",
    });
  }
}

function resolveQuoteItem(session, context, itemReference) {
  const itemID = toInt(itemReference && (itemReference.itemID ?? itemReference), 0);
  if (itemID <= 0) {
    return null;
  }

  const item = findItemById(itemID);
  if (!item || !isItemAccessibleForRepair(item, context)) {
    return null;
  }

  const ancestorInfo = getItemDockedAncestorInfo(item);
  const rootItem = ancestorInfo.rootItem;
  if (
    rootItem &&
    rootItem.itemID !== item.itemID &&
    toInt(rootItem.itemID, 0) > 0 &&
    isItemDirectlyInPersonalHangar(rootItem, context) &&
    session &&
    session._requestedRepairQuoteItemIDs instanceof Set &&
    session._requestedRepairQuoteItemIDs.has(toInt(rootItem.itemID, 0))
  ) {
    return {
      item,
      suppressAsNestedDuplicate: true,
    };
  }

  return {
    item,
    suppressAsNestedDuplicate: false,
  };
}

function buildQuoteGroupForRequestedItem(session, context, itemReference) {
  const resolved = resolveQuoteItem(session, context, itemReference);
  const requestedItemID = toInt(itemReference && (itemReference.itemID ?? itemReference), 0);
  if (!resolved || !resolved.item || requestedItemID <= 0) {
    return {
      requestedItemID,
      rows: [],
    };
  }

  if (resolved.suppressAsNestedDuplicate) {
    return {
      requestedItemID,
      rows: [],
    };
  }

  const rows = [];
  const seen = new Set();
  const pushQuoteForItem = (candidate) => {
    const quote = buildQuoteRecord(candidate, context);
    const actualItemID = toInt(candidate && candidate.itemID, 0);
    if (!quote || actualItemID <= 0 || seen.has(actualItemID)) {
      return;
    }
    seen.add(actualItemID);
    quote.itemID = resolveQuotedRepairItemID(session, context, actualItemID);
    rows.push(quote);
  };

  const item = resolved.item;
  if (
    toInt(item.categoryID, 0) === CATEGORY_SHIP &&
    isItemDirectlyInPersonalHangar(item, context)
  ) {
    pushQuoteForItem(item);
    for (const moduleItem of getFittedModuleItems(context.characterID, item.itemID)) {
      pushQuoteForItem(moduleItem);
    }
  } else {
    pushQuoteForItem(item);
  }

  return {
    requestedItemID,
    rows,
  };
}

function buildRepairQuotesForSelection(session, itemReferences = []) {
  const contextResult = resolveRepairContext(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const context = contextResult.data;
  enforceRepairAccess(context);

  session._requestedRepairQuoteItemIDs = new Set(
    (Array.isArray(itemReferences) ? itemReferences : [])
      .map((itemReference) => toInt(itemReference && (itemReference.itemID ?? itemReference), 0))
      .filter((itemID) => itemID > 0),
  );

  const groupedQuotes = new Map();
  for (const itemReference of Array.isArray(itemReferences) ? itemReferences : []) {
    const { requestedItemID, rows } = buildQuoteGroupForRequestedItem(
      session,
      context,
      itemReference,
    );
    if (requestedItemID <= 0 || groupedQuotes.has(requestedItemID)) {
      continue;
    }
    groupedQuotes.set(requestedItemID, rows);
  }

  delete session._requestedRepairQuoteItemIDs;

  return {
    success: true,
    data: {
      context,
      groupedQuotes,
    },
  };
}

function buildLegacyDamageReportsForSelection(session, itemReferences = []) {
  const quoteResult = buildRepairQuotesForSelection(session, itemReferences);
  if (!quoteResult.success || !quoteResult.data) {
    return quoteResult;
  }

  const reportsByItemID = new Map();
  for (const [itemID, rows] of quoteResult.data.groupedQuotes.entries()) {
    reportsByItemID.set(itemID, {
      discount: "0%",
      serviceCharge: "0%",
      playerStanding: toFiniteNumber(quoteResult.data.context.standing, 0),
      lines: rows,
    });
  }

  return {
    success: true,
    data: {
      context: quoteResult.data.context,
      reportsByItemID,
    },
  };
}

function resolveRepairExecutionItem(context, itemReference) {
  const itemID = decodeDockedShipRepairQuoteItemID(
    itemReference && (itemReference.itemID ?? itemReference),
  );
  if (itemID <= 0) {
    return null;
  }

  const item = findItemById(itemID);
  if (!item || !isItemAccessibleForRepair(item, context)) {
    return null;
  }
  return item;
}

function buildRepairExecutionTargets(context, itemReferences = []) {
  const targets = [];
  const seen = new Set();

  for (const itemReference of Array.isArray(itemReferences) ? itemReferences : []) {
    const item = resolveRepairExecutionItem(context, itemReference);
    const itemID = toInt(item && item.itemID, 0);
    if (!item || itemID <= 0 || seen.has(itemID)) {
      continue;
    }

    const quote = buildQuoteRecord(item, context);
    seen.add(itemID);
    if (!quote) {
      continue;
    }

    targets.push({
      itemID,
      item,
      quote,
      fullCost: round2(Math.ceil(toFiniteNumber(quote.damage, 0)) * toFiniteNumber(quote.costToRepairOneUnitOfDamage, 0)),
    });
  }

  return targets;
}

function applyRepairToHealthSnapshot(snapshot, repairAmount) {
  const remainingRepair = Math.max(0, toFiniteNumber(repairAmount, 0));
  let remaining = remainingRepair;

  const repairStructure = Math.min(snapshot.structureDamage, remaining);
  remaining -= repairStructure;
  const repairArmor = Math.min(snapshot.armorDamage, remaining);
  remaining -= repairArmor;
  const repairShield = Math.min(snapshot.shieldDamage, remaining);

  const nextStructureDamage = Math.max(0, snapshot.structureDamage - repairStructure);
  const nextArmorDamage = Math.max(0, snapshot.armorDamage - repairArmor);
  const nextShieldDamage = Math.max(0, snapshot.shieldDamage - repairShield);

  return {
    damage:
      snapshot.structureHP > 0
        ? clampRatio(nextStructureDamage / snapshot.structureHP, 0)
        : 0,
    armorDamage:
      snapshot.armorHP > 0
        ? clampRatio(nextArmorDamage / snapshot.armorHP, 0)
        : 0,
    shieldCharge:
      snapshot.shieldCapacity > 0
        ? clampRatio(1 - nextShieldDamage / snapshot.shieldCapacity, 1)
        : 1,
  };
}

function buildRepairStatePatch(item, repairAmount) {
  const snapshot = getItemHealthSnapshot(item);
  const nextState = applyRepairToHealthSnapshot(snapshot, repairAmount);
  const usesConditionState =
    (item && item.conditionState && typeof item.conditionState === "object") ||
    toInt(item && item.categoryID, 0) === CATEGORY_SHIP ||
    toInt(item && item.categoryID, 0) === CATEGORY_DRONE;

  if (usesConditionState) {
    return {
      conditionState: normalizeShipConditionState({
        ...(item.conditionState || {}),
        damage: nextState.damage,
        armorDamage: nextState.armorDamage,
        shieldCharge: nextState.shieldCharge,
      }),
    };
  }

  return {
    moduleState: {
      ...(item.moduleState || {}),
      damage: nextState.damage,
      armorDamage: nextState.armorDamage,
      shieldCharge: nextState.shieldCharge,
      incapacitated: false,
    },
  };
}

function syncRepairPlanToItems(repairPlan = []) {
  const changes = [];

  for (const planEntry of Array.isArray(repairPlan) ? repairPlan : []) {
    if (!planEntry || !(planEntry.repairAmount > 0)) {
      continue;
    }

    const itemID = toInt(planEntry.itemID, 0);
    const currentItem = findItemById(itemID);
    if (!currentItem) {
      continue;
    }

    const patch = buildRepairStatePatch(currentItem, planEntry.repairAmount);
    const updateResult =
      toInt(currentItem.categoryID, 0) === CATEGORY_SHIP
        ? updateShipItem(itemID, (existingItem) => ({
            ...existingItem,
            ...patch,
          }))
        : updateInventoryItem(itemID, (existingItem) => ({
            ...existingItem,
            ...patch,
          }));
    if (updateResult && updateResult.success) {
      changes.push({
        previousData: updateResult.previousData || {},
        item: updateResult.data,
      });
    }
  }

  return changes;
}

function creditStructureRepairTax(context, chargeAmount) {
  if (!context || context.dockedKind !== "structure") {
    return null;
  }

  const structureTaxRate = getStructureRepairTaxRate(context);
  if (!(structureTaxRate > 0)) {
    return null;
  }

  const ownerCorporationID = toInt(
    context.structure && (context.structure.ownerCorpID || context.structure.ownerID),
    0,
  );
  if (ownerCorporationID <= 0) {
    return null;
  }

  const taxCredit = round2(
    toFiniteNumber(chargeAmount, 0) * (structureTaxRate / (1 + structureTaxRate)),
  );
  if (!(taxCredit > 0)) {
    return null;
  }

  return adjustCorporationWalletDivisionBalance(
    ownerCorporationID,
    1000,
    taxCredit,
    {
      description: "Repair service tax income",
      ownerID1: context.characterID,
      ownerID2: ownerCorporationID,
      referenceID: context.dockedLocationID,
      entryTypeID: JOURNAL_ENTRY_TYPE.TRANSACTION_TAX,
    },
  );
}

function executeRepairPlan(context, targets, options = {}) {
  const stationCall = options.stationCall === true;
  const payment = Math.max(0, toFiniteNumber(options.payment, 0));
  const allowPartial = stationCall === true;

  const hasModule = targets.some(
    (target) => toInt(target && target.quote && target.quote.categoryID, 0) === CATEGORY_MODULE,
  );
  const totalFullCost = round2(
    targets.reduce((sum, target) => sum + toFiniteNumber(target && target.fullCost, 0), 0),
  );

  if (allowPartial && hasModule && payment + 0.0001 < totalFullCost) {
    return {
      success: false,
      errorMsg: "MODULE_PARTIAL_REPAIR",
    };
  }

  let remainingBudget = allowPartial ? Math.min(payment, totalFullCost) : totalFullCost;
  const repairPlan = [];

  for (const target of targets) {
    const unitCost = Math.max(
      0,
      toFiniteNumber(target && target.quote && target.quote.costToRepairOneUnitOfDamage, 0),
    );
    const damage = Math.max(
      0,
      toFiniteNumber(target && target.quote && target.quote.damage, 0),
    );
    if (!(damage > 0)) {
      continue;
    }

    if (!(unitCost > 0)) {
      repairPlan.push({
        itemID: toInt(target.itemID, 0),
        repairAmount: damage,
        chargeAmount: 0,
      });
      continue;
    }

    const fullCost = Math.max(0, toFiniteNumber(target.fullCost, 0));
    const chargeAmount = Math.min(remainingBudget, fullCost);
    if (!(chargeAmount > 0)) {
      continue;
    }

    const repairAmount = Math.min(damage, chargeAmount / unitCost);
    remainingBudget = round2(Math.max(0, remainingBudget - chargeAmount));
    if (!(repairAmount > 0)) {
      continue;
    }

    repairPlan.push({
      itemID: toInt(target.itemID, 0),
      repairAmount,
      chargeAmount: round2(chargeAmount),
    });
  }

  const chargedAmount = round2(
    repairPlan.reduce(
      (sum, entry) => sum + toFiniteNumber(entry && entry.chargeAmount, 0),
      0,
    ),
  );

  if (!(repairPlan.length > 0)) {
    return {
      success: true,
      data: {
        totalFullCost,
        chargedAmount: 0,
        changes: [],
      },
    };
  }

  if (chargedAmount > 0) {
    const wallet = getCharacterWallet(context.characterID);
    const currentBalance = toFiniteNumber(wallet && wallet.balance, 0);
    if (chargedAmount - currentBalance > 0.0001) {
      return {
        success: false,
        errorMsg: "INSUFFICIENT_FUNDS",
        errorValues: buildNotEnoughMoneyUserErrorValues(
          chargedAmount,
          currentBalance,
        ),
      };
    }

    const walletResult = adjustCharacterBalance(
      context.characterID,
      -chargedAmount,
      {
        description: "Repair service charge",
        ownerID1: context.characterID,
        ownerID2: toInt(
          context.structure
            ? context.structure.ownerCorpID || context.structure.ownerID
            : context.stationRecord && context.stationRecord.ownerID,
          0,
        ),
        referenceID: context.dockedLocationID,
        entryTypeID: JOURNAL_ENTRY_TYPE.TRANSACTION_TAX,
      },
    );
    if (!walletResult.success) {
      return walletResult;
    }
  }

  const changes = syncRepairPlanToItems(repairPlan);
  creditStructureRepairTax(context, chargedAmount);

  return {
    success: true,
    data: {
      totalFullCost,
      chargedAmount,
      changes,
      repairedItemIDs: repairPlan.map((entry) => entry.itemID),
    },
  };
}

function repairItemsInStation(session, itemReferences = [], payment = null) {
  const contextResult = resolveRepairContext(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const context = contextResult.data;
  if (context.dockedKind !== "station") {
    return {
      success: false,
      errorMsg: "REPAIR_STATION_ONLY",
    };
  }

  enforceRepairAccess(context);
  const targets = buildRepairExecutionTargets(context, itemReferences);
  return executeRepairPlan(context, targets, {
    stationCall: true,
    payment:
      payment === null || payment === undefined
        ? targets.reduce((sum, target) => sum + toFiniteNumber(target && target.fullCost, 0), 0)
        : payment,
  });
}

function repairItemsInStructure(session, itemReferences = []) {
  const contextResult = resolveRepairContext(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const context = contextResult.data;
  if (context.dockedKind !== "structure") {
    return {
      success: false,
      errorMsg: "REPAIR_STRUCTURE_ONLY",
    };
  }

  const targets = buildRepairExecutionTargets(context, itemReferences);
  return executeRepairPlan(context, targets, {
    stationCall: false,
  });
}

module.exports = {
  REPAIR_SERVICE_ID,
  STRUCTURE_REPAIR_SERVICE_ID,
  STATION_REPAIR_COST_MULTIPLIER,
  isRepairableInventoryItem,
  resolveRepairContext,
  buildRepairQuotesForSelection,
  buildLegacyDamageReportsForSelection,
  repairItemsInStation,
  repairItemsInStructure,
  throwRepairError,
};
