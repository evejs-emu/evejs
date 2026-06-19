const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const database = require(path.join(__dirname, "../../newDatabase"));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));

const STRUCTURE_GRAPHIC_LOCATORS_TABLE = "structureGraphicLocators";

const DEFAULT_FORWARD = Object.freeze({ x: 0, y: 0, z: 1 });
const DEFAULT_POSITION = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_ROTATION = Object.freeze([0, 0, 0]);
const DEFAULT_FALLBACK_DOCK_OFFSET = 7500;
const DEFAULT_FALLBACK_DOCK_PADDING = 3500;
const DEFAULT_FALLBACK_UNDOCK_PADDING = 2500;

const UNDOCK_CATEGORY_SMALL = "undockPointSmall";
const UNDOCK_CATEGORY_LARGE = "undockPointLarge";
const UNDOCK_CATEGORY_CAPITAL = "undockPointCapital";
const UNDOCK_CATEGORY_SUPERCAPITAL = "undockPointSupercapital";
const DEFAULT_UNDOCK_CATEGORY = UNDOCK_CATEGORY_SMALL;

const CATEGORY_BY_GROUP_ID = Object.freeze({
  27: UNDOCK_CATEGORY_LARGE,
  28: UNDOCK_CATEGORY_LARGE,
  30: UNDOCK_CATEGORY_SUPERCAPITAL,
  380: UNDOCK_CATEGORY_LARGE,
  381: UNDOCK_CATEGORY_LARGE,
  485: UNDOCK_CATEGORY_CAPITAL,
  513: UNDOCK_CATEGORY_LARGE,
  547: UNDOCK_CATEGORY_CAPITAL,
  659: UNDOCK_CATEGORY_SUPERCAPITAL,
  883: UNDOCK_CATEGORY_CAPITAL,
  898: UNDOCK_CATEGORY_LARGE,
  900: UNDOCK_CATEGORY_LARGE,
  902: UNDOCK_CATEGORY_LARGE,
  941: UNDOCK_CATEGORY_LARGE,
  1202: UNDOCK_CATEGORY_LARGE,
  1538: UNDOCK_CATEGORY_CAPITAL,
  4594: UNDOCK_CATEGORY_CAPITAL,
});

let cachedLocatorProfiles = null;
let locatorLoadFailureLogged = false;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(vector, fallback = DEFAULT_POSITION) {
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

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function magnitude(vector) {
  const resolved = cloneVector(vector);
  return Math.sqrt((resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2));
}

function normalizeVector(vector, fallback = DEFAULT_FORWARD) {
  const resolved = cloneVector(vector, fallback);
  const length = magnitude(resolved);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }
  return scaleVector(resolved, 1 / length);
}

function normalizeRotation(rotation) {
  if (!Array.isArray(rotation) || rotation.length < 3) {
    return [...DEFAULT_ROTATION];
  }
  return [
    toFiniteNumber(rotation[0], 0),
    toFiniteNumber(rotation[1], 0),
    toFiniteNumber(rotation[2], 0),
  ];
}

function quaternionFromYawPitchRollDegrees(rotation) {
  const [yawDegrees, pitchDegrees, rollDegrees] = normalizeRotation(rotation);
  const yaw = yawDegrees * (Math.PI / 180);
  const pitch = pitchDegrees * (Math.PI / 180);
  const roll = rollDegrees * (Math.PI / 180);
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  const cr = Math.cos(roll / 2);
  const sr = Math.sin(roll / 2);
  return {
    w: cy * cp * cr + sy * sp * sr,
    x: cy * sp * cr + sy * cp * sr,
    y: sy * cp * cr - cy * sp * sr,
    z: cy * cp * sr - sy * sp * cr,
  };
}

function rotateVectorByQuaternion(quaternion, vector) {
  const resolvedVector = cloneVector(vector);
  const tx = 2 * (
    quaternion.y * resolvedVector.z - quaternion.z * resolvedVector.y
  );
  const ty = 2 * (
    quaternion.z * resolvedVector.x - quaternion.x * resolvedVector.z
  );
  const tz = 2 * (
    quaternion.x * resolvedVector.y - quaternion.y * resolvedVector.x
  );
  return {
    x:
      resolvedVector.x +
      quaternion.w * tx +
      (quaternion.y * tz - quaternion.z * ty),
    y:
      resolvedVector.y +
      quaternion.w * ty +
      (quaternion.z * tx - quaternion.x * tz),
    z:
      resolvedVector.z +
      quaternion.w * tz +
      (quaternion.x * ty - quaternion.y * tx),
  };
}

