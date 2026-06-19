const path = require("path");

const config = require(path.join(__dirname, "../../../config"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../../common/machoErrors"));
const {
  JOURNAL_ENTRY_TYPE,
  JOURNAL_CURRENCY,
  adjustCharacterBalance,
  buildNotEnoughMoneyUserErrorValues,
  getCharacterWallet,
} = require(path.join(__dirname, "../../account/walletState"));
const {
  findItemById,
  removeInventoryItem,
  updateInventoryItem,
} = require(path.join(__dirname, "../../inventory/itemStore"));
const {
  buildSkillRecord,
  getCharacterBaseSkillMap,
  getSkillTypeByID,
  grantCharacterSkillLevels,
} = require(path.join(__dirname, "../skillState"));
const {
  notifySkillStateChanged,
} = require(path.join(__dirname, "../training/skillQueueNotifications"));

const SKILL_CATEGORY_ID = 16;
const DIRECT_PURCHASE_TAX_RATE = 0.3;
const REF_SKILL_PURCHASE = JOURNAL_ENTRY_TYPE.SKILL_PURCHASE;

let directPurchaseCache = null;

function getCharacterState() {
  return require(path.join(__dirname, "../../character/characterState"));
}

function toInt(value, fallback = 0) {
  if (Buffer.isBuffer(value)) {
    return toInt(value.toString("utf8"), fallback);
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return toInt(value.value, fallback);
    }
    if (value.type === "int" || value.type === "long") {
      return toInt(value.value, fallback);
    }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toMoney(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.round(numeric * 100) / 100;
}

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function unwrapValue(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return unwrapValue(value.value);
    }
    if (value.type === "int" || value.type === "long") {
      return unwrapValue(value.value);
    }
    if (value.type === "list" && Array.isArray(value.items)) {
      return value.items.map((item) => unwrapValue(item));
    }
  }
  return value;
}

function normalizeIDList(rawValue) {
  const unwrapped = unwrapValue(rawValue);
  if (unwrapped === null || unwrapped === undefined) {
    return [];
  }
  const rawList = Array.isArray(unwrapped) ? unwrapped : [unwrapped];
  return rawList
    .map((value) => toInt(unwrapValue(value), 0))
    .filter((value) => value > 0);
}

function isSkillType(typeID) {
  return Boolean(getSkillTypeByID(typeID));
}

function isDirectlyPurchasableSkillType(skillType) {
  if (!skillType || typeof skillType !== "object") {
    return false;
  }
  if (toInt(skillType.categoryID, SKILL_CATEGORY_ID) !== SKILL_CATEGORY_ID) {
    return false;
  }
  if (skillType.published === false) {
    return false;
  }
  return toMoney(skillType.basePrice, 0) > 0;
}

function buildDirectPurchaseCache() {
  const byTypeID = new Map();
  const purchasableTypeIDs = new Set();
  const priceByTypeID = new Map();
  const {
    getSkillTypes,
  } = require(path.join(__dirname, "../skillState"));

  for (const rawSkillType of getSkillTypes()) {
    const skillType = cloneValue(rawSkillType);
    const typeID = toInt(skillType && skillType.typeID, 0);
    if (typeID <= 0) {
      continue;
    }
    byTypeID.set(typeID, skillType);
    if (!isDirectlyPurchasableSkillType(skillType)) {
      continue;
    }
    purchasableTypeIDs.add(typeID);
    priceByTypeID.set(
      typeID,
      toMoney(toMoney(skillType.basePrice, 0) * (1 + DIRECT_PURCHASE_TAX_RATE), 0),
    );
  }

  return {
    byTypeID,
    purchasableTypeIDs,
    priceByTypeID,
  };
}

function getDirectPurchaseCache() {
  if (!directPurchaseCache) {
    directPurchaseCache = buildDirectPurchaseCache();
  }
  return directPurchaseCache;
}

function getDirectPurchaseSkillType(typeID) {
  return cloneValue(getDirectPurchaseCache().byTypeID.get(toInt(typeID, 0)) || null);
}

function isSkillAvailableForDirectPurchase(typeID) {
  return getDirectPurchaseCache().purchasableTypeIDs.has(toInt(typeID, 0));
}

function getDirectPurchasePrice(typeID) {
  const numericTypeID = toInt(typeID, 0);
  if (!isSkillType(numericTypeID)) {
    throwWrappedUserError("ItemNotASkill", {
      skillName: numericTypeID,
    });
  }
  if (!isSkillAvailableForDirectPurchase(numericTypeID)) {
    throwWrappedUserError("SkillUnavailableForPurchase", {
      type: numericTypeID,
    });
  }
  return getDirectPurchaseCache().priceByTypeID.get(numericTypeID) || 0;
}

function getBaseSkillMap(characterID) {
  return getCharacterBaseSkillMap(characterID, {
    includeExpertSystems: false,
  });
}

function isSkillInjected(characterID, skillTypeID) {
  const baseSkill = getBaseSkillMap(characterID).get(toInt(skillTypeID, 0));
  return Boolean(
    baseSkill &&
      baseSkill.trainedSkillLevel !== null &&
      baseSkill.trainedSkillLevel !== undefined,
  );
}

function throwPurchaseError(errorName, values = {}) {
  throwWrappedUserError(errorName, values);
}

function validateNoDuplicates(skillTypeIDs) {
  const seen = new Set();
  for (const typeID of skillTypeIDs) {
    if (seen.has(typeID)) {
      throwPurchaseError("SkillPurchaseUnknownError", {});
    }
    seen.add(typeID);
  }
}

function validateSkillPurchase(characterID, rawSkillTypeIDs) {
  if (config.skillPurchaseEnabled === false) {
    throwPurchaseError("SkillPurchaseDisabled", {});
  }

  const skillTypeIDs = normalizeIDList(rawSkillTypeIDs);
  validateNoDuplicates(skillTypeIDs);

  for (const typeID of skillTypeIDs) {
    if (!isSkillType(typeID)) {
      throwPurchaseError("ItemNotASkill", {
        skillName: typeID,
      });
    }
  }

  for (const typeID of skillTypeIDs) {
    if (!isSkillAvailableForDirectPurchase(typeID)) {
      throwPurchaseError("SkillUnavailableForPurchase", {
        type: typeID,
      });
    }
  }

  const baseSkillMap = getBaseSkillMap(characterID);
  for (const typeID of skillTypeIDs) {
    const existingSkill = baseSkillMap.get(typeID);
    if (
      existingSkill &&
      existingSkill.trainedSkillLevel !== null &&
      existingSkill.trainedSkillLevel !== undefined
    ) {
      throwPurchaseError("CharacterAlreadyKnowsSkill", {
        skillName: typeID,
      });
    }
  }

  const totalCost = toMoney(
    skillTypeIDs.reduce((sum, typeID) => sum + getDirectPurchasePrice(typeID), 0),
    0,
  );
  const wallet = getCharacterWallet(characterID);
  const balance = toMoney(wallet && wallet.balance, 0);
  if (totalCost > balance) {
    throwPurchaseError(
      "NotEnoughMoney",
      buildNotEnoughMoneyUserErrorValues(totalCost, balance),
    );
  }

  return {
    skillTypeIDs,
    totalCost,
    previousSkillMap: baseSkillMap,
  };
}

function notifyInjectedSkills(characterID, changedSkills, previousSkillMap) {
  if (!changedSkills || changedSkills.length === 0) {
    return;
  }
  notifySkillStateChanged(characterID, changedSkills, {
    previousSkillMap,
    emitSkillLevelsTrained: false,
    trainedTypeIDs: [],
  });
}

function injectSkillTypes(characterID, rawSkillTypeIDs, session = null, options = {}) {
  const skillTypeIDs = normalizeIDList(rawSkillTypeIDs);
  if (skillTypeIDs.length === 0) {
    return [];
  }

  const previousSkillMap =
    options.previousSkillMap instanceof Map ? options.previousSkillMap : getBaseSkillMap(characterID);

  for (const typeID of skillTypeIDs) {
    const skillType = getDirectPurchaseSkillType(typeID) || getSkillTypeByID(typeID);
    if (!skillType || toInt(skillType.categoryID, SKILL_CATEGORY_ID) !== SKILL_CATEGORY_ID) {
      throwPurchaseError("ItemNotASkill", {
        skillName: typeID,
      });
    }
    if (skillType.published === false) {
      throwPurchaseError("ItemNotASkill", {
        skillName: typeID,
      });
    }
    const existingSkill = previousSkillMap.get(typeID);
    if (
      existingSkill &&
      existingSkill.trainedSkillLevel !== null &&
      existingSkill.trainedSkillLevel !== undefined
    ) {
      throwPurchaseError("CharacterAlreadyKnowsSkill", {
        skillName: typeID,
      });
    }
  }

  const changedSkills = grantCharacterSkillLevels(
    characterID,
    skillTypeIDs.map((typeID) => ({
      typeID,
      level: 0,
    })),
  );

  notifyInjectedSkills(characterID, changedSkills, previousSkillMap);
  const changedTypeIDs = new Set(
    changedSkills.map((skillRecord) => toInt(skillRecord.typeID, 0)).filter(Boolean),
  );
  return skillTypeIDs.filter((typeID) => changedTypeIDs.has(typeID));
}

function purchaseSkills(characterID, rawSkillTypeIDs, session = null) {
  const validation = validateSkillPurchase(characterID, rawSkillTypeIDs);
  if (validation.skillTypeIDs.length === 0) {
    return [];
  }

  const debitResult = adjustCharacterBalance(characterID, -validation.totalCost, {
    description: "Skill purchase",
    ownerID1: characterID,
    ownerID2: 0,
    referenceID: validation.skillTypeIDs[0] || 0,
    entryTypeID: REF_SKILL_PURCHASE,
    currency: JOURNAL_CURRENCY.ISK,
  });
  if (!debitResult.success) {
    if (debitResult.errorMsg === "INSUFFICIENT_FUNDS") {
      const wallet = getCharacterWallet(characterID);
      throwPurchaseError(
        "NotEnoughMoney",
        buildNotEnoughMoneyUserErrorValues(
          validation.totalCost,
          toMoney(wallet && wallet.balance, 0),
        ),
      );
    }
    throwPurchaseError("CustomNotify", {
      notify: "Failed to charge wallet for skill purchase.",
    });
  }

  return injectSkillTypes(characterID, validation.skillTypeIDs, session, {
    previousSkillMap: validation.previousSkillMap,
  });
}

function buildUpdateChange(updateResult) {
  if (!updateResult || !updateResult.success) {
    return [];
  }
  return [{
    item: updateResult.data,
    previousData: updateResult.previousData || {},
  }];
}

function consumeExactInventoryStack(item, quantity = 1) {
  const normalizedQuantity = Math.max(1, toInt(quantity, 1));
  const currentItem = findItemById(item && item.itemID);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }
  const availableQuantity = Math.max(
    0,
    toInt(
      currentItem.stacksize ?? currentItem.quantity,
      currentItem.singleton === 1 ? 1 : 0,
    ),
  );
  if (availableQuantity < normalizedQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
    };
  }
  if (availableQuantity === normalizedQuantity) {
    return removeInventoryItem(currentItem.itemID, {
      removeContents: false,
    });
  }

  const updateResult = updateInventoryItem(currentItem.itemID, (existing) => ({
    ...existing,
    quantity: availableQuantity - normalizedQuantity,
    stacksize: availableQuantity - normalizedQuantity,
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
  const { syncInventoryItemForSession } = getCharacterState();
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
    } else if (change.removed === true && change.previousData) {
      syncInventoryItemForSession(
        session,
        {
          ...change.previousData,
          locationID: 6,
        },
        change.previousData,
      );
    }
  }
}

