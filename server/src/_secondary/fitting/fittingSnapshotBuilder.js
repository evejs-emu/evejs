const path = require("path");

const {
  findCharacterShipItem,
  findItemById,
  findShipItemById,
} = require(path.join(__dirname, "../../services/inventory/itemStore"));
const {
  getAttributeIDByNames,
  getEffectiveModuleResourceLoad,
  isShipFittingFlag,
  listFittedItems,
  buildShipResourceState,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  collectAssumedActiveFittingEffects,
} = require(path.join(__dirname, "./assumedActiveFittingEffects"));
const {
  resolveStructureEffectiveHitpoints,
} = require(path.join(
  __dirname,
  "../../services/structure/structureFullPowerDogma",
));

const CHARGE_CATEGORY_ID = 8;
const STRUCTURE_CATEGORY_ID = 65;
const ATTRIBUTE_MODULE_POWER_NEED = getAttributeIDByNames("power") || 30;
const ATTRIBUTE_MODULE_CPU_NEED = getAttributeIDByNames("cpu") || 50;
const ATTRIBUTE_SHIELD_CAPACITY = getAttributeIDByNames("shieldCapacity") || 263;
const ATTRIBUTE_ARMOR_HP = getAttributeIDByNames("armorHP") || 265;
const ATTRIBUTE_STRUCTURE_HP = getAttributeIDByNames("hp", "structureHP") || 9;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveShipReferenceID(shipReference, options = {}) {
  return toInt(
    shipReference && typeof shipReference === "object"
      ? shipReference.itemID
      : shipReference,
    toInt(options.shipID, toInt(options.shipItem && options.shipItem.itemID, 0)),
  );
}

function cloneShipLikeItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  if (toInt(item.itemID, 0) <= 0 && toInt(item.typeID, 0) <= 0) {
    return null;
  }
  return { ...item };
}

function resolveSnapshotShipItem(characterID, shipReference, options = {}) {
  const referencedShipID = resolveShipReferenceID(shipReference, options);
  const optionShip = cloneShipLikeItem(options.shipItem);
  if (
    optionShip &&
    (referencedShipID <= 0 || toInt(optionShip.itemID, 0) === referencedShipID)
  ) {
    return optionShip;
  }

  const referenceShip = cloneShipLikeItem(shipReference);
  if (referenceShip) {
    return referenceShip;
  }

  if (characterID > 0 && referencedShipID > 0) {
    const characterShip = findCharacterShipItem(characterID, referencedShipID);
    if (characterShip) {
      return characterShip;
    }
  }

  if (referencedShipID > 0) {
    return findShipItemById(referencedShipID) || findItemById(referencedShipID);
  }

  return null;
}

function getSnapshotFittedItems(characterID, shipID, options = {}) {
  if (Array.isArray(options.fittedItems)) {
    return options.fittedItems.filter(Boolean).map((item) => ({ ...item }));
  }
  if (shipID <= 0) {
    return [];
  }
  return listFittedItems(characterID, shipID);
}

function isModuleInSnapshot(snapshot, moduleItem) {
  if (
    !snapshot ||
    !moduleItem ||
    Number(moduleItem.categoryID) === CHARGE_CATEGORY_ID ||
    !isShipFittingFlag(moduleItem.flagID)
  ) {
    return false;
  }

  const moduleLocationID = toInt(moduleItem.locationID, 0);
  if (snapshot.shipID > 0 && moduleLocationID !== snapshot.shipID) {
    return false;
  }

  const moduleOwnerID = toInt(moduleItem.ownerID, 0);
  return snapshot.characterID <= 0 || moduleOwnerID === snapshot.characterID;
}

function buildResourceStateForItems(snapshot, fittedItems) {
  if (!snapshot || !snapshot.shipItem) {
    return null;
  }
  return buildSnapshotResourceState(
    snapshot.characterID,
    snapshot.shipItem,
    Array.isArray(fittedItems) ? fittedItems : snapshot.fittedItems,
    snapshot.skillMap,
    {
      assumeActiveShipModules: snapshot.assumeActiveShipModules !== false,
    },
  ).resourceState;
}

