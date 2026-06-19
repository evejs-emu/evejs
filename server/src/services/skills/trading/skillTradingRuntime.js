const path = require("path");

const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../../common/machoErrors"));
const {
  notifyFreeSkillPointsChanged,
  notifySkillStateChanged,
} = require(path.join(__dirname, "../training/skillQueueNotifications"));
const {
  getQueueSnapshot,
} = require(path.join(__dirname, "../training/skillQueueRuntime"));
const {
  getSkillLevelForPoints,
  getSkillPointsForLevel,
  CLONE_STATE_ALPHA,
  getNowFileTime,
} = require(path.join(__dirname, "../training/skillTrainingMath"));
const {
  getMaxTrainableLevelForClone,
  resolveCharacterCloneGrade,
} = require(path.join(__dirname, "../training/skillCloneRestrictions"));
const {
  replaceCharacterSkillRecords,
} = require(path.join(__dirname, "../skillState"));
const {
  getRequiredSkillRequirements,
} = require(path.join(__dirname, "../../fitting/liveFittingState"));
const {
  getDockedLocationID,
  isDockedSession,
} = require(path.join(__dirname, "../../structure/structureLocation"));
const {
  CAPSULE_TYPE_ID,
  CLIENT_INVENTORY_STACK_LIMIT,
  findItemById,
  grantItemToCharacterLocation,
  removeInventoryItem,
  updateInventoryItem,
} = require(path.join(__dirname, "../../inventory/itemStore"));
const {
  getCharacterSkillTradingState,
  updateCharacterSkillTradingState,
} = require("./skillTradingState");
const {
  SKILL_TRADING_BUCKET_SIZE,
  SKILL_TRADING_MINIMUM_SP_TO_EXTRACT,
  SKILL_TRADING_SMALL_INJECTOR_DIVISOR,
  TYPE_LARGE_SKILL_INJECTOR,
  TYPE_SMALL_SKILL_INJECTOR,
  TYPE_SKILL_EXTRACTOR,
  buildDiminishingInjectionPreview,
  getFixedInjectorMaxUsableQuantity,
  getFixedInjectorSkillPointAmount,
  getInjectorPreviewSkillPoints,
  getSkillInjectorSpec,
  isSkillInjectorType,
  isSkillExtractorType,
  resolveNextDowntimeFileTime,
} = require("./skillTradingAuthority");
const {
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  notifyNonDiminishingInjectionsUsed,
} = require("./skillTradingNotifications");

const ITEM_FLAG_HANGAR = 4;
const ITEM_FLAG_CARGO_HOLD = 5;

const TYPE_INFOMORPH_PSYCHOLOGY = 24242;
const TYPE_ADVANCED_INFOMORPH_PSYCHOLOGY = 33407;
const TYPE_ELITE_INFOMORPH_PSYCHOLOGY = 73910;
const TYPE_INTERPLANETARY_CONSOLIDATION = 2495;
const TYPE_COMMAND_CENTER_UPGRADES = 2505;
const recursiveRequiredSkillCache = new Map();
const directRequiredSkillCache = new Map();

