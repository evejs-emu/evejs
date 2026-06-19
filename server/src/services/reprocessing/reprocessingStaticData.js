const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  REPROCESSING_CLIENT_RANDOMIZED_TABLE,
  REPROCESSING_STATIC_TABLE,
} = require("./reprocessingConstants");

let cachedPayload = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFloat(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function freezeFixedMaterial(entry = {}) {
  return Object.freeze({
    materialTypeID: toInt(entry.materialTypeID, 0),
    quantity: Math.max(0, toInt(entry.quantity, 0)),
  });
}

function freezeRandomizedMaterial(entry = {}) {
  const weight = toFloat(entry.weight, 0);
  return Object.freeze({
    materialTypeID: toInt(entry.materialTypeID, 0),
    quantityMin: Math.max(0, toInt(entry.quantityMin, 0)),
    quantityMax: Math.max(0, toInt(entry.quantityMax, 0)),
    weight: weight > 0 ? weight : null,
  });
}

function freezeStructureReprocessingProfile(entry = {}) {
  return Object.freeze({
    typeID: toInt(entry.typeID, 0),
    name: String(entry.name || "").trim(),
    rigSize: Math.max(0, toInt(entry.rigSize, 0)),
    reprocessingYieldBonusPercent: toFloat(entry.reprocessingYieldBonusPercent, 0),
    gasDecompressionEfficiencyBase: toFloat(entry.gasDecompressionEfficiencyBase, 0),
    gasDecompressionEfficiencyBonusAdd: toFloat(entry.gasDecompressionEfficiencyBonusAdd, 0),
  });
}

function freezeReprocessingRigProfile(entry = {}) {
  const securityMultipliers =
    entry.securityMultipliers && typeof entry.securityMultipliers === "object"
      ? entry.securityMultipliers
      : {};
  return Object.freeze({
    typeID: toInt(entry.typeID, 0),
    name: String(entry.name || "").trim(),
    rigSize: Math.max(0, toInt(entry.rigSize, 0)),
    refiningYieldMultiplierBase: toFloat(entry.refiningYieldMultiplierBase, 0),
    securityMultipliers: Object.freeze({
      high: toFloat(securityMultipliers.high, 1),
      low: toFloat(securityMultipliers.low, 1),
      null: toFloat(securityMultipliers.null, 1),
    }),
    yieldClasses: Object.freeze(
      [...new Set(
        (Array.isArray(entry.yieldClasses) ? entry.yieldClasses : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      )].sort(),
    ),
    isGeneralMonitor: entry.isGeneralMonitor === true,
  });
}

function buildAverageRandomizedOutputs(randomizedMaterials = []) {
  const materials = Array.isArray(randomizedMaterials)
    ? randomizedMaterials.filter(
      (entry) =>
        entry &&
        toInt(entry.materialTypeID, 0) > 0 &&
        toInt(entry.quantityMax, 0) > 0,
    )
    : [];
  if (materials.length <= 0) {
    return Object.freeze([]);
  }

  const explicitWeightSum = materials.reduce(
    (sum, entry) => sum + Math.max(0, toFloat(entry.weight, 0)),
    0,
  );
  const defaultWeight = explicitWeightSum > 0 ? 0 : 1 / materials.length;

  return Object.freeze(
    materials
      .map((entry) => {
        const probability =
          explicitWeightSum > 0
            ? Math.max(0, toFloat(entry.weight, 0)) / explicitWeightSum
            : defaultWeight;
        const averageQuantity =
          ((Math.max(0, toInt(entry.quantityMin, 0)) +
            Math.max(0, toInt(entry.quantityMax, 0))) / 2) *
          probability;
        return Object.freeze({
          materialTypeID: toInt(entry.materialTypeID, 0),
          quantityAverage: averageQuantity,
          probability,
        });
      })
      .filter((entry) => entry.materialTypeID > 0 && entry.quantityAverage > 0),
  );
}

function readClientRandomizedProfiles() {
  const result = database.read(REPROCESSING_CLIENT_RANDOMIZED_TABLE, "/");
  const root = result && result.success && result.data && typeof result.data === "object"
    ? result.data
    : {};
  const source = Array.isArray(root.types)
    ? root.types
    : Object.values(root.types || {});
  return source
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const typeID = toInt(entry.typeID, 0);
      if (typeID <= 0) {
        return null;
      }
      const typeRecord = resolveItemByTypeID(typeID) || {};
      return {
        typeID,
        name: String(typeRecord.name || entry.name || "").trim(),
        groupID: toInt(typeRecord.groupID, 0),
        categoryID: toInt(typeRecord.categoryID, 0),
        groupName: String(typeRecord.groupName || entry.groupName || "").trim(),
        reprocessingFamily: String(
          entry.reprocessingFamily || "randomized-client-materials",
        ),
        portionSize: Math.max(
          1,
          toInt(typeRecord.portionSize || entry.portionSize, 1),
        ),
        basePrice: Math.max(
          0,
          toFloat(typeRecord.basePrice || entry.basePrice, 0),
        ),
        published: typeRecord.published === false ? false : true,
        reprocessingSkillType: toInt(entry.reprocessingSkillType, 0),
        isRefinable: true,
        isRecyclable: false,
        materials: [],
        randomizedMaterials: Array.isArray(entry.randomizedMaterials)
          ? entry.randomizedMaterials.map((material) => ({
              ...material,
              weight: material.weight ?? material.relativeProbability ?? null,
            }))
          : [],
      };
    })
    .filter(Boolean);
}

