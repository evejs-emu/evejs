const path = require("path");

const {
  getAttributeIDByNames,
  getEffectTypeRecord,
  getLoadedChargeByFlag,
  getFittedModuleItems,
  getTypeAttributeMap,
  getTypeEffectRecords,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  findItemById,
  findShipItemById,
  getItemMutationVersion,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildLocationModifiedAttributeMap,
  collectShipModifierAttributes,
} = require(path.join(__dirname, "../../space/combat/weaponDogma"));
const {
  getLocationModifierSourcesForSystem,
} = require(path.join(
  __dirname,
  "../exploration/wormholes/wormholeEnvironmentRuntime",
));

const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_FALLOFF = getAttributeIDByNames("falloff") || 158;
const ATTRIBUTE_TRACKING_SPEED = getAttributeIDByNames("trackingSpeed") || 160;
const ATTRIBUTE_OPTIMAL_SIG_RADIUS = getAttributeIDByNames("optimalSigRadius") || 620;
const ATTRIBUTE_SIGNATURE_RADIUS = getAttributeIDByNames("signatureRadius") || 552;
const ATTRIBUTE_ECM_JAM_DURATION = getAttributeIDByNames("ecmJamDuration") || 2822;
const ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH_BONUS =
  getAttributeIDByNames("scanGravimetricStrengthBonus") || 238;
const ATTRIBUTE_SCAN_LADAR_STRENGTH_BONUS =
  getAttributeIDByNames("scanLadarStrengthBonus") || 239;
const ATTRIBUTE_SCAN_MAGNETOMETRIC_STRENGTH_BONUS =
  getAttributeIDByNames("scanMagnetometricStrengthBonus") || 240;
const ATTRIBUTE_SCAN_RADAR_STRENGTH_BONUS =
  getAttributeIDByNames("scanRadarStrengthBonus") || 241;
const ATTRIBUTE_DAMAGE_MULTIPLIER = getAttributeIDByNames("damageMultiplier") || 64;
const ATTRIBUTE_EM_DAMAGE = getAttributeIDByNames("emDamage") || 114;
const ATTRIBUTE_EXPLOSIVE_DAMAGE = getAttributeIDByNames("explosiveDamage") || 116;
const ATTRIBUTE_KINETIC_DAMAGE = getAttributeIDByNames("kineticDamage") || 117;
const ATTRIBUTE_THERMAL_DAMAGE = getAttributeIDByNames("thermalDamage") || 118;
const ATTRIBUTE_ENTITY_FLY_RANGE = getAttributeIDByNames("entityFlyRange") || 416;
const ATTRIBUTE_ENTITY_ATTACK_RANGE = getAttributeIDByNames("entityAttackRange") || 72;
const ATTRIBUTE_ENTITY_CHASE_MAX_DISTANCE =
  getAttributeIDByNames("entityChaseMaxDistance") || 613;
const ATTRIBUTE_ORBIT_RANGE = getAttributeIDByNames("orbitRange") || 4161;
const ATTRIBUTE_MINING_AMOUNT = getAttributeIDByNames("miningAmount") || 77;
const ATTRIBUTE_ACCESS_DIFFICULTY_BONUS =
  getAttributeIDByNames("accessDifficultyBonus") || 902;

const COMBAT_EFFECT_NAMES = new Set(["targetattack"]);
const ECM_EFFECT_NAMES = new Set(["entityecmfalloff"]);
const MINING_EFFECT_NAMES = new Set(["mining", "miningclouds"]);
const SALVAGE_EFFECT_NAMES = new Set(["salvagedroneeffect"]);

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

function buildDamageVector(attributes = {}) {
  return {
    em: Math.max(0, round6(toFiniteNumber(attributes[ATTRIBUTE_EM_DAMAGE], 0))),
    thermal: Math.max(0, round6(toFiniteNumber(attributes[ATTRIBUTE_THERMAL_DAMAGE], 0))),
    kinetic: Math.max(0, round6(toFiniteNumber(attributes[ATTRIBUTE_KINETIC_DAMAGE], 0))),
    explosive: Math.max(0, round6(toFiniteNumber(attributes[ATTRIBUTE_EXPLOSIVE_DAMAGE], 0))),
  };
}

function sumDamageVector(vector = {}) {
  return round6(
    Math.max(0, toFiniteNumber(vector.em, 0)) +
      Math.max(0, toFiniteNumber(vector.thermal, 0)) +
      Math.max(0, toFiniteNumber(vector.kinetic, 0)) +
      Math.max(0, toFiniteNumber(vector.explosive, 0)),
  );
}

