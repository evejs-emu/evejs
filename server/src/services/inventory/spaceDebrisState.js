const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const runtime = require(path.join(__dirname, "../../space/runtime"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  createSpaceItemForCharacter,
  grantItemToCharacterLocation,
} = require(path.join(__dirname, "./itemStore"));
const {
  resolveItemByName,
} = require(path.join(__dirname, "./itemTypeRegistry"));
const {
  resolveRuntimeWreckRadius,
} = require(path.join(__dirname, "./wreckRadius"));

const DEFAULT_DEBRIS_RADIUS_METERS = 20_000;
const DEFAULT_WRECK_COUNT = 6;
const DEFAULT_CONTAINER_COUNT = 5;
// Minimum distance from the player's ship to the nearest spawned wreck/container.
const MIN_DEBRIS_DISTANCE_METERS = 3_000;
const MAX_POSITION_ATTEMPTS = 64;
// Minimum surface-to-surface gap between any two spawned entities so they don't
// appear to overlap or cluster on top of each other.
const DEBRIS_PADDING_METERS = 1_500;
const LOOT_FLAG_ID = 4;
const RANDOM_WRECK_FALLBACK_NAMES = Object.freeze([
  "Frigate Wreck",
  "Destroyer Wreck",
  "Cruiser Wreck",
  "Battlecruiser Wreck",
  "Battleship Wreck",
  "Amarr Frigate Wreck",
  "Caldari Cruiser Wreck",
  "Gallente Battlecruiser Wreck",
  "Minmatar Battleship Wreck",
]);
const RANDOM_CONTAINER_FALLBACK_NAMES = Object.freeze([
  "Cargo Container",
  "Abandoned Container",
  "Large Secure Container",
  "Medium Secure Container",
  "Small Secure Container",
  "Giant Secure Container",
]);
const RANDOM_LOOT_FALLBACK = Object.freeze([
  ["Tritanium", [25, 500]],
  ["Pyerite", [25, 500]],
  ["Antimatter Charge S", [20, 200]],
  ["Antimatter Charge M", [20, 200]],
  ["Scourge Light Missile", [20, 200]],
  ["Inferno Rocket", [20, 200]],
  ["Warp Scrambler I", [1, 1]],
  ["Warp Disruptor I", [1, 1]],
  ["1MN Afterburner I", [1, 1]],
  ["5MN Microwarpdrive I", [1, 1]],
  ["Damage Control I", [1, 1]],
  ["Small Shield Extender I", [1, 1]],
  ["Small Armor Repairer I", [1, 1]],
  ["Cap Booster 25", [5, 20]],
]);

let cachedWreckTypes = null;
let cachedContainerTypes = null;
let cachedLootPool = null;

function normalizePositiveInteger(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(value && value.x, fallback.x),
    y: toFiniteNumber(value && value.y, fallback.y),
    z: toFiniteNumber(value && value.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const magnitude = Math.sqrt(
    (resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2),
  );
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return { ...fallback };
  }
  return {
    x: resolved.x / magnitude,
    y: resolved.y / magnitude,
    z: resolved.z / magnitude,
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function distance(left, right) {
  const delta = subtractVectors(left, right);
  return Math.sqrt((delta.x ** 2) + (delta.y ** 2) + (delta.z ** 2));
}

function buildDebrisConditionState() {
  return {
    damage: 0,
    charge: 1,
    armorDamage: 0,
    shieldCharge: 0,
    incapacitated: false,
  };
}

function getSpaceDebrisLifetimeMs() {
  return Math.max(
    60_000,
    normalizePositiveInteger(config.spaceDebrisLifetimeMs, 2 * 60 * 60 * 1000),
  );
}

function isRandomWreckCandidate(row) {
  const groupName = String(row && row.groupName || "").trim().toLowerCase();
  const name = String(row && row.name || "").trim();
  if (groupName !== "wreck") {
    return false;
  }
  if (name.toLowerCase() === "wreck") {
    return false;
  }
  if (!/wreck$/i.test(name)) {
    return false;
  }
  return !/(copy|fortizar|hideout|outpost|officer|commander|fob)/i.test(name);
}

function isRandomContainerCandidate(row) {
  const groupName = String(row && row.groupName || "").trim().toLowerCase();
  const name = String(row && row.name || "").trim();
  if (!/container/i.test(name)) {
    return false;
  }
  return (
    groupName === "spawn container" ||
    groupName === "cargo container" ||
    groupName === "secure cargo container" ||
    groupName === "mission container"
  );
}

function isValidDebrisType(kind, row) {
  if (!row) {
    return false;
  }
  if (kind === "wreck") {
    return String(row.groupName || "").trim().toLowerCase() === "wreck";
  }
  return isRandomContainerCandidate(row);
}

function dedupeByTypeID(rows) {
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const typeID = Number(row && row.typeID) || 0;
    if (typeID <= 0 || seen.has(typeID)) {
      continue;
    }
    seen.add(typeID);
    deduped.push(row);
  }
  return deduped;
}

function buildFallbackRows(names) {
  return names
    .map((name) => resolveItemByName(name))
    .filter((lookup) => lookup && lookup.success && lookup.match)
    .map((lookup) => lookup.match);
}

function getRandomWreckTypes() {
  if (cachedWreckTypes) {
    return cachedWreckTypes;
  }

  const rows = dedupeByTypeID(
    readStaticRows(TABLE.ITEM_TYPES).filter(isRandomWreckCandidate),
  );
  cachedWreckTypes =
    rows.length > 0 ? rows : buildFallbackRows(RANDOM_WRECK_FALLBACK_NAMES);
  return cachedWreckTypes;
}

function getRandomContainerTypes() {
  if (cachedContainerTypes) {
    return cachedContainerTypes;
  }

  const rows = dedupeByTypeID(
    readStaticRows(TABLE.ITEM_TYPES).filter(isRandomContainerCandidate),
  );
  cachedContainerTypes =
    rows.length > 0 ? rows : buildFallbackRows(RANDOM_CONTAINER_FALLBACK_NAMES);
  return cachedContainerTypes;
}

function getRandomLootPool() {
  if (cachedLootPool) {
    return cachedLootPool;
  }

  cachedLootPool = RANDOM_LOOT_FALLBACK
    .map(([name, quantityRange]) => {
      const lookup = resolveItemByName(name);
      if (!lookup || !lookup.success || !lookup.match) {
        return null;
      }
      return {
        itemType: lookup.match,
        minQuantity: quantityRange[0],
        maxQuantity: quantityRange[1],
      };
    })
    .filter(Boolean);

  return cachedLootPool;
}

function chooseRandomEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }
  return entries[Math.floor(Math.random() * entries.length)] || null;
}