function buildCacheFromPayload(payload = {}) {
  const profileByTypeID = new Map();
  for (const profile of Array.isArray(payload.reprocessingTypes)
    ? payload.reprocessingTypes
    : []) {
    const typeID = toInt(profile && profile.typeID, 0);
    if (typeID > 0) {
      profileByTypeID.set(typeID, { ...profile });
    }
  }
  for (const randomizedProfile of readClientRandomizedProfiles()) {
    const existing = profileByTypeID.get(randomizedProfile.typeID) || {};
    profileByTypeID.set(randomizedProfile.typeID, {
      ...randomizedProfile,
      ...existing,
      randomizedMaterials:
        Array.isArray(existing.randomizedMaterials) &&
        existing.randomizedMaterials.length > 0
          ? existing.randomizedMaterials
          : randomizedProfile.randomizedMaterials,
      averageRandomizedOutputs:
        Array.isArray(existing.averageRandomizedOutputs) &&
        existing.averageRandomizedOutputs.length > 0
          ? existing.averageRandomizedOutputs
          : randomizedProfile.averageRandomizedOutputs,
    });
  }
  const profiles = [...profileByTypeID.values()];
  const structureProfiles = Array.isArray(payload.structureReprocessingProfiles)
    ? payload.structureReprocessingProfiles
    : [];
  const rigProfiles = Array.isArray(payload.reprocessingRigProfiles)
    ? payload.reprocessingRigProfiles
    : [];
  const byTypeID = new Map();
  const materialsByTypeID = new Map();
  const randomizedMaterialsByTypeID = new Map();
  const averageRandomizedOutputsByTypeID = new Map();
  const reprocessableTypeIDs = new Set();
  const randomizedTypeIDs = new Set();
  const structureReprocessingProfilesByTypeID = new Map();
  const reprocessingRigProfilesByTypeID = new Map();
  const reprocessingRigProfilesBySize = new Map();

  for (const rawProfile of profiles) {
    const typeID = toInt(rawProfile && rawProfile.typeID, 0);
    if (typeID <= 0) {
      continue;
    }

    const materials = Object.freeze(
      (Array.isArray(rawProfile && rawProfile.materials) ? rawProfile.materials : [])
        .map((entry) => freezeFixedMaterial(entry))
        .filter((entry) => entry.materialTypeID > 0 && entry.quantity > 0),
    );
    const randomizedMaterials = Object.freeze(
      (Array.isArray(rawProfile && rawProfile.randomizedMaterials)
        ? rawProfile.randomizedMaterials
        : [])
        .map((entry) => freezeRandomizedMaterial(entry))
        .filter(
          (entry) =>
            entry.materialTypeID > 0 &&
            entry.quantityMin >= 0 &&
            entry.quantityMax > 0,
        ),
    );
    const averageRandomizedOutputs = buildAverageRandomizedOutputs(
      Array.isArray(rawProfile && rawProfile.averageRandomizedOutputs)
        ? rawProfile.averageRandomizedOutputs
        : randomizedMaterials,
    );
    const profile = Object.freeze({
      typeID,
      name: String(rawProfile && rawProfile.name || "").trim(),
      groupID: toInt(rawProfile && rawProfile.groupID, 0),
      categoryID: toInt(rawProfile && rawProfile.categoryID, 0),
      groupName: String(rawProfile && rawProfile.groupName || "").trim(),
      reprocessingFamily: String(rawProfile && rawProfile.reprocessingFamily || "").trim(),
      portionSize: Math.max(1, toInt(rawProfile && rawProfile.portionSize, 1)),
      basePrice: Math.max(0, toFloat(rawProfile && rawProfile.basePrice, 0)),
      published: rawProfile && rawProfile.published === false ? false : true,
      reprocessingSkillType: Math.max(
        0,
        toInt(rawProfile && rawProfile.reprocessingSkillType, 0),
      ),
      isRefinable: rawProfile && rawProfile.isRefinable === true,
      isRecyclable: rawProfile && rawProfile.isRecyclable === true,
      materials,
      randomizedMaterials,
      averageRandomizedOutputs,
    });

    byTypeID.set(typeID, profile);
    if (materials.length > 0) {
      materialsByTypeID.set(typeID, materials);
      reprocessableTypeIDs.add(typeID);
    }
    if (randomizedMaterials.length > 0) {
      randomizedMaterialsByTypeID.set(typeID, randomizedMaterials);
      averageRandomizedOutputsByTypeID.set(typeID, averageRandomizedOutputs);
      reprocessableTypeIDs.add(typeID);
      randomizedTypeIDs.add(typeID);
    }
  }

  for (const rawProfile of structureProfiles) {
    const profile = freezeStructureReprocessingProfile(rawProfile);
    if (profile.typeID <= 0) {
      continue;
    }
    structureReprocessingProfilesByTypeID.set(profile.typeID, profile);
  }

  for (const rawProfile of rigProfiles) {
    const profile = freezeReprocessingRigProfile(rawProfile);
    if (profile.typeID <= 0) {
      continue;
    }
    reprocessingRigProfilesByTypeID.set(profile.typeID, profile);
    if (profile.rigSize > 0) {
      if (!reprocessingRigProfilesBySize.has(profile.rigSize)) {
        reprocessingRigProfilesBySize.set(profile.rigSize, []);
      }
      reprocessingRigProfilesBySize.get(profile.rigSize).push(profile);
    }
  }

  for (const profilesBySize of reprocessingRigProfilesBySize.values()) {
    profilesBySize.sort((left, right) => left.typeID - right.typeID);
    Object.freeze(profilesBySize);
  }

  const compressedTypeBySourceTypeID = new Map(
    Object.entries(
      payload.compressedTypeBySourceTypeID &&
      typeof payload.compressedTypeBySourceTypeID === "object"
        ? payload.compressedTypeBySourceTypeID
        : {},
    )
      .map(([sourceTypeID, compressedTypeID]) => [
        toInt(sourceTypeID, 0),
        toInt(compressedTypeID, 0),
      ])
      .filter(([sourceTypeID, compressedTypeID]) => sourceTypeID > 0 && compressedTypeID > 0),
  );

  const sourceTypesByCompressedTypeID = new Map(
    Object.entries(
      payload.sourceTypesByCompressedTypeID &&
      typeof payload.sourceTypesByCompressedTypeID === "object"
        ? payload.sourceTypesByCompressedTypeID
        : {},
    )
      .map(([compressedTypeID, sourceTypeIDs]) => [
        toInt(compressedTypeID, 0),
        Object.freeze(
          [...new Set(
            (Array.isArray(sourceTypeIDs) ? sourceTypeIDs : [])
              .map((entry) => toInt(entry, 0))
              .filter((entry) => entry > 0),
          )].sort((left, right) => left - right),
        ),
      ])
      .filter(([compressedTypeID, sourceTypeIDs]) => compressedTypeID > 0 && sourceTypeIDs.length > 0),
  );

  return {
    payload,
    byTypeID,
    materialsByTypeID,
    randomizedMaterialsByTypeID,
    averageRandomizedOutputsByTypeID,
    compressedTypeBySourceTypeID,
    reprocessingRigProfilesBySize,
    reprocessingRigProfilesByTypeID,
    sourceTypesByCompressedTypeID,
    structureReprocessingProfilesByTypeID,
    randomizedTypeIDs,
    reprocessableTypeIDs,
  };
}