function buildControllerDogmaFingerprint(controllerEntity, fittedItems = []) {
  const shipID = toInt(controllerEntity && controllerEntity.itemID, 0);
  const shipMutationVersion =
    shipID > 0 ? toInt(getItemMutationVersion(shipID), 0) : 0;
  const systemID = toInt(controllerEntity && controllerEntity.systemID, 0);
  const fittedMutationFingerprint = fittedItems
    .map((item) => `${toInt(item && item.itemID, 0)}:${toInt(getItemMutationVersion(item && item.itemID), 0)}`)
    .join("|");
  const activeEffectFingerprint =
    controllerEntity && controllerEntity.activeModuleEffects instanceof Map
      ? [...controllerEntity.activeModuleEffects.values()]
        .filter(Boolean)
        .map((effectState) => (
          `${toInt(effectState && effectState.moduleID, 0)}:` +
          `${toInt(effectState && effectState.effectID, 0)}:` +
          `${toInt(effectState && effectState.chargeTypeID, 0)}`
        ))
        .sort()
        .join("|")
      : "";
  return `${shipMutationVersion}#${systemID}#${fittedMutationFingerprint}#${activeEffectFingerprint}`;
}

function buildActiveModuleContexts(controllerEntity, fittedItems = [], characterID = 0) {
  if (!controllerEntity || !(controllerEntity.activeModuleEffects instanceof Map)) {
    return [];
  }

  return [...controllerEntity.activeModuleEffects.values()]
    .filter(Boolean)
    .map((effectState) => {
      const moduleItem = fittedItems.find((item) => (
        toInt(item && item.itemID, 0) === toInt(effectState && effectState.moduleID, 0) ||
        (
          toInt(effectState && effectState.moduleFlagID, 0) > 0 &&
          toInt(item && item.flagID, 0) === toInt(effectState && effectState.moduleFlagID, 0)
        )
      )) || null;
      if (!moduleItem) {
        return null;
      }

      return {
        effectState,
        effectRecord: getEffectTypeRecord(toInt(effectState && effectState.effectID, 0)),
        moduleItem,
        chargeItem:
          characterID > 0 && toInt(moduleItem && moduleItem.flagID, 0) > 0
            ? getLoadedChargeByFlag(
              characterID,
              toInt(controllerEntity && controllerEntity.itemID, 0),
              toInt(moduleItem && moduleItem.flagID, 0),
            )
            : null,
      };
    })
    .filter((entry) => entry && entry.effectRecord && entry.moduleItem);
}

function getControllerDogmaContext(controllerEntity) {
  const controllerShipID = toInt(controllerEntity && controllerEntity.itemID, 0);
  if (controllerShipID <= 0) {
    return null;
  }

  const controllerOwnerID = toInt(
    controllerEntity &&
      (
        controllerEntity.session && controllerEntity.session.characterID
      ) ||
      controllerEntity &&
      (
        controllerEntity.pilotCharacterID ??
        controllerEntity.characterID ??
        controllerEntity.ownerID
      ),
    0,
  );
  const shipItem = findShipItemById(controllerShipID) || findItemById(controllerShipID) || null;
  if (!shipItem) {
    return null;
  }

  const fittedItems =
    controllerOwnerID > 0
      ? getFittedModuleItems(controllerOwnerID, controllerShipID)
      : [];
  const fingerprint = buildControllerDogmaFingerprint(controllerEntity, fittedItems);
  const cached =
    controllerEntity &&
    controllerEntity.droneDogmaCache &&
    controllerEntity.droneDogmaCache.fingerprint === fingerprint
      ? controllerEntity.droneDogmaCache
      : null;
  if (cached) {
    return cached;
  }

  const skillMap =
    controllerOwnerID > 0
      ? getCharacterSkillMap(controllerOwnerID)
      : new Map();
  const activeModuleContexts = buildActiveModuleContexts(
    controllerEntity,
    fittedItems,
    controllerOwnerID,
  );
  const shipModifierAttributes = collectShipModifierAttributes(shipItem, skillMap);
  const additionalLocationModifierSources = getLocationModifierSourcesForSystem(
    controllerEntity && controllerEntity.systemID,
  );
  const nextCache = {
    fingerprint,
    shipItem,
    skillMap,
    fittedItems,
    activeModuleContexts,
    shipModifierAttributes,
    additionalLocationModifierSources,
    combatByTypeID: new Map(),
    miningByTypeID: new Map(),
    salvageByTypeID: new Map(),
  };
  controllerEntity.droneDogmaCache = nextCache;
  return nextCache;
}

