const path = require("path");

const {
  getAttributeIDByNames,
  getEffectTypeRecord,
  getTypeEffectRecords,
  getPassiveModifierEffectRecords,
  getTypeAttributeMap,
  cloneAttributeMap,
  typeHasEffectName,
  listFittedItems,
  isPassiveModifierSource,
  appendDirectModifierEntries,
  appendLocationModifierEntries,
  buildEffectiveItemAttributeMap,
  applyOtherItemModifiersToAttributes,
  applyModifierGroups,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../../services/skills/skillState"));
const {
  buildNpcEffectiveModuleItem,
} = require(path.join(__dirname, "../npc/npcCapabilityResolver"));

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_FALLOFF = getAttributeIDByNames("falloff") || 158;
const ATTRIBUTE_TRACKING_SPEED = getAttributeIDByNames("trackingSpeed") || 160;
const ATTRIBUTE_OPTIMAL_SIG_RADIUS = getAttributeIDByNames("optimalSigRadius") || 620;
const ATTRIBUTE_DAMAGE_MULTIPLIER = getAttributeIDByNames("damageMultiplier") || 64;
const ATTRIBUTE_MISSILE_DAMAGE_MULTIPLIER =
  getAttributeIDByNames("missileDamageMultiplier") || 212;
const ATTRIBUTE_EM_DAMAGE = getAttributeIDByNames("emDamage") || 114;
const ATTRIBUTE_EXPLOSIVE_DAMAGE = getAttributeIDByNames("explosiveDamage") || 116;
const ATTRIBUTE_KINETIC_DAMAGE = getAttributeIDByNames("kineticDamage") || 117;
const ATTRIBUTE_THERMAL_DAMAGE = getAttributeIDByNames("thermalDamage") || 118;
const ATTRIBUTE_SKILL_LEVEL = getAttributeIDByNames("skillLevel") || 280;
const ATTRIBUTE_EXPLOSION_DELAY = getAttributeIDByNames("explosionDelay") || 281;
const ATTRIBUTE_AOE_VELOCITY = getAttributeIDByNames("aoeVelocity") || 653;
const ATTRIBUTE_AOE_CLOUD_SIZE = getAttributeIDByNames("aoeCloudSize") || 654;
const ATTRIBUTE_AOE_DAMAGE_REDUCTION_FACTOR =
  getAttributeIDByNames("aoeDamageReductionFactor") || 1353;
const ATTRIBUTE_AOE_DAMAGE_REDUCTION_SENSITIVITY =
  getAttributeIDByNames("aoeDamageReductionSensitivity") || 1354;

const ENERGY_TURRET_GROUP_ID = 53;
const PROJECTILE_TURRET_GROUP_ID = 55;
const HYBRID_TURRET_GROUP_ID = 74;
const PRECURSOR_WEAPON_GROUP_ID = 1986;
const PROJECTILE_AMMO_GROUP_ID = 83;
const HYBRID_CHARGE_GROUP_ID = 85;
const FREQUENCY_CRYSTAL_GROUP_ID = 86;
const EXOTIC_PLASMA_GROUP_ID = 1987;
const ADVANCED_EXOTIC_PLASMA_GROUP_ID = 1989;
const LIGHT_MISSILE_GROUP_ID = 384;
const HEAVY_MISSILE_GROUP_ID = 385;
const CRUISE_MISSILE_GROUP_ID = 386;
const ROCKET_GROUP_ID = 387;
const TORPEDO_GROUP_ID = 89;
const XL_TORPEDO_GROUP_ID = 476;
const XL_CRUISE_MISSILE_GROUP_ID = 1019;
const HEAVY_ASSAULT_MISSILE_GROUP_ID = 772;
const CRUISE_MISSILE_LAUNCHER_GROUP_ID = 506;
const ROCKET_LAUNCHER_GROUP_ID = 507;
const TORPEDO_LAUNCHER_GROUP_ID = 508;
const LIGHT_MISSILE_LAUNCHER_GROUP_ID = 509;
const HEAVY_MISSILE_LAUNCHER_GROUP_ID = 510;
const XL_TORPEDO_LAUNCHER_GROUP_ID = 524;
const RAPID_LIGHT_MISSILE_LAUNCHER_GROUP_ID = 511;
const HEAVY_ASSAULT_MISSILE_LAUNCHER_GROUP_ID = 771;
const XL_CRUISE_MISSILE_LAUNCHER_GROUP_ID = 1674;
const RAPID_HEAVY_MISSILE_LAUNCHER_GROUP_ID = 1245;
const MISSILE_DEPLOYMENT_GUID = "effects.MissileDeployment";
const TORPEDO_DEPLOYMENT_GUID = "effects.TorpedoDeployment";
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
const WEAPON_FAMILY_BY_MODULE_GROUP_ID = Object.freeze({
  [ENERGY_TURRET_GROUP_ID]: "laserTurret",
  [PROJECTILE_TURRET_GROUP_ID]: "projectileTurret",
  [HYBRID_TURRET_GROUP_ID]: "hybridTurret",
  [PRECURSOR_WEAPON_GROUP_ID]: "precursorTurret",
});
const WEAPON_FAMILY_BY_CHARGE_GROUP_ID = Object.freeze({
  [PROJECTILE_AMMO_GROUP_ID]: "projectileTurret",
  [HYBRID_CHARGE_GROUP_ID]: "hybridTurret",
  [FREQUENCY_CRYSTAL_GROUP_ID]: "laserTurret",
  [EXOTIC_PLASMA_GROUP_ID]: "precursorTurret",
  [ADVANCED_EXOTIC_PLASMA_GROUP_ID]: "precursorTurret",
});
const STANDARD_MISSILE_CHARGE_GROUP_IDS = new Set([
  LIGHT_MISSILE_GROUP_ID,
  HEAVY_MISSILE_GROUP_ID,
  CRUISE_MISSILE_GROUP_ID,
  ROCKET_GROUP_ID,
  TORPEDO_GROUP_ID,
  XL_TORPEDO_GROUP_ID,
  XL_CRUISE_MISSILE_GROUP_ID,
  HEAVY_ASSAULT_MISSILE_GROUP_ID,
]);
const STANDARD_MISSILE_LAUNCHER_GROUP_IDS = new Set([
  CRUISE_MISSILE_LAUNCHER_GROUP_ID,
  ROCKET_LAUNCHER_GROUP_ID,
  TORPEDO_LAUNCHER_GROUP_ID,
  LIGHT_MISSILE_LAUNCHER_GROUP_ID,
  HEAVY_MISSILE_LAUNCHER_GROUP_ID,
  XL_TORPEDO_LAUNCHER_GROUP_ID,
  RAPID_LIGHT_MISSILE_LAUNCHER_GROUP_ID,
  HEAVY_ASSAULT_MISSILE_LAUNCHER_GROUP_ID,
  XL_CRUISE_MISSILE_LAUNCHER_GROUP_ID,
  RAPID_HEAVY_MISSILE_LAUNCHER_GROUP_ID,
]);
const CHARACTER_DIRECT_MODIFIER_OPTIONS = Object.freeze({
  allowedDomains: new Set(["charID"]),
  allowedFuncs: new Set(["ItemModifier"]),
});
const DEFAULT_MISSILE_DAMAGE_REDUCTION_SENSITIVITY = 5.5;
let cachedSkillEffectiveAttributes = null;
let cachedShipModifierAttributes = null;

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

function clamp(value, min, max) {
  return Math.min(Math.max(toFiniteNumber(value, min), min), max);
}

function ensureSkillEffectiveAttributeCache() {
  if (!cachedSkillEffectiveAttributes) {
    cachedSkillEffectiveAttributes = new Map();
  }
  return cachedSkillEffectiveAttributes;
}

function ensureShipModifierAttributeCache() {
  if (!cachedShipModifierAttributes) {
    cachedShipModifierAttributes = new Map();
  }
  return cachedShipModifierAttributes;
}

function resolveSkillLevel(skillRecord) {
  return Math.max(
    0,
    toInt(
      skillRecord && (
        skillRecord.effectiveSkillLevel ??
        skillRecord.trainedSkillLevel ??
        skillRecord.skillLevel
      ),
      0,
    ),
  );
}

function buildSkillProfileCacheKey(skillMap) {
  if (!(skillMap instanceof Map) || skillMap.size === 0) {
    return "";
  }

  const keyParts = [];
  for (const skillRecord of skillMap.values()) {
    const skillTypeID = toInt(skillRecord && skillRecord.typeID, 0);
    if (skillTypeID <= 0) {
      continue;
    }
    keyParts.push(`${skillTypeID}:${resolveSkillLevel(skillRecord)}`);
  }
  return keyParts.join(",");
}

function getModuleChargeGroupIDs(typeID) {
  const attributeMap = getTypeAttributeMap(typeID);
  const chargeGroupIDs = new Set();
  for (let index = 1; index <= 5; index += 1) {
    const chargeGroupID = toInt(
      attributeMap[getAttributeIDByNames(`chargeGroup${index}`)],
      0,
    );
    if (chargeGroupID > 0) {
      chargeGroupIDs.add(chargeGroupID);
    }
  }
  return chargeGroupIDs;
}

function resolveWeaponActivationEffect(typeID) {
  for (const effectRecord of getTypeEffectRecords(typeID)) {
    if (
      !effectRecord ||
      !ACTIVATABLE_EFFECT_CATEGORIES.has(toInt(effectRecord.effectCategoryID, 0))
    ) {
      continue;
    }
    const normalizedName = String(effectRecord.name || "").trim().toLowerCase();
    if (PASSIVE_SLOT_EFFECTS.has(normalizedName)) {
      continue;
    }
    return effectRecord;
  }
  return null;
}

function normalizeEffectGUID(guid) {
  const normalizedGUID = String(guid || "").trim();
  return normalizedGUID && normalizedGUID.toLowerCase() !== "none"
    ? normalizedGUID
    : "";
}

function resolveWeaponSpecialFxGUID({
  family = null,
  moduleItem = null,
  chargeItem = null,
  activationEffect = null,
} = {}) {
  const explicitGUID = normalizeEffectGUID(activationEffect && activationEffect.guid);
  if (explicitGUID) {
    return explicitGUID;
  }

  const resolvedFamily = family || resolveWeaponFamily(moduleItem, chargeItem);
  if (resolvedFamily !== "missileLauncher") {
    return "";
  }

  const chargeGroupID = toInt(chargeItem && chargeItem.groupID, 0);
  const moduleGroupID = toInt(moduleItem && moduleItem.groupID, 0);
  if (
    chargeGroupID === TORPEDO_GROUP_ID ||
    chargeGroupID === XL_TORPEDO_GROUP_ID ||
    moduleGroupID === TORPEDO_LAUNCHER_GROUP_ID ||
    moduleGroupID === XL_TORPEDO_LAUNCHER_GROUP_ID
  ) {
    return TORPEDO_DEPLOYMENT_GUID;
  }

  return MISSILE_DEPLOYMENT_GUID;
}

function resolveWeaponChargeMode(family) {
  return family === "laserTurret" ? "crystal" : "stack";
}

function isTurretWeaponFamily(family) {
  return (
    family === "laserTurret" ||
    family === "hybridTurret" ||
    family === "projectileTurret" ||
    family === "precursorTurret"
  );
}

function isMissileWeaponFamily(family) {
  return family === "missileLauncher";
}

function hasModuleDirectWeaponDamage(typeID) {
  const attributeMap = getTypeAttributeMap(typeID);
  return (
    toFiniteNumber(attributeMap[ATTRIBUTE_EM_DAMAGE], 0) > 0 ||
    toFiniteNumber(attributeMap[ATTRIBUTE_THERMAL_DAMAGE], 0) > 0 ||
    toFiniteNumber(attributeMap[ATTRIBUTE_KINETIC_DAMAGE], 0) > 0 ||
    toFiniteNumber(attributeMap[ATTRIBUTE_EXPLOSIVE_DAMAGE], 0) > 0
  );
}

function isChargeOptionalTurretWeapon(moduleItem, chargeItem = null) {
  if (!moduleItem) {
    return false;
  }

  const family = resolveWeaponFamily(moduleItem, chargeItem);
  if (!isTurretWeaponFamily(family)) {
    return false;
  }

  if (moduleItem.npcSyntheticHullWeapon === true) {
    return true;
  }

  const effectiveModuleItem = buildNpcEffectiveModuleItem(moduleItem);
  const moduleTypeID = toInt(effectiveModuleItem && effectiveModuleItem.typeID, 0);
  if (moduleTypeID <= 0) {
    return false;
  }

  return (
    getModuleChargeGroupIDs(moduleTypeID).size <= 0 &&
    hasModuleDirectWeaponDamage(moduleTypeID)
  );
}

function buildLocationModifiedAttributeMap(
  targetItem,
  shipItem,
  skillMap,
  shipModifierAttributes,
  fittedItems,
  activeModuleContexts,
  options = {},
) {
  if (!targetItem || !shipItem) {
    return {};
  }

  const attributes = cloneAttributeMap(getTypeAttributeMap(targetItem.typeID));
  const modifierEntries = [];
  const resolvedSkillMap = skillMap instanceof Map ? skillMap : new Map();
  const resolvedFittedItems = Array.isArray(fittedItems) ? fittedItems : [];
  const resolvedActiveModuleContexts = Array.isArray(activeModuleContexts)
    ? activeModuleContexts
    : [];
  const excludeItemID = toInt(options.excludeItemID, 0);
  const additionalLocationModifierSources = Array.isArray(
    options.additionalLocationModifierSources,
  )
    ? options.additionalLocationModifierSources
    : [];

  for (const skillRecord of resolvedSkillMap.values()) {
    appendLocationModifierEntries(
      modifierEntries,
      buildSkillEffectiveAttributes(skillRecord),
      getTypeEffectRecords(skillRecord.typeID),
      "skill",
      targetItem,
    );
  }

  appendLocationModifierEntries(
    modifierEntries,
    shipModifierAttributes,
    getTypeEffectRecords(shipItem.typeID),
    "ship",
    targetItem,
  );

  for (const fittedItem of resolvedFittedItems) {
    if (
      !isPassiveModifierSource(fittedItem) ||
      (
        excludeItemID > 0 &&
        toInt(fittedItem && fittedItem.itemID, 0) === excludeItemID
      )
    ) {
      continue;
    }

    appendLocationModifierEntries(
      modifierEntries,
      getTypeAttributeMap(fittedItem.typeID),
      getTypeEffectRecords(fittedItem.typeID),
      "fittedModule",
      targetItem,
    );
  }

  for (const activeModuleContext of resolvedActiveModuleContexts) {
    const activeModuleItem = buildNpcEffectiveModuleItem(
      activeModuleContext && activeModuleContext.moduleItem,
    );
    const activeEffectRecord =
      (activeModuleContext && activeModuleContext.effectRecord) ||
      getEffectTypeRecord(activeModuleContext && activeModuleContext.effectID);
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
      targetItem,
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
      targetItem,
    );
  }

  applyModifierGroups(attributes, modifierEntries);
  return attributes;
}

