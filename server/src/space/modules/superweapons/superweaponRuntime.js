const path = require("path");

const worldData = require(path.join(__dirname, "../../worldData"));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../../../services/skills/skillState"));
const {
  getAttributeIDByNames,
  getTypeAttributeMap,
  typeHasEffectName,
} = require(path.join(__dirname, "../../../services/fitting/liveFittingState"));
const {
  resolveTitanSuperweaponProfileByModuleTypeID,
} = require(path.join(__dirname, "../../../services/superweapons/superweaponCatalog"));
const {
  buildLiveModuleAttributeMap,
} = require(path.join(__dirname, "../liveModuleAttributes"));
const {
  getFuelStacksForShipStorage,
  getFuelQuantityFromStacks,
  consumeFuelFromShipStorage,
} = require(path.join(__dirname, "../sharedFuelRuntime"));
const {
  hasDamageableHealth,
  sumDamageVector,
} = require(path.join(__dirname, "../../combat/damage"));

function getStructureTethering() {
  return require(path.join(__dirname, "../../structureTethering"));
}

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_EM_DAMAGE = getAttributeIDByNames("emDamage") || 114;
const ATTRIBUTE_EXPLOSIVE_DAMAGE =
  getAttributeIDByNames("explosiveDamage") || 116;
const ATTRIBUTE_KINETIC_DAMAGE = getAttributeIDByNames("kineticDamage") || 117;
const ATTRIBUTE_THERMAL_DAMAGE = getAttributeIDByNames("thermalDamage") || 118;
const ATTRIBUTE_SIGNATURE_RADIUS =
  getAttributeIDByNames("signatureRadius") || 552;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_DAMAGE_DELAY_DURATION =
  getAttributeIDByNames("damageDelayDuration") || 561;
const ATTRIBUTE_CONSUMPTION_TYPE =
  getAttributeIDByNames("consumptionType") || 713;
const ATTRIBUTE_CONSUMPTION_QUANTITY =
  getAttributeIDByNames("consumptionQuantity") || 714;
const ATTRIBUTE_DOOMSDAY_NO_JUMP_OR_CLOAK_DURATION =
  getAttributeIDByNames("doomsdayNoJumpOrCloakDuration") || 2142;
const ATTRIBUTE_DOOMSDAY_IMMOBILITY_DURATION =
  getAttributeIDByNames("doomsdayImmobilityDuration") || 2141;
const ATTRIBUTE_DOOMSDAY_WARNING_DURATION =
  getAttributeIDByNames("doomsdayWarningDuration") || 2143;
const ATTRIBUTE_DOOMSDAY_DAMAGE_DURATION =
  getAttributeIDByNames("doomsdayDamageDuration") || 2144;
const ATTRIBUTE_DOOMSDAY_DAMAGE_CYCLE_TIME =
  getAttributeIDByNames("doomsdayDamageCycleTime") || 2145;
const ATTRIBUTE_DOOMSDAY_DAMAGE_RADIUS =
  getAttributeIDByNames("doomsdayDamageRadius") || 2146;
const ATTRIBUTE_DOOMSDAY_AOE_SHAPE =
  getAttributeIDByNames("doomsdayAOEShape") || 2147;
const ATTRIBUTE_DOOMSDAY_RANGE_IS_FIXED =
  getAttributeIDByNames("doomsdayRangeIsFixed") || 2149;
const ATTRIBUTE_IS_POINT_TARGETED =
  getAttributeIDByNames("isPointTargeted") || 2210;
const ATTRIBUTE_DOOMSDAY_ENERGY_NEUT_AMOUNT =
  getAttributeIDByNames("doomsdayEnergyNeutAmount") || 2148;
const ATTRIBUTE_DOOMSDAY_ENERGY_NEUT_RADIUS =
  getAttributeIDByNames("doomsdayEnergyNeutRadius") || 2151;
const ATTRIBUTE_DOOMSDAY_ENERGY_NEUT_SIGNATURE_RADIUS =
  getAttributeIDByNames("doomsdayEnergyNeutSignatureRadius") || 2152;
const ATTRIBUTE_ENTITY_SUPERWEAPON_DURATION =
  getAttributeIDByNames("entitySuperWeaponDuration") || 2009;
const ATTRIBUTE_ENTITY_SUPERWEAPON_EM_DAMAGE =
  getAttributeIDByNames("entitySuperWeaponEmDamage") || 2010;
const ATTRIBUTE_ENTITY_SUPERWEAPON_KINETIC_DAMAGE =
  getAttributeIDByNames("entitySuperWeaponKineticDamage") || 2011;
const ATTRIBUTE_ENTITY_SUPERWEAPON_THERMAL_DAMAGE =
  getAttributeIDByNames("entitySuperWeaponThermalDamage") || 2012;
const ATTRIBUTE_ENTITY_SUPERWEAPON_EXPLOSIVE_DAMAGE =
  getAttributeIDByNames("entitySuperWeaponExplosiveDamage") || 2013;
const ATTRIBUTE_ENTITY_SUPERWEAPON_MAX_RANGE =
  getAttributeIDByNames("entitySuperWeaponMaxRange") || 2046;
const ATTRIBUTE_ENTITY_SUPERWEAPON_FALLOFF =
  getAttributeIDByNames("entitySuperWeaponFallOff") || 2047;
const ATTRIBUTE_ENTITY_SUPERWEAPON_TRACKING_SPEED =
  getAttributeIDByNames("entitySuperWeaponTrackingSpeed") || 2048;
const ATTRIBUTE_ENTITY_SUPERWEAPON_OPTIMAL_SIGNATURE_RADIUS =
  getAttributeIDByNames("entitySuperWeaponOptimalSignatureRadius") || 2049;

const LOWSEC_SECURITY_THRESHOLD = 0.45;
const MODULAR_EFFECT_BEACON_TYPE_ID = 41233;
const MODULAR_EFFECT_BEACON_GROUP_ID = 1704;
const MODULAR_EFFECT_BEACON_CATEGORY_ID = 2;
const MODULAR_EFFECT_BEACON_RADIUS = 250;
const DEFAULT_SHOW_REFIRE_MS = 30_000;
const DEFAULT_SHOW_INITIAL_DELAY_MS = 4_000;
const DEFAULT_SHOW_APPROACH_RANGE = 60_000;
const DEFAULT_SHOW_VOLLEY_BATCH_SIZE = 4;
const DEFAULT_SHOW_VOLLEY_STEP_MS = 1_000;
const FILETIME_TICKS_PER_MS = 10000n;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;

const SUPERWEAPON_FX_META = Object.freeze({
  "effects.SuperWeaponAmarr": Object.freeze({
    durationMs: 10_000,
    leadInMs: 6_000,
    startActive: false,
  }),
  "effects.SuperWeaponCaldari": Object.freeze({
    durationMs: 10_000,
    leadInMs: 0,
    startActive: false,
  }),
  "effects.SuperWeaponGallente": Object.freeze({
    durationMs: 10_000,
    leadInMs: 0,
    startActive: false,
  }),
  "effects.SuperWeaponMinmatar": Object.freeze({
    durationMs: 10_000,
    leadInMs: 3_000,
    startActive: false,
  }),
  "effects.SuperWeaponLanceAmarr": Object.freeze({
    durationMs: 10_000,
    leadInMs: 6_000,
    startActive: false,
  }),
  "effects.SuperWeaponLanceCaldari": Object.freeze({
    durationMs: 10_000,
    leadInMs: 6_000,
    startActive: false,
  }),
  "effects.SuperWeaponLanceGallente": Object.freeze({
    durationMs: 10_000,
    leadInMs: 6_000,
    startActive: false,
  }),
  "effects.SuperWeaponLanceMinmatar": Object.freeze({
    durationMs: 10_000,
    leadInMs: 6_000,
    startActive: false,
  }),
  "effects.TurboLaser": Object.freeze({
    durationMs: 12_000,
    leadInMs: 0,
    startActive: false,
  }),
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, digits = 6) {
  return Number(toFiniteNumber(value, 0).toFixed(digits));
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(toFiniteNumber(value, minimum), minimum), maximum);
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function magnitude(vector) {
  const resolved = cloneVector(vector);
  return Math.sqrt(
    (resolved.x ** 2) +
    (resolved.y ** 2) +
    (resolved.z ** 2),
  );
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = magnitude(resolved);
  if (length <= 1e-9) {
    return cloneVector(fallback);
  }
  return scaleVector(resolved, 1 / length);
}

function dotProduct(left, right) {
  return (
    toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.x, 0) +
    toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.y, 0) +
    toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.z, 0)
  );
}