function resolveDroneEffectRecord(typeID, acceptedNames = new Set()) {
  for (const effectRecord of getTypeEffectRecords(typeID)) {
    const normalizedName = String(effectRecord && effectRecord.name || "").trim().toLowerCase();
    if (acceptedNames.has(normalizedName)) {
      return effectRecord;
    }
  }
  return null;
}

function buildDroneOperationalAttributes(droneEntity, controllerEntity) {
  const context = getControllerDogmaContext(controllerEntity);
  if (!context || !droneEntity) {
    return null;
  }

  const droneItem = findItemById(toInt(droneEntity.itemID, 0)) || {
    itemID: toInt(droneEntity.itemID, 0),
    typeID: toInt(droneEntity.typeID, 0),
    groupID: toInt(droneEntity.groupID, 0),
    categoryID: toInt(droneEntity.categoryID, 0),
    ownerID: toInt(droneEntity.ownerID, 0),
    locationID: toInt(droneEntity.systemID, 0),
    flagID: 0,
    singleton: 1,
    quantity: 1,
    stacksize: 1,
  };

  const attributes = buildLocationModifiedAttributeMap(
    droneItem,
    context.shipItem,
    context.skillMap,
    context.shipModifierAttributes,
    context.fittedItems,
    context.activeModuleContexts,
    {
      additionalLocationModifierSources: context.additionalLocationModifierSources,
    },
  );
  if (!attributes || Object.keys(attributes).length === 0) {
    return null;
  }
  return { context, attributes };
}