function resolveDebrisType(kind, argumentText = "") {
  const trimmed = String(argumentText || "").trim();
  if (trimmed) {
    const lookup = resolveItemByName(trimmed);
    if (!lookup.success) {
      return lookup;
    }
    if (!isValidDebrisType(kind, lookup.match)) {
      return {
        success: false,
        errorMsg: "ITEM_NOT_FOUND",
        suggestions: [lookup.match.name],
      };
    }
    return lookup;
  }

  const pool = kind === "wreck"
    ? getRandomWreckTypes()
    : getRandomContainerTypes();
  const match = chooseRandomEntry(pool);
  return match
    ? { success: true, match, suggestions: [] }
    : { success: false, errorMsg: "ITEM_NOT_FOUND", suggestions: [] };
}

function buildRandomDirection(baseDirection) {
  const forward = normalizeVector(baseDirection, { x: 1, y: 0, z: 0 });
  const angle = Math.random() * Math.PI * 2;
  const elevation = (Math.random() - 0.5) * 0.35;
  const planar = {
    x: Math.cos(angle),
    y: elevation,
    z: Math.sin(angle),
  };
  return normalizeVector(addVectors(forward, planar), forward);
}

function findSpawnPositions(scene, center, direction, count, maxRadius) {
  const nearbyEntities = scene.getAllVisibleEntities()
    .filter((entity) =>
      distance(entity.position || center, center) <= maxRadius + 10_000,
    )
    .map((entity) => ({
      position: cloneVector(entity.position, center),
      radius: Math.max(0, toFiniteNumber(entity.radius, 0)),
    }));
  const positions = [];

  for (let index = 0; index < count; index += 1) {
    let accepted = null;
    for (let attempt = 0; attempt < MAX_POSITION_ATTEMPTS; attempt += 1) {
      const candidateDirection = buildRandomDirection(direction);
      const candidateDistance =
        MIN_DEBRIS_DISTANCE_METERS +
        Math.random() * Math.max(0, maxRadius - MIN_DEBRIS_DISTANCE_METERS);
      const candidatePosition = addVectors(
        center,
        scaleVector(candidateDirection, candidateDistance),
      );
      const collides = [...nearbyEntities, ...positions].some((existing) => (
        distance(candidatePosition, existing.position) <
        Math.max(
          DEBRIS_PADDING_METERS * 2,
          toFiniteNumber(existing.radius, 0) + DEBRIS_PADDING_METERS,
        )
      ));
      if (!collides) {
        accepted = candidatePosition;
        break;
      }
    }

    if (!accepted) {
      break;
    }

    positions.push({
      position: accepted,
      radius: DEBRIS_PADDING_METERS,
    });
  }

  return positions.map((entry) => entry.position);
}

