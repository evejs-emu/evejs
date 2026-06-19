const path = require("path");

const {
  getBlueprintDefinitionByProductTypeID,
  getBlueprintDefinitionByTypeID,
} = require(path.join(__dirname, "./industryStaticData"));
const {
  INDUSTRY_ACTIVITY,
} = require(path.join(__dirname, "./industryConstants"));
const {
  getItemMetadata,
} = require(path.join(__dirname, "../inventory/itemStore"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFloat(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const priceCache = new Map();
const blueprintPriceCache = new Map();

function normalizePricingActivityID(activityID) {
  const numericActivityID = toInt(activityID, INDUSTRY_ACTIVITY.MANUFACTURING);
  if (
    numericActivityID === INDUSTRY_ACTIVITY.RESEARCH_TIME ||
    numericActivityID === INDUSTRY_ACTIVITY.RESEARCH_MATERIAL ||
    numericActivityID === INDUSTRY_ACTIVITY.COPYING ||
    numericActivityID === INDUSTRY_ACTIVITY.INVENTION
  ) {
    return INDUSTRY_ACTIVITY.MANUFACTURING;
  }
  return numericActivityID;
}

function getFallbackTypePrice(typeID) {
  const metadata = getItemMetadata(typeID, null);
  return Math.max(0, toFloat(metadata && metadata.basePrice, 0));
}

function resolveAdjustedAverageTypePrice(typeID) {
  return getFallbackTypePrice(typeID);
}

function getActivityMaterials(definition, activityID) {
  if (!definition || !definition.activities || typeof definition.activities !== "object") {
    return [];
  }
  if (normalizePricingActivityID(activityID) !== INDUSTRY_ACTIVITY.MANUFACTURING) {
    return [];
  }
  const activity = definition.activities.manufacturing;
  return Array.isArray(activity && activity.materials) ? activity.materials : [];
}

function resolveEstimatedTypePrice(typeID, activityID, visited = null) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return 0;
  }

  const normalizedActivityID = normalizePricingActivityID(activityID);
  const cacheKey = `${normalizedActivityID}:${numericTypeID}`;
  if (priceCache.has(cacheKey)) {
    return priceCache.get(cacheKey);
  }

  const traversal = visited || new Set();
  if (traversal.has(cacheKey)) {
    return getFallbackTypePrice(numericTypeID);
  }
  traversal.add(cacheKey);

  let resolvedPrice = 0;
  const definition = getBlueprintDefinitionByProductTypeID(numericTypeID);
  const materials = getActivityMaterials(definition, normalizedActivityID);
  if (materials.length > 0) {
    resolvedPrice = materials.reduce((sum, material) => {
      const materialTypeID = toInt(material && material.typeID, 0);
      const materialQuantity = Math.max(0, toInt(material && material.quantity, 0));
      if (materialTypeID <= 0 || materialQuantity <= 0) {
        return sum;
      }
      return (
        sum +
        resolveEstimatedTypePrice(materialTypeID, normalizedActivityID, traversal) *
          materialQuantity
      );
    }, 0);
  }

  if (!(resolvedPrice > 0)) {
    resolvedPrice = getFallbackTypePrice(numericTypeID);
  }

  priceCache.set(cacheKey, resolvedPrice);
  traversal.delete(cacheKey);
  return resolvedPrice;
}

function normalizeBlueprintPricingActivityID(activityID) {
  const numericActivityID = toInt(activityID, INDUSTRY_ACTIVITY.MANUFACTURING);
  if (
    numericActivityID === INDUSTRY_ACTIVITY.RESEARCH_TIME ||
    numericActivityID === INDUSTRY_ACTIVITY.RESEARCH_MATERIAL ||
    numericActivityID === INDUSTRY_ACTIVITY.COPYING ||
    numericActivityID === INDUSTRY_ACTIVITY.INVENTION
  ) {
    return INDUSTRY_ACTIVITY.MANUFACTURING;
  }
  return numericActivityID;
}

function getBlueprintActivityKey(activityID) {
  const normalizedActivityID = normalizeBlueprintPricingActivityID(activityID);
  if (normalizedActivityID === INDUSTRY_ACTIVITY.REACTION) {
    return "reaction";
  }
  return "manufacturing";
}

function getBlueprintActivityMaterials(blueprintTypeID, activityID) {
  const definition = getBlueprintDefinitionByTypeID(blueprintTypeID);
  if (!definition || !definition.activities || typeof definition.activities !== "object") {
    return [];
  }
  const activityKey = getBlueprintActivityKey(activityID);
  const activity = definition.activities[activityKey];
  return Array.isArray(activity && activity.materials) ? activity.materials : [];
}

function resolveBlueprintActivityPrice(typeID, activityID, visited = null) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return 0;
  }

  const normalizedActivityID = normalizeBlueprintPricingActivityID(activityID);
  const cacheKey = `${normalizedActivityID}:${numericTypeID}`;
  if (blueprintPriceCache.has(cacheKey)) {
    return blueprintPriceCache.get(cacheKey);
  }

  const traversal = visited || new Set();
  if (traversal.has(cacheKey)) {
    return resolveAdjustedAverageTypePrice(numericTypeID);
  }
  traversal.add(cacheKey);

  const materials = getBlueprintActivityMaterials(numericTypeID, normalizedActivityID);
  let resolvedPrice = 0;
  if (materials.length > 0) {
    resolvedPrice = materials.reduce((sum, material) => {
      const materialTypeID = toInt(material && material.typeID, 0);
      const materialQuantity = Math.max(0, toInt(material && material.quantity, 0));
      if (materialTypeID <= 0 || materialQuantity <= 0) {
        return sum;
      }
      return (
        sum +
        resolveBlueprintActivityPrice(materialTypeID, normalizedActivityID, traversal) *
          materialQuantity
      );
    }, 0);
  }

  if (!(resolvedPrice > 0)) {
    resolvedPrice = resolveAdjustedAverageTypePrice(numericTypeID);
  }

  blueprintPriceCache.set(cacheKey, resolvedPrice);
  traversal.delete(cacheKey);
  return resolvedPrice;
}

function clearIndustryPricingCache() {
  priceCache.clear();
  blueprintPriceCache.clear();
}

module.exports = {
  clearIndustryPricingCache,
  normalizePricingActivityID,
  resolveAdjustedAverageTypePrice,
  resolveBlueprintActivityPrice,
  resolveEstimatedTypePrice,
};