function resolveDroneCombatSnapshot(droneEntity, controllerEntity) {
  const context = getControllerDogmaContext(controllerEntity);
  const typeID = toInt(droneEntity && droneEntity.typeID, 0);
  if (!context || typeID <= 0) {
    return null;
  }

  if (context.combatByTypeID.has(typeID)) {
    return context.combatByTypeID.get(typeID);
  }

  const effectRecord = resolveDroneEffectRecord(typeID, COMBAT_EFFECT_NAMES);
  const jammerEffectRecord = effectRecord
    ? null
    : resolveDroneEffectRecord(typeID, ECM_EFFECT_NAMES);
  if (!effectRecord && !jammerEffectRecord) {
    context.combatByTypeID.set(typeID, null);
    return null;
  }

  const operational = buildDroneOperationalAttributes(droneEntity, controllerEntity);
  if (!operational) {
    context.combatByTypeID.set(typeID, null);
    return null;
  }

  const attributes = operational.attributes;
  const baseDamage = buildDamageVector(attributes);
  const damageMultiplier = Math.max(
    0,
    round6(toFiniteNumber(attributes[ATTRIBUTE_DAMAGE_MULTIPLIER], 1)),
  );
  const rawShotDamage = {
    em: round6(baseDamage.em * damageMultiplier),
    thermal: round6(baseDamage.thermal * damageMultiplier),
    kinetic: round6(baseDamage.kinetic * damageMultiplier),
    explosive: round6(baseDamage.explosive * damageMultiplier),
  };
  if (!jammerEffectRecord && sumDamageVector(rawShotDamage) <= 0) {
    context.combatByTypeID.set(typeID, null);
    return null;
  }

  if (jammerEffectRecord) {
    const durationMs = Math.max(
      1,
      round6(toFiniteNumber(attributes[jammerEffectRecord.durationAttributeID], 20_000)),
    );
    const optimalRange = Math.max(
      0,
      round6(toFiniteNumber(attributes[jammerEffectRecord.rangeAttributeID], 0)),
    );
    const falloff = Math.max(
      0,
      round6(
        toFiniteNumber(
          attributes[jammerEffectRecord.falloffAttributeID],
          0,
        ),
      ),
    );
    const orbitDistanceMeters = Math.max(
      500,
      round6(
        toFiniteNumber(
          attributes[ATTRIBUTE_ENTITY_FLY_RANGE],
          toFiniteNumber(attributes[ATTRIBUTE_ORBIT_RANGE], 500),
        ),
      ),
    );
    const attackRangeMeters = Math.max(
      optimalRange,
      round6(optimalRange + falloff),
    );
    const chaseRangeMeters = Math.max(
      attackRangeMeters,
      round6(
        Math.max(
          attackRangeMeters,
          toFiniteNumber(attributes[ATTRIBUTE_ENTITY_ATTACK_RANGE], 0),
        ),
      ),
    );
    const snapshot = {
      effectID: toInt(jammerEffectRecord.effectID, 0),
      effectName: String(jammerEffectRecord.name || ""),
      effectGUID: String(jammerEffectRecord.guid || ""),
      effectKind: "jammer",
      durationMs,
      jamDurationMs: Math.max(
        1,
        round6(toFiniteNumber(attributes[ATTRIBUTE_ECM_JAM_DURATION], 5_000)),
      ),
      optimalRange,
      falloff,
      orbitDistanceMeters,
      attackRangeMeters,
      chaseRangeMeters,
      jammerStrengthBySensorType: Object.freeze({
        gravimetric: Math.max(
          0,
          round6(toFiniteNumber(attributes[ATTRIBUTE_SCAN_GRAVIMETRIC_STRENGTH_BONUS], 0)),
        ),
        ladar: Math.max(
          0,
          round6(toFiniteNumber(attributes[ATTRIBUTE_SCAN_LADAR_STRENGTH_BONUS], 0)),
        ),
        magnetometric: Math.max(
          0,
          round6(toFiniteNumber(attributes[ATTRIBUTE_SCAN_MAGNETOMETRIC_STRENGTH_BONUS], 0)),
        ),
        radar: Math.max(
          0,
          round6(toFiniteNumber(attributes[ATTRIBUTE_SCAN_RADAR_STRENGTH_BONUS], 0)),
        ),
      }),
    };
    context.combatByTypeID.set(typeID, snapshot);
    return snapshot;
  }

  const durationMs = Math.max(
    1,
    round6(
      toFiniteNumber(
        attributes[ATTRIBUTE_SPEED],
        toFiniteNumber(attributes[ATTRIBUTE_DURATION], 1000),
      ),
    ),
  );
  const optimalRange = Math.max(
    0,
    round6(toFiniteNumber(attributes[ATTRIBUTE_MAX_RANGE], 0)),
  );
  const falloff = Math.max(
    0,
    round6(toFiniteNumber(attributes[ATTRIBUTE_FALLOFF], 0)),
  );
  const trackingSpeed = Math.max(
    0,
    round6(toFiniteNumber(attributes[ATTRIBUTE_TRACKING_SPEED], 0)),
  );
  const optimalSigRadius = Math.max(
    1,
    round6(
      toFiniteNumber(
        attributes[ATTRIBUTE_OPTIMAL_SIG_RADIUS],
        toFiniteNumber(attributes[ATTRIBUTE_SIGNATURE_RADIUS], 25),
      ),
    ),
  );
  const orbitDistanceMeters = Math.max(
    0,
    round6(
      toFiniteNumber(
        attributes[ATTRIBUTE_ENTITY_FLY_RANGE],
        toFiniteNumber(attributes[ATTRIBUTE_ORBIT_RANGE], 500),
      ),
    ),
  );
  const attackRangeMeters = Math.max(
    0,
    round6(
      Math.max(
        toFiniteNumber(attributes[ATTRIBUTE_ENTITY_ATTACK_RANGE], 0),
        optimalRange,
      ),
    ),
  );
  const chaseRangeMeters = Math.max(
    attackRangeMeters,
    round6(
      Math.max(
        attackRangeMeters + falloff,
        toFiniteNumber(attributes[ATTRIBUTE_ENTITY_CHASE_MAX_DISTANCE], 0),
      ),
    ),
  );

  const snapshot = {
    effectID: toInt(effectRecord.effectID, 0),
    effectName: String(effectRecord.name || ""),
    effectGUID: String(effectRecord.guid || ""),
    durationMs,
    optimalRange,
    falloff,
    trackingSpeed,
    optimalSigRadius,
    damageMultiplier,
    rawShotDamage,
    orbitDistanceMeters,
    attackRangeMeters,
    chaseRangeMeters,
  };
  context.combatByTypeID.set(typeID, snapshot);
  return snapshot;
}