function populateDebrisLoot(characterID, itemID) {
  const pool = getRandomLootPool();
  const lootRolls = 1 + Math.floor(Math.random() * 3);
  const changes = [];
  const lootEntries = [];

  for (let index = 0; index < lootRolls; index += 1) {
    const lootEntry = chooseRandomEntry(pool);
    if (!lootEntry) {
      continue;
    }
    const quantity = lootEntry.minQuantity >= lootEntry.maxQuantity
      ? lootEntry.minQuantity
      : lootEntry.minQuantity + Math.floor(
        Math.random() * ((lootEntry.maxQuantity - lootEntry.minQuantity) + 1),
      );
    const grantResult = grantItemToCharacterLocation(
      characterID,
      itemID,
      LOOT_FLAG_ID,
      lootEntry.itemType,
      quantity,
    );
    if (!grantResult.success) {
      continue;
    }

    changes.push(...((grantResult.data && grantResult.data.changes) || []));
    lootEntries.push({
      typeID: lootEntry.itemType.typeID,
      name: lootEntry.itemType.name,
      quantity,
    });
  }

  return {
    changes,
    lootEntries,
  };
}

function spawnDebrisFieldForSession(session, kind, options = {}) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "SPACE_REQUIRED",
    };
  }

  const systemID = Number(session._space.systemID || 0);
  const shipID = Number(session._space.shipID || 0);
  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime.getEntity(session, shipID);
  if (!scene || !shipEntity) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const count = normalizePositiveInteger(
    options.count,
    kind === "wreck" ? DEFAULT_WRECK_COUNT : DEFAULT_CONTAINER_COUNT,
  );
  const radius = Math.max(
    MIN_DEBRIS_DISTANCE_METERS,
    toFiniteNumber(options.radius, DEFAULT_DEBRIS_RADIUS_METERS),
  );
  const positions = findSpawnPositions(
    scene,
    cloneVector(shipEntity.position),
    normalizeVector(shipEntity.direction, { x: 1, y: 0, z: 0 }),
    count,
    radius,
  );
  const created = [];
  const changes = [];
  const nowMs = scene.getCurrentSimTimeMs();
  const expiresAtMs = nowMs + getSpaceDebrisLifetimeMs();

  for (const position of positions) {
    const debrisTypeLookup = resolveDebrisType(kind, options.typeName || "");
    if (!debrisTypeLookup.success || !debrisTypeLookup.match) {
      continue;
    }

    const createResult = createSpaceItemForCharacter(
      session.characterID,
      systemID,
      debrisTypeLookup.match,
      {
        itemName: debrisTypeLookup.match.name,
        position,
        direction: buildRandomDirection(shipEntity.direction),
        createdAtMs: nowMs,
        expiresAtMs,
        spaceRadius:
          kind === "wreck"
            ? resolveRuntimeWreckRadius(debrisTypeLookup.match)
            : null,
        conditionState: buildDebrisConditionState(),
      },
    );
    if (!createResult.success || !createResult.data) {
      continue;
    }

    const lootResult = populateDebrisLoot(session.characterID, createResult.data.itemID);
    const spawnResult = runtime.spawnDynamicInventoryEntity(systemID, createResult.data.itemID);
    if (!spawnResult.success) {
      continue;
    }

    created.push({
      item: createResult.data,
      typeName: debrisTypeLookup.match.name,
      lootEntries: lootResult.lootEntries,
      position,
    });
    changes.push(...(createResult.changes || []));
    changes.push(...lootResult.changes);
  }

  return {
    success: true,
    data: {
      kind,
      created,
      requestedCount: count,
      actualCount: created.length,
      radius,
      expiresAtMs,
      changes,
    },
  };
}