function getSnapshotModuleResourceLoad(snapshot, moduleItem, fittedItems = null) {
  if (!snapshot || !moduleItem) {
    return {
      cpuLoad: 0,
      powerLoad: 0,
    };
  }

  const effectiveFittedItems = Array.isArray(fittedItems)
    ? fittedItems
    : snapshot.fittedItems;
  return getEffectiveModuleResourceLoad(
    snapshot.shipItem,
    moduleItem,
    snapshot.skillMap,
    effectiveFittedItems,
  );
}

function buildSnapshotModuleAttributeOverrides(snapshot, moduleItem) {
  if (!isModuleInSnapshot(snapshot, moduleItem)) {
    return null;
  }

  const resourceLoad = getSnapshotModuleResourceLoad(snapshot, moduleItem);
  return {
    [ATTRIBUTE_MODULE_CPU_NEED]: toFiniteNumber(resourceLoad.cpuLoad, 0),
    [ATTRIBUTE_MODULE_POWER_NEED]: toFiniteNumber(resourceLoad.powerLoad, 0),
  };
}

function buildOnlineCandidateResourceState(snapshot, moduleItem) {
  if (!isModuleInSnapshot(snapshot, moduleItem)) {
    return null;
  }

  const moduleID = toInt(moduleItem.itemID, 0);
  const baselineFittedItems = snapshot.fittedItems.filter(
    (item) => toInt(item && item.itemID, 0) !== moduleID,
  );
  const baselineResourceState = buildResourceStateForItems(
    snapshot,
    baselineFittedItems,
  );
  if (!baselineResourceState) {
    return null;
  }

  const moduleResourceLoad = getSnapshotModuleResourceLoad(
    {
      ...snapshot,
      skillMap: baselineResourceState.skillMap || snapshot.skillMap,
    },
    moduleItem,
    baselineFittedItems,
  );

  return {
    baselineFittedItems,
    baselineResourceState,
    moduleResourceLoad,
    cpuAfter:
      toFiniteNumber(baselineResourceState.cpuLoad, 0) +
      toFiniteNumber(moduleResourceLoad.cpuLoad, 0),
    powerAfter:
      toFiniteNumber(baselineResourceState.powerLoad, 0) +
      toFiniteNumber(moduleResourceLoad.powerLoad, 0),
  };
}

function buildSnapshotResourceState(
  characterID,
  shipItem,
  fittedItems,
  skillMap = null,
  options = {},
) {
  const assumeActiveShipModules =
    options.assumeActiveShipModules !== undefined
      ? options.assumeActiveShipModules === true
      : true;
  const normalizedFittedItems = Array.isArray(fittedItems) ? fittedItems : [];
  const baseResourceState = buildShipResourceState(characterID, shipItem, {
    ...options,
    assumeActiveShipModules,
    fittedItems: normalizedFittedItems,
    skillMap,
  });
  const resolvedSkillMap =
    baseResourceState && baseResourceState.skillMap instanceof Map
      ? baseResourceState.skillMap
      : skillMap instanceof Map
        ? skillMap
        : new Map();

  if (!assumeActiveShipModules) {
    return {
      resourceState: baseResourceState,
      assumeActiveShipModules,
      assumedActiveModuleContexts: [],
    };
  }

  const assumedActiveEffects = collectAssumedActiveFittingEffects({
    shipItem,
    fittedItems:
      (baseResourceState && baseResourceState.fittedItems) || normalizedFittedItems,
    skillMap: resolvedSkillMap,
  });
  const shipAttributeModifierEntries = Array.isArray(
    assumedActiveEffects && assumedActiveEffects.shipAttributeModifierEntries,
  )
    ? assumedActiveEffects.shipAttributeModifierEntries
    : [];
  const assumedActiveModuleContexts = Array.isArray(
    assumedActiveEffects && assumedActiveEffects.activeModuleContexts,
  )
    ? assumedActiveEffects.activeModuleContexts
    : [];

  if (shipAttributeModifierEntries.length <= 0) {
    return {
      resourceState: baseResourceState,
      assumeActiveShipModules,
      assumedActiveModuleContexts,
    };
  }

  return {
    resourceState: buildShipResourceState(characterID, shipItem, {
      ...options,
      assumeActiveShipModules,
      fittedItems:
        (baseResourceState && baseResourceState.fittedItems) || normalizedFittedItems,
      skillMap: resolvedSkillMap,
      additionalAttributeModifierEntries: shipAttributeModifierEntries,
    }),
    assumeActiveShipModules,
    assumedActiveModuleContexts,
  };
}