function normalizeDamageVector(rawDamage = {}) {
  const source =
    rawDamage && typeof rawDamage === "object"
      ? rawDamage
      : {};
  return {
    em: Math.max(0, toFiniteNumber(source.em, 0)),
    thermal: Math.max(0, toFiniteNumber(source.thermal, 0)),
    kinetic: Math.max(0, toFiniteNumber(source.kinetic, 0)),
    explosive: Math.max(0, toFiniteNumber(source.explosive, 0)),
  };
}

function scaleDamageVector(rawDamage = {}, factor = 1) {
  const resolvedDamage = normalizeDamageVector(rawDamage);
  const resolvedFactor = clamp(factor, 0, 1);
  return {
    em: roundNumber(resolvedDamage.em * resolvedFactor, 6),
    thermal: roundNumber(resolvedDamage.thermal * resolvedFactor, 6),
    kinetic: roundNumber(resolvedDamage.kinetic * resolvedFactor, 6),
    explosive: roundNumber(resolvedDamage.explosive * resolvedFactor, 6),
  };
}

function normalizePointValue(value) {
  if (value && typeof value === "object" && typeof value.value === "number") {
    return Number(value.value);
  }
  return Number(value);
}

function normalizePointInput(point) {
  if (Array.isArray(point) && point.length >= 3) {
    return {
      x: toFiniteNumber(normalizePointValue(point[0]), 0),
      y: toFiniteNumber(normalizePointValue(point[1]), 0),
      z: toFiniteNumber(normalizePointValue(point[2]), 0),
    };
  }
  if (point && typeof point === "object") {
    return {
      x: toFiniteNumber(normalizePointValue(point.x), 0),
      y: toFiniteNumber(normalizePointValue(point.y), 0),
      z: toFiniteNumber(normalizePointValue(point.z), 0),
    };
  }
  return null;
}

function getSystemSecurity(systemID) {
  const system = worldData.getSolarSystemByID(toInt(systemID, 0));
  if (!system) {
    return 0;
  }
  const security = clamp(toFiniteNumber(system.security, 0), 0, 1);
  return security > 0 && security < 0.05 ? 0.05 : security;
}

function isLowSecuritySystem(systemID) {
  const security = getSystemSecurity(systemID);
  return security > 0 && security < LOWSEC_SECURITY_THRESHOLD;
}

function resolveSupportedSuperweapon(moduleItem) {
  if (
    moduleItem &&
    moduleItem.npcSyntheticHullModule === true &&
    typeHasEffectName(
      toInt(moduleItem.typeID, 0),
      String(moduleItem.npcEffectName || "").trim() || "entitySuperWeapon",
    )
  ) {
    const normalizedEffectName = String(moduleItem.npcEffectName || "")
      .trim()
      .toLowerCase();
    if (normalizedEffectName === "entitysuperweapon") {
      return {
        family: "doomsday",
        fxGuid: "effects.TurboLaser",
        fuelTypeID: 0,
        fuelPerActivation: 0,
        profile: null,
        entitySuperweapon: true,
      };
    }
    if (normalizedEffectName === "entitysuperweaponlanceallraces") {
      return {
        family: "lance",
        fxGuid: "effects.SuperWeaponLanceAmarr",
        fuelTypeID: 0,
        fuelPerActivation: 0,
        profile: null,
        entitySuperweapon: true,
      };
    }
  }

  const profile = resolveTitanSuperweaponProfileByModuleTypeID(
    toInt(moduleItem && moduleItem.typeID, 0),
  );
  if (!profile) {
    return null;
  }

  if (toInt(moduleItem && moduleItem.typeID, 0) === toInt(profile.doomsdayTypeID, 0)) {
    return {
      family: "doomsday",
      fxGuid: profile.doomsdayFxGuid,
      fuelTypeID: profile.fuelTypeID,
      fuelPerActivation: profile.doomsdayFuelPerActivation,
      profile,
    };
  }

  if (toInt(moduleItem && moduleItem.typeID, 0) === toInt(profile.lanceTypeID, 0)) {
    return {
      family: "lance",
      fxGuid: profile.lanceFxGuid,
      fuelTypeID: profile.fuelTypeID,
      fuelPerActivation: profile.lanceFuelPerActivation,
      profile,
    };
  }

  return null;
}

function resolveSkillMap(entity, fallbackCharacterID = 0) {
  if (entity && entity.skillMap instanceof Map) {
    return entity.skillMap;
  }
  if (entity && entity.skillMap && typeof entity.skillMap === "object") {
    return new Map(entity.skillMap);
  }
  const characterID =
    entity && (
      entity.pilotCharacterID ??
      entity.characterID
    )
      ? toInt(
          entity.pilotCharacterID ??
            entity.characterID,
          fallbackCharacterID,
        )
      : fallbackCharacterID;
  return characterID > 0 ? getCharacterSkillMap(characterID) : new Map();
}

function buildSuperweaponDogmaState(options = {}) {
  const {
    entity,
    shipItem,
    moduleItem,
    callbacks = {},
    supported = null,
  } = options;
  if (!entity || !shipItem || !moduleItem) {
    return null;
  }

  if (supported && supported.entitySuperweapon === true) {
    const attributeMap = getTypeAttributeMap(toInt(moduleItem && moduleItem.typeID, 0));
    if (!attributeMap) {
      return null;
    }

    const durationMs = Math.max(
      1,
      toFiniteNumber(
        attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_DURATION],
        1,
      ),
    );
    return {
      attributes: attributeMap,
      capNeed: 0,
      durationMs,
      durationAttributeID: ATTRIBUTE_ENTITY_SUPERWEAPON_DURATION,
      damageVector: normalizeDamageVector({
        em: attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_EM_DAMAGE],
        thermal: attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_THERMAL_DAMAGE],
        kinetic: attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_KINETIC_DAMAGE],
        explosive: attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_EXPLOSIVE_DAMAGE],
      }),
      signatureRadius: Math.max(
        1,
        toFiniteNumber(
          attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_OPTIMAL_SIGNATURE_RADIUS],
          1,
        ),
      ),
      maxRange: Math.max(
        0,
        toFiniteNumber(attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_MAX_RANGE], 0),
      ),
      falloff: Math.max(
        0,
        toFiniteNumber(attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_FALLOFF], 0),
      ),
      trackingSpeed: Math.max(
        0,
        toFiniteNumber(attributeMap[ATTRIBUTE_ENTITY_SUPERWEAPON_TRACKING_SPEED], 0),
      ),
      damageDelayMs: Math.max(
        0,
        toFiniteNumber(
          attributeMap[ATTRIBUTE_DAMAGE_DELAY_DURATION],
          durationMs,
        ),
      ),
      fuelTypeID: 0,
      fuelPerActivation: 0,
      noJumpOrCloakDurationMs: 0,
      immobilityDurationMs: 0,
      warningDurationMs: 0,
      damageDurationMs: 0,
      damageCycleTimeMs: 1,
      damageRadius: 0,
      aoeShape: 0,
      rangeIsFixed: false,
      isPointTargeted: true,
      energyNeutAmount: 0,
      energyNeutRadius: 0,
      energyNeutSignatureRadius: 0,
    };
  }

  const characterID =
    callbacks.resolveCharacterID &&
    typeof callbacks.resolveCharacterID === "function"
      ? callbacks.resolveCharacterID(entity)
      : 0;
  const skillMap = resolveSkillMap(entity, characterID);
  const fittedItems =
    callbacks.getEntityRuntimeFittedItems &&
    typeof callbacks.getEntityRuntimeFittedItems === "function"
      ? callbacks.getEntityRuntimeFittedItems(entity)
      : [];
  const activeModuleContexts =
    callbacks.getEntityRuntimeActiveModuleContexts &&
    typeof callbacks.getEntityRuntimeActiveModuleContexts === "function"
      ? callbacks.getEntityRuntimeActiveModuleContexts(entity, {
          excludeModuleID: toInt(moduleItem && moduleItem.itemID, 0),
        })
      : [];
  const attributes = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    null,
    skillMap,
    fittedItems,
    activeModuleContexts,
  );
  if (!attributes) {
    return null;
  }

  return {
    attributes,
    capNeed: Math.max(0, toFiniteNumber(attributes[ATTRIBUTE_CAPACITOR_NEED], 0)),
    durationMs: Math.max(1, toFiniteNumber(attributes[ATTRIBUTE_DURATION], 1)),
    durationAttributeID: ATTRIBUTE_DURATION,
    damageVector: normalizeDamageVector({
      em: attributes[ATTRIBUTE_EM_DAMAGE],
      thermal: attributes[ATTRIBUTE_THERMAL_DAMAGE],
      kinetic: attributes[ATTRIBUTE_KINETIC_DAMAGE],
      explosive: attributes[ATTRIBUTE_EXPLOSIVE_DAMAGE],
    }),
    signatureRadius: Math.max(
      1,
      toFiniteNumber(attributes[ATTRIBUTE_SIGNATURE_RADIUS], 1),
    ),
    maxRange: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_MAX_RANGE], 0),
    ),
    damageDelayMs: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DAMAGE_DELAY_DURATION], 0),
    ),
    fuelTypeID: toInt(attributes[ATTRIBUTE_CONSUMPTION_TYPE], 0),
    fuelPerActivation: Math.max(
      0,
      toInt(attributes[ATTRIBUTE_CONSUMPTION_QUANTITY], 0),
    ),
    noJumpOrCloakDurationMs: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_NO_JUMP_OR_CLOAK_DURATION], 0),
    ),
    immobilityDurationMs: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_IMMOBILITY_DURATION], 0),
    ),
    warningDurationMs: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_WARNING_DURATION], 0),
    ),
    damageDurationMs: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_DAMAGE_DURATION], 0),
    ),
    damageCycleTimeMs: Math.max(
      1,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_DAMAGE_CYCLE_TIME], 1000),
    ),
    damageRadius: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_DAMAGE_RADIUS], 0),
    ),
    aoeShape: toInt(attributes[ATTRIBUTE_DOOMSDAY_AOE_SHAPE], 0),
    rangeIsFixed: toInt(attributes[ATTRIBUTE_DOOMSDAY_RANGE_IS_FIXED], 0) === 1,
    isPointTargeted: toInt(attributes[ATTRIBUTE_IS_POINT_TARGETED], 0) >= 1,
    energyNeutAmount: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_ENERGY_NEUT_AMOUNT], 0),
    ),
    energyNeutRadius: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_ENERGY_NEUT_RADIUS], 0),
    ),
    energyNeutSignatureRadius: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DOOMSDAY_ENERGY_NEUT_SIGNATURE_RADIUS], 0),
    ),
  };
}