function getCharacterState() {
  return require(path.join(__dirname, "../../character/characterState"));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function normalizeOptionalQuantity(value, fallback = 1) {
  const normalized = normalizePositiveInteger(value, fallback);
  return normalized > 0 ? normalized : fallback;
}

function normalizeExtractorSelection(selection) {
  if (!selection) {
    return [];
  }

  if (selection.type === "dict" && Array.isArray(selection.entries)) {
    return selection.entries
      .map(([skillTypeID, skillPoints]) => ({
        skillTypeID: toInt(skillTypeID, 0),
        skillPoints: Math.max(0, toInt(skillPoints, 0)),
      }))
      .filter((entry) => entry.skillTypeID > 0 && entry.skillPoints > 0);
  }

  if (Array.isArray(selection)) {
    return selection
      .map((entry) =>
        Array.isArray(entry)
          ? {
              skillTypeID: toInt(entry[0], 0),
              skillPoints: Math.max(0, toInt(entry[1], 0)),
            }
          : {
              skillTypeID: toInt(entry && (entry.skillTypeID ?? entry.typeID), 0),
              skillPoints: Math.max(0, toInt(entry && (entry.skillPoints ?? entry.points), 0)),
            },
      )
      .filter((entry) => entry.skillTypeID > 0 && entry.skillPoints > 0);
  }

  if (typeof selection === "object") {
    return Object.entries(selection)
      .map(([skillTypeID, skillPoints]) => ({
        skillTypeID: toInt(skillTypeID, 0),
        skillPoints: Math.max(0, toInt(skillPoints, 0)),
      }))
      .filter((entry) => entry.skillTypeID > 0 && entry.skillPoints > 0);
  }

  return [];
}

function getActiveShipIDFromSession(session) {
  return toInt(
    session && (session.shipID || session.shipid || session.activeShipID),
    0,
  );
}

function getActiveShipTypeIDFromSession(session) {
  return toInt(session && (session.shipTypeID || session.shiptypeid), 0);
}

function getCharacterIDFromSession(session) {
  return toInt(session && (session.characterID || session.charid), 0);
}

function isAccessibleSkillTradingItem(session, characterID, item) {
  if (!item || typeof item !== "object") {
    return false;
  }

  if (toInt(item.ownerID, 0) !== characterID) {
    return false;
  }

  const dockedLocationID = getDockedLocationID(session);
  const activeShipID = getActiveShipIDFromSession(session);
  const itemLocationID = toInt(item.locationID, 0);
  const flagID = toInt(item.flagID, 0);

  if (
    dockedLocationID > 0 &&
    itemLocationID === dockedLocationID &&
    flagID === ITEM_FLAG_HANGAR
  ) {
    return true;
  }

  if (
    activeShipID > 0 &&
    itemLocationID === activeShipID &&
    flagID === ITEM_FLAG_CARGO_HOLD
  ) {
    return true;
  }

  return false;
}

function resolveOwnedSkillTradingItem(session, characterID, itemID, validator) {
  const item = findItemById(itemID);
  if (!item || toInt(item.ownerID, 0) !== characterID) {
    throwWrappedUserError("SkillTradingItemNotFound", {});
  }
  if (!isAccessibleSkillTradingItem(session, characterID, item)) {
    throwWrappedUserError("SkillTradingItemNotAccessible", {});
  }
  if (typeof validator === "function" && !validator(item)) {
    throwWrappedUserError("SkillTradingItemTypeMismatch", {});
  }
  return item;
}

function syncInventoryChangesToSession(session, changes = []) {
  const { syncInventoryItemForSession } = getCharacterState();
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
    } else if (change.removed === true && change.previousData) {
      const removedState = {
        ...change.previousData,
        locationID: 6,
      };
      syncInventoryItemForSession(session, removedState, change.previousData);
    }
  }
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

function consumeStackQuantity(item, quantity) {
  const normalizedQuantity = normalizePositiveInteger(quantity, 0);
  if (normalizedQuantity <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_QUANTITY_OUT_OF_RANGE",
    };
  }

  const currentItem = findItemById(item.itemID) || item;
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
    return removeInventoryItem(currentItem.itemID, { removeContents: false });
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

function getLiveSkillSnapshot(characterID) {
  return getQueueSnapshot(characterID);
}

function getProjectedAllocatedSkillPoints(snapshot) {
  return (snapshot.projectedSkills || []).reduce(
    (sum, skillRecord) =>
      sum + Math.max(0, toInt(skillRecord && skillRecord.trainedSkillPoints, 0)),
    0,
  );
}

function getProjectedTotalSkillPoints(snapshot) {
  return (
    getProjectedAllocatedSkillPoints(snapshot) +
    Math.max(0, toInt(snapshot.freeSkillPoints, 0))
  );
}

function getCurrentCloneCount(characterRecord = {}) {
  const jumpClones = Array.isArray(characterRecord.jumpClones)
    ? characterRecord.jumpClones
    : [];
  return jumpClones.length;
}

function getCharacterColonies(characterRecord = {}) {
  const candidates = [
    characterRecord.colonies,
    characterRecord.planets,
    characterRecord.planetColonies,
  ];
  const source = candidates.find((entry) => Array.isArray(entry));
  return Array.isArray(source) ? source.filter(Boolean) : [];
}