function applyStructureEffectiveHitpointsToSnapshot(resourceState, shipItem) {
  if (
    !resourceState ||
    !shipItem ||
    toInt(shipItem.categoryID, 0) !== STRUCTURE_CATEGORY_ID
  ) {
    return resourceState;
  }
  const effectiveHitpoints = resolveStructureEffectiveHitpoints({
    structureID: shipItem.itemID,
    typeID: shipItem.typeID,
    shieldCapacity: shipItem.shieldCapacity,
    armorHP: shipItem.armorHP,
    hullHP: shipItem.hullHP ?? shipItem.structureHP,
  });
  if (!resourceState.attributes || typeof resourceState.attributes !== "object") {
    resourceState.attributes = {};
  }
  resourceState.attributes[ATTRIBUTE_SHIELD_CAPACITY] =
    effectiveHitpoints.effectiveShieldCapacity;
  resourceState.attributes[ATTRIBUTE_ARMOR_HP] = effectiveHitpoints.effectiveArmorHP;
  resourceState.attributes[ATTRIBUTE_STRUCTURE_HP] =
    effectiveHitpoints.effectiveStructureHP;
  resourceState.shieldCapacity = effectiveHitpoints.effectiveShieldCapacity;
  resourceState.armorHP = effectiveHitpoints.effectiveArmorHP;
  resourceState.structureHP = effectiveHitpoints.effectiveStructureHP;
  resourceState.fullPowerDogma = effectiveHitpoints.fullPowerDogma;
  return resourceState;
}

function buildFittingSnapshot(characterID, shipReference, options = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const shipItem = resolveSnapshotShipItem(
    numericCharacterID,
    shipReference,
    options,
  );
  if (!shipItem) {
    return null;
  }

  const shipID = toInt(shipItem.itemID, resolveShipReferenceID(shipReference, options));
  const fittedItems = getSnapshotFittedItems(
    numericCharacterID,
    shipID,
    options,
  );
  const snapshotResourceState = buildSnapshotResourceState(
    numericCharacterID,
    shipItem,
    fittedItems,
    null,
    options,
  );
  const resourceState = applyStructureEffectiveHitpointsToSnapshot(
    snapshotResourceState.resourceState,
    shipItem,
  );
  const snapshot = {
    characterID: numericCharacterID,
    shipID,
    shipItem,
    fittedItems: resourceState.fittedItems || fittedItems,
    assumeActiveShipModules:
      snapshotResourceState.assumeActiveShipModules !== false,
    assumedActiveModuleContexts:
      snapshotResourceState.assumedActiveModuleContexts || [],
    skillMap:
      resourceState.skillMap instanceof Map
        ? resourceState.skillMap
        : new Map(),
    resourceState,
    shipAttributes: {
      ...(resourceState && resourceState.attributes
        ? resourceState.attributes
        : {}),
    },
  };

  return {
    ...snapshot,
    buildResourceStateForItems: (nextFittedItems) =>
      buildResourceStateForItems(snapshot, nextFittedItems),
    getModuleResourceLoad: (moduleItem, nextFittedItems = null) =>
      getSnapshotModuleResourceLoad(snapshot, moduleItem, nextFittedItems),
    getModuleAttributeOverrides: (moduleItem) =>
      buildSnapshotModuleAttributeOverrides(snapshot, moduleItem),
    buildOnlineCandidateResourceState: (moduleItem) =>
      buildOnlineCandidateResourceState(snapshot, moduleItem),
  };
}

module.exports = {
  ATTRIBUTE_MODULE_POWER_NEED,
  ATTRIBUTE_MODULE_CPU_NEED,
  buildFittingSnapshot,
};