function getCargoFuelStacks(entity, fuelTypeID, callbacks = {}) {
  return getFuelStacksForShipStorage(entity, fuelTypeID, callbacks);
}

function consumeSuperweaponFuel(entity, fuelTypeID, quantity, callbacks = {}) {
  return consumeFuelFromShipStorage(entity, fuelTypeID, quantity, callbacks);
}

function isSuperweaponMovementLocked(entity, nowMs = Date.now()) {
  return toFiniteNumber(entity && entity.superweaponImmobileUntilMs, 0) > toFiniteNumber(nowMs, 0);
}

function isSuperweaponJumpOrCloakLocked(entity, nowMs = Date.now()) {
  return toFiniteNumber(entity && entity.superweaponNoJumpOrCloakUntilMs, 0) > toFiniteNumber(nowMs, 0);
}

function clampPointToFixedRange(sourceEntity, point, maxRange) {
  const sourcePosition = cloneVector(sourceEntity && sourceEntity.position);
  const resolvedPoint = cloneVector(point, sourcePosition);
  const offset = subtractVectors(resolvedPoint, sourcePosition);
  const normalizedDirection = normalizeVector(
    magnitude(offset) > 1e-9 ? offset : sourceEntity && sourceEntity.direction,
    { x: 1, y: 0, z: 0 },
  );
  return addVectors(
    sourcePosition,
    scaleVector(normalizedDirection, Math.max(0, toFiniteNumber(maxRange, 0))),
  );
}

function allocateRuntimeEntityID(callbacks = {}) {
  if (
    callbacks.allocateRuntimeEntityID &&
    typeof callbacks.allocateRuntimeEntityID === "function"
  ) {
    return toInt(callbacks.allocateRuntimeEntityID(), 0);
  }
  return 0;
}

function spawnLanceBeacon(scene, sourceEntity, targetPoint, nowMs, callbacks = {}) {
  const beaconID = allocateRuntimeEntityID(callbacks);
  if (beaconID <= 0) {
    return null;
  }

  const sourcePosition = cloneVector(sourceEntity && sourceEntity.position);
  const resolvedTargetPoint = cloneVector(targetPoint, sourcePosition);
  const beaconEntity = {
    itemID: beaconID,
    kind: "container",
    typeID: MODULAR_EFFECT_BEACON_TYPE_ID,
    groupID: MODULAR_EFFECT_BEACON_GROUP_ID,
    categoryID: MODULAR_EFFECT_BEACON_CATEGORY_ID,
    slimTypeID: MODULAR_EFFECT_BEACON_TYPE_ID,
    slimGroupID: MODULAR_EFFECT_BEACON_GROUP_ID,
    slimCategoryID: MODULAR_EFFECT_BEACON_CATEGORY_ID,
    itemName: "Modular Effect Beacon",
    ownerID: toInt(sourceEntity && sourceEntity.ownerID, 0),
    systemID: toInt(scene && scene.systemID, 0),
    radius: MODULAR_EFFECT_BEACON_RADIUS,
    position: resolvedTargetPoint,
    velocity: { x: 0, y: 0, z: 0 },
    direction: normalizeVector(
      subtractVectors(resolvedTargetPoint, sourcePosition),
      sourceEntity && sourceEntity.direction,
    ),
    targetPoint: resolvedTargetPoint,
    mode: "STOP",
    speedFraction: 0,
    transient: true,
    createdAtMs: toFiniteNumber(nowMs, 0),
    expiresAtMs: toFiniteNumber(nowMs, 0) + 60_000,
    activityState: 1,
    component_activate: [true, null],
  };
  const spawnResult = scene.spawnDynamicEntity(beaconEntity, {
    broadcast: false,
  });
  if (!spawnResult || spawnResult.success !== true || !spawnResult.data) {
    return null;
  }
  return spawnResult.data.entity || beaconEntity;
}

function removeTransientEntity(scene, entityID, nowMs) {
  if (!scene || toInt(entityID, 0) <= 0) {
    return false;
  }
  const entity = scene.getEntityByID(entityID);
  if (!entity) {
    return false;
  }
  scene.unregisterDynamicEntity(entity, {
    nowMs,
  });
  return true;
}

function resolveSuperweaponFxMeta(guid) {
  return SUPERWEAPON_FX_META[String(guid || "")] || Object.freeze({
    durationMs: 10_000,
    leadInMs: 0,
    startActive: false,
  });
}

function resolveSuperweaponFxTargetID(effectState) {
  if (!effectState || effectState.superweaponEffect !== true) {
    return 0;
  }
  if (String(effectState.superweaponFamily || "").toLowerCase() === "lance") {
    return Math.max(
      0,
      toInt(
        effectState.superweaponFxTargetID,
        effectState.superweaponBeaconID,
      ),
    );
  }
  return Math.max(
    0,
    toInt(
      effectState.superweaponPrimaryTargetID,
      effectState.targetID,
    ),
  );
}

function resolveSuperweaponFxReplayWindowEndMs(effectState) {
  if (!effectState || effectState.superweaponEffect !== true) {
    return 0;
  }
  const activatedAtMs = Math.max(
    0,
    toFiniteNumber(
      effectState.superweaponActivatedAtMs,
      effectState.startedAtMs,
    ),
  );
  if (activatedAtMs <= 0) {
    return 0;
  }
  return activatedAtMs +
    Math.max(0, toFiniteNumber(effectState.superweaponFxLeadInMs, 0)) +
    Math.max(1, toFiniteNumber(effectState.superweaponFxDurationMs, 10_000));
}

function isSuperweaponFxReplayWindowActive(effectState, nowMs = Date.now()) {
  if (!effectState || effectState.superweaponEffect !== true || !effectState.guid) {
    return false;
  }
  if (toFiniteNumber(effectState.deactivatedAtMs, 0) > 0) {
    return false;
  }
  const activatedAtMs = Math.max(
    0,
    toFiniteNumber(
      effectState.superweaponActivatedAtMs,
      effectState.startedAtMs,
    ),
  );
  if (activatedAtMs <= 0 || activatedAtMs > toFiniteNumber(nowMs, 0) + 1) {
    return false;
  }
  return resolveSuperweaponFxReplayWindowEndMs(effectState) > toFiniteNumber(nowMs, 0);
}