function getDirectRequiredSkills(typeID) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return [];
  }

  if (directRequiredSkillCache.has(numericTypeID)) {
    return directRequiredSkillCache.get(numericTypeID);
  }

  const normalizedRequirements = (getRequiredSkillRequirements(numericTypeID) || [])
    .map((requirement) => ({
      skillTypeID: toInt(requirement && requirement.skillTypeID, 0),
      level: Math.max(1, toInt(requirement && requirement.level, 1)),
    }))
    .filter((requirement) => requirement.skillTypeID > 0);
  directRequiredSkillCache.set(numericTypeID, normalizedRequirements);
  return normalizedRequirements;
}

function getRecursiveRequiredSkills(typeID, cache = new Map()) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return new Map();
  }
  if (recursiveRequiredSkillCache.has(numericTypeID)) {
    return new Map(recursiveRequiredSkillCache.get(numericTypeID));
  }
  if (cache.has(numericTypeID)) {
    return new Map(cache.get(numericTypeID));
  }

  const resolved = new Map();
  for (const requirement of getDirectRequiredSkills(numericTypeID)) {
    const skillTypeID = requirement.skillTypeID;
    const level = requirement.level;
    resolved.set(skillTypeID, Math.max(level, resolved.get(skillTypeID) || 0));
    const nestedRequirements = getRecursiveRequiredSkills(skillTypeID, cache);
    for (const [nestedSkillTypeID, nestedLevel] of nestedRequirements.entries()) {
      resolved.set(
        nestedSkillTypeID,
        Math.max(nestedLevel, resolved.get(nestedSkillTypeID) || 0),
      );
    }
  }

  cache.set(numericTypeID, new Map(resolved));
  recursiveRequiredSkillCache.set(numericTypeID, new Map(resolved));
  return resolved;
}

function buildSkillDependencyRequirementMap(skillRecords = []) {
  const dependencyMap = new Map();
  for (const skillRecord of Array.isArray(skillRecords) ? skillRecords : []) {
    const currentPoints = Math.max(0, toInt(skillRecord && skillRecord.trainedSkillPoints, 0));
    if (currentPoints <= 0) {
      continue;
    }
    for (const requirement of getDirectRequiredSkills(skillRecord.typeID)) {
      const requiredSkillTypeID = requirement.skillTypeID;
      const requiredLevel = requirement.level;
      dependencyMap.set(
        requiredSkillTypeID,
        Math.max(requiredLevel, dependencyMap.get(requiredSkillTypeID) || 0),
      );
    }
  }
  return dependencyMap;
}

function buildImplantRestrictionMap(characterRecord = {}) {
  const implants = [
    ...(Array.isArray(characterRecord.implants) ? characterRecord.implants : []),
    ...((Array.isArray(characterRecord.jumpClones) ? characterRecord.jumpClones : [])
      .flatMap((jumpClone) => (
        Array.isArray(jumpClone && jumpClone.implants) ? jumpClone.implants : []
      ))),
  ];
  const restrictionMap = new Map();

  for (const implant of implants) {
    const implantTypeID = toInt(implant && implant.typeID, 0);
    if (implantTypeID <= 0) {
      continue;
    }
    const requirements = getRecursiveRequiredSkills(implantTypeID);
    for (const [skillTypeID, requiredLevel] of requirements.entries()) {
      restrictionMap.set(
        skillTypeID,
        Math.max(requiredLevel, restrictionMap.get(skillTypeID) || 0),
      );
    }
  }

  return restrictionMap;
}

function buildCloneRestrictionMap(characterRecord = {}) {
  const cloneCount = getCurrentCloneCount(characterRecord);
  const restrictionMap = new Map();

  if (cloneCount > 0) {
    restrictionMap.set(TYPE_INFOMORPH_PSYCHOLOGY, Math.min(cloneCount, 5));
  }
  if (cloneCount > 5) {
    restrictionMap.set(TYPE_ADVANCED_INFOMORPH_PSYCHOLOGY, cloneCount - 5);
  }
  if (cloneCount > 10) {
    restrictionMap.set(TYPE_ELITE_INFOMORPH_PSYCHOLOGY, cloneCount - 10);
  }

  return restrictionMap;
}

