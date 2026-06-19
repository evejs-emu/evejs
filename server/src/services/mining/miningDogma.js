const path = require("path");

const {
  getAttributeIDByNames,
  getTypeAttributeMap,
  getTypeAttributeValue,
  applyOtherItemModifiersToAttributes,
  applyModifierGroups,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  buildSkillEffectiveAttributes,
  collectShipModifierAttributes,
  buildLocationModifiedAttributeMap,
} = require(path.join(__dirname, "../../space/combat/weaponDogma"));
const {
  buildNpcEffectiveModuleItem,
} = require(path.join(__dirname, "../../space/npc/npcCapabilityResolver"));

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_MINING_AMOUNT = getAttributeIDByNames("miningAmount") || 77;
const ATTRIBUTE_MAX_GROUP_ACTIVE = getAttributeIDByNames("maxGroupActive") || 763;
const ATTRIBUTE_REACTIVATION_DELAY =
  getAttributeIDByNames("moduleReactivationDelay", "reactivationDelay") || 669;
const ATTRIBUTE_MINING_WASTE_MULTIPLIER =
  getAttributeIDByNames("miningWastedVolumeMultiplier") || 2865;
const ATTRIBUTE_MINING_WASTE_PROBABILITY =
  getAttributeIDByNames("miningWasteProbability") || 2864;
const ATTRIBUTE_MINING_CRIT_CHANCE =
  getAttributeIDByNames("miningCritChance") || 2868;
const ATTRIBUTE_MINING_CRIT_BONUS =
  getAttributeIDByNames("miningCritBonusYield") || 2869;
const ATTRIBUTE_CRYSTAL_VOLATILITY_CHANCE =
  getAttributeIDByNames("crystalVolatilityChance") || 784;
const ATTRIBUTE_CRYSTAL_VOLATILITY_DAMAGE =
  getAttributeIDByNames("crystalVolatilityDamage") || 786;
const ATTRIBUTE_SPECIALIZATION_TYPE_LIST =
  getAttributeIDByNames("specializationAsteroidTypeList") || 3148;
const ATTRIBUTE_SPECIALIZATION_YIELD_MULTIPLIER =
  getAttributeIDByNames("specializationAsteroidYieldMultiplier") || 782;
const MINING_EFFECT_NAMES = new Set([
  "mininglaser",
  "miningclouds",
]);

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

function normalizeEffectName(effectRecord) {
  return String(effectRecord && effectRecord.name || "")
    .trim()
    .toLowerCase();
}

function isMiningEffectRecord(effectRecord, moduleItem = null) {
  const normalizedName = normalizeEffectName(effectRecord);
  if (MINING_EFFECT_NAMES.has(normalizedName)) {
    return true;
  }

  if (effectRecord) {
    return false;
  }

  if (!moduleItem || !moduleItem.typeID) {
    return false;
  }

  const moduleAttributes = getTypeAttributeMap(moduleItem.typeID);
  return toFiniteNumber(
    moduleAttributes && moduleAttributes[ATTRIBUTE_MINING_AMOUNT],
    0,
  ) > 0;
}

function resolveMiningFamily(moduleItem, effectRecord = null) {
  const effectiveModuleItem = buildNpcEffectiveModuleItem(moduleItem);
  const effectName = normalizeEffectName(effectRecord);
  if (effectName === "miningclouds") {
    return "gas";
  }

  const name = String(
    (effectiveModuleItem && effectiveModuleItem.itemName) ||
      (effectiveModuleItem && effectiveModuleItem.name) ||
      "",
  ).toLowerCase();
  if (name.includes("gas")) {
    return "gas";
  }
  if (name.includes("ice")) {
    return "ice";
  }
  return "ore";
}

