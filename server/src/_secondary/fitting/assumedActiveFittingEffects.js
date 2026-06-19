const path = require("path");

const {
  getTypeDogmaEffects,
  getEffectTypeRecord,
  buildModuleStatusSnapshot,
  appendDirectModifierEntries,
  applyModifierGroups,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  buildLiveModuleAttributeMap,
} = require(path.join(__dirname, "../../space/modules/liveModuleAttributes"));
const commandBurstRuntime = require(path.join(
  __dirname,
  "../../space/modules/commandBurstRuntime",
));

const CHARGE_CATEGORY_ID = 8;
const ACTIVATABLE_EFFECT_CATEGORIES = new Set([1, 2, 3]);
const PASSIVE_SLOT_EFFECTS = new Set([
  "online",
  "hipower",
  "medpower",
  "lopower",
  "rigslot",
  "subsystem",
  "turretfitted",
  "launcherfitted",
]);
const PROPULSION_EFFECT_NAMES = new Set([
  "modulebonusafterburner",
  "modulebonusmicrowarpdrive",
]);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeEffectName(effectRecord) {
  return String(effectRecord && effectRecord.name || "").trim().toLowerCase();
}

function isChargeItem(item) {
  return toInt(item && item.categoryID, 0) === CHARGE_CATEGORY_ID;
}

function resolveDefaultActivationEffectRecord(typeID) {
  for (const effectID of getTypeDogmaEffects(typeID)) {
    const effectRecord = getEffectTypeRecord(effectID);
    if (
      !effectRecord ||
      !ACTIVATABLE_EFFECT_CATEGORIES.has(toInt(effectRecord.effectCategoryID, 0))
    ) {
      continue;
    }

    if (PASSIVE_SLOT_EFFECTS.has(normalizeEffectName(effectRecord))) {
      continue;
    }

    return effectRecord;
  }
  return null;
}

function shouldSkipAssumedActiveModule(moduleItem, effectRecord) {
  if (!moduleItem || !effectRecord) {
    return true;
  }

  const normalizedEffectName = normalizeEffectName(effectRecord);
  if (
    normalizedEffectName.includes("cloak") ||
    normalizedEffectName.includes("massentangler")
  ) {
    return true;
  }

  return false;
}

function findLoadedChargeForModule(fittedItems = [], moduleItem) {
  const moduleFlagID = toInt(moduleItem && moduleItem.flagID, 0);
  const moduleLocationID = toInt(moduleItem && moduleItem.locationID, 0);
  if (moduleFlagID <= 0 || moduleLocationID <= 0) {
    return null;
  }

  return (
    (Array.isArray(fittedItems) ? fittedItems : []).find((item) => (
      item &&
      isChargeItem(item) &&
      toInt(item.flagID, 0) === moduleFlagID &&
      toInt(item.locationID, 0) === moduleLocationID
    )) || null
  );
}

function buildAssumedActiveModuleContexts(fittedItems = []) {
  const contexts = [];

  for (const item of Array.isArray(fittedItems) ? fittedItems : []) {
    if (!item || isChargeItem(item)) {
      continue;
    }
    if (buildModuleStatusSnapshot(item).online !== true) {
      continue;
    }

    const effectRecord = resolveDefaultActivationEffectRecord(item.typeID);
    if (!effectRecord || shouldSkipAssumedActiveModule(item, effectRecord)) {
      continue;
    }

    contexts.push({
      moduleItem: item,
      chargeItem: findLoadedChargeForModule(fittedItems, item),
      effectRecord,
      effectID: toInt(effectRecord.effectID, 0),
    });
  }

  return contexts;
}

function filterOtherActiveModuleContexts(activeModuleContexts = [], moduleItem) {
  const moduleID = toInt(moduleItem && moduleItem.itemID, 0);
  return (Array.isArray(activeModuleContexts) ? activeModuleContexts : []).filter(
    (context) => toInt(context && context.moduleItem && context.moduleItem.itemID, 0) !== moduleID,
  );
}