function buildPlanetRestrictionMap(characterRecord = {}) {
  const colonies = getCharacterColonies(characterRecord);
  const restrictionMap = new Map();

  if (colonies.length > 0) {
    restrictionMap.set(
      TYPE_INTERPLANETARY_CONSOLIDATION,
      Math.max(0, colonies.length - 1),
    );
  }

  let maxCommandCenterLevel = 0;
  for (const colony of colonies) {
    maxCommandCenterLevel = Math.max(
      maxCommandCenterLevel,
      toInt(
        colony && (
          colony.commandCenterLevel ??
          colony.colonyLevel ??
          colony.commandCenterUpgradeLevel
        ),
        0,
      ),
    );
  }
  if (maxCommandCenterLevel > 0) {
    restrictionMap.set(TYPE_COMMAND_CENTER_UPGRADES, maxCommandCenterLevel);
  }

  return restrictionMap;
}

function getRestrictionThresholdPoints(requiredLevel, skillRank) {
  const normalizedRequiredLevel = Math.max(0, toInt(requiredLevel, 0));
  if (normalizedRequiredLevel <= 0) {
    return 0;
  }
  return getSkillPointsForLevel(skillRank, normalizedRequiredLevel);
}

function throwExtractorRestrictionError(message = "SkillExtractionRestricted", values = {}) {
  throwWrappedUserError(message, values);
}