function collectCharacterModifierAttributes(
  skillMap,
  fittedItems,
  activeModuleContexts,
) {
  const characterAttributes = {
    [ATTRIBUTE_MISSILE_DAMAGE_MULTIPLIER]: 1,
  };
  const modifierEntries = [];
  const resolvedSkillMap = skillMap instanceof Map ? skillMap : new Map();
  const resolvedFittedItems = Array.isArray(fittedItems) ? fittedItems : [];
  const resolvedActiveModuleContexts = Array.isArray(activeModuleContexts)
    ? activeModuleContexts
    : [];

  for (const skillRecord of resolvedSkillMap.values()) {
    appendDirectModifierEntries(
      modifierEntries,
      buildSkillEffectiveAttributes(skillRecord),
      getTypeEffectRecords(skillRecord.typeID),
      "skill",
      CHARACTER_DIRECT_MODIFIER_OPTIONS,
    );
  }

  for (const fittedItem of resolvedFittedItems) {
    if (!isPassiveModifierSource(fittedItem)) {
      continue;
    }

    const passiveSourceEffects = getPassiveModifierEffectRecords(fittedItem.typeID);
    if (passiveSourceEffects.length <= 0) {
      continue;
    }

    appendDirectModifierEntries(
      modifierEntries,
      getTypeAttributeMap(fittedItem.typeID),
      passiveSourceEffects,
      "fittedModule",
      CHARACTER_DIRECT_MODIFIER_OPTIONS,
    );
  }

  for (const activeModuleContext of resolvedActiveModuleContexts) {
    const activeModuleItem = buildNpcEffectiveModuleItem(
      activeModuleContext && activeModuleContext.moduleItem,
    );
    const activeEffectRecord =
      (activeModuleContext && activeModuleContext.effectRecord) ||
      getEffectTypeRecord(activeModuleContext && activeModuleContext.effectID);
    if (!activeModuleItem || !activeEffectRecord) {
      continue;
    }

    appendDirectModifierEntries(
      modifierEntries,
      buildEffectiveItemAttributeMap(
        activeModuleItem,
        activeModuleContext && activeModuleContext.chargeItem,
      ),
      [activeEffectRecord],
      "fittedModule",
      CHARACTER_DIRECT_MODIFIER_OPTIONS,
    );
  }

  applyModifierGroups(characterAttributes, modifierEntries);
  return characterAttributes;
}

