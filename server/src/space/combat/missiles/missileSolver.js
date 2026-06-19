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

function magnitude(vector) {
  const x = toFiniteNumber(vector && vector.x, 0);
  const y = toFiniteNumber(vector && vector.y, 0);
  const z = toFiniteNumber(vector && vector.z, 0);
  return Math.sqrt((x * x) + (y * y) + (z * z));
}

function distance(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
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

function estimateMissileEffectiveRange(snapshot = {}) {
  if (toFiniteNumber(snapshot.approxRange, 0) > 0) {
    return Math.max(0, toFiniteNumber(snapshot.approxRange, 0));
  }

  return Math.max(
    0,
    toFiniteNumber(snapshot.maxVelocity, 0) *
      (Math.max(0, toFiniteNumber(snapshot.flightTimeMs, 0)) / 1000),
  );
}

function estimateMissileTimeToTargetSeconds(
  sourcePosition,
  targetPosition,
  targetRadius,
  maxVelocity,
  options = {},
) {
  const missileVelocity = Math.max(0, toFiniteNumber(maxVelocity, 0));
  if (missileVelocity <= 0.000001) {
    return 0;
  }

  const distanceToTarget = Math.max(
    0,
    distance(sourcePosition, targetPosition) - (
      options.toCenter === true
        ? 0
        : Math.max(0, toFiniteNumber(targetRadius, 0))
    ),
  );
  return distanceToTarget / missileVelocity;
}

function estimateMissileClientImpactTimeMs(
  sourcePosition,
  targetPosition,
  targetRadius,
  maxVelocity,
) {
  const timeToTarget = estimateMissileTimeToTargetSeconds(
    sourcePosition,
    targetPosition,
    targetRadius,
    maxVelocity,
  );
  return Math.max(0, round6(timeToTarget * 1000));
}

const MISSILE_CLIENT_NO_SPREAD_THRESHOLD_SECONDS = 1.6;

function resolveMissileClientVisualProfile(
  sourcePosition,
  targetPosition,
  targetRadius,
  maxVelocity,
) {
  const surfaceTimeSeconds = estimateMissileTimeToTargetSeconds(
    sourcePosition,
    targetPosition,
    targetRadius,
    maxVelocity,
  );
  const centerTimeSeconds = Math.max(
    0.5,
    estimateMissileTimeToTargetSeconds(
      sourcePosition,
      targetPosition,
      targetRadius,
      maxVelocity,
      { toCenter: true },
    ),
  );
  const visualTimeSeconds =
    surfaceTimeSeconds > 0
      ? (surfaceTimeSeconds + centerTimeSeconds) * 0.5
      : centerTimeSeconds * 0.5;

  return {
    doSpread: surfaceTimeSeconds >= MISSILE_CLIENT_NO_SPREAD_THRESHOLD_SECONDS,
    surfaceTimeSeconds: round6(surfaceTimeSeconds),
    centerTimeSeconds: round6(centerTimeSeconds),
    visualTimeSeconds: round6(visualTimeSeconds),
    surfaceImpactMs: Math.max(0, round6(surfaceTimeSeconds * 1000)),
    visualImpactMs: Math.max(0, round6(visualTimeSeconds * 1000)),
  };
}

function estimateMissileClientVisualImpactTimeMs(
  sourcePosition,
  targetPosition,
  targetRadius,
  maxVelocity,
) {
  return resolveMissileClientVisualProfile(
    sourcePosition,
    targetPosition,
    targetRadius,
    maxVelocity,
  ).visualImpactMs;
}

function estimateMissileFlightBudgetMs(snapshot = {}, sourceRadius = 0) {
  const flightTimeMs = Math.max(1, toFiniteNumber(snapshot.flightTimeMs, 0));
  const maxVelocity = Math.max(0, toFiniteNumber(snapshot.maxVelocity, 0));
  const launchRadius = Math.max(0, toFiniteNumber(sourceRadius, 0));
  const launchRadiusBudgetMs =
    maxVelocity > 0.000001
      ? (launchRadius / maxVelocity) * 1000
      : 0;

  return round6(flightTimeMs + launchRadiusBudgetMs);
}

function buildMissileImpactState(targetEntity = null) {
  return {
    signatureRadius: Math.max(
      1,
      toFiniteNumber(targetEntity && targetEntity.signatureRadius, 1),
    ),
    absoluteVelocity: Math.max(
      0,
      magnitude(targetEntity && targetEntity.velocity),
    ),
  };
}

function resolveMissileDamageReductionExponent(snapshot = {}) {
  const damageReductionFactor = toFiniteNumber(snapshot.damageReductionFactor, 1);
  const damageReductionSensitivity = Math.max(
    1.000001,
    toFiniteNumber(snapshot.damageReductionSensitivity, 5.5),
  );

  // CCP stores the precalculated ln(drf) / ln(5.5) value in
  // aoeDamageReductionFactor for 3rd-party consumers. Keep a legacy fallback
  // for any unexpected raw-factor shape that is still > 1.
  if (damageReductionFactor > 1.000001) {
    return round6(
      Math.log(damageReductionFactor) / Math.log(damageReductionSensitivity),
    );
  }

  return round6(clamp(damageReductionFactor, 0.000001, 1));
}

function resolveMissileApplicationFactor(snapshot = {}, impactState = {}) {
  const explosionRadius = Math.max(
    0.000001,
    toFiniteNumber(snapshot.explosionRadius, 1),
  );
  const explosionVelocity = Math.max(
    0.000001,
    toFiniteNumber(snapshot.explosionVelocity, 1),
  );
  const targetSignatureRadius = Math.max(
    0,
    toFiniteNumber(impactState.signatureRadius, 0),
  );
  const targetAbsoluteVelocity = Math.max(
    0,
    toFiniteNumber(impactState.absoluteVelocity, 0),
  );
  const sigFactor = targetSignatureRadius / explosionRadius;
  const velocityFactorBase =
    targetAbsoluteVelocity <= 0.000001
      ? Number.POSITIVE_INFINITY
      : (
        (sigFactor * explosionVelocity) /
        Math.max(targetAbsoluteVelocity, 0.000001)
      );
  const reductionExponent = resolveMissileDamageReductionExponent(snapshot);
  const velocityFactor = Number.isFinite(velocityFactorBase)
    ? velocityFactorBase ** reductionExponent
    : 1;

  return {
    sigFactor: round6(sigFactor),
    velocityFactorBase: Number.isFinite(velocityFactorBase)
      ? round6(velocityFactorBase)
      : null,
    reductionExponent: round6(reductionExponent),
    applicationFactor: round6(Math.min(1, sigFactor, velocityFactor)),
  };
}

function resolveMissileAppliedDamage(snapshot = {}, targetEntity = null) {
  const rawShotDamage = normalizeDamageVector(snapshot.rawShotDamage);
  const impactState = buildMissileImpactState(targetEntity);
  const application = resolveMissileApplicationFactor(snapshot, impactState);
  const factor = clamp(application.applicationFactor, 0, 1);

  return {
    impactState,
    application,
    rawShotDamage,
    appliedDamage: {
      em: round6(rawShotDamage.em * factor),
      thermal: round6(rawShotDamage.thermal * factor),
      kinetic: round6(rawShotDamage.kinetic * factor),
      explosive: round6(rawShotDamage.explosive * factor),
    },
  };
}

module.exports = {
  MISSILE_CLIENT_NO_SPREAD_THRESHOLD_SECONDS,
  estimateMissileEffectiveRange,
  estimateMissileTimeToTargetSeconds,
  estimateMissileClientImpactTimeMs,
  estimateMissileClientVisualImpactTimeMs,
  resolveMissileClientVisualProfile,
  estimateMissileFlightBudgetMs,
  buildMissileImpactState,
  resolveMissileDamageReductionExponent,
  resolveMissileApplicationFactor,
  resolveMissileAppliedDamage,
};