function toFileTimeFromSimMs(value, fallback = null) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return BigInt(Math.trunc(numericValue)) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
}

function resolveSuperweaponFxStartFileTime(scene, whenMs = Date.now()) {
  if (
    scene &&
    typeof scene.toFileTimeFromSimMs === "function"
  ) {
    const fallback =
      typeof scene.getCurrentFileTime === "function"
        ? scene.getCurrentFileTime()
        : toFileTimeFromSimMs(whenMs);
    return scene.toFileTimeFromSimMs(whenMs, fallback);
  }
  return toFileTimeFromSimMs(whenMs);
}

function buildSuperweaponFreshAcquireFxOptions(effectState, nowMs = Date.now(), scene = null) {
  if (!isSuperweaponFxReplayWindowActive(effectState, nowMs)) {
    return null;
  }
  const activatedAtMs = Math.max(
    0,
    toFiniteNumber(
      effectState.superweaponActivatedAtMs,
      effectState.startedAtMs,
    ),
  );
  return {
    moduleID: effectState.moduleID,
    moduleTypeID: effectState.typeID,
    targetID: resolveSuperweaponFxTargetID(effectState) || null,
    isOffensive: true,
    start: true,
    active: effectState.superweaponFxStartActive === true,
    duration: Math.max(1, toInt(effectState.superweaponFxDurationMs, 10_000)),
    startTime: resolveSuperweaponFxStartFileTime(scene, activatedAtMs),
    timeFromStart: Math.max(0, toFiniteNumber(nowMs, activatedAtMs) - activatedAtMs),
  };
}

function getEntitySignatureRadius(entity) {
  return Math.max(
    0,
    toFiniteNumber(entity && entity.signatureRadius, 0),
  );
}

function resolveSignatureApplicationFactor(entity, weaponSignatureRadius) {
  const resolvedWeaponSignatureRadius = Math.max(0, toFiniteNumber(weaponSignatureRadius, 0));
  if (resolvedWeaponSignatureRadius <= 0) {
    return 1;
  }
  const targetSignatureRadius = getEntitySignatureRadius(entity);
  if (targetSignatureRadius <= 0) {
    return 0;
  }
  return clamp(targetSignatureRadius / resolvedWeaponSignatureRadius, 0, 1);
}

function collectPotentialCylinderTargets(scene) {
  const targets = [];
  if (!scene) {
    return targets;
  }

  if (scene.dynamicEntities instanceof Map) {
    for (const entity of scene.dynamicEntities.values()) {
      targets.push(entity);
    }
  }
  if (scene.staticEntitiesByID instanceof Map) {
    for (const entity of scene.staticEntitiesByID.values()) {
      targets.push(entity);
    }
  }
  return targets;
}

function isEntityInsideCylinder(origin, direction, length, radius, entity) {
  if (!entity || !entity.position) {
    return false;
  }
  const sourcePosition = cloneVector(origin);
  const axis = normalizeVector(direction, { x: 1, y: 0, z: 0 });
  const offset = subtractVectors(entity.position, sourcePosition);
  const targetRadius = Math.max(0, toFiniteNumber(entity.radius, 0));
  const along = dotProduct(offset, axis);
  if (along < -targetRadius || along > Math.max(0, toFiniteNumber(length, 0)) + targetRadius) {
    return false;
  }
  const closestPoint = addVectors(
    sourcePosition,
    scaleVector(axis, clamp(along, 0, Math.max(0, toFiniteNumber(length, 0)))),
  );
  const radialDistance = magnitude(subtractVectors(entity.position, closestPoint));
  return radialDistance <= Math.max(0, toFiniteNumber(radius, 0)) + targetRadius;
}

function buildNpcPseudoSession(entity) {
  return {
    characterID: toInt(
      entity && (
        entity.pilotCharacterID ??
        entity.characterID
      ),
      0,
    ),
    corporationID: toInt(entity && entity.corporationID, 0),
    allianceID: toInt(entity && entity.allianceID, 0),
    _space: {
      systemID: toInt(entity && entity.systemID, 0),
      shipID: toInt(entity && entity.itemID, 0),
    },
  };
}

function getFittedModuleByTypeID(entity, typeID) {
  if (!entity || !Array.isArray(entity.fittedItems)) {
    return null;
  }
  return entity.fittedItems.find(
    (moduleItem) => toInt(moduleItem && moduleItem.typeID, 0) === toInt(typeID, 0),
  ) || null;
}

function hasActiveSuperweaponEffect(entity) {
  if (!entity || !(entity.activeModuleEffects instanceof Map)) {
    return false;
  }
  for (const effectState of entity.activeModuleEffects.values()) {
    if (effectState && effectState.superweaponEffect === true) {
      return true;
    }
  }
  return false;
}

function setEntityMotionTowardTarget(entity, targetEntity, callbacks = {}) {
  if (!entity || !targetEntity) {
    return false;
  }
  entity.mode = "FOLLOW";
  entity.targetEntityID = toInt(targetEntity.itemID, 0) || null;
  entity.followRange = DEFAULT_SHOW_APPROACH_RANGE;
  entity.speedFraction = 1;
  entity.targetPoint = cloneVector(targetEntity.position, entity.targetPoint || entity.position);
  entity.direction = normalizeVector(
    subtractVectors(targetEntity.position, entity.position),
    entity.direction,
  );
  if (
    callbacks.persistDynamicEntity &&
    typeof callbacks.persistDynamicEntity === "function"
  ) {
    callbacks.persistDynamicEntity(entity);
  }
  return true;
}

function applyCapacitorDrain(entity, drainAmount, whenMs, callbacks = {}) {
  const resolvedDrainAmount = Math.max(0, toFiniteNumber(drainAmount, 0));
  if (!entity || resolvedDrainAmount <= 0) {
    return false;
  }
  const currentCapacitor =
    callbacks.getEntityCapacitorAmount &&
    typeof callbacks.getEntityCapacitorAmount === "function"
      ? callbacks.getEntityCapacitorAmount(entity)
      : 0;
  const capacitorCapacity = Math.max(0, toFiniteNumber(entity.capacitorCapacity, 0));
  if (capacitorCapacity <= 0 || currentCapacitor <= 0) {
    return false;
  }
  const nextCapacitor = Math.max(0, currentCapacitor - resolvedDrainAmount);
  if (
    callbacks.setEntityCapacitorRatio &&
    typeof callbacks.setEntityCapacitorRatio === "function"
  ) {
    callbacks.setEntityCapacitorRatio(entity, nextCapacitor / capacitorCapacity);
  }
  if (
    callbacks.persistDynamicEntity &&
    typeof callbacks.persistDynamicEntity === "function"
  ) {
    callbacks.persistDynamicEntity(entity);
  }
  if (
    entity.session &&
    callbacks.notifyCapacitorChangeToSession &&
    typeof callbacks.notifyCapacitorChangeToSession === "function"
  ) {
    callbacks.notifyCapacitorChangeToSession(
      entity.session,
      entity,
      whenMs,
      currentCapacitor,
    );
  }
  return nextCapacitor < currentCapacitor - 1e-6;
}

