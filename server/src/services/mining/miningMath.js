const path = require("path");

const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));

const ASTEROID_EXP_SCALE = 4e-05;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(
    Math.max(toFiniteNumber(value, minimum), minimum),
    maximum,
  );
}

function randomizedRound(value, random = Math.random) {
  const numeric = Math.max(0, toFiniteNumber(value, 0));
  const rounded = Math.trunc(numeric);
  const remainder = numeric - rounded;
  if (remainder > clamp(random(), 0, 1)) {
    return rounded + 1;
  }
  return rounded;
}

function computeMiningResult(options = {}) {
  const clampFactor = clamp(options.clampFactor, 0, 1);
  const volume = Math.max(0, toFiniteNumber(options.volume, 0));
  const unitVolume = Math.max(0.000001, toFiniteNumber(options.unitVolume, 1));
  const asteroidQuantity = Math.max(0, toInt(options.asteroidQuantity, 0));
  const wasteVolumeMultiplier = Math.max(
    0,
    toFiniteNumber(options.wasteVolumeMultiplier, 0),
  );
  const wasteProbability = clamp(options.wasteProbability, 0, 100);
  const critQuantityMultiplier = Math.max(
    0,
    toFiniteNumber(options.critQuantityMultiplier, 0),
  );
  const critProbability = clamp(options.critProbability, 0, 1);
  const efficiency = clamp(
    options.efficiency === undefined ? 1 : options.efficiency,
    0,
    1,
  );
  const rngFloat = typeof options.random === "function" ? options.random : Math.random;
  const rngPercent = typeof options.randomInt === "function"
    ? options.randomInt
    : () => Math.floor(clamp(rngFloat(), 0, 0.999999) * 101);

  const normalVolume = volume * clampFactor;
  let wastedVolume = 0;
  if (normalVolume > 0 && wasteProbability > rngPercent()) {
    wastedVolume = normalVolume * wasteVolumeMultiplier * efficiency;
  }

  const normalQuantity = Math.min(
    asteroidQuantity,
    Math.max(
      0,
      randomizedRound((normalVolume / unitVolume) * efficiency, rngFloat),
    ),
  );
  const remainingAfterNormal = Math.max(0, asteroidQuantity - normalQuantity);
  const wastedQuantity = Math.max(
    0,
    Math.min(
      remainingAfterNormal,
      randomizedRound(wastedVolume / unitVolume, rngFloat),
    ),
  );
  const criticalHitQuantity =
    normalQuantity > 0 && critProbability > clamp(rngFloat(), 0, 1)
      ? Math.max(
          0,
          randomizedRound(normalQuantity * critQuantityMultiplier, rngFloat),
        )
      : 0;

  return {
    clampFactor,
    normalVolume,
    wastedVolume,
    normalQuantity,
    wastedQuantity,
    criticalHitQuantity,
    criticalHitVolume: criticalHitQuantity * unitVolume,
    unitVolume,
    rewardedQuantity: 0,
    rewardedVolume: 0,
    getTotalTransferredQuantity() {
      return this.normalQuantity + this.rewardedQuantity + this.criticalHitQuantity;
    },
    getTotalDepletedQuantity() {
      return this.normalQuantity + this.wastedQuantity;
    },
  };
}

function getAsteroidRadiusAttributes(typeID) {
  return {
    unitSize: Math.max(
      0,
      toFiniteNumber(getTypeAttributeValue(typeID, "asteroidRadiusUnitSize"), 0),
    ),
    growthFactor: Math.max(
      0,
      toFiniteNumber(getTypeAttributeValue(typeID, "asteroidRadiusGrowthFactor"), 0),
    ),
    maxRadius: Math.max(
      0,
      toFiniteNumber(getTypeAttributeValue(typeID, "asteroidMaxRadius"), 0),
    ),
  };
}

function computeAsteroidRadiusFromQuantity(typeID, quantity, options = {}) {
  const normalizedQuantity = Math.max(0, toFiniteNumber(quantity, 0));
  const fallbackUnitVolume = Math.max(
    0.000001,
    toFiniteNumber(options.unitVolume, 1),
  );
  const fallbackScale = Math.max(
    0.000001,
    toFiniteNumber(options.fallbackScale, ASTEROID_EXP_SCALE),
  );
  const fallbackMinRadius = Math.max(
    1,
    toFiniteNumber(options.fallbackMinRadius, 250),
  );
  const fallbackMaxRadius = Math.max(
    fallbackMinRadius,
    toFiniteNumber(options.fallbackMaxRadius, 25_000),
  );

  const attributes = getAsteroidRadiusAttributes(typeID);
  if (
    attributes.unitSize > 0 &&
    attributes.growthFactor > 0 &&
    attributes.maxRadius > 0
  ) {
    const rawRadius =
      attributes.unitSize +
      (attributes.growthFactor * Math.log1p(normalizedQuantity * ASTEROID_EXP_SCALE));
    return clamp(rawRadius, attributes.unitSize, attributes.maxRadius);
  }

  const volume = normalizedQuantity * fallbackUnitVolume;
  const rawFallbackRadius = Math.sqrt(Math.max(0, volume) / fallbackScale);
  return clamp(rawFallbackRadius, fallbackMinRadius, fallbackMaxRadius);
}

function computeAsteroidQuantityFromRadius(typeID, radius, options = {}) {
  const normalizedRadius = Math.max(0, toFiniteNumber(radius, 0));
  const fallbackUnitVolume = Math.max(
    0.000001,
    toFiniteNumber(options.unitVolume, 1),
  );
  const fallbackScale = Math.max(
    0.000001,
    toFiniteNumber(options.fallbackScale, ASTEROID_EXP_SCALE),
  );
  const attributes = getAsteroidRadiusAttributes(typeID);

  if (
    attributes.unitSize > 0 &&
    attributes.growthFactor > 0 &&
    normalizedRadius > attributes.unitSize
  ) {
    const normalizedLog = (normalizedRadius - attributes.unitSize) / attributes.growthFactor;
    return Math.max(
      0,
      Math.round(Math.expm1(normalizedLog) / ASTEROID_EXP_SCALE),
    );
  }

  const volume = (normalizedRadius ** 2) * fallbackScale;
  return Math.max(0, Math.round(volume / fallbackUnitVolume));
}

module.exports = {
  ASTEROID_EXP_SCALE,
  randomizedRound,
  computeMiningResult,
  computeAsteroidRadiusFromQuantity,
  computeAsteroidQuantityFromRadius,
};
