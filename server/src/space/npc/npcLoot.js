const path = require("path");

const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../../services/_shared/referenceData"));
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
} = require(path.join(__dirname, "../../services/inventory/itemStore"));

const EXCLUDED_GROUP_NAMES = new Set([
  "wreck",
]);

let cachedGenericLootPool = null;
let cachedGenericLootPoolByTypeID = null;

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function toNonNegativeInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric >= 0 ? numeric : fallback;
}

function chooseRandomEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  return entries[Math.floor(Math.random() * entries.length)] || null;
}

function chooseWeightedEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  let totalWeight = 0;
  for (const entry of entries) {
    totalWeight += Math.max(1, toPositiveInt(entry && entry.weight, 1));
  }
  if (totalWeight <= 0) {
    return chooseRandomEntry(entries);
  }

  let roll = Math.random() * totalWeight;
  for (const entry of entries) {
    roll -= Math.max(1, toPositiveInt(entry && entry.weight, 1));
    if (roll < 0) {
      return entry;
    }
  }

  return entries[entries.length - 1] || null;
}

function getGenericLootPool() {
  if (cachedGenericLootPool) {
    return cachedGenericLootPool;
  }

  cachedGenericLootPool = readStaticRows(TABLE.ITEM_TYPES)
    .filter((entry) => (
      entry &&
      toPositiveInt(entry.typeID, 0) > 0 &&
      String(entry.name || "").trim().length > 0 &&
      entry.published !== false &&
      !EXCLUDED_GROUP_NAMES.has(String(entry.groupName || "").trim().toLowerCase())
    ));
  cachedGenericLootPoolByTypeID = new Map(
    cachedGenericLootPool.map((entry) => [toPositiveInt(entry && entry.typeID, 0), entry]),
  );

  return cachedGenericLootPool;
}

function getGenericLootPoolByTypeID() {
  if (!(cachedGenericLootPoolByTypeID instanceof Map)) {
    getGenericLootPool();
  }
  return cachedGenericLootPoolByTypeID instanceof Map
    ? cachedGenericLootPoolByTypeID
    : new Map();
}

function isLikelyStackable(itemType) {
  const categoryID = toPositiveInt(itemType && itemType.categoryID, 0);
  return categoryID === 4 || categoryID === 5 || categoryID === 8;
}

function resolveExplicitLootItemType(typeID) {
  const normalizedTypeID = toPositiveInt(typeID, 0);
  if (normalizedTypeID <= 0) {
    return null;
  }

  return getGenericLootPoolByTypeID().get(normalizedTypeID) || null;
}

function buildExplicitLootEntry(entrySpec = {}) {
  const itemType = resolveExplicitLootItemType(entrySpec.typeID);
  if (!itemType) {
    return null;
  }

  const minQuantity = Math.max(
    1,
    toPositiveInt(
      entrySpec.minQuantity,
      toPositiveInt(entrySpec.quantity, 1),
    ),
  );
  const maxQuantity = Math.max(
    minQuantity,
    toPositiveInt(entrySpec.maxQuantity, minQuantity),
  );
  const singleton = typeof entrySpec.singleton === "boolean"
    ? entrySpec.singleton
    : !isLikelyStackable(itemType);

  return {
    itemType,
    typeID: itemType.typeID,
    name: itemType.name,
    quantity: singleton
      ? 1
      : minQuantity + Math.floor(Math.random() * ((maxQuantity - minQuantity) + 1)),
    singleton,
  };
}