function applySuperweaponDamage(scene, sourceEntity, targetEntity, damageVector, moduleItem, whenMs, callbacks = {}) {
  if (
    !scene ||
    !sourceEntity ||
    !targetEntity ||
    sumDamageVector(damageVector) <= 0 ||
    !callbacks.applyWeaponDamageToTarget ||
    typeof callbacks.applyWeaponDamageToTarget !== "function"
  ) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
      damageResult: null,
      destroyResult: null,
    };
  }

  const weaponDamageResult = callbacks.applyWeaponDamageToTarget(
    scene,
    sourceEntity,
    targetEntity,
    damageVector,
    whenMs,
    {
      alignLethalDamageToDestruction: true,
      damageSource: "superweapon_doomsday",
      superweaponFamily: "doomsday",
    },
  ) || {
    damageResult: null,
    destroyResult: null,
  };

  const appliedDamageAmount =
    callbacks.getAppliedDamageAmount &&
    typeof callbacks.getAppliedDamageAmount === "function"
      ? callbacks.getAppliedDamageAmount(weaponDamageResult.damageResult)
      : sumDamageVector(damageVector);
  if (
    appliedDamageAmount > 0 &&
    callbacks.noteKillmailDamage &&
    typeof callbacks.noteKillmailDamage === "function"
  ) {
    callbacks.noteKillmailDamage(sourceEntity, targetEntity, appliedDamageAmount, {
      whenMs,
      moduleItem,
    });
  }
  if (
    weaponDamageResult.destroyResult &&
    weaponDamageResult.destroyResult.success &&
    callbacks.recordKillmailFromDestruction &&
    typeof callbacks.recordKillmailFromDestruction === "function"
  ) {
    callbacks.recordKillmailFromDestruction(targetEntity, weaponDamageResult.destroyResult, {
      attackerEntity: sourceEntity,
      whenMs,
      moduleItem,
    });
  }

  if (
    callbacks.notifyWeaponDamageMessages &&
    typeof callbacks.notifyWeaponDamageMessages === "function"
  ) {
    callbacks.notifyWeaponDamageMessages(
      sourceEntity,
      targetEntity,
      moduleItem,
      damageVector,
      appliedDamageAmount,
      appliedDamageAmount > 0 ? 1 : 0,
    );
  }

  return {
    success: true,
    damageResult: weaponDamageResult.damageResult,
    destroyResult: weaponDamageResult.destroyResult,
    appliedDamageAmount,
  };
}

function prepareSuperweaponActivation(options = {}) {
  const {
    scene,
    entity,
    shipItem,
    moduleItem,
    callbacks = {},
    baseRuntimeAttributes = {},
    options: activationOptions = {},
  } = options;

  const supported = resolveSupportedSuperweapon(moduleItem);
  if (!supported) {
    return {
      matched: false,
      success: true,
    };
  }
  if (!scene || !entity || !shipItem || !moduleItem) {
    return {
      matched: true,
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }
  if (entity.mode === "WARP" || entity.pendingWarp) {
    return {
      matched: true,
      success: false,
      errorMsg: "CANNOT_ACTIVATE_IN_WARP",
    };
  }
  if (isLowSecuritySystem(scene.systemID) && supported.family === "lance") {
    return {
      matched: true,
      success: false,
      errorMsg: "MODULE_RESTRICTED_IN_LOWSEC",
    };
  }

  const dogmaState = buildSuperweaponDogmaState({
    entity,
    shipItem,
    moduleItem,
    callbacks,
    supported,
  });
  if (!dogmaState) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  let targetEntity = null;
  let targetPoint = null;
  const requestedTargetID = toInt(activationOptions.targetID, 0);
  if (supported.family === "doomsday") {
    if (requestedTargetID <= 0) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_REQUIRED",
      };
    }
    targetEntity = scene.getEntityByID(requestedTargetID);
    if (!targetEntity || !hasDamageableHealth(targetEntity)) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_NOT_FOUND",
      };
    }
    if (
      scene.isEntityLockedTarget &&
      typeof scene.isEntityLockedTarget === "function" &&
      !scene.isEntityLockedTarget(entity, requestedTargetID)
    ) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_NOT_LOCKED",
      };
    }
    if (getStructureTethering().isEntityStructureTethered(targetEntity)) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_TETHERED",
      };
    }
    const surfaceDistance =
      scene.getEntitySurfaceDistance &&
      typeof scene.getEntitySurfaceDistance === "function"
        ? scene.getEntitySurfaceDistance(entity, targetEntity)
        : magnitude(subtractVectors(targetEntity.position, entity.position));
    const maxTargetDistance = supported.entitySuperweapon === true
      ? dogmaState.maxRange + Math.max(0, toFiniteNumber(dogmaState.falloff, 0))
      : dogmaState.maxRange;
    if (maxTargetDistance > 0 && surfaceDistance > maxTargetDistance + 1) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_OUT_OF_RANGE",
      };
    }
  } else {
    targetPoint = normalizePointInput(activationOptions.targetPoint);
    if (!targetPoint && requestedTargetID > 0) {
      targetEntity = scene.getEntityByID(requestedTargetID) || null;
      if (targetEntity && targetEntity.position) {
        targetPoint = cloneVector(targetEntity.position);
      }
    }
    if (!targetPoint) {
      return {
        matched: true,
        success: false,
        errorMsg: "TARGET_POINT_REQUIRED",
      };
    }
    if (dogmaState.rangeIsFixed || dogmaState.maxRange > 0) {
      targetPoint = clampPointToFixedRange(
        entity,
        targetPoint,
        dogmaState.maxRange,
      );
    }
  }

  const fuelTypeID = Math.max(
    0,
    toInt(dogmaState.fuelTypeID, supported.fuelTypeID),
  );
  const fuelPerActivation = Math.max(
    0,
    toInt(dogmaState.fuelPerActivation, supported.fuelPerActivation),
  );
  if (fuelTypeID > 0 && fuelPerActivation > 0) {
    const availableFuel = getFuelQuantityFromStacks(
      getCargoFuelStacks(entity, fuelTypeID, callbacks),
    );
    if (availableFuel < fuelPerActivation) {
      return {
        matched: true,
        success: false,
        errorMsg: "NO_FUEL",
      };
    }
  }

  const cycleOverrideMs = Math.max(
    0,
    toInt(entity && entity.superweaponCycleOverrideMs, 0),
  );
  const durationMs = cycleOverrideMs > 0
    ? cycleOverrideMs
    : dogmaState.durationMs;
  const fxMeta = resolveSuperweaponFxMeta(supported.fxGuid);

  return {
    matched: true,
    success: true,
    targetEntity,
    offensiveActivation: true,
    runtimeAttributes: {
      ...baseRuntimeAttributes,
      capNeed: 0,
      // Superweapons consume fuel on the dedicated execute path so NPC and
      // player activations use one authoritative fuel contract.
      fuelTypeID: 0,
      fuelPerActivation: 0,
      durationMs,
      durationAttributeID: dogmaState.durationAttributeID,
    },
    effectStatePatch: {
      capNeed: 0,
      repeat: 1,
      guid: supported.fxGuid,
      superweaponEffect: true,
      autoDeactivateAtCycleEnd: true,
      suppressStartSpecialFx: true,
      suppressStopSpecialFx: true,
      specialFxIsOffensive: true,
      superweaponFamily: supported.family,
      superweaponDamageVector: normalizeDamageVector(dogmaState.damageVector),
      superweaponWeaponSignatureRadius: dogmaState.signatureRadius,
      superweaponFuelTypeID: fuelTypeID,
      superweaponFuelPerActivation: fuelPerActivation,
      superweaponFxDurationMs: fxMeta.durationMs,
      superweaponFxLeadInMs: fxMeta.leadInMs,
      superweaponFxStartActive: fxMeta.startActive === true,
      superweaponMaxRange: dogmaState.maxRange,
      superweaponDamageDelayMs: dogmaState.damageDelayMs,
      superweaponDamageDurationMs: dogmaState.damageDurationMs,
      superweaponDamageCycleTimeMs: dogmaState.damageCycleTimeMs,
      superweaponDamageRadius: dogmaState.damageRadius,
      superweaponWarningDurationMs: dogmaState.warningDurationMs,
      superweaponNoJumpOrCloakDurationMs: dogmaState.noJumpOrCloakDurationMs,
      superweaponImmobilityDurationMs: dogmaState.immobilityDurationMs,
      superweaponEnergyNeutAmount: dogmaState.energyNeutAmount,
      superweaponEnergyNeutRadius: dogmaState.energyNeutRadius,
      superweaponEnergyNeutSignatureRadius: dogmaState.energyNeutSignatureRadius,
      superweaponTargetPoint: targetPoint ? cloneVector(targetPoint) : null,
      superweaponPrimaryTargetID:
        supported.family === "doomsday"
          ? toInt(targetEntity && targetEntity.itemID, 0)
          : 0,
    },
  };
}