function readPayload() {
  const result = database.read(REPROCESSING_STATIC_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {
      source: null,
      reprocessingTypes: [],
      compressedTypeBySourceTypeID: {},
      sourceTypesByCompressedTypeID: {},
    };
  }
  return result.data;
}

function ensureCache() {
  if (!cachedPayload) {
    cachedPayload = buildCacheFromPayload(readPayload());
  }
  return cachedPayload;
}

function getReprocessingProfile(typeID) {
  return ensureCache().byTypeID.get(toInt(typeID, 0)) || null;
}

function getTypeMaterials(typeID) {
  return ensureCache().materialsByTypeID.get(toInt(typeID, 0)) || Object.freeze([]);
}

function getTypeRandomizedMaterials(typeID) {
  return ensureCache().randomizedMaterialsByTypeID.get(toInt(typeID, 0)) || Object.freeze([]);
}

function getAverageRandomizedMaterialsPerBatch(typeID) {
  const entries =
    ensureCache().averageRandomizedOutputsByTypeID.get(toInt(typeID, 0)) ||
    Object.freeze([]);
  return Object.fromEntries(
    entries.map((entry) => [entry.materialTypeID, entry.quantityAverage]),
  );
}

function typeHasRandomizedMaterials(typeID) {
  return ensureCache().randomizedTypeIDs.has(toInt(typeID, 0));
}

