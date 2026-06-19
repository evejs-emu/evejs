const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const asteroidData = require(path.join(__dirname, "./asteroidData"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
const {
  getSolarSystemOreTypeRecords,
  resolveMiningVisualPresentation,
} = require(path.join(__dirname, "../../services/mining/miningVisuals"));
const {
  classifyMiningMaterialType,
} = require(path.join(__dirname, "../../services/mining/miningInventory"));
const {
  recordAsteroidBootstrap,
  resetMiningStartupSummary,
} = require(path.join(__dirname, "../../services/mining/miningStartupSummary"));
const {
  getSolarSystemByID,
  getCelestialsForSystem,
} = require(path.join(__dirname, "../../space/worldData"));

const STATIC_ASTEROID_ITEM_ID_BASE = 5_000_000_000_000;
const STATIC_ASTEROID_ITEM_ID_STRIDE = 512;

const FIELD_SHAPE_PROFILES = Object.freeze({
  default: Object.freeze({
    axisAngleMinDegrees: -30,
    axisAngleMaxDegrees: 75,
    singleSpanFactorMin: 1.22,
    singleSpanFactorMax: 1.58,
    multiSpanFactorMin: 0.9,
    multiSpanFactorMax: 1.45,
    singleWidthFactorMin: 1.85,
    singleWidthFactorMax: 2.55,
    multiWidthFactorMin: 3.0,
    multiWidthFactorMax: 4.8,
    singleBowFactorMin: 0.26,
    singleBowFactorMax: 0.48,
    multiBowFactorMin: 0.34,
    multiBowFactorMax: 0.72,
    singleAreaPerAsteroidMin: 4_850_000,
    singleAreaPerAsteroidMax: 5_900_000,
    multiAreaPerAsteroidMin: 4_350_000,
    multiAreaPerAsteroidMax: 5_400_000,
    singleLaneCountMin: 1,
    singleLaneCountMax: 1,
    multiLaneCountMin: 1,
    multiLaneCountMax: 2,
    singleVisualWidthFactorMin: 1.45,
    singleVisualWidthFactorMax: 2.15,
    multiVisualWidthFactorMin: 1.65,
    multiVisualWidthFactorMax: 2.55,
    singleSideOffsetFactorMin: 0.55,
    singleSideOffsetFactorMax: 0.86,
    multiSideOffsetFactorMin: 0.32,
    multiSideOffsetFactorMax: 0.72,
    verticalSpreadScale: 0.14,
    alongJitterScale: 0.03,
    crossJitterScale: 0.38,
  }),
  empire_highsec_standard: Object.freeze({
    axisAngleMinDegrees: -65,
    axisAngleMaxDegrees: 105,
    singleSpanFactorMin: 1.2,
    singleSpanFactorMax: 1.55,
    multiSpanFactorMin: 0.92,
    multiSpanFactorMax: 1.36,
    singleWidthFactorMin: 1.8,
    singleWidthFactorMax: 2.45,
    multiWidthFactorMin: 3.2,
    multiWidthFactorMax: 4.7,
    singleBowFactorMin: 0.28,
    singleBowFactorMax: 0.5,
    multiBowFactorMin: 0.38,
    multiBowFactorMax: 0.78,
    singleAreaPerAsteroidMin: 4_750_000,
    singleAreaPerAsteroidMax: 5_750_000,
    multiAreaPerAsteroidMin: 4_050_000,
    multiAreaPerAsteroidMax: 5_050_000,
    singleLaneCountMin: 1,
    singleLaneCountMax: 1,
    multiLaneCountMin: 1,
    multiLaneCountMax: 2,
    singleVisualWidthFactorMin: 1.35,
    singleVisualWidthFactorMax: 2.0,
    multiVisualWidthFactorMin: 1.55,
    multiVisualWidthFactorMax: 2.4,
    singleSideOffsetFactorMin: 0.58,
    singleSideOffsetFactorMax: 0.88,
    multiSideOffsetFactorMin: 0.36,
    multiSideOffsetFactorMax: 0.74,
    verticalSpreadScale: 0.12,
    alongJitterScale: 0.025,
    crossJitterScale: 0.36,
  }),
});

// Canonical ore family typeIDs keyed by base family name.
// This avoids fragile name-to-item resolution during security-band enrichment.
const ORE_FAMILY_TYPE_IDS = {
  "Veldspar": [1230, 17470, 17471],
  "Scordite": [1228, 17463, 17464],
  "Pyroxeres": [1224, 17459, 17460],
  "Plagioclase": [18, 17455, 17456],
  "Omber": [1227, 17867, 17868],
  "Kernite": [20, 17452, 17453],
  "Jaspet": [1226],
  "Hemorphite": [1231],
  "Hedbergite": [21],
  "Dark Ochre": [1223],
  "Gneiss": [1229],
  "Crokite": [1225, 17432, 17433],
  "Bistot": [],
  "Arkonor": [22, 17425, 17426],
  "Mercoxit": [11396, 17869, 17870],
};

const SECURITY_CLASS_FAMILIES = {
  A: ["Veldspar", "Scordite"],
  B: ["Veldspar", "Scordite", "Pyroxeres"],
  C: ["Veldspar", "Scordite", "Pyroxeres", "Plagioclase", "Omber"],
  C1: ["Veldspar", "Scordite", "Pyroxeres", "Plagioclase", "Omber"],
  C2: ["Pyroxeres", "Plagioclase", "Omber", "Kernite", "Jaspet"],
  D: ["Pyroxeres", "Plagioclase", "Omber", "Kernite", "Jaspet"],
  D1: ["Pyroxeres", "Plagioclase", "Omber", "Kernite", "Jaspet"],
  E: ["Kernite", "Jaspet", "Hemorphite", "Hedbergite"],
  E1: ["Kernite", "Jaspet", "Hemorphite", "Hedbergite"],
  F: ["Hemorphite", "Hedbergite", "Dark Ochre", "Gneiss"],
  F1: ["Hemorphite", "Hedbergite", "Dark Ochre", "Gneiss"],
  G: ["Dark Ochre", "Gneiss", "Crokite", "Bistot"],
  G1: ["Dark Ochre", "Gneiss", "Crokite", "Bistot"],
  H: ["Crokite", "Bistot", "Arkonor", "Mercoxit"],
  H1: ["Crokite", "Bistot", "Arkonor", "Mercoxit"],
};

const BELT_BUCKETS = {
  common: { targetMin: 2, targetMax: 4, weight: 6 },
  uncommon: { targetMin: 1, targetMax: 3, weight: 5 },
  rare: { targetMin: 1, targetMax: 2, weight: 2.5 },
};

const GENERATED_ORE_ASTEROID_SHELL_TYPE_IDS = Object.freeze([
  64063,
  64064,
  64065,
  64066,
  64067,
  64068,
  64069,
  64070,
  64071,
  64072,
  64073,
  64074,
  64075,
  64076,
  64077,
]);

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  if (value <= minimum) {
    return minimum;
  }
  if (value >= maximum) {
    return maximum;
  }
  return value;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
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
    x: toFiniteNumber(vector && vector.x, 0) * toFiniteNumber(scalar, 0),
    y: toFiniteNumber(vector && vector.y, 0) * toFiniteNumber(scalar, 0),
    z: toFiniteNumber(vector && vector.z, 0) * toFiniteNumber(scalar, 0),
  };
}

