const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  MISSILE_CLIENT_NO_SPREAD_THRESHOLD_SECONDS,
  estimateMissileClientImpactTimeMs,
  estimateMissileClientVisualImpactTimeMs,
  estimateMissileFlightBudgetMs,
  estimateMissileTimeToTargetSeconds,
  resolveMissileClientVisualProfile,
  resolveMissileDamageReductionExponent,
  resolveMissileApplicationFactor,
  resolveMissileAppliedDamage,
} = require(path.join(
  repoRoot,
  "server/src/space/combat/missiles/missileSolver",
));

function assertApprox(actual, expected, epsilon = 0.000001) {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function buildSnapshot(overrides = {}) {
  return {
    explosionRadius: 140,
    explosionVelocity: 85,
    damageReductionFactor: 0.682,
    damageReductionSensitivity: 5.5,
    rawShotDamage: {
      em: 0,
      thermal: 0,
      kinetic: 149,
      explosive: 0,
    },
    maxVelocity: 4300,
    flightTimeMs: 6500,
    ...overrides,
  };
}

test("missile solver treats aoeDamageReductionFactor as CCP's precalculated exponent", () => {
  const snapshot = buildSnapshot();
  const exponent = resolveMissileDamageReductionExponent(snapshot);
  const result = resolveMissileApplicationFactor(snapshot, {
    signatureRadius: 40,
    absoluteVelocity: 1000,
  });
  const expectedSigFactor = 40 / 140;
  const expectedVelocityBase = (expectedSigFactor * 85) / 1000;
  const expectedApplication = Math.min(1, expectedSigFactor, expectedVelocityBase ** 0.682);

  assertApprox(exponent, 0.682);
  assertApprox(result.sigFactor, expectedSigFactor);
  assertApprox(result.velocityFactorBase, expectedVelocityBase);
  assertApprox(result.reductionExponent, 0.682);
  assertApprox(result.applicationFactor, expectedApplication);
  assert.ok(
    result.applicationFactor < expectedSigFactor,
    "expected velocity to reduce application for a small fast target",
  );
});

test("missile application falls as target velocity rises", () => {
  const snapshot = buildSnapshot();
  const slow = resolveMissileApplicationFactor(snapshot, {
    signatureRadius: 120,
    absoluteVelocity: 150,
  });
  const fast = resolveMissileApplicationFactor(snapshot, {
    signatureRadius: 120,
    absoluteVelocity: 1200,
  });

  assert.ok(
    slow.applicationFactor > fast.applicationFactor,
    "expected faster targets to take less missile damage",
  );
});

test("missile application rises with target signature", () => {
  const snapshot = buildSnapshot();
  const small = resolveMissileApplicationFactor(snapshot, {
    signatureRadius: 40,
    absoluteVelocity: 250,
  });
  const large = resolveMissileApplicationFactor(snapshot, {
    signatureRadius: 400,
    absoluteVelocity: 250,
  });

  assert.ok(
    large.applicationFactor > small.applicationFactor,
    "expected larger targets to take more missile damage",
  );
});

test("large slow targets take full missile damage", () => {
  const snapshot = buildSnapshot();
  const result = resolveMissileAppliedDamage(snapshot, {
    signatureRadius: 400,
    velocity: { x: 30, y: 0, z: 0 },
  });

  assertApprox(result.application.applicationFactor, 1);
  assertApprox(result.appliedDamage.kinetic, snapshot.rawShotDamage.kinetic);
});

test("missile application only depends on absolute target speed, not movement direction", () => {
  const snapshot = buildSnapshot();
  const away = resolveMissileAppliedDamage(snapshot, {
    signatureRadius: 120,
    velocity: { x: 800, y: 0, z: 0 },
  });
  const lateral = resolveMissileAppliedDamage(snapshot, {
    signatureRadius: 120,
    velocity: { x: 0, y: 800, z: 0 },
  });

  assertApprox(away.application.applicationFactor, lateral.application.applicationFactor);
  assertApprox(away.appliedDamage.kinetic, lateral.appliedDamage.kinetic);
});

test("stationary targets are only limited by signature, not velocity", () => {
  const snapshot = buildSnapshot({
    explosionRadius: 400,
  });
  const result = resolveMissileApplicationFactor(snapshot, {
    signatureRadius: 100,
    absoluteVelocity: 0,
  });

  assertApprox(result.velocityFactorBase, null, 0);
  assertApprox(result.applicationFactor, 0.25);
});

test("missile applied damage uses the resolved application factor", () => {
  const snapshot = buildSnapshot();
  const result = resolveMissileAppliedDamage(snapshot, {
    signatureRadius: 40,
    velocity: { x: 1000, y: 0, z: 0 },
  });

  assert.ok(result.application.applicationFactor > 0);
  assert.ok(result.application.applicationFactor < 1);
  assertApprox(
    result.appliedDamage.kinetic,
    snapshot.rawShotDamage.kinetic * result.application.applicationFactor,
  );
});

test("missile impact timing follows CCP's surface-distance estimate", () => {
  const impactMs = estimateMissileClientImpactTimeMs(
    { x: 0, y: 0, z: 0 },
    { x: 10000, y: 0, z: 0 },
    40,
    4300,
  );

  assertApprox(impactMs, ((10000 - 40) / 4300) * 1000);
});

test("time-to-target can still be estimated to the target center for client visual spread timing", () => {
  const surfaceSeconds = estimateMissileTimeToTargetSeconds(
    { x: 0, y: 0, z: 0 },
    { x: 10_000, y: 0, z: 0 },
    40,
    4_300,
  );
  const centerSeconds = estimateMissileTimeToTargetSeconds(
    { x: 0, y: 0, z: 0 },
    { x: 10_000, y: 0, z: 0 },
    40,
    4_300,
    { toCenter: true },
  );

  assert.ok(centerSeconds > surfaceSeconds, "expected center-time estimate to exceed surface-time estimate");
  assertApprox(surfaceSeconds, (10_000 - 40) / 4_300);
  assertApprox(centerSeconds, 10_000 / 4_300);
});

test("client visual missile timing follows CCP's averaged surface/center estimate", () => {
  const visualProfile = resolveMissileClientVisualProfile(
    { x: 0, y: 0, z: 0 },
    { x: 10_000, y: 0, z: 0 },
    40,
    4_300,
  );

  const surfaceSeconds = (10_000 - 40) / 4_300;
  const centerSeconds = 10_000 / 4_300;
  assertApprox(
    visualProfile.visualImpactMs,
    (((surfaceSeconds + centerSeconds) * 0.5) * 1000),
  );
  assert.equal(visualProfile.doSpread, true);
});

test("client missile visuals disable spread for short flights and keep the 0.5s center clamp", () => {
  const visualProfile = resolveMissileClientVisualProfile(
    { x: 0, y: 0, z: 0 },
    { x: 500, y: 0, z: 0 },
    40,
    4_300,
  );

  const surfaceSeconds = (500 - 40) / 4_300;
  assert.equal(
    visualProfile.doSpread,
    surfaceSeconds >= MISSILE_CLIENT_NO_SPREAD_THRESHOLD_SECONDS,
  );
  assert.equal(visualProfile.doSpread, false);
  assertApprox(visualProfile.surfaceTimeSeconds, surfaceSeconds);
  assertApprox(visualProfile.centerTimeSeconds, 0.5);
  assertApprox(
    visualProfile.visualImpactMs,
    (((surfaceSeconds + 0.5) * 0.5) * 1000),
  );
  assertApprox(
    estimateMissileClientVisualImpactTimeMs(
      { x: 0, y: 0, z: 0 },
      { x: 500, y: 0, z: 0 },
      40,
      4_300,
    ),
    visualProfile.visualImpactMs,
  );
});

test("missile flight budget includes large-hull launch radius compensation", () => {
  const budgetMs = estimateMissileFlightBudgetMs(buildSnapshot(), 8000);

  assertApprox(budgetMs, 6500 + ((8000 / 4300) * 1000));
});