function validateSkillbookItem(characterID, itemID, previousSkillMap) {
  const item = findItemById(itemID);
  if (!item || toInt(item.ownerID, 0) !== toInt(characterID, 0)) {
    throwPurchaseError("ItemNotASkill", {
      skillName: itemID,
    });
  }

  const typeID = toInt(item.typeID, 0);
  const skillType = getSkillTypeByID(typeID);
  if (
    !skillType ||
    toInt(item.categoryID, toInt(skillType.categoryID, 0)) !== SKILL_CATEGORY_ID ||
    skillType.published === false
  ) {
    throwPurchaseError("ItemNotASkill", {
      skillName: typeID,
    });
  }

  const existingSkill = previousSkillMap.get(typeID);
  if (
    existingSkill &&
    existingSkill.trainedSkillLevel !== null &&
    existingSkill.trainedSkillLevel !== undefined
  ) {
    throwPurchaseError("CharacterAlreadyKnowsSkill", {
      skillName: typeID,
    });
  }

  const stackQuantity = Math.max(
    0,
    toInt(item.stacksize ?? item.quantity, item.singleton === 1 ? 1 : 0),
  );
  if (stackQuantity <= 0) {
    throwPurchaseError("ItemNotASkill", {
      skillName: typeID,
    });
  }

  return {
    item,
    typeID,
  };
}