function dotVectors(left, right) {
  return (
    (toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.x, 0)) +
    (toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.y, 0)) +
    (toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.z, 0))
  );
}

function vectorLength(vector) {
  return Math.sqrt(Math.max(0, dotVectors(vector, vector)));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = vectorLength(vector);
  if (length <= 0.000001) {
    return cloneVector(fallback);
  }
  return scaleVector(vector, 1 / length);
}

function createRng(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let output = state;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

function buildAsteroidItemID(beltID, asteroidIndex) {
  return (
    STATIC_ASTEROID_ITEM_ID_BASE +
    (toPositiveInt(beltID, 0) * STATIC_ASTEROID_ITEM_ID_STRIDE) +
    asteroidIndex
  );
}

function pickWeightedEntry(entries, rng) {
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      ...entry,
      weight: Math.max(0, toFiniteNumber(entry && entry.weight, 0)),
    }))
    .filter((entry) => entry.weight > 0);
  if (normalizedEntries.length <= 0) {
    return null;
  }

  const totalWeight = normalizedEntries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng() * totalWeight;
  for (const entry of normalizedEntries) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry;
    }
  }
  return normalizedEntries[normalizedEntries.length - 1];
}

function pickIntegerInRange(minimum, maximum, rng) {
  const min = Math.trunc(Math.min(minimum, maximum));
  const max = Math.trunc(Math.max(minimum, maximum));
  if (max <= min) {
    return min;
  }
  return min + Math.floor(rng() * ((max - min) + 1));
}

function hashText(value) {
  const text = String(value == null ? "" : value);
  let state = 0;
  for (let index = 0; index < text.length; index += 1) {
    state = Math.imul(state ^ text.charCodeAt(index), 0x45d9f3b);
    state ^= state >>> 16;
  }
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state ^= state >>> 16;
  return state >>> 0;
}

function lerp(left, right, ratio) {
  return left + ((right - left) * clamp(ratio, 0, 1));
}

function signedBellJitter(rng) {
  return clamp(
    ((rng() + rng() + rng()) / 3 - 0.5) * 2,
    -1,
    1,
  );
}

function normalize2D(point, fallback = { x: 1, y: 0 }) {
  const length = Math.hypot(
    toFiniteNumber(point && point.x, 0),
    toFiniteNumber(point && point.y, 0),
  );
  if (length <= 0.000001) {
    return { ...fallback };
  }
  return {
    x: point.x / length,
    y: point.y / length,
  };
}

function rotate2D(point) {
  return {
    x: -toFiniteNumber(point && point.y, 0),
    y: toFiniteNumber(point && point.x, 0),
  };
}

function buildBezierPoint(start, control, end, ratio) {
  const u = clamp(ratio, 0, 1);
  const v = 1 - u;
  return {
    x: (v * v * start.x) + (2 * v * u * control.x) + (u * u * end.x),
    y: (v * v * start.y) + (2 * v * u * control.y) + (u * u * end.y),
  };
}

