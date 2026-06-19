const path = require("path");

const { TABLE, readStaticRows } = require(path.join(
  __dirname,
  "../_shared/referenceData",
));
const {
  createSpaceItemForCharacter,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getStructureSpaceDirection,
} = require(path.join(__dirname, "./structureSpaceInterop"));

let cachedStructureWreckTypes = null;

const STRUCTURE_LIKE_CATEGORY_IDS = new Set([
  40, // Sovereignty structures
  46, // Skyhooks
  65, // Upwell/player/pirate structures
]);

const STRUCTURE_LIKE_GROUP_IDS = new Set([
  319, // Large Collidable Structure
  1003, // Territorial Claim Unit
  1012, // Sovereignty Hub
  1404, // Engineering Complex
  1405, // Laboratory
  1406, // Refinery
  1407, // Observatory
  1408, // Jump Gate
  1409, // Administration Hub
  1657, // Citadel
  1924, // Pirate Stronghold
  2016, // Upwell Cyno Jammer
  2017, // Upwell Cyno Beacon
  4644, // Pirate Forward Operating Base
  4736, // Skyhook
  4744, // Metenox Moon Drill
  4810, // Mercenary Den
]);

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
}

function normalizeRotation(value) {
  if (!Array.isArray(value) || value.length < 3) {
    return [0, 0, 0];
  }
  return [
    toFiniteNumber(value[0], 0),
    toFiniteNumber(value[1], 0),
    toFiniteNumber(value[2], 0),
  ];
}

function normalizeStructureWreckLookupName(value) {
  return String(value || "")
    .replace(/^[^A-Za-z0-9']+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pushCandidate(candidates, value) {
  const normalizedName = normalizeStructureWreckLookupName(value);
  if (!normalizedName || candidates.includes(normalizedName)) {
    return;
  }
  candidates.push(normalizedName);
}

function stripPirateFactionQualifier(name) {
  return String(name || "")
    .replace(/\bPirates\b/gi, "")
    .replace(/\bCartel\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isStructureWreckSourceCandidate(row) {
  const categoryID = toPositiveInt(row && row.categoryID, 0);
  const groupID = toPositiveInt(row && row.groupID, 0);
  if (STRUCTURE_LIKE_CATEGORY_IDS.has(categoryID) || STRUCTURE_LIKE_GROUP_IDS.has(groupID)) {
    return true;
  }

  const groupName = String(row && row.groupName || "").trim().toLowerCase();
  return (
    groupName.includes("structure") ||
    groupName.includes("stronghold") ||
    groupName.includes("forward operating base") ||
    groupName.includes("sovereignty hub") ||
    groupName.includes("skyhook") ||
    groupName.includes("mercenary den")
  );
}

function buildStructureWreckNameCandidates(row) {
  const candidates = [];
  const rawName = String(row && row.name || "").trim();
  const strippedName = rawName.replace(/^[^A-Za-z0-9']+\s*/g, "").trim();
  const groupID = toPositiveInt(row && row.groupID, 0);
  const groupName = String(row && row.groupName || "").trim().toLowerCase();

  pushCandidate(candidates, `${rawName} Wreck`);
  pushCandidate(candidates, `${strippedName} Wreck`);

  if (groupID === 1924 || groupName.includes("stronghold")) {
    const factionName = stripPirateFactionQualifier(
      strippedName.replace(/\bStronghold\b/gi, "").trim(),
    );
    pushCandidate(candidates, `${factionName} Forward Operating Base Wreck`);
    pushCandidate(candidates, `${factionName} FOB Wreck`);
  }

  if (groupID === 4644 || groupName.includes("forward operating base")) {
    const compactName = stripPirateFactionQualifier(strippedName);
    pushCandidate(candidates, `${compactName} Wreck`);
    pushCandidate(candidates, `${compactName.replace(/\bFOB\b/gi, "Forward Operating Base")} Wreck`);
  }

  return candidates;
}

function getStructureWreckTypeIndex() {
  if (cachedStructureWreckTypes) {
    return cachedStructureWreckTypes;
  }

  const itemTypes = readStaticRows(TABLE.ITEM_TYPES);
  const wreckByName = new Map();

  for (const row of itemTypes) {
    if (String(row && row.groupName || "").trim().toLowerCase() !== "wreck") {
      continue;
    }
    const normalizedName = normalizeStructureWreckLookupName(row && row.name);
    if (!normalizedName) {
      continue;
    }
    wreckByName.set(normalizedName, row);
  }

  const byStructureTypeID = new Map();
  for (const row of itemTypes) {
    if (!isStructureWreckSourceCandidate(row)) {
      continue;
    }
    const structureTypeID = toPositiveInt(row && row.typeID, 0);
    if (byStructureTypeID.has(structureTypeID)) {
      continue;
    }

    for (const candidateName of buildStructureWreckNameCandidates(row)) {
      if (wreckByName.has(candidateName)) {
        byStructureTypeID.set(structureTypeID, wreckByName.get(candidateName));
        break;
      }
    }
  }

  cachedStructureWreckTypes = {
    byStructureTypeID,
  };
  return cachedStructureWreckTypes;
}

function clearStructureWreckTypeCache() {
  cachedStructureWreckTypes = null;
}

function resolveStructureWreckType(structureOrTypeID) {
  const structureTypeID =
    typeof structureOrTypeID === "object" && structureOrTypeID !== null
      ? toPositiveInt(structureOrTypeID.typeID, 0)
      : toPositiveInt(structureOrTypeID, 0);
  if (!structureTypeID) {
    return null;
  }
  return getStructureWreckTypeIndex().byStructureTypeID.get(structureTypeID) || null;
}

function createStructureWreck(structure, ownerCharacterID, options = {}) {
  const { getSpaceDebrisLifetimeMs } = require(path.join(
    __dirname,
    "../inventory/spaceDebrisState",
  ));
  const wreckType = resolveStructureWreckType(structure);
  if (!wreckType) {
    return {
      success: false,
      errorMsg: "WRECK_TYPE_NOT_FOUND",
    };
  }

  const numericOwnerCharacterID = toPositiveInt(ownerCharacterID, 0);
  const solarSystemID = toPositiveInt(structure && structure.solarSystemID, 0);
  if (!numericOwnerCharacterID || !solarSystemID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const nowMs = Math.max(0, Math.trunc(toFiniteNumber(options.nowMs, Date.now())));
  const createResult = createSpaceItemForCharacter(
    numericOwnerCharacterID,
    solarSystemID,
    wreckType,
    {
      itemName: String(wreckType.name || "Wreck"),
      position: cloneVector(structure && structure.position),
      direction: getStructureSpaceDirection(structure),
      velocity: { x: 0, y: 0, z: 0 },
      targetPoint: cloneVector(structure && structure.position),
      mode: "STOP",
      speedFraction: 0,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + getSpaceDebrisLifetimeMs(),
      launcherID: toPositiveInt(structure && structure.structureID, 0),
      dunRotation: normalizeRotation(structure && structure.rotation),
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 0,
        incapacitated: false,
      },
    },
  );
  if (!createResult.success || !createResult.data) {
    return {
      success: false,
      errorMsg: createResult.errorMsg || "WRECK_CREATE_FAILED",
    };
  }

  return {
    success: true,
    data: createResult.data,
  };
}

module.exports = {
  clearStructureWreckTypeCache,
  resolveStructureWreckType,
  createStructureWreck,
};