function hasTypeMaterials(typeID) {
  return ensureCache().reprocessableTypeIDs.has(toInt(typeID, 0));
}

function getCompressedTypeID(sourceTypeID) {
  return ensureCache().compressedTypeBySourceTypeID.get(toInt(sourceTypeID, 0)) || null;
}

function isCompressibleType(sourceTypeID) {
  return getCompressedTypeID(sourceTypeID) !== null;
}

function getCompressionSourceTypeIDs(compressedTypeID) {
  return ensureCache().sourceTypesByCompressedTypeID.get(toInt(compressedTypeID, 0)) || Object.freeze([]);
}

function isCompressedType(typeID) {
  return getCompressionSourceTypeIDs(typeID).length > 0;
}

function getAdjustedAveragePrice(typeID) {
  const profile = getReprocessingProfile(typeID);
  if (profile && profile.basePrice > 0) {
    return profile.basePrice;
  }
  const itemType = resolveItemByTypeID(toInt(typeID, 0));
  const basePrice = Number(itemType && itemType.basePrice);
  return Number.isFinite(basePrice) && basePrice > 0 ? basePrice : 0;
}

function getStructureReprocessingProfile(typeID) {
  return ensureCache().structureReprocessingProfilesByTypeID.get(toInt(typeID, 0)) || null;
}

function getReprocessingRigProfile(typeID) {
  return ensureCache().reprocessingRigProfilesByTypeID.get(toInt(typeID, 0)) || null;
}

function listReprocessingRigProfilesBySize(rigSize) {
  return ensureCache().reprocessingRigProfilesBySize.get(toInt(rigSize, 0)) || Object.freeze([]);
}

function pickRandomizedMaterialTypesByWeight(typeID, portions = 0, randomFn = Math.random) {
  const materials = getTypeRandomizedMaterials(typeID);
  const portionCount = Math.max(0, toInt(portions, 0));
  if (materials.length <= 0 || portionCount <= 0) {
    return [];
  }

  const weightedEntries = materials.map((entry) => ({
    material: entry,
    weight: Math.max(0, toFloat(entry.weight, 0)),
  }));
  const explicitWeightSum = weightedEntries.reduce((sum, entry) => sum + entry.weight, 0);
  const useUniformWeights = explicitWeightSum <= 0;
  const totalWeight = useUniformWeights ? weightedEntries.length : explicitWeightSum;
  const countsByMaterialTypeID = new Map();

  for (let index = 0; index < portionCount; index += 1) {
    let roll = Math.max(0, Math.min(0.999999999999, Number(randomFn()) || 0)) * totalWeight;
    let selected = weightedEntries[weightedEntries.length - 1];

    for (const entry of weightedEntries) {
      const currentWeight = useUniformWeights ? 1 : entry.weight;
      if (roll < currentWeight) {
        selected = entry;
        break;
      }
      roll -= currentWeight;
    }

    const materialTypeID = selected.material.materialTypeID;
    countsByMaterialTypeID.set(materialTypeID, (countsByMaterialTypeID.get(materialTypeID) || 0) + 1);
  }

  return materials
    .map((material) => ({
      material,
      numOutputPortions: countsByMaterialTypeID.get(material.materialTypeID) || 0,
    }))
    .filter((entry) => entry.numOutputPortions > 0);
}

function refreshReprocessingStaticData() {
  cachedPayload = null;
  return ensureCache();
}

module.exports = {
  getAdjustedAveragePrice,
  getAverageRandomizedMaterialsPerBatch,
  getCompressedTypeID,
  getCompressionSourceTypeIDs,
  getReprocessingRigProfile,
  getReprocessingProfile,
  getStructureReprocessingProfile,
  getTypeMaterials,
  getTypeRandomizedMaterials,
  hasTypeMaterials,
  isCompressedType,
  isCompressibleType,
  listReprocessingRigProfilesBySize,
  pickRandomizedMaterialTypesByWeight,
  refreshReprocessingStaticData,
  typeHasRandomizedMaterials,
};