function buildBezierTangent(start, control, end, ratio) {
  const u = clamp(ratio, 0, 1);
  return {
    x: (2 * (1 - u) * (control.x - start.x)) + (2 * u * (end.x - control.x)),
    y: (2 * (1 - u) * (control.y - start.y)) + (2 * u * (end.y - control.y)),
  };
}

function combinePlaneVectors(primary, secondary, up, offset) {
  return addVectors(
    addVectors(
      scaleVector(primary, toFiniteNumber(offset && offset.x, 0)),
      scaleVector(secondary, toFiniteNumber(offset && offset.y, 0)),
    ),
    scaleVector(up, toFiniteNumber(offset && offset.z, 0)),
  );
}

function resolveFieldShapeProfile(styleID) {
  const normalizedStyleID = String(styleID || "").trim();
  return FIELD_SHAPE_PROFILES[normalizedStyleID] || FIELD_SHAPE_PROFILES.default;
}

function resolveOrbitSiblings(systemBelts, belt) {
  const orbitID = toPositiveInt(belt && belt.orbitID, 0);
  if (orbitID <= 0) {
    return [belt];
  }
  const siblings = (Array.isArray(systemBelts) ? systemBelts : [])
    .filter((candidate) => toPositiveInt(candidate && candidate.orbitID, 0) === orbitID)
    .sort(
      (left, right) =>
        toPositiveInt(left && left.itemID, 0) -
        toPositiveInt(right && right.itemID, 0),
    );
  return siblings.length > 0 ? siblings : [belt];
}

function resolveBeltOrbitContext(scene, belt, systemBelts = []) {
  const parentPosition = cloneVector(
    (getCelestialsForSystem(scene.systemID).find(
      (candidate) =>
        toPositiveInt(candidate && candidate.itemID, 0) ===
        toPositiveInt(belt && belt.orbitID, 0),
    ) || belt).position,
  );
  const radial = normalizeVector(
    subtractVectors(cloneVector(belt.position), parentPosition),
    { x: 1, y: 0, z: 0 },
  );
  const tangent = normalizeVector(
    { x: -radial.z, y: 0, z: radial.x },
    { x: 0, y: 0, z: 1 },
  );
  const up = normalizeVector(
    {
      x: radial.y * tangent.z - radial.z * tangent.y,
      y: radial.z * tangent.x - radial.x * tangent.z,
      z: radial.x * tangent.y - radial.y * tangent.x,
    },
    { x: 0, y: 1, z: 0 },
  );
  const siblings = resolveOrbitSiblings(systemBelts, belt);
  let gapBias = 0;
  if (siblings.length > 1) {
    const siblingsByAngle = siblings
      .map((candidate) => ({
        belt: candidate,
        angle: Math.atan2(
          toFiniteNumber(candidate && candidate.position && candidate.position.z, 0) -
            parentPosition.z,
          toFiniteNumber(candidate && candidate.position && candidate.position.x, 0) -
            parentPosition.x,
        ),
      }))
      .sort((left, right) => left.angle - right.angle);
    const siblingIndex = siblingsByAngle.findIndex(
      (entry) =>
        toPositiveInt(entry && entry.belt && entry.belt.itemID, 0) ===
        toPositiveInt(belt && belt.itemID, 0),
    );
    if (siblingIndex >= 0) {
      const current = siblingsByAngle[siblingIndex];
      const previous =
        siblingsByAngle[(siblingIndex - 1 + siblingsByAngle.length) % siblingsByAngle.length];
      const next = siblingsByAngle[(siblingIndex + 1) % siblingsByAngle.length];
      let previousGap = current.angle - previous.angle;
      let nextGap = next.angle - current.angle;
      if (previousGap < 0) {
        previousGap += Math.PI * 2;
      }
      if (nextGap < 0) {
        nextGap += Math.PI * 2;
      }
      gapBias = clamp(
        (nextGap - previousGap) / Math.max(0.000001, nextGap + previousGap),
        -1,
        1,
      );
    }
  }
  return {
    parentPosition,
    radial,
    tangent,
    up,
    siblings,
    siblingCount: siblings.length,
    gapBias,
  };
}