function buildSkillEffectiveAttributes(skillRecord) {
  const typeID = toInt(skillRecord && skillRecord.typeID, 0);
  const level = resolveSkillLevel(skillRecord);
  const cacheKey = `${typeID}:${level}`;
  const cache = ensureSkillEffectiveAttributeCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return cloneAttributeMap(cached);
  }

  const attributes = getTypeAttributeMap(typeID);
  attributes[ATTRIBUTE_SKILL_LEVEL] = level;

  for (const effectRecord of getTypeEffectRecords(typeID)) {
    if (String(effectRecord.name || "").toLowerCase() === "skilleffect") {
      continue;
    }
    for (const modifier of effectRecord.modifierInfo || []) {
      if (
        modifier.func !== "ItemModifier" ||
        modifier.domain !== "itemID" ||
        toInt(modifier.modifiedAttributeID, 0) === ATTRIBUTE_SKILL_LEVEL
      ) {
        continue;
      }

      applyDirectModifier(
        attributes,
        modifier.modifiedAttributeID,
        attributes[modifier.modifyingAttributeID],
        modifier.operation,
      );
    }
  }

  const frozen = Object.freeze(attributes);
  cache.set(cacheKey, frozen);
  return cloneAttributeMap(frozen);
}

function applyDirectModifier(attributes, attributeID, rawValue, operation) {
  const numericAttributeID = toInt(attributeID, 0);
  const value = toFiniteNumber(rawValue, NaN);
  if (numericAttributeID <= 0 || !Number.isFinite(value)) {
    return;
  }

  const currentValue = toFiniteNumber(attributes[numericAttributeID], NaN);
  switch (toInt(operation, 0)) {
    case 0:
    case 4: {
      const base = Number.isFinite(currentValue) ? currentValue : 1;
      attributes[numericAttributeID] = round6(base * value);
      break;
    }
    case 2: {
      const base = Number.isFinite(currentValue) ? currentValue : 0;
      attributes[numericAttributeID] = round6(base + value);
      break;
    }
    case 3: {
      const base = Number.isFinite(currentValue) ? currentValue : 0;
      attributes[numericAttributeID] = round6(base - value);
      break;
    }
    case 5: {
      const base = Number.isFinite(currentValue) ? currentValue : 1;
      if (Math.abs(value) > 1e-9) {
        attributes[numericAttributeID] = round6(base / value);
      }
      break;
    }
    case 6: {
      const base = Number.isFinite(currentValue) ? currentValue : 0;
      attributes[numericAttributeID] = round6(base * (1 + (value / 100)));
      break;
    }
    case 7: {
      attributes[numericAttributeID] = round6(value);
      break;
    }
    default:
      break;
  }
}