function resolveDroneMiningSnapshot(droneEntity, controllerEntity) {
  const context = getControllerDogmaContext(controllerEntity);
  const typeID = toInt(droneEntity && droneEntity.typeID, 0);
  if (!context || typeID <= 0) {
    return null;
  }

  if (context.miningByTypeID.has(typeID)) {
    return context.miningByTypeID.get(typeID);
  }

  const effectRecord = resolveDroneEffectRecord(typeID, MINING_EFFECT_NAMES);
  if (!effectRecord) {
    context.miningByTypeID.set(typeID, null);
    return null;
  }

  const operational = buildDroneOperationalAttributes(droneEntity, controllerEntity);
  if (!operational) {
    context.miningByTypeID.set(typeID, null);
    return null;
  }

  const attributes = operational.attributes;
  const miningAmountM3 = Math.max(
    0,
    round6(toFiniteNumber(attributes[ATTRIBUTE_MINING_AMOUNT], 0)),
  );
  if (miningAmountM3 <= 0) {
    context.miningByTypeID.set(typeID, null);
    return null;
  }

  const durationMs = Math.max(
    1,
    round6(
      toFiniteNumber(
        attributes[ATTRIBUTE_DURATION],
        toFiniteNumber(attributes[ATTRIBUTE_SPEED], 1000),
      ),
    ),
  );
  const snapshot = {
    effectID: toInt(effectRecord.effectID, 0),
    effectName: String(effectRecord.name || ""),
    effectGUID: String(effectRecord.guid || ""),
    durationMs,
    miningAmountM3,
    maxRangeMeters: Math.max(
      0,
      round6(toFiniteNumber(attributes[ATTRIBUTE_MAX_RANGE], 0)),
    ),
    orbitDistanceMeters: Math.max(
      0,
      round6(
        toFiniteNumber(
          attributes[ATTRIBUTE_ORBIT_RANGE],
          toFiniteNumber(attributes[ATTRIBUTE_ENTITY_FLY_RANGE], 200),
        ),
      ),
    ),
  };
  context.miningByTypeID.set(typeID, snapshot);
  return snapshot;
}

function resolveDroneSalvageSnapshot(droneEntity, controllerEntity) {
  const context = getControllerDogmaContext(controllerEntity);
  const typeID = toInt(droneEntity && droneEntity.typeID, 0);
  if (!context || typeID <= 0) {
    return null;
  }

  if (context.salvageByTypeID.has(typeID)) {
    return context.salvageByTypeID.get(typeID);
  }

  const effectRecord = resolveDroneEffectRecord(typeID, SALVAGE_EFFECT_NAMES);
  if (!effectRecord) {
    context.salvageByTypeID.set(typeID, null);
    return null;
  }

  const operational = buildDroneOperationalAttributes(droneEntity, controllerEntity);
  if (!operational) {
    context.salvageByTypeID.set(typeID, null);
    return null;
  }

  const attributes = operational.attributes;
  const accessBonusPercent = Math.max(
    0,
    round6(toFiniteNumber(attributes[ATTRIBUTE_ACCESS_DIFFICULTY_BONUS], 0)),
  );
  if (accessBonusPercent <= 0) {
    context.salvageByTypeID.set(typeID, null);
    return null;
  }

  const durationMs = Math.max(
    1,
    round6(
      toFiniteNumber(
        attributes[ATTRIBUTE_DURATION],
        toFiniteNumber(attributes[ATTRIBUTE_SPEED], 1000),
      ),
    ),
  );
  const snapshot = {
    effectID: toInt(effectRecord.effectID, 0),
    effectName: String(effectRecord.name || ""),
    effectGUID: String(effectRecord.guid || ""),
    durationMs,
    accessBonusPercent,
    maxRangeMeters: Math.max(
      0,
      round6(toFiniteNumber(attributes[ATTRIBUTE_MAX_RANGE], 0)),
    ),
    orbitDistanceMeters: Math.max(
      0,
      round6(
        toFiniteNumber(
          attributes[ATTRIBUTE_ORBIT_RANGE],
          toFiniteNumber(attributes[ATTRIBUTE_ENTITY_FLY_RANGE], 500),
        ),
      ),
    ),
  };
  context.salvageByTypeID.set(typeID, snapshot);
  return snapshot;
}

module.exports = {
  resolveDroneCombatSnapshot,
  resolveDroneMiningSnapshot,
  resolveDroneSalvageSnapshot,
  _testing: {
    getControllerDogmaContext,
    buildDamageVector,
    sumDamageVector,
    buildControllerDogmaFingerprint,
  },
};