function buildCurvedFieldProfile(scene, belt, style, systemBelts = []) {
  const orbitContext = resolveBeltOrbitContext(scene, belt, systemBelts);
  const shapeProfile = resolveFieldShapeProfile(style && style.fieldStyleID);
  const authoredCount = Math.max(1, toPositiveInt(belt && belt.asteroidCount, 1));
  const fieldRadiusMeters = Math.max(
    12_000,
    toFiniteNumber(belt && belt.fieldRadiusMeters, 32_000),
  );
  const clusterRadiusMeters = Math.max(
    2_500,
    toFiniteNumber(belt && belt.clusterRadiusMeters, 6_000),
  );
  const verticalSpreadMeters = Math.max(
    900,
    toFiniteNumber(belt && belt.verticalSpreadMeters, 4_000),
  );
  const seededRng = createRng(
    hashText(`${belt.itemID}:${belt.fieldSeed}:${belt.fieldStyleID}:curveProfile`),
  );
  const densitySeed = seededRng();
  const spanSeed = seededRng();
  const widthSeed = seededRng();
  const bowSeed = seededRng();
  const orientationSeed = seededRng();
  const flowSeed = seededRng();
  const visualWidthSeed = seededRng();
  const sideOffsetSeed = seededRng();
  const multiBeltOrbit = orbitContext.siblingCount > 1;
  const flowBias =
    multiBeltOrbit && Math.abs(orbitContext.gapBias) >= 0.14
      ? orbitContext.gapBias
      : (flowSeed * 2) - 1;

  const axisAngleDegrees = multiBeltOrbit
    ? lerp(
      shapeProfile.axisAngleMinDegrees,
      shapeProfile.axisAngleMaxDegrees,
      orientationSeed,
    ) + (orbitContext.gapBias * 12)
    : lerp(88, 96, orientationSeed);
  const axisAngleRadians = (axisAngleDegrees * Math.PI) / 180;
  const axisDirection = normalizeVector(
    addVectors(
      scaleVector(orbitContext.tangent, Math.cos(axisAngleRadians)),
      scaleVector(orbitContext.radial, Math.sin(axisAngleRadians)),
    ),
  );
  const crossDirection = normalizeVector(
    addVectors(
      scaleVector(orbitContext.radial, Math.cos(axisAngleRadians)),
      scaleVector(orbitContext.tangent, -Math.sin(axisAngleRadians)),
    ),
  );

  const axisSpanMeters = fieldRadiusMeters * (
    multiBeltOrbit
      ? lerp(shapeProfile.multiSpanFactorMin, shapeProfile.multiSpanFactorMax, spanSeed)
      : lerp(shapeProfile.singleSpanFactorMin, shapeProfile.singleSpanFactorMax, spanSeed)
  );
  const ribbonWidthMeters = clusterRadiusMeters * (
    multiBeltOrbit
      ? lerp(shapeProfile.multiWidthFactorMin, shapeProfile.multiWidthFactorMax, widthSeed)
      : lerp(shapeProfile.singleWidthFactorMin, shapeProfile.singleWidthFactorMax, widthSeed)
  );
  const visualRibbonWidthMeters = clusterRadiusMeters * (
    multiBeltOrbit
      ? lerp(
        shapeProfile.multiVisualWidthFactorMin,
        shapeProfile.multiVisualWidthFactorMax,
        visualWidthSeed,
      )
      : lerp(
        shapeProfile.singleVisualWidthFactorMin,
        shapeProfile.singleVisualWidthFactorMax,
        visualWidthSeed,
      )
  );
  const bowMeters = fieldRadiusMeters * (
    multiBeltOrbit
      ? lerp(shapeProfile.multiBowFactorMin, shapeProfile.multiBowFactorMax, bowSeed)
      : lerp(shapeProfile.singleBowFactorMin, shapeProfile.singleBowFactorMax, bowSeed)
  );
  const densityAreaPerAsteroid = multiBeltOrbit
    ? lerp(
      shapeProfile.multiAreaPerAsteroidMin,
      shapeProfile.multiAreaPerAsteroidMax,
      densitySeed,
    )
    : lerp(
      shapeProfile.singleAreaPerAsteroidMin,
      shapeProfile.singleAreaPerAsteroidMax,
      densitySeed,
    );
  const laneCount = pickIntegerInRange(
    multiBeltOrbit ? shapeProfile.multiLaneCountMin : shapeProfile.singleLaneCountMin,
    multiBeltOrbit ? shapeProfile.multiLaneCountMax : shapeProfile.singleLaneCountMax,
    seededRng,
  );
  const anchorBias = flowBias * axisSpanMeters * (multiBeltOrbit ? 0.26 : 0.42);
  const areaCount = Math.round(
    (axisSpanMeters * ribbonWidthMeters) / Math.max(1, densityAreaPerAsteroid),
  );
  const count = clamp(
    Math.max(authoredCount, areaCount),
    authoredCount,
    STATIC_ASTEROID_ITEM_ID_STRIDE - 1,
  );
  const halfSpanMeters = axisSpanMeters * 0.5;
  const controlLeadMeters = anchorBias * 0.22;
  const bowSign = flowBias >= 0 ? 1 : -1;
  const sideSign =
    multiBeltOrbit && Math.abs(orbitContext.gapBias) >= 0.2
      ? orbitContext.gapBias >= 0
        ? 1
        : -1
      : hashText(`${belt.itemID}:curveSide`) & 1
        ? -1
        : 1;
  const sideOffsetMeters = sideSign * fieldRadiusMeters * (
    multiBeltOrbit
      ? lerp(
        shapeProfile.multiSideOffsetFactorMin,
        shapeProfile.multiSideOffsetFactorMax,
        sideOffsetSeed,
      )
      : lerp(
        shapeProfile.singleSideOffsetFactorMin,
        shapeProfile.singleSideOffsetFactorMax,
        sideOffsetSeed,
      )
  );
  const start = {
    x: anchorBias - halfSpanMeters,
    y: sideOffsetMeters - (bowMeters * 0.18 * bowSign),
  };
  const control = {
    x: controlLeadMeters,
    y: sideOffsetMeters + (bowMeters * bowSign),
  };
  const end = {
    x: anchorBias + halfSpanMeters,
    y: sideOffsetMeters + (bowMeters * 0.18 * bowSign),
  };

  return {
    count,
    authoredCount,
    multiBeltOrbit,
    axisDirection,
    crossDirection,
    upDirection: orbitContext.up,
    axisSpanMeters,
    ribbonWidthMeters,
    visualRibbonWidthMeters,
    bowMeters,
    verticalSpreadMeters: verticalSpreadMeters * shapeProfile.verticalSpreadScale,
    alongJitterMeters: axisSpanMeters * shapeProfile.alongJitterScale,
    crossJitterMeters: visualRibbonWidthMeters * shapeProfile.crossJitterScale,
    laneCount,
    laneSpacingMeters: visualRibbonWidthMeters / Math.max(1, laneCount),
    laneJitterMeters: visualRibbonWidthMeters * 0.08,
    sideOffsetMeters,
    start,
    control,
    end,
    seed: hashText(`${belt.itemID}:${belt.fieldSeed}:curveLaneProfile`),
  };
}