function buildAssumedCommandBurstState({
  shipItem,
  fittedItems,
  skillMap,
  activeModuleContexts,
  nowMs,
} = {}) {
  const burstState = {};
  let applied = false;

  for (const activeModuleContext of Array.isArray(activeModuleContexts)
    ? activeModuleContexts
    : []) {
    const effectRecord = activeModuleContext && activeModuleContext.effectRecord;
    if (!commandBurstRuntime.isCommandBurstEffectRecord(effectRecord)) {
      continue;
    }

    const activation = commandBurstRuntime.resolveCommandBurstActivation({
      effectRecord,
      moduleItem: activeModuleContext.moduleItem,
      chargeItem: activeModuleContext.chargeItem,
      shipItem,
      skillMap,
      fittedItems,
      activeModuleContexts: filterOtherActiveModuleContexts(
        activeModuleContexts,
        activeModuleContext.moduleItem,
      ),
    });
    if (!activation || activation.success !== true || !activation.data) {
      continue;
    }

    const effectStatePatch =
      activation.data.effectStatePatch &&
      typeof activation.data.effectStatePatch === "object"
        ? activation.data.effectStatePatch
        : null;
    if (!effectStatePatch) {
      continue;
    }

    const collectionValues =
      effectStatePatch.commandBurstDbuffValues instanceof Map
        ? effectStatePatch.commandBurstDbuffValues
        : null;
    const durationMs = Number(effectStatePatch.commandBurstBuffDurationMs) || 0;
    if (!(collectionValues instanceof Map) || collectionValues.size <= 0 || durationMs <= 0) {
      continue;
    }

    commandBurstRuntime.applyTimedCommandBurstToEntity(
      burstState,
      collectionValues,
      durationMs,
      nowMs,
    );
    applied = true;
  }

  return applied ? burstState : null;
}

function collectCommandBurstModifierEntries(commandBurstState, targetItem, nowMs) {
  if (!commandBurstState || !targetItem) {
    return [];
  }
  return commandBurstRuntime.collectModifierEntriesForItem(
    commandBurstState,
    targetItem,
    nowMs,
  );
}

function buildActiveModuleAttributeMap({
  shipItem,
  moduleItem,
  chargeItem,
  skillMap,
  fittedItems,
  activeModuleContexts,
  commandBurstState,
  nowMs,
} = {}) {
  const moduleAttributes = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    chargeItem,
    skillMap,
    fittedItems,
    filterOtherActiveModuleContexts(activeModuleContexts, moduleItem),
  ) || {};

  const commandBurstModifierEntries = collectCommandBurstModifierEntries(
    commandBurstState,
    moduleItem,
    nowMs,
  );
  if (commandBurstModifierEntries.length > 0) {
    applyModifierGroups(moduleAttributes, commandBurstModifierEntries);
  }

  return moduleAttributes;
}

function collectAssumedActiveFittingEffects({
  shipItem,
  fittedItems = [],
  skillMap = new Map(),
  nowMs = Date.now(),
} = {}) {
  if (!shipItem) {
    return {
      activeModuleContexts: [],
      shipAttributeModifierEntries: [],
    };
  }

  const activeModuleContexts = buildAssumedActiveModuleContexts(fittedItems);
  if (activeModuleContexts.length <= 0) {
    return {
      activeModuleContexts,
      shipAttributeModifierEntries: [],
    };
  }

  const commandBurstState = buildAssumedCommandBurstState({
    shipItem,
    fittedItems,
    skillMap,
    activeModuleContexts,
    nowMs,
  });
  const shipAttributeModifierEntries = collectCommandBurstModifierEntries(
    commandBurstState,
    shipItem,
    nowMs,
  );

  for (const activeModuleContext of activeModuleContexts) {
    if (PROPULSION_EFFECT_NAMES.has(normalizeEffectName(activeModuleContext.effectRecord))) {
      continue;
    }

    const moduleAttributes = buildActiveModuleAttributeMap({
      shipItem,
      moduleItem: activeModuleContext.moduleItem,
      chargeItem: activeModuleContext.chargeItem,
      skillMap,
      fittedItems,
      activeModuleContexts,
      commandBurstState,
      nowMs,
    });
    appendDirectModifierEntries(
      shipAttributeModifierEntries,
      moduleAttributes,
      [activeModuleContext.effectRecord],
      "fittedModule",
    );
  }

  return {
    activeModuleContexts,
    shipAttributeModifierEntries,
  };
}

module.exports = {
  buildAssumedActiveModuleContexts,
  collectAssumedActiveFittingEffects,
};
