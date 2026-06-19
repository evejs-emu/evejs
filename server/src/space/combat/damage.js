const path = require("path");

const {
  getAttributeIDByNames,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  currentFileTime,
  buildMarshalReal,
} = require(path.join(__dirname, "../../services/_shared/serviceHelpers"));

const ATTRIBUTE_STRUCTURE_HP = getAttributeIDByNames("hp", "structureHP") || 9;
const ATTRIBUTE_ARMOR_HP = getAttributeIDByNames("armorHP") || 265;
const ATTRIBUTE_SHIELD_CAPACITY = getAttributeIDByNames("shieldCapacity") || 263;
const ATTRIBUTE_ARMOR_EM_RESONANCE =
  getAttributeIDByNames("armorEmDamageResonance") || 267;
const ATTRIBUTE_ARMOR_EXPLOSIVE_RESONANCE =
  getAttributeIDByNames("armorExplosiveDamageResonance") || 268;
const ATTRIBUTE_ARMOR_KINETIC_RESONANCE =
  getAttributeIDByNames("armorKineticDamageResonance") || 269;
const ATTRIBUTE_ARMOR_THERMAL_RESONANCE =
  getAttributeIDByNames("armorThermalDamageResonance") || 270;
const ATTRIBUTE_SHIELD_EM_RESONANCE =
  getAttributeIDByNames("shieldEmDamageResonance") || 271;
const ATTRIBUTE_SHIELD_EXPLOSIVE_RESONANCE =
  getAttributeIDByNames("shieldExplosiveDamageResonance") || 272;
const ATTRIBUTE_SHIELD_KINETIC_RESONANCE =
  getAttributeIDByNames("shieldKineticDamageResonance") || 273;
const ATTRIBUTE_SHIELD_THERMAL_RESONANCE =
  getAttributeIDByNames("shieldThermalDamageResonance") || 274;
const ATTRIBUTE_STRUCTURE_EM_RESONANCE =
  getAttributeIDByNames("emDamageResonance") || 113;
const ATTRIBUTE_STRUCTURE_THERMAL_RESONANCE =
  getAttributeIDByNames("thermalDamageResonance") || 110;
const ATTRIBUTE_STRUCTURE_KINETIC_RESONANCE =
  getAttributeIDByNames("kineticDamageResonance") || 109;
const ATTRIBUTE_STRUCTURE_EXPLOSIVE_RESONANCE =
  getAttributeIDByNames("explosiveDamageResonance") || 111;

const DAMAGE_TYPES = Object.freeze([
  "em",
  "thermal",
  "kinetic",
  "explosive",
]);

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

function getEntityAttributeMap(entity) {
  const attributes =
    entity &&
    entity.passiveDerivedState &&
    entity.passiveDerivedState.attributes &&
    typeof entity.passiveDerivedState.attributes === "object"
      ? entity.passiveDerivedState.attributes
      : null;
  return attributes || null;
}

function getEntityAttributeValue(entity, attributeID, fallback = NaN) {
  const attributes = getEntityAttributeMap(entity);
  if (attributes && attributes[String(attributeID)] !== undefined) {
    return toFiniteNumber(attributes[String(attributeID)], fallback);
  }
  if (attributes && attributes[attributeID] !== undefined) {
    return toFiniteNumber(attributes[attributeID], fallback);
  }
  return fallback;
}

function getEntityMaxHealthLayers(entity) {
  const shieldCapacity = Math.max(
    0,
    toFiniteNumber(
      entity && entity.shieldCapacity,
      getEntityAttributeValue(entity, ATTRIBUTE_SHIELD_CAPACITY, 0),
    ),
  );
  const armorHP = Math.max(
    0,
    toFiniteNumber(
      entity && entity.armorHP,
      getEntityAttributeValue(entity, ATTRIBUTE_ARMOR_HP, 0),
    ),
  );
  const structureHP = Math.max(
    0,
    toFiniteNumber(
      entity && entity.structureHP,
      getEntityAttributeValue(entity, ATTRIBUTE_STRUCTURE_HP, 0),
    ),
  );

  return {
    shield: shieldCapacity,
    armor: armorHP,
    structure: structureHP,
  };
}

function getEntityCurrentHealthLayers(entity, maxLayers = getEntityMaxHealthLayers(entity)) {
  const conditionState =
    entity && entity.conditionState && typeof entity.conditionState === "object"
      ? entity.conditionState
      : {};

  return {
    shield:
      maxLayers.shield > 0
        ? maxLayers.shield * clamp(conditionState.shieldCharge, 0, 1)
        : 0,
    armor:
      maxLayers.armor > 0
        ? maxLayers.armor * clamp(1 - toFiniteNumber(conditionState.armorDamage, 0), 0, 1)
        : 0,
    structure:
      maxLayers.structure > 0
        ? maxLayers.structure * clamp(1 - toFiniteNumber(conditionState.damage, 0), 0, 1)
        : 0,
  };
}