function buildCurvedAsteroidOffset(profile, asteroidIndex, totalCount, rng) {
  const safeTotalCount = Math.max(1, toPositiveInt(totalCount, 1));
  const orderedRatio =
    safeTotalCount <= 1 ? 0.5 : asteroidIndex / Math.max(1, safeTotalCount - 1);
  const ratio = clamp(
    orderedRatio + (((rng() * 2) - 1) / Math.max(8, safeTotalCount)),
    0,
    1,
  );
  const laneCenterIndex = (profile.laneCount - 1) * 0.5;
  const laneIndex =
    profile.laneCount <= 1 ? 0 : asteroidIndex % profile.laneCount;
  const laneOffsetBase =
    profile.laneCount <= 1
      ? 0
      : (laneIndex - laneCenterIndex) * profile.laneSpacingMeters * 0.5;
  const laneOffset =
    laneOffsetBase + (signedBellJitter(rng) * profile.laneJitterMeters);
  const curvePoint = buildBezierPoint(profile.start, profile.control, profile.end, ratio);
  const tangent2D = normalize2D(
    buildBezierTangent(profile.start, profile.control, profile.end, ratio),
    { x: 1, y: 0 },
  );
  const normal2D = rotate2D(tangent2D);
  const alongJitter = signedBellJitter(rng) * profile.alongJitterMeters;
  const crossJitter = signedBellJitter(rng) * profile.crossJitterMeters;
  const local2D = {
    x:
      curvePoint.x +
      (tangent2D.x * alongJitter) +
      (normal2D.x * (laneOffset + crossJitter)),
    y:
      curvePoint.y +
      (tangent2D.y * alongJitter) +
      (normal2D.y * (laneOffset + crossJitter)),
  };
  const verticalScale = Math.sin(Math.PI * clamp(ratio, 0, 1));
  return combinePlaneVectors(
    profile.axisDirection,
    profile.crossDirection,
    profile.upDirection,
    {
      x: local2D.x,
      y: local2D.y,
      z:
        ((rng() * 2) - 1) *
        profile.verticalSpreadMeters *
        (0.35 + (verticalScale * 0.65)),
    },
  );
}