const SHIP_ITEM_MODIFIER_OPTIONS = Object.freeze({
  allowedDomains: new Set(["shipID"]),
  allowedFuncs: new Set(["ItemModifier"]),
});

function collectShipModifierAttributes(shipItem, skillMap, activeModuleContexts = null) {
  const shipTypeID = toInt(shipItem && shipItem.typeID, 0);
  const resolvedSkillMap = skillMap instanceof Map ? skillMap : new Map();
  const cacheKey = `${shipTypeID}|${buildSkillProfileCacheKey(resolvedSkillMap)}`;
  const cache = ensureShipModifierAttributeCache();
  const cached = cache.get(cacheKey);
  const baseShipAttributes = cached
    ? cloneAttributeMap(cached)
    : (() => {
      const shipAttributes = getTypeAttributeMap(shipTypeID);
      for (const skillRecord of resolvedSkillMap.values()) {
        const effectiveSkillAttributes = buildSkillEffectiveAttributes(skillRecord);
        for (const effectRecord of getTypeEffectRecords(skillRecord.typeID)) {
          for (const modifier of effectRecord.modifierInfo || []) {
            if (
              modifier.func !== "ItemModifier" ||
              modifier.domain !== "shipID"
            ) {
              continue;
            }
            applyDirectModifier(
              shipAttributes,
              modifier.modifiedAttributeID,
              effectiveSkillAttributes[modifier.modifyingAttributeID],
              modifier.operation,
            );
          }
        }
      }
      const frozen = Object.freeze(shipAttributes);
      cache.set(cacheKey, frozen);
      return cloneAttributeMap(frozen);
    })();

  const resolvedActiveModuleContexts = Array.isArray(activeModuleContexts)
    ? activeModuleContexts
    : [];
  if (resolvedActiveModuleContexts.length <= 0) {
    return baseShipAttributes;
  }

  const modifierEntries = [];
  for (const activeModuleContext of resolvedActiveModuleContexts) {
    const activeModuleItem = buildNpcEffectiveModuleItem(
      activeModuleContext && activeModuleContext.moduleItem,
    );
    const activeEffectRecord =
      (activeModuleContext && activeModuleContext.effectRecord) ||
      getEffectTypeRecord(activeModuleContext && activeModuleContext.effectID);
    if (!activeModuleItem || !activeEffectRecord) {
      continue;
    }

    appendDirectModifierEntries(
      modifierEntries,
      buildEffectiveItemAttributeMap(
        activeModuleItem,
        activeModuleContext && activeModuleContext.chargeItem,
      ),
      [activeEffectRecord],
      "fittedModule",
      SHIP_ITEM_MODIFIER_OPTIONS,
    );
  }
  if (modifierEntries.length > 0) {
    applyModifierGroups(baseShipAttributes, modifierEntries);
  }
  return baseShipAttributes;
}