function rollExplicitLootEntries(lootTable = null) {
  if (!lootTable || typeof lootTable !== "object") {
    return [];
  }

  const lootEntries = [];
  const guaranteedEntries = Array.isArray(lootTable.guaranteedEntries)
    ? lootTable.guaranteedEntries
    : [];
  for (const entrySpec of guaranteedEntries) {
    const lootEntry = buildExplicitLootEntry(entrySpec);
    if (lootEntry) {
      lootEntries.push(lootEntry);
    }
  }

  const weightedEntries = (Array.isArray(lootTable.entries) ? lootTable.entries : [])
    .filter((entry) => toPositiveInt(entry && entry.typeID, 0) > 0);
  if (weightedEntries.length === 0) {
    return lootEntries;
  }

  const minEntries = toNonNegativeInt(lootTable.minEntries, 1);
  const maxEntries = Math.max(minEntries, toNonNegativeInt(lootTable.maxEntries, minEntries));
  const entryCount = minEntries + Math.floor(Math.random() * ((maxEntries - minEntries) + 1));
  const allowDuplicates = lootTable.allowDuplicates === true;
  const candidateEntries = [...weightedEntries];

  for (let index = 0; index < entryCount; index += 1) {
    if (candidateEntries.length === 0) {
      break;
    }

    const chosenSpec = chooseWeightedEntry(candidateEntries);
    if (!chosenSpec) {
      continue;
    }

    const lootEntry = buildExplicitLootEntry(chosenSpec);
    if (lootEntry) {
      lootEntries.push(lootEntry);
    }

    if (!allowDuplicates) {
      const chosenIndex = candidateEntries.indexOf(chosenSpec);
      if (chosenIndex >= 0) {
        candidateEntries.splice(chosenIndex, 1);
      }
    }
  }

  return lootEntries;
}

function rollNpcLootEntries(lootTable = null) {
  const pool = getGenericLootPool();
  if (!lootTable || pool.length === 0) {
    return [];
  }

  const hasExplicitLootEntries =
    Array.isArray(lootTable.entries) &&
    lootTable.entries.length > 0;
  const hasGuaranteedLootEntries =
    Array.isArray(lootTable.guaranteedEntries) &&
    lootTable.guaranteedEntries.length > 0;
  if (hasExplicitLootEntries || hasGuaranteedLootEntries) {
    return rollExplicitLootEntries(lootTable);
  }

  const minEntries = toPositiveInt(lootTable.minEntries, 1);
  const maxEntries = Math.max(minEntries, toPositiveInt(lootTable.maxEntries, minEntries));
  const entryCount = minEntries + Math.floor(Math.random() * ((maxEntries - minEntries) + 1));
  const lootEntries = [];

  for (let index = 0; index < entryCount; index += 1) {
    const itemType = chooseRandomEntry(pool);
    if (!itemType) {
      continue;
    }

    const stackableMinQuantity = toPositiveInt(lootTable.stackableMinQuantity, 1);
    const stackableMaxQuantity = Math.max(
      stackableMinQuantity,
      toPositiveInt(lootTable.stackableMaxQuantity, stackableMinQuantity),
    );
    const quantity = isLikelyStackable(itemType)
      ? stackableMinQuantity +
        Math.floor(Math.random() * ((stackableMaxQuantity - stackableMinQuantity) + 1))
      : 1;

    lootEntries.push({
      itemType,
      typeID: itemType.typeID,
      name: itemType.name,
      quantity,
      singleton: !isLikelyStackable(itemType),
    });
  }

  return lootEntries;
}

function seedNpcShipLoot(characterID, shipID, lootTable = null, options = {}) {
  const lootEntries = rollNpcLootEntries(lootTable);
  const changes = [];

  for (const lootEntry of lootEntries) {
    const grantResult = grantItemToCharacterLocation(
      characterID,
      shipID,
      ITEM_FLAGS.CARGO_HOLD,
      lootEntry.itemType,
      lootEntry.quantity,
      {
        singleton: lootEntry.singleton,
        transient: options.transient === true,
      },
    );
    if (!grantResult.success) {
      continue;
    }

    changes.push(...((grantResult.data && grantResult.data.changes) || []));
  }

  return {
    success: true,
    data: {
      lootEntries: lootEntries.map((entry) => ({
        typeID: entry.typeID,
        name: entry.name,
        quantity: entry.quantity,
      })),
      changes,
    },
  };
}

module.exports = {
  rollNpcLootEntries,
  seedNpcShipLoot,
};