function buildMiningModuleSnapshot({
  shipItem,
  moduleItem,
  effectRecord,
  chargeItem = null,
  fittedItems = null,
  skillMap = null,
  activeModuleContexts = null,
  additionalModifierEntries = null,
  additionalLocationModifierSources = null,
} = {}) {
  if (!shipItem || !moduleItem || !isMiningEffectRecord(effectRecord, moduleItem)) {
    return null;
  }

  const effectiveModuleItem = buildNpcEffectiveModuleItem(moduleItem);
  const resolvedFittedItems = Array.isArray(fittedItems) ? fittedItems : [];
  const resolvedSkillMap = skillMap instanceof Map ? skillMap : new Map();
  const resolvedActiveModuleContexts = Array.isArray(activeModuleContexts)
    ? activeModuleContexts
    : [];
  const resolvedAdditionalLocationModifierSources = Array.isArray(
    additionalLocationModifierSources,
  )
    ? additionalLocationModifierSources
    : [];
  const shipModifierAttributes = collectShipModifierAttributes(
    shipItem,
    resolvedSkillMap,
  );
  const moduleAttributes = buildLocationModifiedAttributeMap(
    effectiveModuleItem,
    shipItem,
    resolvedSkillMap,
    shipModifierAttributes,
    resolvedFittedItems,
    resolvedActiveModuleContexts,
    {
      excludeItemID: toInt(moduleItem && moduleItem.itemID, 0),
      additionalLocationModifierSources: resolvedAdditionalLocationModifierSources,
    },
  );
  applyOtherItemModifiersToAttributes(moduleAttributes, chargeItem);
  if (Array.isArray(additionalModifierEntries) && additionalModifierEntries.length > 0) {
    applyModifierGroups(moduleAttributes, additionalModifierEntries);
  }

  const chargeAttributes =
    chargeItem && typeof chargeItem === "object"
      ? buildLocationModifiedAttributeMap(
        chargeItem,
        shipItem,
        resolvedSkillMap,
        shipModifierAttributes,
        resolvedFittedItems,
        resolvedActiveModuleContexts,
        {
          additionalLocationModifierSources: resolvedAdditionalLocationModifierSources,
        },
      )
      : {};
  if (chargeItem) {
    applyOtherItemModifiersToAttributes(chargeAttributes, effectiveModuleItem);
  }

  const rawDuration = toFiniteNumber(moduleAttributes[ATTRIBUTE_DURATION], 0);
  const rawSpeed = toFiniteNumber(moduleAttributes[ATTRIBUTE_SPEED], 0);
  const durationAttributeID = rawDuration > 0 ? ATTRIBUTE_DURATION : ATTRIBUTE_SPEED;
  const durationMs = Math.max(1, round6(rawDuration > 0 ? rawDuration : rawSpeed));
  const miningAmountM3 = Math.max(
    0,
    round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_MINING_AMOUNT], 0)),
  );
  if (miningAmountM3 <= 0) {
    return null;
  }

  return {
    family: resolveMiningFamily(effectiveModuleItem, effectRecord),
    moduleID: toInt(moduleItem.itemID, 0),
    moduleTypeID: toInt(moduleItem.typeID, 0),
    chargeItemID: toInt(chargeItem && chargeItem.itemID, 0),
    chargeTypeID: toInt(chargeItem && chargeItem.typeID, 0),
    chargeQuantity: Math.max(
      0,
      toInt(chargeItem && (chargeItem.stacksize ?? chargeItem.quantity), 0),
    ),
    effectID: toInt(effectRecord && effectRecord.effectID, 0),
    effectName: String(effectRecord && effectRecord.name || ""),
    effectGUID: String(effectRecord && effectRecord.guid || ""),
    durationMs,
    durationAttributeID,
    capNeed: Math.max(
      0,
      round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_CAPACITOR_NEED], 0)),
    ),
    maxRangeMeters: Math.max(
      0,
      round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_MAX_RANGE], 0)),
    ),
    maxGroupActive: Math.max(
      0,
      toInt(moduleAttributes[ATTRIBUTE_MAX_GROUP_ACTIVE], 0),
    ),
    reactivationDelayMs: Math.max(
      0,
      round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_REACTIVATION_DELAY], 0)),
    ),
    miningAmountM3,
    wasteVolumeMultiplier: Math.max(
      0,
      round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_MINING_WASTE_MULTIPLIER], 0)),
    ),
    wasteProbability: Math.max(
      0,
      round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_MINING_WASTE_PROBABILITY], 0)),
    ),
    critChance: Math.max(
      0,
      round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_MINING_CRIT_CHANCE], 0)),
    ),
    critQuantityMultiplier: Math.max(
      0,
      round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_MINING_CRIT_BONUS], 0)),
    ),
    crystalVolatilityChance: Math.max(
      0,
      round6(toFiniteNumber(chargeAttributes[ATTRIBUTE_CRYSTAL_VOLATILITY_CHANCE], 0)),
    ),
    crystalVolatilityDamage: Math.max(
      0,
      round6(toFiniteNumber(chargeAttributes[ATTRIBUTE_CRYSTAL_VOLATILITY_DAMAGE], 0)),
    ),
    crystalTargetTypeListID: toInt(
      chargeAttributes[ATTRIBUTE_SPECIALIZATION_TYPE_LIST],
      0,
    ),
    crystalYieldMultiplier: Math.max(
      0,
      round6(toFiniteNumber(chargeAttributes[ATTRIBUTE_SPECIALIZATION_YIELD_MULTIPLIER], 0)),
    ),
    moduleAttributes,
    chargeAttributes,
    shipModifierAttributes,
  };
}

module.exports = {
  isMiningEffectRecord,
  resolveMiningFamily,
  buildMiningModuleSnapshot,
  _testing: {
    buildSkillEffectiveAttributes,
  },
};
