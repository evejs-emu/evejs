const path = require("path");

const {
  getTypeEffectRecords,
  isPassiveModifierSource,
  appendLocationModifierEntries,
  buildEffectiveItemAttributeMap,
  applyModifierGroups,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  buildSkillEffectiveAttributes,
  collectShipModifierAttributes,
} = require(path.join(__dirname, "../combat/weaponDogma"));
const {
  buildNpcEffectiveModuleItem,
} = require(path.join(__dirname, "../npc/npcCapabilityResolver"));

function toInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildLiveModuleAttributeMap(
  shipItem,
  moduleItem,
  chargeItem,
  skillMap,
  fittedItems,
  activeModuleContexts,
  options = {},
) {
  if (!shipItem || !moduleItem) {
    return null;
  }

  const effectiveModuleItem = buildNpcEffectiveModuleItem(moduleItem);
  const attributes = buildEffectiveItemAttributeMap(effectiveModuleItem, chargeItem);
  const modifierEntries = [];
  const resolvedSkillMap = skillMap instanceof Map ? skillMap : new Map();
  const resolvedFittedItems = Array.isArray(fittedItems) ? fittedItems : [];
  const resolvedActiveModuleContexts = Array.isArray(activeModuleContexts)
    ? activeModuleContexts
    : [];
  const additionalLocationModifierSources = Array.isArray(
    options.additionalLocationModifierSources,
  )
    ? options.additionalLocationModifierSources
    : [];
  const shipModifierAttributes = collectShipModifierAttributes(shipItem, resolvedSkillMap);

  for (const skillRecord of resolvedSkillMap.values()) {
    appendLocationModifierEntries(
      modifierEntries,
      buildSkillEffectiveAttributes(skillRecord),
      getTypeEffectRecords(skillRecord.typeID),
      "skill",
      effectiveModuleItem,
    );
  }

  appendLocationModifierEntries(
    modifierEntries,
    shipModifierAttributes,
    getTypeEffectRecords(shipItem.typeID),
    "ship",
    effectiveModuleItem,
  );

  for (const fittedItem of resolvedFittedItems) {
    if (
      !isPassiveModifierSource(fittedItem) ||
      toInt(fittedItem && fittedItem.itemID, 0) === toInt(moduleItem.itemID, 0)
    ) {
      continue;
    }

    const effectiveFittedItem = buildNpcEffectiveModuleItem(fittedItem);
    appendLocationModifierEntries(
      modifierEntries,
      buildEffectiveItemAttributeMap(effectiveFittedItem),
      getTypeEffectRecords(effectiveFittedItem.typeID),
      "fittedModule",
      effectiveModuleItem,
    );
  }

  for (const activeModuleContext of resolvedActiveModuleContexts) {
    const activeModuleItem = buildNpcEffectiveModuleItem(
      activeModuleContext && activeModuleContext.moduleItem,
    );
    const activeEffectRecord =
      activeModuleContext && activeModuleContext.effectRecord
        ? activeModuleContext.effectRecord
        : null;
    if (!activeModuleItem || !activeEffectRecord) {
      continue;
    }

    appendLocationModifierEntries(
      modifierEntries,
      buildEffectiveItemAttributeMap(
        activeModuleItem,
        activeModuleContext && activeModuleContext.chargeItem,
      ),
      [activeEffectRecord],
      "fittedModule",
      effectiveModuleItem,
    );
  }

  for (const source of additionalLocationModifierSources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    appendLocationModifierEntries(
      modifierEntries,
      source.sourceAttributes,
      source.sourceEffects,
      String(source.sourceKind || "system"),
      effectiveModuleItem,
    );
  }

  applyModifierGroups(attributes, modifierEntries);
  return attributes;
}

module.exports = {
  buildLiveModuleAttributeMap,
};