function resolveRecordWeight(record) {
  if (!record || typeof record !== "object") {
    return 1;
  }
  const candidates = [
    "weight",
    "spawnWeight",
    "chance",
    "probability",
    "frequency",
    "abundance",
    "rarityWeight",
    "quantity",
    "count",
  ];
  for (const key of candidates) {
    const value = toFiniteNumber(record[key], NaN);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 1;
}

function buildSystemOrePool(systemID) {
  const records = getSolarSystemOreTypeRecords(systemID);
  const mergedByTypeID = new Map();
  for (const record of records) {
    if (!record) {
      continue;
    }
    const typeID = toPositiveInt(record.typeID, 0);
    if (typeID <= 0) {
      continue;
    }
    const classification = classifyMiningMaterialType(record);
    if (!classification || classification.kind !== "ore") {
      continue;
    }
    const existing = mergedByTypeID.get(typeID);
    const nextWeight = resolveRecordWeight(record);
    if (!existing) {
      mergedByTypeID.set(typeID, {
        ...record,
        weight: nextWeight,
        spawnWeight: nextWeight,
      });
      continue;
    }
    existing.weight = Math.max(0.000001, toFiniteNumber(existing.weight, 1)) + nextWeight;
    existing.spawnWeight = existing.weight;
  }
  return Array.from(mergedByTypeID.values());
}

function getSecurityMetadata(systemID) {
  const row = getSolarSystemByID(toPositiveInt(systemID, 0)) || {};
  const securityStatus = toFiniteNumber(
    row.securityStatus ?? row.security ?? row.trueSec,
    0,
  );
  let securityClass = String(row.securityClass || "").trim().toUpperCase();

  if (!securityClass) {
    if (securityStatus >= 0.85) {
      securityClass = "A";
    } else if (securityStatus >= 0.65) {
      securityClass = "B";
    } else if (securityStatus >= 0.45) {
      securityClass = "C";
    } else if (securityStatus >= 0.25) {
      securityClass = "D";
    } else if (securityStatus >= 0.05) {
      securityClass = "E";
    } else {
      securityClass = "F";
    }
  }

  return { securityClass, securityStatus };
}

function inferFamilyName(record) {
  const name = String(record && record.name || "").trim();
  if (!name) {
    return "";
  }
  const knownFamilies = Object.keys(ORE_FAMILY_TYPE_IDS).sort((a, b) => b.length - a.length);
  for (const family of knownFamilies) {
    if (
      name === family ||
      name.startsWith(`${family} `) ||
      name.includes(`${family} II-Grade`) ||
      name.includes(`${family} III-Grade`)
    ) {
      return family;
    }
  }
  return name.replace(/\s+(II|III)-Grade$/i, "").trim();
}

function classifyFamilyBucket(familyName, securityClass) {
  const families =
    SECURITY_CLASS_FAMILIES[securityClass] ||
    SECURITY_CLASS_FAMILIES[String(securityClass || "").replace(/[0-9]+$/, "")] ||
    [];
  const index = families.indexOf(familyName);
  if (index < 0) {
    return "rare";
  }
  if (index <= 1) {
    return "common";
  }
  if (index <= 3) {
    return "uncommon";
  }
  return "rare";
}

function buildSecurityBandOreCandidates(securityClass) {
  const normalized = String(securityClass || "").toUpperCase();
  const fallback = normalized.replace(/[0-9]+$/, "");
  const familyNames = SECURITY_CLASS_FAMILIES[normalized] || SECURITY_CLASS_FAMILIES[fallback] || [];
  const rows = [];
  const seenTypeIDs = new Set();

  for (const familyName of familyNames) {
    const typeIDs = ORE_FAMILY_TYPE_IDS[familyName] || [];
    for (const typeID of typeIDs) {
      const safeTypeID = toPositiveInt(typeID, 0);
      if (safeTypeID <= 0 || seenTypeIDs.has(safeTypeID)) {
        continue;
      }

      const row = resolveItemByTypeID(safeTypeID);
      if (!row) {
        continue;
      }

      const classification = classifyMiningMaterialType(row);
      if (!classification || classification.kind !== "ore") {
        continue;
      }

      seenTypeIDs.add(safeTypeID);
      rows.push({
        ...row,
        typeID: toPositiveInt(row.typeID, safeTypeID),
        familyName,
        weight: 1,
        spawnWeight: 1,
      });
    }
  }

  return rows;
}

function buildEnrichedSystemOrePool(systemID) {
  const rawPool = buildSystemOrePool(systemID);
  const { securityClass, securityStatus } = getSecurityMetadata(systemID);
  const mergedByTypeID = new Map();

  for (const row of rawPool) {
    const typeID = toPositiveInt(row.typeID, 0);
    if (typeID > 0) {
      mergedByTypeID.set(typeID, {
        ...row,
        familyName: inferFamilyName(row),
        spawnWeight: Math.max(0.000001, toFiniteNumber(row.spawnWeight ?? row.weight, 1)),
      });
    }
  }

  const rawFamilyCount = new Set(rawPool.map((row) => inferFamilyName(row)).filter(Boolean)).size;
  const shouldEnrich = rawPool.length < 10 || rawFamilyCount < 4;

  if (shouldEnrich) {
    const extraCandidates = buildSecurityBandOreCandidates(securityClass);
    for (const candidate of extraCandidates) {
      const typeID = toPositiveInt(candidate.typeID, 0);
      if (typeID <= 0 || mergedByTypeID.has(typeID)) {
        continue;
      }
      const familyName = inferFamilyName(candidate);
      const bucket = classifyFamilyBucket(familyName, securityClass);
      const weight = bucket === "common" ? 1.5 : bucket === "uncommon" ? 1.15 : 0.8;
      mergedByTypeID.set(typeID, {
        ...candidate,
        familyName,
        weight,
        spawnWeight: weight,
        enriched: true,
      });
    }
  }

  const orePool = Array.from(mergedByTypeID.values())
    .filter((row) => {
      const classification = classifyMiningMaterialType(row);
      return classification && classification.kind === "ore";
    })
    .sort((left, right) => {
      const nameDelta = String(left.familyName || left.name || "").localeCompare(
        String(right.familyName || right.name || ""),
      );
      if (nameDelta !== 0) {
        return nameDelta;
      }
      return toPositiveInt(left.typeID, 0) - toPositiveInt(right.typeID, 0);
    });

  return {
    orePool,
    securityClass,
    securityStatus,
  };
}

function groupEntriesByFamily(entries) {
  const grouped = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const familyName = String(entry && entry.familyName || inferFamilyName(entry)).trim();
    if (!familyName) {
      continue;
    }
    if (!grouped.has(familyName)) {
      grouped.set(familyName, []);
    }
    grouped.get(familyName).push({
      ...entry,
      familyName,
    });
  }
  return grouped;
}

function resolveGradeVariantWeight(entry) {
  const name = String(entry && entry.name || "").trim();
  if (/\bIII-Grade\b/i.test(name)) {
    return 0.7;
  }
  if (/\bII-Grade\b/i.test(name)) {
    return 1.0;
  }
  return 1.35;
}

