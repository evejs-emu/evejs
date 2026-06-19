const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_ASTEROID_FIELDS = "true";

const repoRoot = path.join(__dirname, "..", "..");

const asteroidService = require(path.join(
  repoRoot,
  "server/src/space/asteroids/asteroidService",
));
const asteroidData = require(path.join(
  repoRoot,
  "server/src/space/asteroids/asteroidData",
));
const worldData = require(path.join(
  repoRoot,
  "server/src/space/worldData",
));

const OFFICIAL_HIGHSEC_SAMPLE_COUNTS = Object.freeze({
  40009129: 70,
  40009163: 103,
  40009180: 112,
  40009193: 140,
  40009198: 130,
  40009200: 139,
});

function buildScene(systemID) {
  return {
    systemID,
    staticEntities: [],
    addStaticEntity(entity) {
      this.staticEntities.push(entity);
      return true;
    },
  };
}

function subtractVectors(left, right) {
  return {
    x: Number(left && left.x) - Number(right && right.x),
    y: Number(left && left.y) - Number(right && right.y),
    z: Number(left && left.z) - Number(right && right.z),
  };
}

function dotVectors(left, right) {
  return (left.x * right.x) + (left.y * right.y) + (left.z * right.z);
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = Math.sqrt(Math.max(0, dotVectors(vector, vector)));
  if (length <= 0.000001) {
    return fallback;
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function buildBeltFrame(systemID, belt) {
  const parent = worldData.getCelestialsForSystem(systemID)
    .find((candidate) => Number(candidate && candidate.itemID) === Number(belt.orbitID)) || belt;
  const radial = normalizeVector(subtractVectors(belt.position, parent.position));
  const tangent = normalizeVector(
    { x: -radial.z, y: 0, z: radial.x },
    { x: 0, y: 0, z: 1 },
  );
  const up = normalizeVector({
    x: (radial.y * tangent.z) - (radial.z * tangent.y),
    y: (radial.z * tangent.x) - (radial.x * tangent.z),
    z: (radial.x * tangent.y) - (radial.y * tangent.x),
  }, { x: 0, y: 1, z: 0 });
  return { radial, tangent, up };
}

function measureRibbon(systemID, belt, asteroids) {
  const frame = buildBeltFrame(systemID, belt);
  const points = asteroids.map((asteroid) => {
    const offset = subtractVectors(asteroid.position, belt.position);
    return {
      r: dotVectors(offset, frame.radial),
      t: dotVectors(offset, frame.tangent),
      u: dotVectors(offset, frame.up),
    };
  });
  const min = { r: Infinity, t: Infinity, u: Infinity };
  const max = { r: -Infinity, t: -Infinity, u: -Infinity };
  const centroid = { r: 0, t: 0, u: 0 };
  for (const point of points) {
    for (const key of ["r", "t", "u"]) {
      min[key] = Math.min(min[key], point[key]);
      max[key] = Math.max(max[key], point[key]);
      centroid[key] += point[key];
    }
  }
  for (const key of ["r", "t", "u"]) {
    centroid[key] /= Math.max(1, points.length);
  }

  let rr = 0;
  let rt = 0;
  let tt = 0;
  for (const point of points) {
    const r = point.r - centroid.r;
    const t = point.t - centroid.t;
    rr += r * r;
    rt += r * t;
    tt += t * t;
  }
  rr /= Math.max(1, points.length);
  rt /= Math.max(1, points.length);
  tt /= Math.max(1, points.length);
  const trace = rr + tt;
  const discriminant = Math.sqrt(
    Math.max(0, ((rr - tt) ** 2) + (4 * rt * rt)),
  );
  const major = (trace + discriminant) / 2;
  const minor = (trace - discriminant) / 2;

  return {
    centroidOffsetMeters: Math.hypot(centroid.r, centroid.t),
    horizontalMajorSpanMeters: Math.max(max.r - min.r, max.t - min.t),
    verticalSpanMeters: max.u - min.u,
    aspectRatio: major / Math.max(1, minor),
  };
}

test("high-sec asteroid ribbon generator stays close to decoded TQ belt populations", () => {
  const systemID = 30000143;
  const scene = buildScene(systemID);
  const belts = asteroidData.getBeltsForSystem(systemID);

  for (const [beltIDText, expectedCount] of Object.entries(OFFICIAL_HIGHSEC_SAMPLE_COUNTS)) {
    const beltID = Number(beltIDText);
    const belt = asteroidData.getBeltByID(beltID);
    assert.ok(belt, `expected belt ${beltID} in asteroid authority`);

    const profile = asteroidService._testing.buildCurvedFieldProfile(
      scene,
      belt,
      asteroidData.getFieldStyleByID(belt.fieldStyleID),
      belts,
    );

    const relativeError = Math.abs(profile.count - expectedCount) / expectedCount;
    assert.ok(
      relativeError <= 0.3,
      `expected ${belt.itemName} generated count ${profile.count} to stay within 30% of decoded TQ count ${expectedCount}`,
    );
    assert.ok(
      profile.count > Number(belt.asteroidCount),
      `expected ${belt.itemName} generated count to exceed authored placeholder count`,
    );
  }
});

test("generated asteroid item IDs stay unique when belts exceed 128 rocks", () => {
  const systemID = 30000143;
  const scene = buildScene(systemID);
  const result = asteroidService.handleSceneCreated(scene);
  assert.equal(result.success, true, "expected asteroid scene generation to succeed");

  const asteroidIDs = scene.staticEntities
    .filter((entity) => entity && entity.kind === "asteroid")
    .map((entity) => Number(entity.itemID));
  assert.ok(asteroidIDs.length > 0, "expected generated asteroid entities");

  const uniqueIDs = new Set(asteroidIDs);
  assert.equal(
    uniqueIDs.size,
    asteroidIDs.length,
    "expected dense belt generation to keep asteroid itemIDs collision-free",
  );
});

test("generated asteroid fields use TQ-style offset ribbon geometry", () => {
  const systemID = 30000143;

  for (const beltIDText of Object.keys(OFFICIAL_HIGHSEC_SAMPLE_COUNTS)) {
    const belt = asteroidData.getBeltByID(Number(beltIDText));
    const scene = buildScene(systemID);
    const asteroids = asteroidService._testing.populateBeltField(scene, belt);
    const metrics = measureRibbon(systemID, belt, asteroids);

    assert.ok(
      metrics.centroidOffsetMeters >= 5_000,
      `expected ${belt.itemName} ribbon center to be offset from the belt marker`,
    );
    assert.ok(
      metrics.horizontalMajorSpanMeters >= 20_000,
      `expected ${belt.itemName} to span like a TQ ribbon field`,
    );
    assert.ok(
      metrics.aspectRatio >= 3,
      `expected ${belt.itemName} to be a high-aspect ribbon, got ${metrics.aspectRatio.toFixed(2)}`,
    );
    assert.ok(
      metrics.verticalSpanMeters <= 9_000,
      `expected ${belt.itemName} vertical scatter to stay TQ-thin`,
    );
  }
});
