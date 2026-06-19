const path = require("path");

const {
  getSystemEnvironment,
} = require("./wormholeAuthority");
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../inventory/itemTypeRegistry"));
const {
  buildDict,
  buildPythonSet,
} = require(path.join(__dirname, "../../_shared/serviceHelpers"));
const {
  getTypeAttributeMap,
  getTypeEffectRecords,
  appendDirectModifierEntries,
} = require(path.join(__dirname, "../../fitting/liveFittingState"));

const SECONDARY_SUN_ITEM_ID_BASE = 9_940_000_000_000;
const EFFECT_BEACON_ITEM_ID_BASE = 9_941_000_000_000;
const SECONDARY_SUN_GROUP_ID = 995;
const SECONDARY_SUN_CATEGORY_ID = 2;
const EFFECT_BEACON_GROUP_ID = 920;
const EFFECT_BEACON_CATEGORY_ID = 2;

const cacheBySystemID = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(source = null) {
  return {
    x: toFiniteNumber(source && source.x, 0),
    y: toFiniteNumber(source && source.y, 0),
    z: toFiniteNumber(source && source.z, 0),
  };
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildTuple(items = []) {
  return {
    type: "tuple",
    items: Array.isArray(items) ? items : [],
  };
}

function buildDescriptor(systemID) {
  const numericSystemID = toInt(systemID, 0);
  if (numericSystemID <= 0) {
    return null;
  }

  const environment = getSystemEnvironment(numericSystemID);
  if (
    !environment ||
    toInt(environment.environmentTypeID, 0) <= 0 ||
    toInt(environment.environmentEffectTypeID, 0) <= 0
  ) {
    return null;
  }

  const secondarySunType = resolveItemByTypeID(
    toInt(environment.environmentTypeID, 0),
  ) || null;
  const effectType = resolveItemByTypeID(
    toInt(environment.environmentEffectTypeID, 0),
  ) || null;
  const sourceAttributes = Object.freeze({
    ...getTypeAttributeMap(toInt(environment.environmentEffectTypeID, 0)),
  });
  const sourceEffects = Object.freeze([
    ...getTypeEffectRecords(toInt(environment.environmentEffectTypeID, 0)),
  ]);

  const shipAttributeModifierEntries = [];
  appendDirectModifierEntries(
    shipAttributeModifierEntries,
    sourceAttributes,
    sourceEffects,
    "system",
    {
      allowedDomains: new Set(["shipID"]),
      allowedFuncs: new Set(["ItemModifier"]),
      stackingPenalized: false,
    },
  );

  return Object.freeze({
    systemID: numericSystemID,
    environmentFamily: String(environment.environmentFamily || "").trim() || null,
    environmentTypeID: toInt(environment.environmentTypeID, 0),
    environmentName: String(environment.environmentName || "").trim() || null,
    environmentPosition: cloneVector(environment.environmentPosition),
    environmentEffectTypeID: toInt(environment.environmentEffectTypeID, 0),
    environmentEffectTypeName:
      String(environment.environmentEffectTypeName || "").trim() || null,
    secondarySunType,
    effectType,
    sourceAttributes,
    sourceEffects,
    shipAttributeModifierEntries: Object.freeze(
      shipAttributeModifierEntries.map((entry) => Object.freeze({ ...entry })),
    ),
    locationModifierSources: Object.freeze([
      Object.freeze({
        sourceKind: "system",
        sourceAttributes,
        sourceEffects,
      }),
    ]),
  });
}

function getSystemEnvironmentDescriptor(systemID) {
  const numericSystemID = toInt(systemID, 0);
  if (numericSystemID <= 0) {
    return null;
  }
  if (!cacheBySystemID.has(numericSystemID)) {
    cacheBySystemID.set(numericSystemID, buildDescriptor(numericSystemID));
  }
  return cacheBySystemID.get(numericSystemID) || null;
}

function collectShipAttributeModifierEntriesForSystem(systemID) {
  const descriptor = getSystemEnvironmentDescriptor(systemID);
  return descriptor
    ? descriptor.shipAttributeModifierEntries.map((entry) => ({ ...entry }))
    : [];
}

function getLocationModifierSourcesForSystem(systemID) {
  const descriptor = getSystemEnvironmentDescriptor(systemID);
  return descriptor ? [...descriptor.locationModifierSources] : [];
}

function buildSystemWideEffectsPayloadForSystem(systemID) {
  const descriptor = getSystemEnvironmentDescriptor(systemID);
  if (!descriptor || toInt(descriptor.environmentEffectTypeID, 0) <= 0) {
    return null;
  }

  const sourceItemID = EFFECT_BEACON_ITEM_ID_BASE + toInt(descriptor.systemID, 0);
  const sourceTypeID = toInt(descriptor.environmentEffectTypeID, 0);
  const effectIDs = [...new Set(
    (Array.isArray(descriptor.sourceEffects) ? descriptor.sourceEffects : [])
      .map((effectRecord) => toInt(effectRecord && effectRecord.effectID, 0))
      .filter((effectID) => effectID > 0),
  )].sort((left, right) => left - right);

  return buildDict([
    [
      buildTuple([sourceItemID, sourceTypeID]),
      buildPythonSet(effectIDs),
    ],
  ]);
}

function buildEmptySystemWideEffectsPayload() {
  return buildDict([]);
}

function buildSecondarySunEntity(systemID) {
  const descriptor = getSystemEnvironmentDescriptor(systemID);
  if (!descriptor) {
    return null;
  }

  const secondarySunType = descriptor.secondarySunType || null;
  const itemID = SECONDARY_SUN_ITEM_ID_BASE + toInt(descriptor.systemID, 0);
  return {
    kind: "secondarySun",
    itemID,
    typeID: toInt(descriptor.environmentTypeID, 0),
    groupID: toInt(secondarySunType && secondarySunType.groupID, SECONDARY_SUN_GROUP_ID),
    categoryID: toInt(
      secondarySunType && secondarySunType.categoryID,
      SECONDARY_SUN_CATEGORY_ID,
    ),
    itemName:
      String((secondarySunType && secondarySunType.name) || descriptor.environmentName || "").trim() ||
      `Secondary Sun ${descriptor.systemID}`,
    ownerID: 1,
    radius: Math.max(1, toFiniteNumber(secondarySunType && secondarySunType.radius, 10000)),
    graphicID: toInt(secondarySunType && secondarySunType.graphicID, 0),
    position: cloneVector(descriptor.environmentPosition),
    velocity: { x: 0, y: 0, z: 0 },
    environmentFamily: descriptor.environmentFamily,
    environmentEffectTypeID: descriptor.environmentEffectTypeID,
    environmentEffectTypeName: descriptor.environmentEffectTypeName,
  };
}

function buildEffectBeaconEntity(systemID) {
  const descriptor = getSystemEnvironmentDescriptor(systemID);
  if (!descriptor) {
    return null;
  }

  const effectType = descriptor.effectType || null;
  const itemID = EFFECT_BEACON_ITEM_ID_BASE + toInt(descriptor.systemID, 0);
  return {
    kind: "effectBeacon",
    itemID,
    typeID: toInt(descriptor.environmentEffectTypeID, 0),
    groupID: toInt(effectType && effectType.groupID, EFFECT_BEACON_GROUP_ID),
    categoryID: toInt(
      effectType && effectType.categoryID,
      EFFECT_BEACON_CATEGORY_ID,
    ),
    itemName:
      String(
        (effectType && effectType.name) ||
          descriptor.environmentEffectTypeName ||
          descriptor.environmentName ||
          "",
      ).trim() || `Wormhole Effect Beacon ${descriptor.systemID}`,
    ownerID: 1,
    radius: Math.max(1, toFiniteNumber(effectType && effectType.radius, 10000)),
    graphicID: toInt(effectType && effectType.graphicID, 0),
    position: cloneVector(descriptor.environmentPosition),
    velocity: { x: 0, y: 0, z: 0 },
    environmentFamily: descriptor.environmentFamily,
    environmentEffectTypeID: descriptor.environmentEffectTypeID,
    environmentEffectTypeName: descriptor.environmentEffectTypeName,
  };
}

function clearCache() {
  cacheBySystemID.clear();
}

module.exports = {
  SECONDARY_SUN_ITEM_ID_BASE,
  EFFECT_BEACON_ITEM_ID_BASE,
  getSystemEnvironmentDescriptor,
  collectShipAttributeModifierEntriesForSystem,
  getLocationModifierSourcesForSystem,
  buildSystemWideEffectsPayloadForSystem,
  buildEmptySystemWideEffectsPayload,
  buildSecondarySunEntity,
  buildEffectBeaconEntity,
  clearCache,
  _testing: {
    buildDescriptor,
    cloneValue,
  },
};