function inspectSuperweaponActivationContract(options = {}) {
  const {
    scene,
    entity,
    moduleItem,
    callbacks = {},
    targetID = 0,
    targetPoint = null,
  } = options;
  if (!scene || !entity || !moduleItem) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const inspectionCallbacks = {
    getEntityRuntimeFittedItems(currentEntity) {
      return Array.isArray(currentEntity && currentEntity.fittedItems)
        ? currentEntity.fittedItems
        : [];
    },
    getEntityRuntimeActiveModuleContexts() {
      return [];
    },
    resolveCharacterID(currentEntity) {
      return toInt(
        currentEntity &&
          (
            currentEntity.pilotCharacterID ??
            currentEntity.characterID
          ),
        0,
      );
    },
    ...callbacks,
  };

  const activationResult = prepareSuperweaponActivation({
    scene,
    entity,
    shipItem: entity,
    moduleItem,
    callbacks: inspectionCallbacks,
    options: targetPoint
      ? { targetPoint }
      : { targetID },
  });
  if (!activationResult || activationResult.matched !== true || activationResult.success !== true) {
    return {
      success: false,
      errorMsg:
        activationResult && activationResult.matched === true
          ? activationResult.errorMsg || "UNSUPPORTED_MODULE"
          : "UNSUPPORTED_MODULE",
    };
  }

  const effectStatePatch = activationResult.effectStatePatch || {};
  return {
    success: true,
    data: {
      family: String(effectStatePatch.superweaponFamily || "").trim().toLowerCase(),
      fxGuid: String(effectStatePatch.guid || ""),
      fuelTypeID: toInt(effectStatePatch.superweaponFuelTypeID, 0),
      fuelPerActivation: Math.max(0, toInt(effectStatePatch.superweaponFuelPerActivation, 0)),
      warningDurationMs: Math.max(0, toFiniteNumber(effectStatePatch.superweaponWarningDurationMs, 0)),
      damageDelayMs: Math.max(0, toFiniteNumber(effectStatePatch.superweaponDamageDelayMs, 0)),
      damageDurationMs: Math.max(0, toFiniteNumber(effectStatePatch.superweaponDamageDurationMs, 0)),
      damageCycleTimeMs: Math.max(0, toFiniteNumber(effectStatePatch.superweaponDamageCycleTimeMs, 0)),
      damageRadius: Math.max(0, toFiniteNumber(effectStatePatch.superweaponDamageRadius, 0)),
      maxRange: Math.max(0, toFiniteNumber(effectStatePatch.superweaponMaxRange, 0)),
      primaryTargetID: toInt(effectStatePatch.superweaponPrimaryTargetID, 0),
      targetPoint: effectStatePatch.superweaponTargetPoint
        ? cloneVector(effectStatePatch.superweaponTargetPoint)
        : null,
    },
  };
}

function broadcastSuperweaponFx(
  scene,
  sourceEntity,
  effectState,
  targetID,
  nowMs,
  options = {},
) {
  if (!scene || !sourceEntity || !effectState || !effectState.guid) {
    return false;
  }
  const baseFxOptions = {
    moduleID: effectState.moduleID,
    moduleTypeID: effectState.typeID,
    targetID: toInt(targetID, 0) || null,
    isOffensive: true,
    start: true,
    active: effectState.superweaponFxStartActive === true,
    duration: Math.max(1, toInt(effectState.superweaponFxDurationMs, 10_000)),
    // `client/nofx.txt`: the doomsday start FX was arriving behind already
    // presented movement/stop history, so the client rewound right as the
    // one-shot fired. Keep the FX on Michelle's presented held-future lane.
    useCurrentStamp: true,
    minimumLeadFromCurrentHistory: 2,
    maximumLeadFromCurrentHistory: 2,
    maximumHistorySafeLeadOverride: 2,
    historyLeadUsesPresentedSessionStamp: true,
    historyLeadPresentedMaximumFutureLead: 2,
    // CCP client treats long one-shot FX startTime as blue/FILETIME. Sending
    // raw milliseconds makes Leviathan/Ragnarok doomsdays look ancient and the
    // client silently drops them before the sequencer ever starts.
    startTime: resolveSuperweaponFxStartFileTime(scene, nowMs),
  };
  scene.broadcastSpecialFx(
    sourceEntity.itemID,
    effectState.guid,
    {
      ...baseFxOptions,
      ...(options && typeof options === "object" ? options : {}),
    },
    sourceEntity,
  );
  return true;
}

function broadcastLanceSuperweaponFxAfterBeaconAcquire(
  scene,
  sourceEntity,
  effectState,
  beaconEntity,
  nowMs,
) {
  if (
    !scene ||
    !sourceEntity ||
    !effectState ||
    effectState.superweaponEffect !== true ||
    !effectState.guid ||
    !beaconEntity
  ) {
    return {
      deliveredCount: 0,
    };
  }

  const beaconDeliveries = scene.broadcastAddBalls([beaconEntity], null, {
    freshAcquire: true,
    nowMs,
    bypassTickPresentationBatch: true,
  });
  if (!Array.isArray(beaconDeliveries) || beaconDeliveries.length === 0) {
    return {
      deliveredCount: 0,
    };
  }

  let deliveredCount = 0;
  for (const delivery of beaconDeliveries) {
    if (!delivery || !delivery.session) {
      continue;
    }
    const fxResult = scene.sendSpecialFxToSession(
      delivery.session,
      sourceEntity.itemID,
      effectState.guid,
      {
        moduleID: effectState.moduleID,
        moduleTypeID: effectState.typeID,
        targetID: beaconEntity.itemID,
        isOffensive: true,
        start: true,
        active: effectState.superweaponFxStartActive === true,
        duration: Math.max(1, toInt(effectState.superweaponFxDurationMs, 10_000)),
        startTime: resolveSuperweaponFxStartFileTime(scene, nowMs),
        // Client parity: once the beacon acquire is delivered, keep the lance
        // start FX on that exact delivered lane so the ball already exists when
        // Michelle processes OnSpecialFX, without widening beyond +2.
        stampOverride:
          delivery.stamp !== null && delivery.stamp !== undefined
            ? (toInt(delivery.stamp, 0) >>> 0)
            : undefined,
        destinyAuthorityAllowPostHeldFuture: true,
      },
      sourceEntity,
    );
    if (fxResult && fxResult.delivered === true) {
      deliveredCount += 1;
    }
  }
  if (
    deliveredCount > 0 &&
    scene &&
    typeof scene.flushDirectDestinyNotificationBatchIfIdle === "function"
  ) {
    scene.flushDirectDestinyNotificationBatchIfIdle();
  }

  return {
    deliveredCount,
  };
}

function executeSuperweaponActivation(options = {}) {
  const {
    scene,
    entity,
    moduleItem,
    effectState,
    nowMs = Date.now(),
    callbacks = {},
  } = options;

  if (!scene || !entity || !moduleItem || !effectState || effectState.superweaponEffect !== true) {
    return {
      success: false,
      errorMsg: "MODULE_NOT_FOUND",
    };
  }

  if (
    callbacks.breakEntityStructureTether &&
    typeof callbacks.breakEntityStructureTether === "function"
  ) {
    callbacks.breakEntityStructureTether(scene, entity, {
      nowMs,
      reason: "SUPERWEAPON_ACTIVATION",
    });
  }

  const consumeFuelResult = consumeSuperweaponFuel(
    entity,
    effectState.superweaponFuelTypeID,
    effectState.superweaponFuelPerActivation,
    callbacks,
  );
  if (!consumeFuelResult.success) {
    return consumeFuelResult;
  }

  if (
    callbacks.stopShipEntity &&
    typeof callbacks.stopShipEntity === "function"
  ) {
    callbacks.stopShipEntity(entity, {
      reason: "superweapon",
      allowSessionlessWarpAbort: true,
    });
  }

  entity.superweaponImmobileUntilMs = Math.max(
    toFiniteNumber(entity.superweaponImmobileUntilMs, 0),
    nowMs + Math.max(0, toFiniteNumber(effectState.superweaponImmobilityDurationMs, 0)),
  );
  entity.superweaponNoJumpOrCloakUntilMs = Math.max(
    toFiniteNumber(entity.superweaponNoJumpOrCloakUntilMs, 0),
    nowMs + Math.max(0, toFiniteNumber(effectState.superweaponNoJumpOrCloakDurationMs, 0)),
  );
  if (
    callbacks.persistDynamicEntity &&
    typeof callbacks.persistDynamicEntity === "function"
  ) {
    callbacks.persistDynamicEntity(entity);
  }

  effectState.superweaponActivatedAtMs = nowMs;
  if (effectState.superweaponFamily === "doomsday") {
    effectState.superweaponDamageApplied = false;
    effectState.superweaponDamageAtMs = nowMs + Math.max(
      0,
      toFiniteNumber(effectState.superweaponDamageDelayMs, 0),
    );
  broadcastSuperweaponFx(
    scene,
    entity,
    effectState,
    effectState.superweaponPrimaryTargetID,
      nowMs,
    );
    return {
      success: true,
      data: {
        specialFxHandled: true,
      },
    };
  }

  const targetPoint = cloneVector(
    effectState.superweaponTargetPoint,
    clampPointToFixedRange(
      entity,
      addVectors(entity.position, scaleVector(entity.direction, effectState.superweaponMaxRange)),
      effectState.superweaponMaxRange,
    ),
  );
  const sourcePosition = cloneVector(entity.position);
  const direction = normalizeVector(
    subtractVectors(targetPoint, sourcePosition),
    entity.direction,
  );
  const beaconEntity = spawnLanceBeacon(scene, entity, targetPoint, nowMs, callbacks);
  if (!beaconEntity) {
    return {
      success: false,
      errorMsg: "TARGET_POINT_REQUIRED",
    };
  }

  effectState.superweaponSourcePosition = sourcePosition;
  effectState.superweaponDirection = direction;
  effectState.superweaponFxTargetID = beaconEntity.itemID;
  effectState.superweaponBeaconID = beaconEntity.itemID;
  effectState.superweaponBeaconExpireAtMs =
    nowMs +
    Math.max(0, toFiniteNumber(effectState.superweaponFxLeadInMs, 0)) +
    Math.max(1, toFiniteNumber(effectState.superweaponFxDurationMs, 10_000)) +
    1_000;
  effectState.superweaponDamageWindowStartMs =
    nowMs + Math.max(0, toFiniteNumber(effectState.superweaponWarningDurationMs, 0));
  effectState.superweaponDamageWindowEndMs =
    effectState.superweaponDamageWindowStartMs +
    Math.max(0, toFiniteNumber(effectState.superweaponDamageDurationMs, 0));
  effectState.superweaponLastProcessedPulse = -1;

  // CCP parity: lances attach their primary FX to the modular-effect beacon,
  // and the client requires that target ball to already exist in ballpark
  // before the OnSpecialFX trigger is processed.
  broadcastLanceSuperweaponFxAfterBeaconAcquire(
    scene,
    entity,
    effectState,
    beaconEntity,
    nowMs,
  );

  return {
    success: true,
    data: {
      specialFxHandled: true,
      beaconEntity,
    },
  };
}

