const path = require("path");

const {
  getNpcWeaponModules,
  estimateNpcWeaponEffectiveRange,
} = require(path.join(__dirname, "../npcEquipment"));
const {
  getCapitalRuntimeConfig,
} = require("./capitalNpcRuntimeConfig");

const doctrineCacheByEntity = new WeakMap();

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function getSurfaceDistance(left, right) {
  const dx = toFiniteNumber(left && left.position && left.position.x, 0) -
    toFiniteNumber(right && right.position && right.position.x, 0);
  const dy = toFiniteNumber(left && left.position && left.position.y, 0) -
    toFiniteNumber(right && right.position && right.position.y, 0);
  const dz = toFiniteNumber(left && left.position && left.position.z, 0) -
    toFiniteNumber(right && right.position && right.position.z, 0);
  return Math.max(
    0,
    Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2)) -
      toFiniteNumber(left && left.radius, 0) -
      toFiniteNumber(right && right.radius, 0),
  );
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function buildWeaponSignature(entity) {
  return (Array.isArray(entity && entity.fittedItems) ? entity.fittedItems : [])
    .map((entry) => [
      toPositiveInt(entry && entry.itemID, 0),
      toPositiveInt(entry && entry.typeID, 0),
      toPositiveInt(entry && entry.npcCapabilityTypeID, 0),
    ].join(":"))
    .sort()
    .join("|");
}

function resolveCapitalClassID(entity, behaviorProfile = {}) {
  const explicitClassID = String(
    (entity && entity.capitalClassID) ||
      behaviorProfile.capitalClassID ||
      "",
  ).trim().toLowerCase();
  if (explicitClassID) {
    return explicitClassID;
  }
  if (Array.isArray(behaviorProfile.capitalFighterWingTypeIDs)) {
    return "supercarrier";
  }
  if (toPositiveInt(behaviorProfile.capitalSuperweaponModuleTypeID, 0) > 0) {
    return "titan";
  }
  return "dreadnought";
}

function resolveWeaponMetrics(entity) {
  const weaponRanges = getNpcWeaponModules(entity)
    .map((moduleItem) => Math.max(0, toFiniteNumber(
      estimateNpcWeaponEffectiveRange(entity, moduleItem),
      0,
    )))
    .filter((range) => range > 0)
    .sort((left, right) => left - right);
  if (weaponRanges.length <= 0) {
    return {
      count: 0,
      shortestRangeMeters: 0,
      longestRangeMeters: 0,
      medianRangeMeters: 0,
    };
  }
  return {
    count: weaponRanges.length,
    shortestRangeMeters: weaponRanges[0],
    longestRangeMeters: weaponRanges[weaponRanges.length - 1],
    medianRangeMeters: weaponRanges[Math.floor(weaponRanges.length / 2)],
  };
}

function buildDoctrineForEntity(entity, behaviorProfile = {}) {
  const classID = resolveCapitalClassID(entity, behaviorProfile);
  const runtimeConfig = getCapitalRuntimeConfig(classID);
  const weaponMetrics = resolveWeaponMetrics(entity);
  const explicitRange = Math.max(
    toFiniteNumber(behaviorProfile.followRangeMeters, 0),
    toFiniteNumber(behaviorProfile.orbitDistanceMeters, 0),
  );
  const weightedWeaponRange = Math.max(
    weaponMetrics.medianRangeMeters,
    weaponMetrics.longestRangeMeters * runtimeConfig.preferredRangeFactor,
  );
  const preferredCombatRangeMeters = clamp(
    Math.round(Math.max(explicitRange, weightedWeaponRange, runtimeConfig.minimumPreferredRangeMeters)),
    runtimeConfig.minimumPreferredRangeMeters,
    Math.max(
      runtimeConfig.minimumPreferredRangeMeters,
      runtimeConfig.maximumPreferredRangeMeters,
      explicitRange,
      weaponMetrics.longestRangeMeters,
    ),
  );
  const settleToleranceMeters = Math.max(
    runtimeConfig.settleToleranceMinMeters,
    Math.round(preferredCombatRangeMeters * runtimeConfig.settleToleranceRatio),
  );
  return Object.freeze({
    classID,
    usesFighters: Array.isArray(behaviorProfile.capitalFighterWingTypeIDs),
    hasSuperweapon: toPositiveInt(behaviorProfile.capitalSuperweaponModuleTypeID, 0) > 0,
    preferredCombatRangeMeters,
    settleToleranceMeters,
    settledMovementMode: runtimeConfig.settledMovementMode,
    shortestWeaponRangeMeters: weaponMetrics.shortestRangeMeters,
    longestWeaponRangeMeters: weaponMetrics.longestRangeMeters,
  });
}

function resolveCapitalDoctrine(entity, behaviorProfile = {}) {
  if (!entity || entity.capitalNpc !== true) {
    return null;
  }

  const signature = [
    toPositiveInt(entity && entity.typeID, 0),
    String(resolveCapitalClassID(entity, behaviorProfile)),
    buildWeaponSignature(entity),
    Math.max(
      toFiniteNumber(behaviorProfile.followRangeMeters, 0),
      toFiniteNumber(behaviorProfile.orbitDistanceMeters, 0),
    ),
    toPositiveInt(behaviorProfile.capitalSuperweaponModuleTypeID, 0),
    Array.isArray(behaviorProfile.capitalFighterWingTypeIDs)
      ? behaviorProfile.capitalFighterWingTypeIDs
        .map((entry) => toPositiveInt(entry && entry.typeID, 0))
        .join(",")
      : "",
  ].join("|");
  const cached = doctrineCacheByEntity.get(entity) || null;
  if (cached && cached.signature === signature) {
    return cached.doctrine;
  }

  const doctrine = buildDoctrineForEntity(entity, behaviorProfile);
  doctrineCacheByEntity.set(entity, {
    signature,
    doctrine,
  });
  return doctrine;
}

function resolveCapitalMovementDirective(entity, behaviorProfile, target, fallbackDirective = {}) {
  const doctrine = resolveCapitalDoctrine(entity, behaviorProfile);
  if (!doctrine || !target) {
    return fallbackDirective;
  }

  const preferredCombatRangeMeters = Math.max(0, toFiniteNumber(
    doctrine.preferredCombatRangeMeters,
    0,
  ));
  if (preferredCombatRangeMeters <= 0) {
    return fallbackDirective;
  }

  const settleToleranceMeters = Math.max(0, toFiniteNumber(
    doctrine.settleToleranceMeters,
    0,
  ));
  const currentDistanceMeters = getSurfaceDistance(entity, target);
  if (
    currentDistanceMeters >= preferredCombatRangeMeters - settleToleranceMeters &&
    currentDistanceMeters <= preferredCombatRangeMeters + settleToleranceMeters
  ) {
    return {
      ...fallbackDirective,
      movementMode: doctrine.settledMovementMode,
      orbitDistanceMeters: preferredCombatRangeMeters,
      followRangeMeters: preferredCombatRangeMeters,
      capitalDoctrine: doctrine,
    };
  }

  return {
    ...fallbackDirective,
    movementMode: "follow",
    orbitDistanceMeters: preferredCombatRangeMeters,
    followRangeMeters: preferredCombatRangeMeters,
    capitalDoctrine: doctrine,
  };
}

module.exports = {
  resolveCapitalDoctrine,
  resolveCapitalMovementDirective,
  __testing: {
    buildDoctrineForEntity,
    getSurfaceDistance,
    resolveCapitalClassID,
  },
};