function rotateVectorByRotation(vector, rotation) {
  return rotateVectorByQuaternion(
    quaternionFromYawPitchRollDegrees(rotation),
    vector,
  );
}

function normalizeLocator(locator = {}) {
  return {
    category: String(locator.category || "").trim(),
    name: String(locator.name || "").trim(),
    position: cloneVector(locator.position),
    direction: normalizeVector(locator.direction, DEFAULT_FORWARD),
  };
}

function normalizeLocatorProfile(profile = {}) {
  const locators = Array.isArray(profile.directionalLocators)
    ? profile.directionalLocators.map((locator) => normalizeLocator(locator))
    : [];
  return {
    typeID: toPositiveInt(profile.typeID, 0),
    name: String(profile.name || "").trim(),
    graphicLocationID: toPositiveInt(profile.graphicLocationID, 0) || null,
    hasUndockLocators: profile.hasUndockLocators === true,
    directionalLocators: locators,
    locatorCategories: [...new Set(
      locators
        .map((locator) => locator.category)
        .filter((category) => category.length > 0),
    )],
  };
}

function loadLocatorProfiles() {
  if (cachedLocatorProfiles) {
    return cachedLocatorProfiles;
  }

  const byTypeID = new Map();
  try {
    const readResult = database.read(STRUCTURE_GRAPHIC_LOCATORS_TABLE, "/");
    if (!readResult.success) {
      throw new Error(readResult.errorMsg || "TABLE_READ_FAILED");
    }
    const payload =
      readResult.data &&
      typeof readResult.data === "object"
        ? readResult.data
        : null;
    const rows = Array.isArray(payload && payload.locators)
      ? payload.locators
      : [];
    for (const row of rows) {
      const profile = normalizeLocatorProfile(row);
      if (profile.typeID > 0) {
        byTypeID.set(profile.typeID, profile);
      }
    }
  } catch (error) {
    if (!locatorLoadFailureLogged) {
      locatorLoadFailureLogged = true;
      log.warn(
        `[StructureLocatorGeometry] Failed to load ${STRUCTURE_GRAPHIC_LOCATORS_TABLE}: ${error.message}`,
      );
    }
  }

  cachedLocatorProfiles = {
    byTypeID,
  };
  return cachedLocatorProfiles;
}

function getStructureLocatorProfile(typeID) {
  return loadLocatorProfiles().byTypeID.get(toPositiveInt(typeID, 0)) || null;
}

function getUndockCategoryByShipType(shipTypeID) {
  const metadata = resolveItemByTypeID(toPositiveInt(shipTypeID, 0)) || null;
  const groupID = toPositiveInt(metadata && metadata.groupID, 0);
  return CATEGORY_BY_GROUP_ID[groupID] || DEFAULT_UNDOCK_CATEGORY;
}

function getLocatorCandidates(profile, shipTypeID) {
  if (!profile || !Array.isArray(profile.directionalLocators)) {
    return [];
  }

  const locators = profile.directionalLocators.filter(
    (locator) => String(locator.category || "").startsWith("undockPoint"),
  );
  if (locators.length === 0) {
    return [];
  }

  const requestedCategory = getUndockCategoryByShipType(shipTypeID);
  const categoryMatches = locators.filter(
    (locator) => locator.category === requestedCategory,
  );
  return categoryMatches.length > 0 ? categoryMatches : locators;
}