function finalizeSuperweaponDeactivation(options = {}) {
  const {
    scene,
    effectState,
    nowMs = Date.now(),
  } = options;

  if (!scene || !effectState || effectState.superweaponEffect !== true) {
    return {
      success: false,
      errorMsg: "MODULE_NOT_ACTIVE",
    };
  }

  if (toInt(effectState.superweaponBeaconID, 0) > 0) {
    removeTransientEntity(scene, effectState.superweaponBeaconID, nowMs);
    effectState.superweaponBeaconID = 0;
  }

  return {
    success: true,
  };
}

function tickDoomsdayEffect(scene, sourceEntity, effectState, moduleItem, nowMs, callbacks = {}) {
  if (!scene || !sourceEntity || !effectState || effectState.superweaponDamageApplied === true) {
    return;
  }
  if (toFiniteNumber(effectState.superweaponDamageAtMs, 0) > toFiniteNumber(nowMs, 0)) {
    return;
  }

  effectState.superweaponDamageApplied = true;
  const targetEntity = scene.getEntityByID(toInt(effectState.superweaponPrimaryTargetID, 0));
  if (!targetEntity || !hasDamageableHealth(targetEntity)) {
    return;
  }
  applySuperweaponDamage(
    scene,
    sourceEntity,
    targetEntity,
    effectState.superweaponDamageVector,
    moduleItem,
    nowMs,
    callbacks,
  );
}

function tickLanceEffect(scene, sourceEntity, effectState, moduleItem, nowMs, callbacks = {}) {
  if (!scene || !sourceEntity || !effectState) {
    return;
  }

  if (
    toInt(effectState.superweaponBeaconID, 0) > 0 &&
    toFiniteNumber(effectState.superweaponBeaconExpireAtMs, 0) > 0 &&
    toFiniteNumber(nowMs, 0) >= toFiniteNumber(effectState.superweaponBeaconExpireAtMs, 0)
  ) {
    removeTransientEntity(scene, effectState.superweaponBeaconID, nowMs);
    effectState.superweaponBeaconID = 0;
  }

  const windowStart = toFiniteNumber(effectState.superweaponDamageWindowStartMs, 0);
  const windowEnd = toFiniteNumber(effectState.superweaponDamageWindowEndMs, 0);
  if (windowStart <= 0 || windowEnd <= 0 || nowMs < windowStart || windowStart >= windowEnd) {
    return;
  }

  const pulseDurationMs = Math.max(1, toFiniteNumber(effectState.superweaponDamageCycleTimeMs, 1000));
  const elapsed = Math.min(nowMs, windowEnd) - windowStart;
  const latestPulseIndex = Math.floor(elapsed / pulseDurationMs);
  const previousPulseIndex = toInt(effectState.superweaponLastProcessedPulse, -1);
  if (latestPulseIndex <= previousPulseIndex) {
    return;
  }

  const sourcePosition = cloneVector(
    effectState.superweaponSourcePosition,
    sourceEntity.position,
  );
  const direction = normalizeVector(
    effectState.superweaponDirection,
    sourceEntity.direction,
  );
  const length = Math.max(0, toFiniteNumber(effectState.superweaponMaxRange, 0));
  const damageRadius = Math.max(0, toFiniteNumber(effectState.superweaponDamageRadius, 0));

  for (let pulseIndex = previousPulseIndex + 1; pulseIndex <= latestPulseIndex; pulseIndex += 1) {
    const pulseTimeMs = Math.min(windowEnd, windowStart + (pulseIndex * pulseDurationMs));
    for (const targetEntity of collectPotentialCylinderTargets(scene)) {
      if (
        !targetEntity ||
        toInt(targetEntity.itemID, 0) === toInt(sourceEntity.itemID, 0) ||
        !hasDamageableHealth(targetEntity) ||
        !isEntityInsideCylinder(
          sourcePosition,
          direction,
          length,
          damageRadius,
          targetEntity,
        )
      ) {
        continue;
      }

      const damageApplication = resolveSignatureApplicationFactor(
        targetEntity,
        effectState.superweaponWeaponSignatureRadius,
      );
      if (damageApplication > 0) {
        applySuperweaponDamage(
          scene,
          sourceEntity,
          targetEntity,
          scaleDamageVector(effectState.superweaponDamageVector, damageApplication),
          moduleItem,
          pulseTimeMs,
          callbacks,
        );
      }

      const neutRadius = Math.max(
        damageRadius,
        toFiniteNumber(effectState.superweaponEnergyNeutRadius, 0),
      );
      if (
        toFiniteNumber(effectState.superweaponEnergyNeutAmount, 0) > 0 &&
        isEntityInsideCylinder(
          sourcePosition,
          direction,
          length,
          neutRadius,
          targetEntity,
        )
      ) {
        const neutApplication = resolveSignatureApplicationFactor(
          targetEntity,
          effectState.superweaponEnergyNeutSignatureRadius,
        );
        applyCapacitorDrain(
          targetEntity,
          toFiniteNumber(effectState.superweaponEnergyNeutAmount, 0) * neutApplication,
          pulseTimeMs,
          callbacks,
        );
      }
    }
  }

  effectState.superweaponLastProcessedPulse = latestPulseIndex;
}