function resolveWeaponFamily(moduleItem, chargeItem = null) {
  const explicitFamily = String(
    moduleItem && (
      moduleItem.npcWeaponFamily ??
      moduleItem.weaponFamily
    ) || "",
  ).trim();
  if (explicitFamily) {
    return explicitFamily;
  }

  const effectiveModuleItem = buildNpcEffectiveModuleItem(moduleItem);
  const moduleTypeID = toInt(effectiveModuleItem && effectiveModuleItem.typeID, 0);
  if (moduleTypeID <= 0) {
    return null;
  }
  const moduleGroupID = toInt(effectiveModuleItem && effectiveModuleItem.groupID, 0);
  const chargeGroupID = toInt(chargeItem && chargeItem.groupID, 0);
  const isMissileLauncher =
    typeHasEffectName(moduleTypeID, "launcherFitted") &&
    typeHasEffectName(moduleTypeID, "useMissiles");
  if (isMissileLauncher) {
    if (STANDARD_MISSILE_CHARGE_GROUP_IDS.has(chargeGroupID)) {
      return "missileLauncher";
    }

    const moduleChargeGroupIDs = getModuleChargeGroupIDs(moduleTypeID);
    for (const standardChargeGroupID of STANDARD_MISSILE_CHARGE_GROUP_IDS) {
      if (moduleChargeGroupIDs.has(standardChargeGroupID)) {
        return "missileLauncher";
      }
    }

    if (STANDARD_MISSILE_LAUNCHER_GROUP_IDS.has(moduleGroupID)) {
      return "missileLauncher";
    }
  }

  const isTurret = typeHasEffectName(
    moduleTypeID,
    "turretFitted",
  );
  if (!isTurret) {
    return null;
  }

  const familyFromChargeGroup = WEAPON_FAMILY_BY_CHARGE_GROUP_ID[chargeGroupID] || null;
  if (familyFromChargeGroup) {
    return familyFromChargeGroup;
  }

  const moduleChargeGroupIDs = getModuleChargeGroupIDs(moduleTypeID);
  for (const [rawChargeGroupID, family] of Object.entries(WEAPON_FAMILY_BY_CHARGE_GROUP_ID)) {
    if (moduleChargeGroupIDs.has(toInt(rawChargeGroupID, 0))) {
      return family;
    }
  }

  return WEAPON_FAMILY_BY_MODULE_GROUP_ID[moduleGroupID] || null;
}

