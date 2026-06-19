const path = require("path");

const {
  normalizeDamageVector,
  sumDamageVector,
} = require(path.join(__dirname, "./damage"));

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

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function dot(left, right) {
  return (
    (toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.x, 0)) +
    (toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.y, 0)) +
    (toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.z, 0))
  );
}

function magnitude(vector) {
  return Math.sqrt(dot(vector, vector));
}

function getSurfaceDistance(sourceEntity, targetEntity) {
  const delta = subtractVectors(targetEntity && targetEntity.position, sourceEntity && sourceEntity.position);
  return Math.max(
    0,
    magnitude(delta) -
      Math.max(0, toFiniteNumber(sourceEntity && sourceEntity.radius, 0)) -
      Math.max(0, toFiniteNumber(targetEntity && targetEntity.radius, 0)),
  );
}

function getAngularVelocity(sourceEntity, targetEntity) {
  const relativePosition = subtractVectors(
    targetEntity && targetEntity.position,
    sourceEntity && sourceEntity.position,
  );
  const centerDistance = Math.max(magnitude(relativePosition), 1);
  const relativeVelocity = subtractVectors(
    targetEntity && targetEntity.velocity,
    sourceEntity && sourceEntity.velocity,
  );
  const radialUnit = {
    x: relativePosition.x / centerDistance,
    y: relativePosition.y / centerDistance,
    z: relativePosition.z / centerDistance,
  };
  const radialSpeed = dot(relativeVelocity, radialUnit);
  const tangentialVelocity = {
    x: relativeVelocity.x - (radialUnit.x * radialSpeed),
    y: relativeVelocity.y - (radialUnit.y * radialSpeed),
    z: relativeVelocity.z - (radialUnit.z * radialSpeed),
  };
  return magnitude(tangentialVelocity) / centerDistance;
}

function getTargetSignatureRadius(entity) {
  const signatureRadius = Math.max(0, toFiniteNumber(entity && entity.signatureRadius, 0));
  if (signatureRadius > 0) {
    return signatureRadius;
  }
  return Math.max(1, toFiniteNumber(entity && entity.radius, 1));
}

function scaleDamageVector(vector, scale) {
  const resolvedScale = toFiniteNumber(scale, 0);
  return {
    em: round6(toFiniteNumber(vector && vector.em, 0) * resolvedScale),
    thermal: round6(toFiniteNumber(vector && vector.thermal, 0) * resolvedScale),
    kinetic: round6(toFiniteNumber(vector && vector.kinetic, 0) * resolvedScale),
    explosive: round6(toFiniteNumber(vector && vector.explosive, 0) * resolvedScale),
  };
}

function resolveTurretShot({
  attackerEntity,
  targetEntity,
  weaponSnapshot,
  randomValue = Math.random(),
} = {}) {
  const resolvedRawDamage = normalizeDamageVector(
    weaponSnapshot && weaponSnapshot.rawShotDamage,
  );
  const surfaceDistance = getSurfaceDistance(attackerEntity, targetEntity);
  const angularVelocity = getAngularVelocity(attackerEntity, targetEntity);
  const targetSignatureRadius = getTargetSignatureRadius(targetEntity);
  const trackingSpeed = Math.max(0, toFiniteNumber(
    weaponSnapshot && weaponSnapshot.trackingSpeed,
    0,
  ));
  const optimalSigRadius = Math.max(1, toFiniteNumber(
    weaponSnapshot && weaponSnapshot.optimalSigRadius,
    40000,
  ));
  const optimalRange = Math.max(0, toFiniteNumber(
    weaponSnapshot && weaponSnapshot.optimalRange,
    0,
  ));
  const falloff = Math.max(0, toFiniteNumber(
    weaponSnapshot && weaponSnapshot.falloff,
    0,
  ));
  const trackingTerm =
    trackingSpeed > 0
      ? (angularVelocity * optimalSigRadius) / (trackingSpeed * Math.max(targetSignatureRadius, 1))
      : Number.POSITIVE_INFINITY;
  let rangeTerm = 0;
  if (surfaceDistance > optimalRange) {
    if (falloff > 0) {
      rangeTerm = (surfaceDistance - optimalRange) / falloff;
    } else {
      rangeTerm = Number.POSITIVE_INFINITY;
    }
  }

  const hitChance = Number.isFinite(trackingTerm) && Number.isFinite(rangeTerm)
    ? clamp(0.5 ** ((trackingTerm ** 2) + (rangeTerm ** 2)), 0, 1)
    : 0;
  const roll = clamp(randomValue, 0, 0.999999999);

  if (sumDamageVector(resolvedRawDamage) <= 0 || roll > hitChance) {
    return {
      hit: false,
      wrecking: false,
      quality: 0,
      chanceToHit: round6(hitChance),
      roll: round6(roll),
      surfaceDistance: round6(surfaceDistance),
      angularVelocity: round6(angularVelocity),
      targetSignatureRadius: round6(targetSignatureRadius),
      trackingTerm: Number.isFinite(trackingTerm) ? round6(trackingTerm) : trackingTerm,
      rangeTerm: Number.isFinite(rangeTerm) ? round6(rangeTerm) : rangeTerm,
      shotDamage: scaleDamageVector(resolvedRawDamage, 0),
    };
  }

  const wrecking = roll < 0.01;
  const quality = wrecking ? 3.0 : round6(0.49 + roll);

  return {
    hit: true,
    wrecking,
    quality,
    chanceToHit: round6(hitChance),
    roll: round6(roll),
    surfaceDistance: round6(surfaceDistance),
    angularVelocity: round6(angularVelocity),
    targetSignatureRadius: round6(targetSignatureRadius),
    trackingTerm: Number.isFinite(trackingTerm) ? round6(trackingTerm) : trackingTerm,
    rangeTerm: Number.isFinite(rangeTerm) ? round6(rangeTerm) : rangeTerm,
    shotDamage: scaleDamageVector(resolvedRawDamage, quality),
  };
}

module.exports = {
  resolveTurretShot,
  resolveLaserTurretShot: resolveTurretShot,
};