function tickShowController(scene, controller, nowMs, callbacks = {}) {
  if (!scene || !controller || controller.active !== true) {
    return;
  }

  const fleetA = controller.fleetA
    .map((entry) => ({
      ...entry,
      entity: scene.getEntityByID(toInt(entry && entry.entityID, 0)),
    }))
    .filter((entry) => entry.entity && hasDamageableHealth(entry.entity));
  const fleetB = controller.fleetB
    .map((entry) => ({
      ...entry,
      entity: scene.getEntityByID(toInt(entry && entry.entityID, 0)),
    }))
    .filter((entry) => entry.entity && hasDamageableHealth(entry.entity));

  controller.fleetA = fleetA.map((entry) => ({
    entityID: entry.entityID,
    profile: entry.profile,
    nextFamily: entry.nextFamily,
  }));
  controller.fleetB = fleetB.map((entry) => ({
    entityID: entry.entityID,
    profile: entry.profile,
    nextFamily: entry.nextFamily,
  }));

  if (fleetA.length === 0 || fleetB.length === 0) {
    controller.active = false;
    controller.pendingVolley = [];
    return;
  }

  const pickRandom =
    typeof controller.random === "function"
      ? controller.random
      : Math.random;
  const chooseTarget = (list) => {
    const boundedRandom = Math.min(0.999999, Math.max(0, Number(pickRandom()) || 0));
    return list[Math.floor(boundedRandom * list.length)] || list[0] || null;
  };

  const buildVolleyQueue = () => {
    const queueA = fleetA
      .map((source) => ({
        source,
        targetEntry: chooseTarget(fleetB),
      }))
      .filter((entry) => entry.targetEntry && entry.targetEntry.entity);
    const queueB = fleetB
      .map((source) => ({
        source,
        targetEntry: chooseTarget(fleetA),
      }))
      .filter((entry) => entry.targetEntry && entry.targetEntry.entity);
    const queue = [];
    const pairCount = Math.max(queueA.length, queueB.length);
    for (let index = 0; index < pairCount; index += 1) {
      if (queueA[index]) {
        queue.push(queueA[index]);
      }
      if (queueB[index]) {
        queue.push(queueB[index]);
      }
    }
    return queue;
  };

  for (const source of [...fleetA, ...fleetB]) {
    const targetFleet = fleetA.includes(source) ? fleetB : fleetA;
    const desiredTarget = chooseTarget(targetFleet);
    if (
      !desiredTarget ||
      !desiredTarget.entity ||
      isSuperweaponMovementLocked(source.entity, nowMs) ||
      hasActiveSuperweaponEffect(source.entity)
    ) {
      continue;
    }
    setEntityMotionTowardTarget(source.entity, desiredTarget.entity, callbacks);
  }

  if (toFiniteNumber(controller.nextVolleyAtMs, 0) > toFiniteNumber(nowMs, 0)) {
    return;
  }

  const fireVolley = (source, targetEntry) => {
    const profile = source.profile;
    const sourceEntity = source.entity;
    const targetEntity = targetEntry && targetEntry.entity;
    if (!profile || !sourceEntity || !targetEntity) {
      return false;
    }

    if (
      scene.finalizeTargetLock &&
      typeof scene.finalizeTargetLock === "function"
    ) {
      scene.finalizeTargetLock(sourceEntity, targetEntity, {
        nowMs,
      });
    }

    const nextFamily = String(source.nextFamily || "doomsday").toLowerCase();
    const preferredModule = nextFamily === "lance"
      ? getFittedModuleByTypeID(sourceEntity, profile.lanceTypeID)
      : getFittedModuleByTypeID(sourceEntity, profile.doomsdayTypeID);
    const fallbackModule = nextFamily === "lance"
      ? getFittedModuleByTypeID(sourceEntity, profile.doomsdayTypeID)
      : getFittedModuleByTypeID(sourceEntity, profile.lanceTypeID);
    const moduleItem = preferredModule || fallbackModule;
    if (!moduleItem) {
      return false;
    }

    const pseudoSession = buildNpcPseudoSession(sourceEntity);
    const activationOptions =
      toInt(moduleItem.typeID, 0) === toInt(profile.lanceTypeID, 0)
        ? {
            targetPoint: cloneVector(targetEntity.position),
            repeat: 1,
          }
        : {
            targetID: targetEntity.itemID,
            repeat: 1,
          };
    const activationResult = scene.activateGenericModule(
      pseudoSession,
      moduleItem,
      null,
      activationOptions,
    );
    if (!activationResult || activationResult.success !== true) {
      return false;
    }
    const firedFamily =
      toInt(moduleItem.typeID, 0) === toInt(profile.lanceTypeID, 0)
        ? "lance"
        : "doomsday";
    source.nextFamily =
      preferredModule && fallbackModule
        ? firedFamily === "lance"
          ? "doomsday"
          : "lance"
        : firedFamily;
    return true;
  };

  if (!Array.isArray(controller.pendingVolley) || controller.pendingVolley.length === 0) {
    if (toFiniteNumber(controller.nextVolleyAtMs, 0) > toFiniteNumber(nowMs, 0)) {
      return;
    }
    controller.pendingVolley = buildVolleyQueue();
    controller.nextVolleyStepAtMs = toFiniteNumber(nowMs, 0);
  }

  if (toFiniteNumber(controller.nextVolleyStepAtMs, 0) > toFiniteNumber(nowMs, 0)) {
    return;
  }

  const batchSize = Math.max(
    1,
    toInt(controller.volleyBatchSize, DEFAULT_SHOW_VOLLEY_BATCH_SIZE),
  );
  const volleyStepMs = Math.max(
    1,
    toInt(controller.volleyStepMs, DEFAULT_SHOW_VOLLEY_STEP_MS),
  );
  const batch = controller.pendingVolley.splice(0, batchSize);
  for (const entry of batch) {
    fireVolley(entry.source, entry.targetEntry);
  }

  if (controller.pendingVolley.length > 0) {
    controller.nextVolleyStepAtMs = nowMs + volleyStepMs;
    return;
  }

  controller.nextVolleyStepAtMs = 0;
  controller.nextVolleyAtMs = nowMs + Math.max(
    1,
    toInt(controller.refireMs, DEFAULT_SHOW_REFIRE_MS),
  );
}

function registerSuperTitanShowController(scene, options = {}) {
  if (!scene) {
    return null;
  }
  const nowMs =
    scene.getCurrentSimTimeMs &&
    typeof scene.getCurrentSimTimeMs === "function"
      ? scene.getCurrentSimTimeMs()
      : Date.now();
  scene.superTitanShowController = {
    active: true,
    fleetA: Array.isArray(options.fleetA) ? options.fleetA.map((entry) => ({ ...entry })) : [],
    fleetB: Array.isArray(options.fleetB) ? options.fleetB.map((entry) => ({ ...entry })) : [],
    random: typeof options.random === "function" ? options.random : Math.random,
    refireMs: Math.max(1, toInt(options.refireMs, DEFAULT_SHOW_REFIRE_MS)),
    volleyBatchSize: Math.max(
      1,
      toInt(options.volleyBatchSize, DEFAULT_SHOW_VOLLEY_BATCH_SIZE),
    ),
    volleyStepMs: Math.max(
      1,
      toInt(options.volleyStepMs, DEFAULT_SHOW_VOLLEY_STEP_MS),
    ),
    pendingVolley: [],
    nextVolleyStepAtMs: 0,
    nextVolleyAtMs: nowMs + Math.max(
      0,
      toInt(options.initialDelayMs, DEFAULT_SHOW_INITIAL_DELAY_MS),
    ),
  };
  return scene.superTitanShowController;
}

function tickScene(scene, nowMs, callbacks = {}) {
  if (!scene) {
    return;
  }

  if (scene.dynamicEntities instanceof Map) {
    for (const entity of scene.dynamicEntities.values()) {
      if (!entity || !(entity.activeModuleEffects instanceof Map)) {
        continue;
      }
      for (const effectState of entity.activeModuleEffects.values()) {
        if (!effectState || effectState.superweaponEffect !== true) {
          continue;
        }
        const moduleItem =
          callbacks.getEntityRuntimeModuleItem &&
          typeof callbacks.getEntityRuntimeModuleItem === "function"
            ? callbacks.getEntityRuntimeModuleItem(
                entity,
                effectState.moduleID,
                effectState.moduleFlagID,
              )
            : null;
        if (!moduleItem) {
          continue;
        }
        if (effectState.superweaponFamily === "doomsday") {
          tickDoomsdayEffect(scene, entity, effectState, moduleItem, nowMs, callbacks);
        } else if (effectState.superweaponFamily === "lance") {
          tickLanceEffect(scene, entity, effectState, moduleItem, nowMs, callbacks);
        }
      }
    }
  }

  tickShowController(scene, scene.superTitanShowController, nowMs, callbacks);
}

module.exports = {
  broadcastSuperweaponFxForTesting: broadcastSuperweaponFx,
  buildSuperweaponFreshAcquireFxOptions,
  buildNpcPseudoSession,
  inspectSuperweaponActivationContract,
  isSuperweaponFxReplayWindowActive,
  isSuperweaponMovementLocked,
  isSuperweaponJumpOrCloakLocked,
  prepareSuperweaponActivation,
  executeSuperweaponActivation,
  finalizeSuperweaponDeactivation,
  registerSuperTitanShowController,
  tickScene,
};