function validateExtractionSelections(
  characterID,
  session,
  snapshot,
  requestedSelections,
) {
  const { getCharacterRecord } = getCharacterState();
  const characterRecord = getCharacterRecord(characterID) || {};
  const cloneGrade = resolveCharacterCloneGrade(characterID);
  const projectedSkillMap = new Map(
    (snapshot.projectedSkills || []).map((record) => [toInt(record.typeID, 0), cloneValue(record)]),
  );
  const queueSkillTypeIDs = new Set(
    (snapshot.queueEntries || [])
      .map((entry) => toInt(entry.trainingTypeID, 0))
      .filter(Boolean),
  );

  if (!isDockedSession(session)) {
    throwWrappedUserError("SkillExtractorNotDockedInStation", {
      extractor: TYPE_SKILL_EXTRACTOR,
    });
  }

  if (getActiveShipTypeIDFromSession(session) !== CAPSULE_TYPE_ID) {
    throwWrappedUserError("SkillExtractorNotInCapsule", {
      extractor: TYPE_SKILL_EXTRACTOR,
    });
  }

  const allocatedSkillPoints = getProjectedAllocatedSkillPoints(snapshot);
  if (allocatedSkillPoints < SKILL_TRADING_MINIMUM_SP_TO_EXTRACT) {
    throwWrappedUserError("SkillExtractionNotEnoughSP", {
      limit: SKILL_TRADING_MINIMUM_SP_TO_EXTRACT,
      extractor: TYPE_SKILL_EXTRACTOR,
    });
  }

  const totalRequestedPoints = requestedSelections.reduce(
    (sum, entry) => sum + Math.max(0, toInt(entry.skillPoints, 0)),
    0,
  );
  if (totalRequestedPoints !== SKILL_TRADING_BUCKET_SIZE) {
    throwExtractorRestrictionError("SkillExtractionIncorrectAmount", {
      goal: SKILL_TRADING_BUCKET_SIZE,
      amount: totalRequestedPoints,
    });
  }

  const nextSkillMap = new Map(
    [...projectedSkillMap.entries()].map(([typeID, record]) => [typeID, cloneValue(record)]),
  );

  for (const selection of requestedSelections) {
    const skillTypeID = toInt(selection.skillTypeID, 0);
    const extractionPoints = Math.max(0, toInt(selection.skillPoints, 0));
    const currentRecord = nextSkillMap.get(skillTypeID);
    if (!currentRecord) {
      throwExtractorRestrictionError("SkillExtractionMissingSkill", {
        skillTypeID,
      });
    }
    if (queueSkillTypeIDs.has(skillTypeID)) {
      throwExtractorRestrictionError("SkillExtractionQueuedSkill", {
        skillTypeID,
      });
    }

    const currentPoints = Math.max(0, toInt(currentRecord.trainedSkillPoints, 0));
    if (currentPoints < extractionPoints) {
      throwExtractorRestrictionError("SkillExtractionTooManyPoints", {
        skillTypeID,
        requested: extractionPoints,
        available: currentPoints,
      });
    }

    const nextPoints = currentPoints - extractionPoints;
    const nextLevel = getSkillLevelForPoints(currentRecord.skillRank, nextPoints);
    nextSkillMap.set(skillTypeID, {
      ...currentRecord,
      trainedSkillPoints: nextPoints,
      skillPoints: nextPoints,
      trainedSkillLevel: nextLevel,
      skillLevel: nextLevel,
      effectiveSkillLevel: nextLevel,
      inTraining: false,
      trainingStartTime: null,
      trainingEndTime: null,
      trainingStartSP: nextPoints,
      trainingDestinationSP: nextPoints,
    });
  }

  const nextSkillRecords = [...nextSkillMap.values()];
  const dependencyRestrictions = buildSkillDependencyRequirementMap(nextSkillRecords);
  const implantRestrictions = buildImplantRestrictionMap(characterRecord);
  const cloneRestrictions = buildCloneRestrictionMap(characterRecord);
  const planetRestrictions = buildPlanetRestrictionMap(characterRecord);

  for (const selection of requestedSelections) {
    const skillTypeID = toInt(selection.skillTypeID, 0);
    const nextRecord = nextSkillMap.get(skillTypeID);
    const nextPoints = Math.max(0, toInt(nextRecord && nextRecord.trainedSkillPoints, 0));
    const skillRank = Number(nextRecord && nextRecord.skillRank) || 1;

    const alphaMaxLevel = getMaxTrainableLevelForClone(skillTypeID, {
      characterID,
      cloneGrade,
    });
    const alphaThresholdPoints = getRestrictionThresholdPoints(alphaMaxLevel, skillRank);
    if (cloneGrade === CLONE_STATE_ALPHA && nextPoints < alphaThresholdPoints) {
      throwExtractorRestrictionError("SkillExtractionCloneRestricted", {
        skillTypeID,
      });
    }

    const dependencyRequiredLevel = dependencyRestrictions.get(skillTypeID) || 0;
    if (
      dependencyRequiredLevel > 0 &&
      nextPoints < getRestrictionThresholdPoints(dependencyRequiredLevel, skillRank)
    ) {
      throwExtractorRestrictionError("SkillExtractionRequiredSkill", {
        skillTypeID,
        requiredLevel: dependencyRequiredLevel,
      });
    }

    const implantRequiredLevel = implantRestrictions.get(skillTypeID) || 0;
    if (
      implantRequiredLevel > 0 &&
      nextPoints < getRestrictionThresholdPoints(implantRequiredLevel, skillRank)
    ) {
      throwExtractorRestrictionError("SkillExtractionImplantRestricted", {
        skillTypeID,
        requiredLevel: implantRequiredLevel,
      });
    }

    const cloneRequiredLevel = cloneRestrictions.get(skillTypeID) || 0;
    if (
      cloneRequiredLevel > 0 &&
      nextPoints < getRestrictionThresholdPoints(cloneRequiredLevel, skillRank)
    ) {
      throwExtractorRestrictionError("SkillExtractionJumpCloneRestricted", {
        skillTypeID,
        requiredLevel: cloneRequiredLevel,
      });
    }

    const planetRequiredLevel = planetRestrictions.get(skillTypeID) || 0;
    if (
      planetRequiredLevel > 0 &&
      nextPoints < getRestrictionThresholdPoints(planetRequiredLevel, skillRank)
    ) {
      throwExtractorRestrictionError("SkillExtractionPlanetRestricted", {
        skillTypeID,
        requiredLevel: planetRequiredLevel,
      });
    }
  }

  return nextSkillRecords;
}

function getRemainingNonDiminishingInjections(characterID) {
  const state = getCharacterSkillTradingState(characterID);
  return Math.max(0, toInt(state.nonDiminishingInjectionsRemaining, 0));
}

function getNextAvailableAlphaInjectionFileTime(characterID) {
  const state = getCharacterSkillTradingState(characterID);
  return BigInt(String(state.nextAlphaInjectionAt || "0"));
}

function getNextAvailableAlphaInjectionForSession(session) {
  return getNextAvailableAlphaInjectionFileTime(getCharacterIDFromSession(session));
}

function getAvailableNonDiminishingInjectionsForSession(session) {
  return getRemainingNonDiminishingInjections(getCharacterIDFromSession(session));
}