function hashString(value) {
  const source = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function selectLocator(candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const selectionStrategy = String(options.selectionStrategy || "first").trim().toLowerCase();
  if (selectionStrategy === "random") {
    const randomValue =
      typeof options.random === "function" ? options.random() : Math.random();
    const randomIndex = Math.max(
      0,
      Math.min(
        candidates.length - 1,
        Math.floor(toFiniteNumber(randomValue, 0) * candidates.length),
      ),
    );
    return candidates[randomIndex];
  }

  if (selectionStrategy === "hash") {
    const key = options.selectionKey == null
      ? ""
      : String(options.selectionKey);
    const index = candidates.length > 0
      ? hashString(key) % candidates.length
      : 0;
    return candidates[index];
  }

  return candidates[0];
}

function getStructureFallbackDirection(structure) {
  const rotated = rotateVectorByRotation(
    DEFAULT_FORWARD,
    structure && structure.rotation,
  );
  return normalizeVector(rotated, DEFAULT_FORWARD);
}

function buildFallbackGeometry(structure, options = {}) {
  const direction = getStructureFallbackDirection(structure);
  const radius = Math.max(0, toFiniteNumber(structure && structure.radius, 0));
  const dockOffset = Math.max(
    radius + DEFAULT_FALLBACK_DOCK_PADDING,
    DEFAULT_FALLBACK_DOCK_OFFSET,
  );
  const extraUndockDistance = Math.max(
    0,
    toFiniteNumber(options.extraUndockDistance, 0),
  );
  const dockPosition = addVectors(
    cloneVector(structure && structure.position),
    scaleVector(direction, dockOffset),
  );
  return {
    source: "fallback",
    shipUndockCategory: getUndockCategoryByShipType(options.shipTypeID),
    locatorCategory: null,
    locatorName: null,
    dockPosition,
    dockOrientation: direction,
    undockDirection: direction,
    undockPosition: addVectors(
      dockPosition,
      scaleVector(
        direction,
        DEFAULT_FALLBACK_UNDOCK_PADDING + extraUndockDistance,
      ),
    ),
    dunRotation: normalizeRotation(structure && structure.rotation),
  };
}

function buildStructureDockingGeometry(structure, options = {}) {
  const profile = getStructureLocatorProfile(structure && structure.typeID);
  const candidates = getLocatorCandidates(profile, options.shipTypeID);
  const locator = selectLocator(candidates, options);

  if (!locator) {
    return {
      ...buildFallbackGeometry(structure, options),
      profile,
    };
  }

  const rotation = normalizeRotation(structure && structure.rotation);
  const worldDirection = normalizeVector(
    rotateVectorByRotation(locator.direction, rotation),
    getStructureFallbackDirection(structure),
  );
  const worldPosition = addVectors(
    cloneVector(structure && structure.position),
    rotateVectorByRotation(locator.position, rotation),
  );
  const extraUndockDistance = Math.max(
    0,
    toFiniteNumber(options.extraUndockDistance, 0),
  );

  return {
    source: "authored",
    profile,
    shipUndockCategory: getUndockCategoryByShipType(options.shipTypeID),
    locatorCategory: locator.category,
    locatorName: locator.name,
    dockPosition: worldPosition,
    dockOrientation: worldDirection,
    undockDirection: worldDirection,
    undockPosition: addVectors(
      worldPosition,
      scaleVector(worldDirection, extraUndockDistance),
    ),
    dunRotation: rotation,
  };
}

function getStructureSpaceDirection(structure, options = {}) {
  return buildStructureDockingGeometry(structure, {
    ...options,
    selectionStrategy: options.selectionStrategy || "first",
  }).dockOrientation;
}

function getStructureDockPosition(structure, options = {}) {
  return buildStructureDockingGeometry(structure, {
    ...options,
    selectionStrategy: options.selectionStrategy || "hash",
  }).dockPosition;
}

function buildStructureUndockSpawnState(structure, options = {}) {
  const geometry = buildStructureDockingGeometry(structure, {
    ...options,
    selectionStrategy: options.selectionStrategy || "random",
  });
  return {
    direction: geometry.undockDirection,
    position: geometry.undockPosition,
    source: geometry.source,
    locatorCategory: geometry.locatorCategory,
    locatorName: geometry.locatorName,
  };
}

function clearStructureLocatorGeometryCache() {
  cachedLocatorProfiles = null;
  locatorLoadFailureLogged = false;
}

module.exports = {
  DEFAULT_FORWARD,
  UNDOCK_CATEGORY_SMALL,
  UNDOCK_CATEGORY_LARGE,
  UNDOCK_CATEGORY_CAPITAL,
  UNDOCK_CATEGORY_SUPERCAPITAL,
  getStructureLocatorProfile,
  getUndockCategoryByShipType,
  buildStructureDockingGeometry,
  getStructureSpaceDirection,
  getStructureDockPosition,
  buildStructureUndockSpawnState,
  clearStructureLocatorGeometryCache,
  _testing: {
    cloneVector,
    addVectors,
    scaleVector,
    magnitude,
    normalizeVector,
    normalizeRotation,
    rotateVectorByRotation,
    buildFallbackGeometry,
    getLocatorCandidates,
    selectLocator,
  },
};
