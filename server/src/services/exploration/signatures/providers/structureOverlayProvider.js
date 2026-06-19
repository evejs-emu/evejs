const path = require("path");

const structureState = require(path.join(
  __dirname,
  "../../../structure/structureState",
));
const targetIdRuntime = require(path.join(
  __dirname,
  "../targetIdRuntime",
));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function clonePosition(position = null) {
  return {
    x: Number(position && position.x) || 0,
    y: Number(position && position.y) || 0,
    z: Number(position && position.z) || 0,
  };
}

function listStructureSites(systemID, options = {}) {
  const numericSystemID = toInt(systemID, 0);
  if (numericSystemID <= 0) {
    return [];
  }

  return structureState.listStructuresForSystem(numericSystemID, {
    refresh: options.refresh !== false,
  }).map((structure) => {
    const typeID = toInt(structure && structure.typeID, 0);
    const typeRecord = structureState.getStructureTypeByID(typeID) || null;
    return {
      siteID: toInt(structure && structure.structureID, 0),
      siteKind: "structure",
      family: "structure",
      targetID: targetIdRuntime.encodeTargetID(
        "structure",
        numericSystemID,
        toInt(structure && structure.structureID, 0),
      ),
      label: String(
        structure && (structure.name || structure.itemName) ||
        `Structure ${toInt(structure && structure.structureID, 0)}`
      ),
      typeID,
      groupID: toInt(structure && structure.groupID, toInt(typeRecord && typeRecord.groupID, 0)),
      categoryID: toInt(structure && structure.categoryID, toInt(typeRecord && typeRecord.categoryID, 65)),
      position: clonePosition(structure && structure.position),
    };
  }).filter((site) => site.siteID > 0 && site.typeID > 0);
}

module.exports = {
  providerID: "structureOverlay",
  listStructureSites,
};