function buildBeltOreSubset(orePool, securityClass, rng) {
  const bucketed = {
    common: [],
    uncommon: [],
    rare: [],
  };

  for (const entry of orePool) {
    const familyName = String(entry && entry.familyName || inferFamilyName(entry)).trim();
    if (!familyName) {
      continue;
    }
    const bucket = classifyFamilyBucket(familyName, securityClass);
    bucketed[bucket].push({
      ...entry,
      familyName,
      spawnBucket: bucket,
      spawnWeight: bucket === "common" ? 6 : bucket === "uncommon" ? 5 : 2.5,
    });
  }

  const subset = [];
  for (const [bucketName, rules] of Object.entries(BELT_BUCKETS)) {
    const groupedCandidates = groupEntriesByFamily(bucketed[bucketName]);
    const familyNames = Array.from(groupedCandidates.keys()).sort((a, b) => String(a).localeCompare(String(b)));
    if (familyNames.length <= 0) {
      continue;
    }

    const target = Math.min(
      familyNames.length,
      pickIntegerInRange(rules.targetMin, rules.targetMax, rng),
    );

    const shuffledFamilies = [...familyNames];
    for (let index = shuffledFamilies.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(rng() * (index + 1));
      [shuffledFamilies[index], shuffledFamilies[swapIndex]] =
        [shuffledFamilies[swapIndex], shuffledFamilies[index]];
    }

    for (let index = 0; index < target; index += 1) {
      const familyName = shuffledFamilies[index];
      const familyEntries = (groupedCandidates.get(familyName) || [])
        .sort((left, right) => toPositiveInt(left && left.typeID, 0) - toPositiveInt(right && right.typeID, 0));

      for (const familyEntry of familyEntries) {
        const variantWeight = resolveGradeVariantWeight(familyEntry);
        subset.push({
          ...familyEntry,
          spawnBucket: bucketName,
          spawnWeight: Math.max(0.000001, toFiniteNumber(rules.weight, 1) * variantWeight),
        });
      }
    }
  }

  return subset.length > 0
    ? subset
    : orePool.slice(0, Math.min(orePool.length, 6)).map((entry) => ({
      ...entry,
      familyName: String(entry && entry.familyName || inferFamilyName(entry)).trim(),
      spawnBucket: "common",
      spawnWeight: resolveGradeVariantWeight(entry),
    }));
}

function selectSystemOreType(pool, rng) {
  const entries = Array.isArray(pool) ? pool : [];
  if (entries.length <= 0) {
    return null;
  }

  const weightedEntries = entries
    .map((entry) => ({
      ...entry,
      weight: Math.max(0.000001, toFiniteNumber(entry && entry.spawnWeight, 1)),
    }))
    .filter((entry) => entry.weight > 0);

  return pickWeightedEntry(weightedEntries, rng) ||
    weightedEntries[0] ||
    null;
}

function resolveGeneratedOreAsteroidShellTypeRecord(typeRow, itemID) {
  const shellTypeID = GENERATED_ORE_ASTEROID_SHELL_TYPE_IDS[
    hashText(
      `${toPositiveInt(typeRow && typeRow.typeID, 0)}:${toPositiveInt(itemID, 0)}:shell`,
    ) % GENERATED_ORE_ASTEROID_SHELL_TYPE_IDS.length
  ];
  return resolveItemByTypeID(shellTypeID) || typeRow || null;
}

function buildSystemOreAsteroidEntity(
  scene,
  belt,
  asteroidIndex,
  totalCount,
  fieldProfile,
  rng,
  pool,
) {
  const typeRow = selectSystemOreType(pool, rng);
  if (!typeRow) {
    return null;
  }

  const itemID = buildAsteroidItemID(belt.itemID, asteroidIndex + 1);
  const asteroidOffset = buildCurvedAsteroidOffset(
    fieldProfile,
    asteroidIndex,
    totalCount,
    rng,
  );
  const position = addVectors(cloneVector(belt.position), asteroidOffset);
  const shellTypeRecord = resolveGeneratedOreAsteroidShellTypeRecord(typeRow, itemID);
  const visualPresentation = resolveMiningVisualPresentation(shellTypeRecord, {
    visualTypeID: shellTypeRecord && shellTypeRecord.typeID,
    entityID: itemID,
    radius: shellTypeRecord && shellTypeRecord.radius,
  });
  const visualTypeID = toPositiveInt(
    visualPresentation.visualTypeID,
    toPositiveInt(shellTypeRecord && shellTypeRecord.typeID, typeRow.typeID),
  );
  const visualRecord =
    resolveItemByTypeID(visualTypeID) || shellTypeRecord || typeRow;

  const name = typeRow.name || `${belt.itemName} Asteroid ${asteroidIndex + 1}`;
  return {
    kind: "asteroid",
    generatedAsteroid: true,
    generatedFromSystemIDTable: true,
    resourceFieldSource: "systemID",
    itemID,
    typeID: visualRecord.typeID,
    groupID: visualRecord.groupID,
    categoryID: visualRecord.categoryID,
    slimTypeID: typeRow.typeID,
    slimGroupID: typeRow.groupID,
    slimCategoryID: typeRow.categoryID,
    miningYieldTypeID: typeRow.typeID,
    miningYieldKind: "ore",
    itemName: name,
    slimName: name,
    ownerID: 1,
    radius: Math.max(
      500,
      toFiniteNumber(visualRecord.radius, toFiniteNumber(typeRow.radius, 1_800)),
    ),
    graphicID: toPositiveInt(
      visualPresentation.graphicID,
      toPositiveInt(visualRecord.graphicID, 0),
    ),
    slimGraphicID: toPositiveInt(
      visualPresentation.graphicID,
      toPositiveInt(visualRecord.graphicID, 0),
    ),
    visualTypeID,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    beltID: belt.itemID,
    fieldStyleID: belt.fieldStyleID,
    staticVisibilityScope: "bubble",
  };
}