function buildInjectorConstraintContext(characterID, injectorSpec, quantity, totalSkillPoints) {
  const normalizedQuantity = normalizeOptionalQuantity(quantity, 1);
  const nonDiminishingRemaining = getRemainingNonDiminishingInjections(characterID);

  return {
    quantity: normalizedQuantity,
    totalSkillPoints,
    nonDiminishingRemaining,
    fixedSkillPoints: getFixedInjectorSkillPointAmount(injectorSpec),
    fixedUsableQuantity: getFixedInjectorMaxUsableQuantity(
      injectorSpec,
      normalizedQuantity,
      totalSkillPoints,
    ),
    diminishingPreview:
      injectorSpec && injectorSpec.injectionMode === "diminishing"
        ? buildDiminishingInjectionPreview(
            injectorSpec,
            normalizedQuantity,
            totalSkillPoints,
            nonDiminishingRemaining,
          )
        : null,
  };
}

function checkInjectionConstraints(characterID, itemID, quantity, session = null) {
  const injectorItem = resolveOwnedSkillTradingItem(
    session,
    characterID,
    itemID,
    (item) => isSkillInjectorType(item.typeID),
  );
  const injectorSpec = getSkillInjectorSpec(injectorItem.typeID);
  const snapshot = getLiveSkillSnapshot(characterID);
  const totalSkillPoints = getProjectedTotalSkillPoints(snapshot);
  const context = buildInjectorConstraintContext(
    characterID,
    injectorSpec,
    quantity,
    totalSkillPoints,
  );
  const requestedQuantity = context.quantity;
  const availableQuantity = Math.max(
    0,
    toInt(
      injectorItem.stacksize ?? injectorItem.quantity,
      injectorItem.singleton === 1 ? 1 : 0,
    ),
  );

  if (requestedQuantity > availableQuantity) {
    throwWrappedUserError("NotEnoughQuantity", {});
  }

  if (injectorSpec.alphaOnly === true && resolveCharacterCloneGrade(characterID) !== CLONE_STATE_ALPHA) {
    throwWrappedUserError("InjectorSkillPointLimitReached", {
      typeID: injectorSpec.typeID,
      limit: 0,
    });
  }

  if (injectorSpec.oncePerDowntime === true) {
    if (getNextAvailableAlphaInjectionFileTime(characterID) > getNowFileTime()) {
      throwWrappedUserError("AlreadyInjectedToday", {
        type: injectorSpec.typeID,
      });
    }
    if (requestedQuantity > 1) {
      throwWrappedUserError("AlreadyInjectedToday", {
        type: injectorSpec.typeID,
      });
    }
    return {
      injectorItem,
      injectorSpec,
      totalSkillPoints,
      skillPointsToInject: getFixedInjectorSkillPointAmount(injectorSpec),
      nonDiminishingUsed: 0,
    };
  }

  if (injectorSpec.injectionMode === "fixed") {
    if (context.fixedUsableQuantity < requestedQuantity) {
      throwWrappedUserError("InjectorSkillPointLimitReached", {
        typeID: injectorSpec.typeID,
        limit: injectorSpec.characterSkillPointLimit || 0,
      });
    }
    return {
      injectorItem,
      injectorSpec,
      totalSkillPoints,
      skillPointsToInject: context.fixedSkillPoints * requestedQuantity,
      nonDiminishingUsed: 0,
    };
  }

  return {
    injectorItem,
    injectorSpec,
    totalSkillPoints,
    skillPointsToInject: context.diminishingPreview.totalSkillPoints,
    nonDiminishingUsed: context.diminishingPreview.nonDiminishingUsed,
  };
}