function buildMissileModuleSnapshot({
  shipItem,
  moduleItem,
  chargeItem,
  fittedItems,
  skillMap,
  activeModuleContexts,
  effectiveModuleItem,
  family = "missileLauncher",
  additionalLocationModifierSources = null,
  directModuleModifierEntries = null,
  directChargeModifierEntries = null,
} = {}) {
  if (!shipItem || !moduleItem || !chargeItem) {
    return null;
  }

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
  const resolvedDirectModuleModifierEntries = Array.isArray(directModuleModifierEntries)
    ? directModuleModifierEntries
    : [];
  const resolvedDirectChargeModifierEntries = Array.isArray(directChargeModifierEntries)
    ? directChargeModifierEntries
    : [];
  const shipModifierAttributes = collectShipModifierAttributes(
    shipItem,
    resolvedSkillMap,
    resolvedActiveModuleContexts,
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
  const chargeAttributes = buildLocationModifiedAttributeMap(
    chargeItem,
    shipItem,
    resolvedSkillMap,
    shipModifierAttributes,
    resolvedFittedItems,
    resolvedActiveModuleContexts,
    {
      additionalLocationModifierSources: resolvedAdditionalLocationModifierSources,
    },
  );
  applyOtherItemModifiersToAttributes(moduleAttributes, chargeItem);
  applyOtherItemModifiersToAttributes(chargeAttributes, effectiveModuleItem);
  applyModifierGroups(moduleAttributes, resolvedDirectModuleModifierEntries);
  applyModifierGroups(chargeAttributes, resolvedDirectChargeModifierEntries);

  const characterAttributes = collectCharacterModifierAttributes(
    resolvedSkillMap,
    resolvedFittedItems,
    resolvedActiveModuleContexts,
  );
  const activationEffect = resolveWeaponActivationEffect(effectiveModuleItem.typeID);
  const chargeMode = resolveWeaponChargeMode(family);
  const missileDamageMultiplier = Math.max(
    0,
    toFiniteNumber(characterAttributes[ATTRIBUTE_MISSILE_DAMAGE_MULTIPLIER], 1),
  );
  const baseDamage = {
    em: Math.max(0, toFiniteNumber(chargeAttributes[ATTRIBUTE_EM_DAMAGE], 0)),
    thermal: Math.max(0, toFiniteNumber(chargeAttributes[ATTRIBUTE_THERMAL_DAMAGE], 0)),
    kinetic: Math.max(0, toFiniteNumber(chargeAttributes[ATTRIBUTE_KINETIC_DAMAGE], 0)),
    explosive: Math.max(0, toFiniteNumber(chargeAttributes[ATTRIBUTE_EXPLOSIVE_DAMAGE], 0)),
  };

  const flightTimeMs = Math.max(
    1,
    round6(toFiniteNumber(chargeAttributes[ATTRIBUTE_EXPLOSION_DELAY], 1000)),
  );
  const maxVelocity = Math.max(
    0,
    round6(toFiniteNumber(chargeAttributes[ATTRIBUTE_MAX_VELOCITY], 0)),
  );

  return {
    family,
    moduleID: toInt(moduleItem.itemID, 0),
    moduleTypeID: toInt(moduleItem.typeID, 0),
    chargeItemID: toInt(chargeItem.itemID, 0),
    chargeTypeID: toInt(chargeItem.typeID, 0),
    chargeMode,
    chargeQuantity: Math.max(
      0,
      toInt(chargeItem && (chargeItem.stacksize ?? chargeItem.quantity), 0),
    ),
    activationEffectID: toInt(activationEffect && activationEffect.effectID, 0),
    activationEffectName: String(activationEffect && activationEffect.name || ""),
    effectGUID: resolveWeaponSpecialFxGUID({
      family,
      moduleItem: effectiveModuleItem,
      chargeItem,
      activationEffect,
    }),
    durationMs: Math.max(1, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_SPEED], 1000))),
    capNeed: Math.max(0, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_CAPACITOR_NEED], 0))),
    damageMultiplier: missileDamageMultiplier,
    baseDamage,
    rawShotDamage: {
      em: round6(baseDamage.em * missileDamageMultiplier),
      thermal: round6(baseDamage.thermal * missileDamageMultiplier),
      kinetic: round6(baseDamage.kinetic * missileDamageMultiplier),
      explosive: round6(baseDamage.explosive * missileDamageMultiplier),
    },
    maxVelocity,
    flightTimeMs,
    explosionRadius: Math.max(
      1,
      round6(toFiniteNumber(chargeAttributes[ATTRIBUTE_AOE_CLOUD_SIZE], 1)),
    ),
    explosionVelocity: Math.max(
      0.001,
      round6(toFiniteNumber(chargeAttributes[ATTRIBUTE_AOE_VELOCITY], 0.001)),
    ),
    damageReductionFactor: clamp(
      toFiniteNumber(chargeAttributes[ATTRIBUTE_AOE_DAMAGE_REDUCTION_FACTOR], 1),
      0.000001,
      1,
    ),
    damageReductionSensitivity: Math.max(
      0.000001,
      round6(toFiniteNumber(
        chargeAttributes[ATTRIBUTE_AOE_DAMAGE_REDUCTION_SENSITIVITY],
        DEFAULT_MISSILE_DAMAGE_REDUCTION_SENSITIVITY,
      )),
    ),
    approxRange: round6(maxVelocity * (flightTimeMs / 1000)),
    moduleAttributes,
    chargeAttributes,
    shipModifierAttributes,
    characterAttributes,
  };
}