function buildDecorativeFallbackAsteroidEntity(_belt, _style, _asteroidIndex, _clusterOffsets, _rng) {
  return null;
}

function populateBeltField(scene, belt) {
  const style = asteroidData.getFieldStyleByID(belt.fieldStyleID);
  if (!scene || !belt) {
    return [];
  }

  const systemBelts = asteroidData.getBeltsForSystem(scene.systemID);
  const fieldProfile = buildCurvedFieldProfile(scene, belt, style, systemBelts);
  const totalCount = Math.max(0, toPositiveInt(fieldProfile.count, 0));
  if (totalCount <= 0) {
    return [];
  }

  const rng = createRng(toPositiveInt(belt.fieldSeed, belt.itemID));
  const enriched = buildEnrichedSystemOrePool(scene.systemID);
  const systemOrePool = enriched.orePool;
  const beltSubset = buildBeltOreSubset(systemOrePool, enriched.securityClass, rng);
  const legacyClusterOffsets = [];

  const spawned = [];
  for (let asteroidIndex = 0; asteroidIndex < totalCount; asteroidIndex += 1) {
    const entity = beltSubset.length > 0
      ? buildSystemOreAsteroidEntity(
        scene,
        belt,
        asteroidIndex,
        totalCount,
        fieldProfile,
        rng,
        beltSubset,
      )
      : buildDecorativeFallbackAsteroidEntity(
        belt,
        style,
        asteroidIndex,
        legacyClusterOffsets,
        rng,
      );
    if (!entity) {
      continue;
    }
    if (scene.addStaticEntity(entity)) {
      spawned.push(entity);
    }
  }

  recordAsteroidBootstrap(scene, {
    beltID: toPositiveInt(belt && belt.itemID, 0),
    spawnedCount: spawned.length,
    orePool: systemOrePool,
    beltSubset,
    fieldProfile: {
      count: fieldProfile.count,
      authoredCount: fieldProfile.authoredCount,
      multiBeltOrbit: fieldProfile.multiBeltOrbit,
      axisSpanMeters: fieldProfile.axisSpanMeters,
      ribbonWidthMeters: fieldProfile.ribbonWidthMeters,
      visualRibbonWidthMeters: fieldProfile.visualRibbonWidthMeters,
      bowMeters: fieldProfile.bowMeters,
      laneCount: fieldProfile.laneCount,
      sideOffsetMeters: fieldProfile.sideOffsetMeters,
    },
    securityClass: enriched.securityClass,
    securityStatus: enriched.securityStatus,
  });

  return spawned;
}

function listGeneratedAsteroidEntities(scene) {
  if (!scene || !Array.isArray(scene.staticEntities)) {
    return [];
  }
  return scene.staticEntities.filter((entity) => (
    entity &&
    String(entity.kind || "").toLowerCase() === "asteroid" &&
    toPositiveInt(entity.beltID, 0) > 0
  ));
}

function handleSceneCreated(scene) {
  if (!scene || scene._asteroidFieldsInitialized === true) {
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  }

  if (config.asteroidFieldsEnabled !== true) {
    scene._asteroidFieldsInitialized = true;
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  }

  scene._asteroidFieldsInitialized = true;
  const belts = asteroidData.getBeltsForSystem(scene.systemID);
  const spawned = [];
  for (const belt of belts) {
    spawned.push(...populateBeltField(scene, belt));
  }

  return {
    success: true,
    data: {
      spawned,
    },
  };
}

function resetSceneAsteroidFields(scene, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  resetMiningStartupSummary(scene);
  const removedEntityIDs = [];
  for (const entity of listGeneratedAsteroidEntities(scene)) {
    if (
      scene.removeStaticEntity(entity.itemID, {
        broadcast: options.broadcast === true,
        nowMs: options.nowMs,
      })
    ) {
      removedEntityIDs.push(entity.itemID);
    }
  }

  scene._asteroidFieldsInitialized = false;
  const spawnResult = handleSceneCreated(scene);
  if (!spawnResult.success) {
    return spawnResult;
  }

  return {
    success: true,
    data: {
      removedEntityIDs,
      removedCount: removedEntityIDs.length,
      spawned: Array.isArray(spawnResult.data && spawnResult.data.spawned)
        ? spawnResult.data.spawned
        : [],
    },
  };
}

module.exports = {
  handleSceneCreated,
  resetSceneAsteroidFields,
  _testing: {
    buildAsteroidItemID,
    buildCurvedFieldProfile,
    buildCurvedAsteroidOffset,
    populateBeltField,
    listGeneratedAsteroidEntities,
    buildSystemOrePool,
    buildEnrichedSystemOrePool,
    buildBeltOreSubset,
  },
};
