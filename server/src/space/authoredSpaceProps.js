const fs = require("fs");
const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../services/inventory/itemTypeRegistry"));
const database = require(path.join(__dirname, "../newDatabase"));

const DATA_DIR = database.getDataDir("authoredSpaceProps");
const ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_DIRECTION = Object.freeze({ x: 1, y: 0, z: 0 });
const DESTINY_BOOTSTRAP_DELIVERY_ADDBALLS2 = "addBalls2";
const DEFAULT_AUTHORED_PROP_VISIBILITY_SCOPE = "publicgrid";
const AUTHORED_PROP_ITEM_ID_BASE = 8_500_000_000_000_000;

let cachedEntitiesBySystemID = null;
let cachedLoadStats = null;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function hasOwn(object, fieldName) {
  return Object.prototype.hasOwnProperty.call(object || {}, fieldName);
}

function readVector(source = null, fallback = ZERO_VECTOR) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function readOptionalVector(source = null) {
  if (!source || typeof source !== "object") {
    return null;
  }
  return readVector(source);
}

function readOptionalRotation(source = null) {
  if (!Array.isArray(source) || source.length !== 3) {
    return null;
  }
  return [
    toFiniteNumber(source[0], 0),
    toFiniteNumber(source[1], 0),
    toFiniteNumber(source[2], 0),
  ];
}