function injectSkillbookItems(characterID, rawItemIDs, session = null) {
  const itemIDs = normalizeIDList(rawItemIDs);
  if (itemIDs.length === 0) {
    return [];
  }

  validateNoDuplicates(itemIDs);
  const previousSkillMap = getBaseSkillMap(characterID);
  const entries = itemIDs.map((itemID) =>
    validateSkillbookItem(characterID, itemID, previousSkillMap),
  );
  validateNoDuplicates(entries.map((entry) => entry.typeID));

  const changes = [];
  for (const entry of entries) {
    const consumeResult = consumeExactInventoryStack(entry.item, 1);
    if (!consumeResult.success) {
      throwPurchaseError("ItemNotASkill", {
        skillName: entry.typeID,
      });
    }
    changes.push(...((consumeResult.data && consumeResult.data.changes) || []));
  }

  const injectedTypeIDs = injectSkillTypes(
    characterID,
    entries.map((entry) => entry.typeID),
    session,
    {
      previousSkillMap,
    },
  );
  syncInventoryChangesToSession(session, changes);
  return injectedTypeIDs;
}

function buildInjectedSkillPreview(characterID, typeID) {
  const skillType = getSkillTypeByID(typeID);
  if (!skillType) {
    return null;
  }
  const existingSkill = getBaseSkillMap(characterID).get(toInt(typeID, 0));
  return cloneValue(existingSkill || buildSkillRecord(characterID, skillType, 0));
}

function resetSkillbookRuntimeCacheForTests() {
  directPurchaseCache = null;
}

module.exports = {
  DIRECT_PURCHASE_TAX_RATE,
  REF_SKILL_PURCHASE,
  buildInjectedSkillPreview,
  getDirectPurchasePrice,
  injectSkillTypes,
  injectSkillbookItems,
  isSkillAvailableForDirectPurchase,
  isSkillInjected,
  isSkillType,
  normalizeIDList,
  purchaseSkills,
  resetSkillbookRuntimeCacheForTests,
  validateSkillPurchase,
};