function injectSkillPoints(characterID, itemID, quantity, session = null) {
  const { updateCharacterRecord } = getCharacterState();
  const constraintResult = checkInjectionConstraints(characterID, itemID, quantity, session);
  const {
    injectorItem,
    injectorSpec,
    skillPointsToInject,
    nonDiminishingUsed,
  } = constraintResult;

  const consumeQuantity =
    injectorSpec.oncePerDowntime === true ? 1 : normalizeOptionalQuantity(quantity, 1);
  const consumeResult = consumeStackQuantity(injectorItem, consumeQuantity);
  if (!consumeResult.success) {
    throwWrappedUserError("NotEnoughQuantity", {});
  }

  const updateCharacterResult = updateCharacterRecord(characterID, (record) => ({
    ...record,
    freeSkillPoints: Math.max(0, toInt(record.freeSkillPoints, 0)) + skillPointsToInject,
  }));
  if (!updateCharacterResult.success) {
    throwWrappedUserError("CustomNotify", {
      notify: "Failed to update free skill points.",
    });
  }

  if (injectorSpec.oncePerDowntime === true || nonDiminishingUsed > 0) {
    updateCharacterSkillTradingState(characterID, (state) => ({
      ...state,
      nextAlphaInjectionAt:
        injectorSpec.oncePerDowntime === true
          ? resolveNextDowntimeFileTime().toString()
          : state.nextAlphaInjectionAt,
      nonDiminishingInjectionsRemaining:
        nonDiminishingUsed > 0
          ? Math.max(
              0,
              toInt(state.nonDiminishingInjectionsRemaining, 0) - nonDiminishingUsed,
            )
          : toInt(state.nonDiminishingInjectionsRemaining, 0),
    }));
  }

  if (session) {
    syncInventoryChangesToSession(session, (consumeResult.data && consumeResult.data.changes) || []);
  }
  if (nonDiminishingUsed > 0) {
    notifyNonDiminishingInjectionsUsed(characterID, nonDiminishingUsed);
  }
  notifyFreeSkillPointsChanged(
    characterID,
    Math.max(0, toInt((updateCharacterResult.data || {}).freeSkillPoints, 0)),
  );

  return skillPointsToInject;
}

function getDiminishedSpFromInjectors(
  characterID,
  typeID,
  quantity,
  nonDiminishingInjectionsRemaining = 0,
) {
  const injectorSpec = getSkillInjectorSpec(typeID);
  if (!injectorSpec) {
    return 0;
  }
  const snapshot = getLiveSkillSnapshot(characterID);
  return getInjectorPreviewSkillPoints(
    injectorSpec,
    normalizeOptionalQuantity(quantity, 1),
    getProjectedTotalSkillPoints(snapshot),
    Math.max(0, toInt(nonDiminishingInjectionsRemaining, 0)),
  );
}

function extractSkills(characterID, selection, itemID, session = null) {
  const requestedSelections = normalizeExtractorSelection(selection);
  if (requestedSelections.length === 0) {
    throwExtractorRestrictionError("SkillExtractionIncorrectAmount", {
      goal: SKILL_TRADING_BUCKET_SIZE,
      amount: 0,
    });
  }

  const extractorItem = resolveOwnedSkillTradingItem(
    session,
    characterID,
    itemID,
    (item) => isSkillExtractorType(item.typeID),
  );
  const snapshot = getLiveSkillSnapshot(characterID);
  const nextSkillRecords = validateExtractionSelections(
    characterID,
    session,
    snapshot,
    requestedSelections,
  );

  const replaceResult = replaceCharacterSkillRecords(characterID, nextSkillRecords);
  if (!replaceResult.success) {
    throwWrappedUserError("CustomNotify", {
      notify: "Failed to persist extracted skill state.",
    });
  }

  const removeResult = consumeStackQuantity(extractorItem, 1);
  if (!removeResult.success) {
    throwWrappedUserError("SkillTradingItemNotFound", {});
  }

  const grantResult = grantItemToCharacterLocation(
    characterID,
    getDockedLocationID(session),
    ITEM_FLAG_HANGAR,
    TYPE_LARGE_SKILL_INJECTOR,
    1,
  );
  if (!grantResult.success) {
    throwWrappedUserError("CustomNotify", {
      notify: "Failed to create the extracted skill injector.",
    });
  }

  const changedSkillTypeIDs = new Set(
    requestedSelections.map((entry) => toInt(entry.skillTypeID, 0)).filter(Boolean),
  );
  const changedSkills = (replaceResult.data || []).filter((record) =>
    changedSkillTypeIDs.has(toInt(record.typeID, 0)),
  );
  notifySkillStateChanged(characterID, changedSkills, {
    emitSkillLevelsTrained: false,
  });

  if (session) {
    syncInventoryChangesToSession(session, [
      ...((removeResult.data && removeResult.data.changes) || []),
      ...((grantResult.data && grantResult.data.changes) || []),
    ]);
  }

  return null;
}