function hasDamageableHealth(entity) {
  const maxLayers = getEntityMaxHealthLayers(entity);
  return maxLayers.shield > 0 || maxLayers.armor > 0 || maxLayers.structure > 0;
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

function sumDamageVector(vector) {
  return DAMAGE_TYPES.reduce(
    (sum, damageType) => sum + Math.max(0, toFiniteNumber(vector && vector[damageType], 0)),
    0,
  );
}

function getLayerResonances(entity, layerName) {
  if (layerName === "shield") {
    return {
      em: Math.max(0, toFiniteNumber(
        getEntityAttributeValue(entity, ATTRIBUTE_SHIELD_EM_RESONANCE, 1),
        1,
      )),
      thermal: Math.max(0, toFiniteNumber(
        getEntityAttributeValue(entity, ATTRIBUTE_SHIELD_THERMAL_RESONANCE, 1),
        1,
      )),
      kinetic: Math.max(0, toFiniteNumber(
        getEntityAttributeValue(entity, ATTRIBUTE_SHIELD_KINETIC_RESONANCE, 1),
        1,
      )),
      explosive: Math.max(0, toFiniteNumber(
        getEntityAttributeValue(entity, ATTRIBUTE_SHIELD_EXPLOSIVE_RESONANCE, 1),
        1,
      )),
    };
  }

  if (layerName === "armor") {
    return {
      em: Math.max(0, toFiniteNumber(
        getEntityAttributeValue(entity, ATTRIBUTE_ARMOR_EM_RESONANCE, 1),
        1,
      )),
      thermal: Math.max(0, toFiniteNumber(
        getEntityAttributeValue(entity, ATTRIBUTE_ARMOR_THERMAL_RESONANCE, 1),
        1,
      )),
      kinetic: Math.max(0, toFiniteNumber(
        getEntityAttributeValue(entity, ATTRIBUTE_ARMOR_KINETIC_RESONANCE, 1),
        1,
      )),
      explosive: Math.max(0, toFiniteNumber(
        getEntityAttributeValue(entity, ATTRIBUTE_ARMOR_EXPLOSIVE_RESONANCE, 1),
        1,
      )),
    };
  }

  return {
    em: Math.max(0, toFiniteNumber(
      getEntityAttributeValue(entity, ATTRIBUTE_STRUCTURE_EM_RESONANCE, 1),
      1,
    )),
    thermal: Math.max(0, toFiniteNumber(
      getEntityAttributeValue(entity, ATTRIBUTE_STRUCTURE_THERMAL_RESONANCE, 1),
      1,
    )),
    kinetic: Math.max(0, toFiniteNumber(
      getEntityAttributeValue(entity, ATTRIBUTE_STRUCTURE_KINETIC_RESONANCE, 1),
      1,
    )),
    explosive: Math.max(0, toFiniteNumber(
      getEntityAttributeValue(entity, ATTRIBUTE_STRUCTURE_EXPLOSIVE_RESONANCE, 1),
      1,
    )),
  };
}

function getEntityHealthRatios(entity) {
  if (!hasDamageableHealth(entity)) {
    return {
      shieldRatio: 1,
      armorRatio: 1,
      structureRatio: 1,
      shieldTau: 110000,
    };
  }

  const maxLayers = getEntityMaxHealthLayers(entity);
  const currentLayers = getEntityCurrentHealthLayers(entity, maxLayers);
  return {
    shieldRatio:
      maxLayers.shield > 0 ? clamp(currentLayers.shield / maxLayers.shield, 0, 1) : 0,
    armorRatio:
      maxLayers.armor > 0 ? clamp(currentLayers.armor / maxLayers.armor, 0, 1) : 0,
    structureRatio:
      maxLayers.structure > 0
        ? clamp(currentLayers.structure / maxLayers.structure, 0, 1)
        : 0,
    shieldTau:
      maxLayers.shield > 0
        ? Math.max(0, toFiniteNumber(entity && entity.shieldRechargeRate, 0) / 5)
        : 0,
  };
}

function buildDamageState(entity, simFileTime = currentFileTime()) {
  const {
    shieldRatio,
    armorRatio,
    structureRatio,
    shieldTau,
  } = getEntityHealthRatios(entity);

  return [
    [
      buildMarshalReal(shieldRatio, 0),
      buildMarshalReal(shieldTau, 0),
      { type: "long", value: simFileTime },
    ],
    buildMarshalReal(armorRatio, 0),
    buildMarshalReal(structureRatio, 0),
  ];
}

function buildLiveDamageState(entity, simFileTime = currentFileTime()) {
  return buildDamageState(entity, simFileTime);
}

function applyDamageToEntity(entity, rawDamage, options = {}) {
  if (!entity || !hasDamageableHealth(entity)) {
    return {
      success: false,
      errorMsg: "ENTITY_NOT_DAMAGEABLE",
    };
  }

  const maxLayers = getEntityMaxHealthLayers(entity);
  const startingLayers = getEntityCurrentHealthLayers(entity, maxLayers);
  const beforeConditionState = {
    ...(entity.conditionState || {}),
  };
  const rawRemaining = normalizeDamageVector(rawDamage);
  const perLayer = [];

  for (const layerName of ["shield", "armor", "structure"]) {
    const maxHP = maxLayers[layerName];
    let currentHP = startingLayers[layerName];
    if (maxHP <= 0 || currentHP <= 0 || sumDamageVector(rawRemaining) <= 0) {
      perLayer.push({
        layer: layerName,
        maxHP: round6(maxHP),
        beforeHP: round6(currentHP),
        afterHP: round6(currentHP),
        appliedRaw: normalizeDamageVector(null),
        appliedEffective: 0,
      });
      continue;
    }

    const resonances = getLayerResonances(entity, layerName);
    const effectiveRemaining = DAMAGE_TYPES.reduce(
      (sum, damageType) => sum + (rawRemaining[damageType] * resonances[damageType]),
      0,
    );
    if (effectiveRemaining <= 0) {
      perLayer.push({
        layer: layerName,
        maxHP: round6(maxHP),
        beforeHP: round6(currentHP),
        afterHP: round6(currentHP),
        appliedRaw: normalizeDamageVector(null),
        appliedEffective: 0,
      });
      continue;
    }

    const beforeHP = currentHP;
    let appliedRaw = normalizeDamageVector(null);
    let appliedEffective = 0;
    if (effectiveRemaining <= currentHP + 1e-9) {
      for (const damageType of DAMAGE_TYPES) {
        appliedRaw[damageType] = rawRemaining[damageType];
        rawRemaining[damageType] = 0;
        appliedEffective += appliedRaw[damageType] * resonances[damageType];
      }
      currentHP = Math.max(0, currentHP - appliedEffective);
    } else {
      const consumedFraction = currentHP / effectiveRemaining;
      for (const damageType of DAMAGE_TYPES) {
        const consumedRaw = rawRemaining[damageType] * consumedFraction;
        appliedRaw[damageType] = consumedRaw;
        rawRemaining[damageType] = Math.max(0, rawRemaining[damageType] - consumedRaw);
        appliedEffective += consumedRaw * resonances[damageType];
      }
      currentHP = 0;
    }

    startingLayers[layerName] = currentHP;
    perLayer.push({
      layer: layerName,
      maxHP: round6(maxHP),
      beforeHP: round6(beforeHP),
      afterHP: round6(currentHP),
      appliedRaw: normalizeDamageVector(appliedRaw),
      appliedEffective: round6(appliedEffective),
    });
  }

  entity.conditionState = {
    ...(entity.conditionState || {}),
    damage:
      maxLayers.structure > 0
        ? round6(1 - clamp(startingLayers.structure / maxLayers.structure, 0, 1))
        : 1,
    charge: clamp(
      toFiniteNumber(
        beforeConditionState.charge,
        entity.capacitorChargeRatio === undefined ? 1 : entity.capacitorChargeRatio,
      ),
      0,
      1,
    ),
    armorDamage:
      maxLayers.armor > 0
        ? round6(1 - clamp(startingLayers.armor / maxLayers.armor, 0, 1))
        : 0,
    shieldCharge:
      maxLayers.shield > 0
        ? round6(clamp(startingLayers.shield / maxLayers.shield, 0, 1))
        : 0,
    incapacitated:
      options.incapacitated === undefined || options.incapacitated === null
        ? Boolean(beforeConditionState.incapacitated)
        : Boolean(options.incapacitated),
  };

  return {
    success: true,
    data: {
      maxLayers: {
        shield: round6(maxLayers.shield),
        armor: round6(maxLayers.armor),
        structure: round6(maxLayers.structure),
      },
      beforeLayers: {
        shield: round6(getEntityCurrentHealthLayers(
          { ...entity, conditionState: beforeConditionState },
          maxLayers,
        ).shield),
        armor: round6(getEntityCurrentHealthLayers(
          { ...entity, conditionState: beforeConditionState },
          maxLayers,
        ).armor),
        structure: round6(getEntityCurrentHealthLayers(
          { ...entity, conditionState: beforeConditionState },
          maxLayers,
        ).structure),
      },
      afterLayers: {
        shield: round6(startingLayers.shield),
        armor: round6(startingLayers.armor),
        structure: round6(startingLayers.structure),
      },
      beforeConditionState,
      afterConditionState: {
        ...entity.conditionState,
      },
      perLayer,
      rawDamage: normalizeDamageVector(rawDamage),
      remainingRaw: normalizeDamageVector(rawRemaining),
      destroyed:
        maxLayers.structure > 0 &&
        startingLayers.structure <= 1e-9 &&
        sumDamageVector(rawDamage) > 0,
    },
  };
}

module.exports = {
  DAMAGE_TYPES,
  normalizeDamageVector,
  sumDamageVector,
  hasDamageableHealth,
  getEntityMaxHealthLayers,
  getEntityCurrentHealthLayers,
  buildDamageState,
  buildLiveDamageState,
  applyDamageToEntity,
};