function buildWeaponModuleSnapshot({
  characterID,
  shipItem,
  moduleItem,
  chargeItem = null,
  fittedItems = null,
  skillMap = null,
  activeModuleContexts = null,
  additionalLocationModifierSources = null,
  directModuleModifierEntries = null,
  directChargeModifierEntries = null,
} = {}) {
  if (!shipItem || !moduleItem) {
    return null;
  }

  const effectiveModuleItem = buildNpcEffectiveModuleItem(moduleItem);
  const family = resolveWeaponFamily(effectiveModuleItem, chargeItem);
  const chargeOptionalTurretWeapon = isChargeOptionalTurretWeapon(
    effectiveModuleItem,
    chargeItem,
  );
  if (isMissileWeaponFamily(family)) {
    if (!chargeItem) {
      return null;
    }

    const resolvedFittedItems = Array.isArray(fittedItems)
      ? fittedItems
      : listFittedItems(characterID, shipItem.itemID);
    const resolvedSkillMap = skillMap instanceof Map
      ? skillMap
      : getCharacterSkillMap(characterID);
    const resolvedActiveModuleContexts = Array.isArray(activeModuleContexts)
      ? activeModuleContexts
      : [];

    return buildMissileModuleSnapshot({
      shipItem,
      moduleItem,
      chargeItem,
      fittedItems: resolvedFittedItems,
      skillMap: resolvedSkillMap,
      activeModuleContexts: resolvedActiveModuleContexts,
      effectiveModuleItem,
      family,
      additionalLocationModifierSources,
      directModuleModifierEntries,
      directChargeModifierEntries,
    });
  }
  if (!isTurretWeaponFamily(family)) {
    return null;
  }

  const resolvedFittedItems = Array.isArray(fittedItems)
    ? fittedItems
    : listFittedItems(characterID, shipItem.itemID);
  const resolvedSkillMap = skillMap instanceof Map
    ? skillMap
    : getCharacterSkillMap(characterID);
  const resolvedActiveModuleContexts = Array.isArray(activeModuleContexts)
    ? activeModuleContexts
    : [];
  const resolvedAdditionalLocationModifierSources = Array.isArray(
    additionalLocationModifierSources,
  )
    ? additionalLocationModifierSources
    : [];
  const resolvedDirectModuleModifierEntries = Array.isArray(directModuleModifierEntries)
    ? directModuleModifierEntries
    : [];
  const resolvedDirectChargeModifierEntries = Array.isArray(directChargeModifierEntries)
    ? directChargeModifierEntries
    : [];
  const shipModifierAttributes = collectShipModifierAttributes(
    shipItem,
    resolvedSkillMap,
    resolvedActiveModuleContexts,
  );
  const moduleAttributes = Boolean(
    moduleItem &&
    moduleItem.npcSyntheticHullWeapon === true &&
    toInt(effectiveModuleItem.typeID, 0) === toInt(shipItem.typeID, 0),
  )
    ? cloneAttributeMap(shipModifierAttributes)
    : cloneAttributeMap(getTypeAttributeMap(effectiveModuleItem.typeID));
  const modifierEntries = [];
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
      toInt(fittedItem.itemID, 0) === toInt(moduleItem.itemID, 0)
    ) {
      continue;
    }

    appendLocationModifierEntries(
      modifierEntries,
      getTypeAttributeMap(fittedItem.typeID),
      getTypeEffectRecords(fittedItem.typeID),
      "fittedModule",
      effectiveModuleItem,
    );
  }

  for (const activeModuleContext of resolvedActiveModuleContexts) {
    const activeModuleItem = buildNpcEffectiveModuleItem(
      activeModuleContext && activeModuleContext.moduleItem,
    );
    const activeEffectRecord =
      (activeModuleContext && activeModuleContext.effectRecord) ||
      getEffectTypeRecord(activeModuleContext && activeModuleContext.effectID);
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

  for (const source of resolvedAdditionalLocationModifierSources) {
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

  applyModifierGroups(moduleAttributes, modifierEntries);
  applyOtherItemModifiersToAttributes(moduleAttributes, chargeItem);
  applyOtherItemModifiersToAttributes(chargeAttributes, effectiveModuleItem);
  applyModifierGroups(moduleAttributes, resolvedDirectModuleModifierEntries);
  applyModifierGroups(chargeAttributes, resolvedDirectChargeModifierEntries);

  const damageMultiplier = Math.max(
    0,
    toFiniteNumber(moduleAttributes[ATTRIBUTE_DAMAGE_MULTIPLIER], 1),
  );
  const activationEffect = resolveWeaponActivationEffect(effectiveModuleItem.typeID);
  const chargeMode = resolveWeaponChargeMode(family);
  const damageSourceAttributes =
    chargeItem || !chargeOptionalTurretWeapon
      ? chargeAttributes
      : moduleAttributes;
  const chargeDamage = {
    em: Math.max(0, toFiniteNumber(damageSourceAttributes[ATTRIBUTE_EM_DAMAGE], 0)),
    thermal: Math.max(0, toFiniteNumber(damageSourceAttributes[ATTRIBUTE_THERMAL_DAMAGE], 0)),
    kinetic: Math.max(0, toFiniteNumber(damageSourceAttributes[ATTRIBUTE_KINETIC_DAMAGE], 0)),
    explosive: Math.max(0, toFiniteNumber(damageSourceAttributes[ATTRIBUTE_EXPLOSIVE_DAMAGE], 0)),
  };

  return {
    family,
    moduleID: toInt(moduleItem.itemID, 0),
    moduleTypeID: toInt(moduleItem.typeID, 0),
    chargeItemID: toInt(chargeItem && chargeItem.itemID, 0),
    chargeTypeID: toInt(chargeItem && chargeItem.typeID, 0),
    chargeMode,
    chargeQuantity: Math.max(
      0,
      toInt(chargeItem && (chargeItem.stacksize ?? chargeItem.quantity), 0),
    ),
    activationEffectID: toInt(activationEffect && activationEffect.effectID, 0),
    activationEffectName: String(activationEffect && activationEffect.name || ""),
    effectGUID: resolveWeaponSpecialFxGUID({
      family,
      moduleItem: effectiveModuleItem,
      chargeItem,
      activationEffect,
    }),
    durationMs: Math.max(1, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_SPEED], 1000))),
    capNeed: Math.max(0, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_CAPACITOR_NEED], 0))),
    optimalRange: Math.max(0, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_MAX_RANGE], 0))),
    falloff: Math.max(0, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_FALLOFF], 0))),
    trackingSpeed: Math.max(0, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_TRACKING_SPEED], 0))),
    optimalSigRadius: Math.max(
      1,
      round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_OPTIMAL_SIG_RADIUS], 40000)),
    ),
    damageMultiplier,
    baseDamage: chargeDamage,
    rawShotDamage: {
      em: round6(chargeDamage.em * damageMultiplier),
      thermal: round6(chargeDamage.thermal * damageMultiplier),
      kinetic: round6(chargeDamage.kinetic * damageMultiplier),
      explosive: round6(chargeDamage.explosive * damageMultiplier),
    },
    moduleAttributes,
    chargeAttributes,
    shipModifierAttributes,
  };
}