function splitSkillInjector(characterID, itemID, quantity, session = null) {
  const injectorItem = resolveOwnedSkillTradingItem(
    session,
    characterID,
    itemID,
    (item) => toInt(item.typeID, 0) === TYPE_LARGE_SKILL_INJECTOR,
  );
  const requestedQuantity = normalizeOptionalQuantity(quantity, 1);
  const availableQuantity = Math.max(
    0,
    toInt(
      injectorItem.stacksize ?? injectorItem.quantity,
      injectorItem.singleton === 1 ? 1 : 0,
    ),
  );
  if (requestedQuantity > availableQuantity) {
    throwWrappedUserError("NotEnoughQuantity", {});
  }

  if (requestedQuantity * SKILL_TRADING_SMALL_INJECTOR_DIVISOR > CLIENT_INVENTORY_STACK_LIMIT) {
    throwWrappedUserError("StackSizeExceeded", {});
  }

  const consumeResult = consumeStackQuantity(injectorItem, requestedQuantity);
  if (!consumeResult.success) {
    throwWrappedUserError("NotEnoughQuantity", {});
  }

  const grantResult = grantItemToCharacterLocation(
    characterID,
    toInt(injectorItem.locationID, 0),
    toInt(injectorItem.flagID, ITEM_FLAG_HANGAR),
    TYPE_SMALL_SKILL_INJECTOR,
    requestedQuantity * SKILL_TRADING_SMALL_INJECTOR_DIVISOR,
  );
  if (!grantResult.success) {
    throwWrappedUserError("CustomNotify", {
      notify: "Failed to create split small injectors.",
    });
  }

  if (session) {
    syncInventoryChangesToSession(session, [
      ...((consumeResult.data && consumeResult.data.changes) || []),
      ...((grantResult.data && grantResult.data.changes) || []),
    ]);
  }

  return requestedQuantity;
}

function combineSkillInjector(characterID, itemID, quantity, session = null) {
  const injectorItem = resolveOwnedSkillTradingItem(
    session,
    characterID,
    itemID,
    (item) => toInt(item.typeID, 0) === TYPE_SMALL_SKILL_INJECTOR,
  );
  const requestedQuantity = normalizeOptionalQuantity(quantity, 1);
  if (requestedQuantity < SKILL_TRADING_SMALL_INJECTOR_DIVISOR) {
    throwWrappedUserError("CombineSkillInjectorTooFewInjectors", {
      minQuantity: SKILL_TRADING_SMALL_INJECTOR_DIVISOR,
      injectorType: TYPE_SMALL_SKILL_INJECTOR,
    });
  }

  const availableQuantity = Math.max(
    0,
    toInt(
      injectorItem.stacksize ?? injectorItem.quantity,
      injectorItem.singleton === 1 ? 1 : 0,
    ),
  );
  if (requestedQuantity > availableQuantity) {
    throwWrappedUserError("NotEnoughQuantity", {});
  }

  const largeInjectorCount = Math.floor(
    requestedQuantity / SKILL_TRADING_SMALL_INJECTOR_DIVISOR,
  );
  const smallInjectorsToConsume =
    largeInjectorCount * SKILL_TRADING_SMALL_INJECTOR_DIVISOR;

  const consumeResult = consumeStackQuantity(injectorItem, smallInjectorsToConsume);
  if (!consumeResult.success) {
    throwWrappedUserError("NotEnoughQuantity", {});
  }

  const grantResult = grantItemToCharacterLocation(
    characterID,
    toInt(injectorItem.locationID, 0),
    toInt(injectorItem.flagID, ITEM_FLAG_HANGAR),
    TYPE_LARGE_SKILL_INJECTOR,
    largeInjectorCount,
  );
  if (!grantResult.success) {
    throwWrappedUserError("CustomNotify", {
      notify: "Failed to create combined large injectors.",
    });
  }

  if (session) {
    syncInventoryChangesToSession(session, [
      ...((consumeResult.data && consumeResult.data.changes) || []),
      ...((grantResult.data && grantResult.data.changes) || []),
    ]);
  }

  return largeInjectorCount;
}

module.exports = {
  checkInjectionConstraints,
  combineSkillInjector,
  extractSkills,
  getAvailableNonDiminishingInjectionsForSession,
  getDiminishedSpFromInjectors,
  getNextAvailableAlphaInjectionForSession,
  injectSkillPoints,
  splitSkillInjector,
};