function clearNearbyDebrisForSession(session, options = {}) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "SPACE_REQUIRED",
    };
  }

  const systemID = Number(session._space.systemID || 0);
  const shipID = Number(session._space.shipID || 0);
  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime.getEntity(session, shipID);
  if (!scene || !shipEntity) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const radius = Math.max(
    1000,
    toFiniteNumber(options.radius, DEFAULT_DEBRIS_RADIUS_METERS),
  );
  const removed = [];
  const changes = [];
  const targets = scene.getDynamicEntities()
    .filter((entity) =>
      (entity.kind === "container" || entity.kind === "wreck") &&
      distance(entity.position, shipEntity.position) <= radius,
    )
    .sort((left, right) => left.itemID - right.itemID);

  for (const entity of targets) {
    const destroyResult = runtime.destroyDynamicInventoryEntity(systemID, entity.itemID);
    if (!destroyResult.success) {
      continue;
    }
    removed.push({
      itemID: entity.itemID,
      kind: entity.kind,
      name: entity.itemName,
    });
    changes.push(...((destroyResult.data && destroyResult.data.changes) || []));
  }

  return {
    success: true,
    data: {
      removed,
      radius,
      changes,
    },
  };
}

function clearSystemDebrisForSession(session) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "SPACE_REQUIRED",
    };
  }

  const systemID = Number(session._space.systemID || 0);
  const scene = runtime.ensureScene(systemID);
  if (!scene) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const removed = [];
  const changes = [];
  const targets = scene.getDynamicEntities()
    .filter((entity) => entity.kind === "container" || entity.kind === "wreck")
    .sort((left, right) => left.itemID - right.itemID);

  for (const entity of targets) {
    const destroyResult = runtime.destroyDynamicInventoryEntity(systemID, entity.itemID);
    if (!destroyResult.success) {
      continue;
    }
    removed.push({
      itemID: entity.itemID,
      kind: entity.kind,
      name: entity.itemName,
    });
    changes.push(...((destroyResult.data && destroyResult.data.changes) || []));
  }

  return {
    success: true,
    data: {
      removed,
      changes,
      systemID,
    },
  };
}

/**
 * Returns all valid wreck or container types that can be spawned with /wreck
 * or /container, sorted alphabetically.  Each entry has { typeID, name }.
 */
function listAvailableDebrisTypes(kind) {
  const pool = kind === "wreck" ? getRandomWreckTypes() : getRandomContainerTypes();
  return pool
    .map((row) => ({ typeID: Number(row.typeID), name: String(row.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  DEFAULT_DEBRIS_RADIUS_METERS,
  DEFAULT_WRECK_COUNT,
  DEFAULT_CONTAINER_COUNT,
  getSpaceDebrisLifetimeMs,
  resolveDebrisType,
  listAvailableDebrisTypes,
  spawnDebrisFieldForSession,
  clearNearbyDebrisForSession,
  clearSystemDebrisForSession,
};