function buildWeaponDogmaAttributeOverrides(options = {}) {
  const snapshot = buildWeaponModuleSnapshot(options);
  if (!snapshot) {
    return null;
  }

  return {
    family: snapshot.family || null,
    moduleAttributes: cloneAttributeMap(snapshot.moduleAttributes || {}),
    chargeAttributes: cloneAttributeMap(snapshot.chargeAttributes || {}),
    shipModifierAttributes: cloneAttributeMap(snapshot.shipModifierAttributes || {}),
    characterAttributes: cloneAttributeMap(snapshot.characterAttributes || {}),
    snapshot,
  };
}

module.exports = {
  ENERGY_TURRET_GROUP_ID,
  PROJECTILE_TURRET_GROUP_ID,
  HYBRID_TURRET_GROUP_ID,
  PROJECTILE_AMMO_GROUP_ID,
  HYBRID_CHARGE_GROUP_ID,
  FREQUENCY_CRYSTAL_GROUP_ID,
  buildSkillEffectiveAttributes,
  collectShipModifierAttributes,
  collectCharacterModifierAttributes,
  buildLocationModifiedAttributeMap,
  isTurretWeaponFamily,
  isMissileWeaponFamily,
  isChargeOptionalTurretWeapon,
  resolveWeaponFamily,
  resolveWeaponSpecialFxGUID,
  buildWeaponModuleSnapshot,
  buildWeaponDogmaAttributeOverrides,
};