function normalizeItemID(value) {
  if (typeof value === "bigint") {
    if (value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    return null;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (/^\d+$/.test(text)) {
      const parsed = BigInt(text);
      if (parsed > 0n && parsed <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(parsed);
      }
      return null;
    }
  }

  const numeric = Number(value);
  if (
    !Number.isSafeInteger(numeric) ||
    numeric <= 0
  ) {
    return null;
  }
  return numeric;
}

function buildAuthoredPublicItemID(systemID, propIndex) {
  const numericSystemID = toPositiveInt(systemID, 0);
  const numericIndex = Math.max(0, Math.trunc(Number(propIndex) || 0));
  return AUTHORED_PROP_ITEM_ID_BASE + (numericSystemID * 10_000) + numericIndex + 1;
}

function normalizeText(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

function normalizeVisibilityScope(value, fallback = "bubble") {
  const scope = String(value || "").trim().toLowerCase();
  if (scope === "bubble" || scope === "site" || scope === "system") {
    return scope;
  }
  if (scope === "grid" || scope === "publicgrid" || scope === "public_grid") {
    return "publicgrid";
  }
  return fallback;
}

function isAddBalls2BootstrapScope(scope) {
  return false;
}

function roundedCoordinate(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function vectorIdentity(vector) {
  if (!vector || typeof vector !== "object") {
    return "";
  }
  return [
    roundedCoordinate(vector.x),
    roundedCoordinate(vector.y),
    roundedCoordinate(vector.z),
  ].join(",");
}

function getAuthoredPropIdentityKey(prop) {
  if (!prop || prop.kind !== "authoredSpaceProp") {
    return null;
  }

  const systemID = toPositiveInt(prop.solarSystemID, 0);
  const typeID = toPositiveInt(prop.typeID, 0);
  const dungeonObjectID = toPositiveInt(prop.dungeonObjectID || prop.dunObjectID, 0);
  if (systemID > 0 && typeID > 0 && dungeonObjectID > 0) {
    return [
      systemID,
      "dungeon",
      dungeonObjectID,
      typeID,
      vectorIdentity(prop.position),
    ].join("|");
  }

  if (systemID > 0 && typeID > 0 && prop.position) {
    return [
      systemID,
      "position",
      typeID,
      vectorIdentity(prop.position),
    ].join("|");
  }

  return null;
}

function getAuthoredPropPreferenceScore(prop) {
  if (!prop) {
    return -1;
  }
  let score = 0;
  if (Object.prototype.hasOwnProperty.call(prop, "destinyBallFlags")) {
    score += 30;
  }
  if (prop.destinyBallMode === "STOP") {
    score += 20;
  }
  if (prop.dunObjectID) {
    score += 10;
  }
  if (prop.skinMaterialSetID !== undefined && prop.skinMaterialSetID !== null) {
    score += 5;
  }
  const description = String(prop.authoredSpacePropDescription || "");
  if (description.toLowerCase().includes("captured")) {
    score += 3;
  }
  return score;
}

function shouldReplaceAuthoredProp(existing, candidate) {
  const existingScore = getAuthoredPropPreferenceScore(existing);
  const candidateScore = getAuthoredPropPreferenceScore(candidate);
  if (candidateScore !== existingScore) {
    return candidateScore > existingScore;
  }
  return String(candidate && candidate.itemID || "").localeCompare(
    String(existing && existing.itemID || ""),
    undefined,
    { numeric: true },
  ) > 0;
}

function normalizeMode(value) {
  const mode = String(value || "").trim().toUpperCase();
  return mode || "RIGID";
}

function normalizeProp(rawProp, fileName, fileSystemID, propIndex = 0) {
  if (!rawProp || typeof rawProp !== "object") {
    return null;
  }
  if (rawProp.enabled === false || rawProp.disabled === true) {
    return null;
  }

  const sourceItemID = normalizeText(rawProp.itemID, "");
  const itemID = buildAuthoredPublicItemID(fileSystemID, propIndex);
  if (!Number.isSafeInteger(itemID) || itemID <= 0) {
    return null;
  }

  const typeID = toPositiveInt(rawProp.typeID, 0);
  const typeRecord = typeID > 0 ? resolveItemByTypeID(typeID) : null;
  const ownerID = toPositiveInt(rawProp.ownerID, 0);
  const groupID = toPositiveInt(rawProp.groupID, toPositiveInt(typeRecord && typeRecord.groupID, 0));
  const categoryID = toPositiveInt(
    rawProp.categoryID,
    toPositiveInt(typeRecord && typeRecord.categoryID, 0),
  );
  const graphicID = toPositiveInt(typeRecord && typeRecord.graphicID, 0);
  const radius = Math.max(
    0,
    toFiniteNumber(
      rawProp.radius,
      toFiniteNumber(typeRecord && typeRecord.radius, 1),
    ),
  );

  const entity = {
    authoredSpaceProp: true,
    authoredSpacePropSourceFile: fileName,
    authoredSpacePropSourceItemID: sourceItemID,
    authoredSpacePropDescription: normalizeText(rawProp.description, ""),
    kind: normalizeText(rawProp.kind, "authoredSpaceProp") || "authoredSpaceProp",
    itemID,
    anchorItemID: normalizeItemID(rawProp.anchorItemID),
    solarSystemID: fileSystemID,
    radius: radius > 0 ? radius : 1,
    position: readVector(rawProp.position),
    velocity: readVector(rawProp.velocity, ZERO_VECTOR),
    direction: readVector(rawProp.direction, DEFAULT_DIRECTION),
    staticVisibilityScope: normalizeVisibilityScope(
      rawProp.staticVisibilityScope,
      DEFAULT_AUTHORED_PROP_VISIBILITY_SCOPE,
    ),
    destinyBallMode: normalizeMode(rawProp.mode || rawProp.destinyBallMode),
    destinyForceFree: rawProp.destinyForceFree === true,
    forceDamageState: rawProp.forceDamageState === true,
    omitSlimItem: rawProp.omitSlimItem === true,
  };

  if (hasOwn(rawProp, "flagsByte")) {
    entity.destinyBallFlags = toPositiveInt(rawProp.flagsByte, 0) & 0xff;
  } else if (hasOwn(rawProp, "destinyBallFlags")) {
    entity.destinyBallFlags = toPositiveInt(rawProp.destinyBallFlags, 0) & 0xff;
  }

  if (hasOwn(rawProp, "destinyBootstrapDelivery")) {
    const bootstrapDelivery = normalizeText(rawProp.destinyBootstrapDelivery, "");
    if (bootstrapDelivery && bootstrapDelivery !== DESTINY_BOOTSTRAP_DELIVERY_ADDBALLS2) {
      entity.destinyBootstrapDelivery = bootstrapDelivery;
    }
  }

  if (
    entity.kind === "authoredSpaceProp" &&
    entity.destinyForceFree !== true &&
    entity.destinyBallMode !== "RIGID"
  ) {
    entity.destinyBallMode = "RIGID";
  }

  if (typeID > 0) {
    entity.typeID = typeID;
    entity.slimTypeID = typeID;
  }
  if (groupID > 0) {
    entity.groupID = groupID;
    entity.slimGroupID = groupID;
  }
  if (categoryID > 0) {
    entity.categoryID = categoryID;
    entity.slimCategoryID = categoryID;
  }
  if (graphicID > 0) {
    entity.graphicID = graphicID;
    entity.slimGraphicID = graphicID;
  }
  if (ownerID > 0) {
    entity.ownerID = ownerID;
    entity.slimOwnerID = ownerID;
  }

  entity.corporationID = toPositiveInt(rawProp.corporationID, 0);
  entity.allianceID = toPositiveInt(rawProp.allianceID, 0);
  entity.factionID = toPositiveInt(rawProp.factionID, 0);
  entity.warFactionID = toPositiveInt(rawProp.warFactionID, 0);

  if (hasOwn(rawProp, "itemName")) {
    entity.itemName = normalizeText(rawProp.itemName, "");
  } else if (typeRecord && typeRecord.name) {
    entity.itemName = typeRecord.name;
  } else {
    entity.itemName = entity.kind;
  }

  if (hasOwn(rawProp, "slimName")) {
    entity.slimName = normalizeText(rawProp.slimName, "");
  } else {
    entity.slimName = entity.itemName;
  }

  if (rawProp.suppressSlimName === true) {
    entity.suppressSlimName = true;
  }

  const dunPosition = readOptionalVector(rawProp.dunPosition);
  if (dunPosition) {
    entity.dunPosition = dunPosition;
  }

  const dunRotation = readOptionalRotation(rawProp.dunRotation);
  if (dunRotation) {
    entity.dunRotation = dunRotation;
  }

  for (const fieldName of [
    "dungeonObjectID",
    "dunObjectID",
    "dunObjectNameID",
    "objectiveTargetGroup",
    "nameID",
    "signalTrackerStaticSite",
    "signalTrackerStaticSiteNameID",
    "signalTrackerStaticSiteFactionID",
    "signalTrackerStaticSiteLabel",
    "signalTrackerStaticSiteFamily",
    "signalTrackerStaticSiteTemplateID",
    "skinMaterialSetID",
  ]) {
    if (hasOwn(rawProp, fieldName)) {
      entity[fieldName] = rawProp[fieldName];
    }
  }

  return entity;
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (value && typeof value === "object" && typeof value !== "bigint") {
    const copy = {};
    for (const [key, child] of Object.entries(value)) {
      copy[key] = cloneValue(child);
    }
    return copy;
  }
  return value;
}

function loadAuthoredSpaceProps() {
  const entitiesBySystemID = new Map();
  const stats = {
    files: 0,
    entities: 0,
    duplicates: 0,
    skipped: 0,
    dataDir: DATA_DIR,
  };

  if (!fs.existsSync(DATA_DIR)) {
    return { entitiesBySystemID, stats };
  }

  const fileNames = fs.readdirSync(DATA_DIR)
    .filter((fileName) => fileName.toLowerCase().endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of fileNames) {
    const filePath = path.join(DATA_DIR, fileName);
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      stats.skipped += 1;
      log.warn(`[AuthoredSpaceProps] failed to parse ${filePath}: ${error.message}`);
      continue;
    }

    const systemID = toPositiveInt(parsed && parsed.solarSystemID, 0);
    const props = Array.isArray(parsed && parsed.props) ? parsed.props : [];
    if (systemID <= 0 || props.length === 0) {
      stats.skipped += 1;
      continue;
    }

    stats.files += 1;
    if (!entitiesBySystemID.has(systemID)) {
      entitiesBySystemID.set(systemID, []);
    }
    const entities = entitiesBySystemID.get(systemID);
    const identityIndexByKey = new Map(
      entities
        .map((entity, index) => [getAuthoredPropIdentityKey(entity), index])
        .filter(([key]) => key),
    );

    for (let propIndex = 0; propIndex < props.length; propIndex += 1) {
      const rawProp = props[propIndex];
      const entity = normalizeProp(rawProp, fileName, systemID, propIndex);
      if (!entity) {
        stats.skipped += 1;
        continue;
      }
      const identityKey = getAuthoredPropIdentityKey(entity);
      const duplicateIndex = identityKey ? identityIndexByKey.get(identityKey) : undefined;
      if (duplicateIndex !== undefined) {
        stats.duplicates += 1;
        if (shouldReplaceAuthoredProp(entities[duplicateIndex], entity)) {
          entities[duplicateIndex] = Object.freeze(entity);
        }
        continue;
      }
      if (identityKey) {
        identityIndexByKey.set(identityKey, entities.length);
      }
      entities.push(Object.freeze(entity));
    }
  }

  for (const [systemID, entities] of entitiesBySystemID.entries()) {
    entitiesBySystemID.set(systemID, Object.freeze(entities.slice()));
    stats.entities += entities.length;
  }

  return {
    entitiesBySystemID,
    stats,
  };
}

function getCache() {
  if (!cachedEntitiesBySystemID) {
    const loaded = loadAuthoredSpaceProps();
    cachedEntitiesBySystemID = loaded.entitiesBySystemID;
    cachedLoadStats = Object.freeze({ ...loaded.stats });
  }
  return cachedEntitiesBySystemID;
}

function getConfiguredStaticEntitiesForSystem(systemID) {
  const numericSystemID = toPositiveInt(systemID, 0);
  if (numericSystemID <= 0) {
    return [];
  }
  const cachedEntities = getCache().get(numericSystemID) || [];
  return cachedEntities.map((entity) => cloneValue(entity));
}

function getLoadStats() {
  getCache();
  return { ...cachedLoadStats };
}

function clearCacheForTests() {
  cachedEntitiesBySystemID = null;
  cachedLoadStats = null;
}

module.exports = {
  getConfiguredStaticEntitiesForSystem,
  getLoadStats,
  _testing: {
    clearCacheForTests,
    getAuthoredPropIdentityKey,
    normalizeVisibilityScope,
    normalizeItemID,
    normalizeProp,
  },
};
