const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ITEM_FLAGS,
  createSpaceItemForCharacter,
  findItemById,
  grantItemToCharacterLocation,
  listContainerItems,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  resolveLocationDeathOutcome,
} = require(path.join(__dirname, "../killmail/deathOutcomeResolver"));
const structureWreckState = require(path.join(
  __dirname,
  "./structureWreckState",
));
const {
  buildStructureScatterPosition,
  getStructureSpaceDirection,
} = require(path.join(__dirname, "./structureSpaceInterop"));

const DROP_CONTAINER_TYPE_ID = 10167;
const CHARACTERS_TABLE = "characters";

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function buildStructureLootContainerName(structure, options = {}) {
  const structureName = String(
    (structure && (structure.itemName || structure.name)) ||
      `Structure ${toPositiveInt(structure && structure.structureID, 0)}`,
  );
  const label = String(options.label || "Loot").trim();
  return `${structureName} ${label}`.trim();
}

function resolveLootOwnerCharacterID(structure) {
  const charactersResult = database.read(CHARACTERS_TABLE, "/");
  const characters =
    charactersResult.success &&
    charactersResult.data &&
    typeof charactersResult.data === "object"
      ? charactersResult.data
      : {};
  const preferredCorpID = toPositiveInt(structure && structure.ownerCorpID, 0);

  for (const [characterID, record] of Object.entries(characters)) {
    if (toPositiveInt(record && record.corporationID, 0) !== preferredCorpID) {
      continue;
    }
    return toPositiveInt(characterID, 0);
  }

  return toPositiveInt(Object.keys(characters)[0], 140000001) || 140000001;
}

function createStructureLootContainer(structure, index, options = {}) {
  const containerType = resolveItemByTypeID(DROP_CONTAINER_TYPE_ID);
  if (!containerType) {
    return {
      success: false,
      errorMsg: "DROP_CONTAINER_TYPE_NOT_FOUND",
    };
  }

  const ownerID = resolveLootOwnerCharacterID(structure);
  const solarSystemID = toPositiveInt(structure && structure.solarSystemID, 0);
  const position = buildStructureScatterPosition(structure, index, options);
  const direction = getStructureSpaceDirection(structure);
  const desiredName = buildStructureLootContainerName(structure, {
    label: options.label || "Container",
  });
  const createResult = createSpaceItemForCharacter(ownerID, solarSystemID, containerType, {
    itemName: buildStructureLootContainerName(structure, {
      label: options.label || "Container",
    }),
    position,
    direction,
    targetPoint: position,
    createdAtMs: options.nowMs ?? Date.now(),
    launcherID: toPositiveInt(structure && structure.structureID, 0),
  });
  if (!createResult.success || !createResult.data) {
    return createResult;
  }

  const renameResult = updateInventoryItem(createResult.data.itemID, (currentItem) => ({
    ...currentItem,
    itemName: desiredName,
  }));
  if (!renameResult.success) {
    return renameResult;
  }

  const containerRecord = findItemById(createResult.data.itemID);
  return {
    success: true,
    data: containerRecord || createResult.data,
  };
}

function addQuantumCoreToDropLocation(structure, dropLocationID) {
  if (!structure || structure.hasQuantumCore !== true) {
    return {
      success: true,
      data: {
        dropped: false,
      },
    };
  }

  const coreTypeID = toPositiveInt(structure.quantumCoreItemTypeID, 0);
  const coreType = resolveItemByTypeID(coreTypeID);
  if (!coreType) {
    return {
      success: false,
      errorMsg: "QUANTUM_CORE_TYPE_NOT_FOUND",
    };
  }

  const ownerID = resolveLootOwnerCharacterID(structure);
  const grantResult = grantItemToCharacterLocation(
    ownerID,
    dropLocationID,
    ITEM_FLAGS.HANGAR,
    coreType,
    1,
    {
      itemName: coreType.name,
      singleton: 1,
    },
  );
  if (!grantResult.success) {
    return grantResult;
  }

  return {
    success: true,
    data: {
      dropped: true,
      typeID: coreType.typeID,
      name: coreType.name,
    },
  };
}

function handleStructureDestroyedLoot(structure, options = {}) {
  const includeContents = options.includeStructureContents === true;
  const includeQuantumCore = options.includeQuantumCore !== false;
  const structureID = toPositiveInt(structure && structure.structureID, 0);
  const solarSystemID = toPositiveInt(structure && structure.solarSystemID, 0);
  if (!structureID || !solarSystemID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const containers = [];
  let wreck = null;
  const resolvedWreckType = structureWreckState.resolveStructureWreckType(structure);
  const topLevelContents = includeContents
    ? listContainerItems(null, structureID, null)
        .filter((item) => toPositiveInt(item && item.locationID, 0) === structureID)
    : [];
  const killmailItems = [];
  const needsDropLocation = Boolean(resolvedWreckType) || topLevelContents.length > 0 || (
    includeQuantumCore &&
    structure &&
    structure.hasQuantumCore === true
  );

  if (!needsDropLocation) {
    return {
      success: true,
      data: {
        containers,
        wreck,
        spawnItemIDs: [],
      },
    };
  }

  const ownerID = resolveLootOwnerCharacterID(structure);
  let dropLocationResult = structureWreckState.createStructureWreck(
    structure,
    ownerID,
    {
      nowMs: options.nowMs,
    },
  );
  let dropKind = "wreck";
  if (!dropLocationResult.success || !dropLocationResult.data) {
    dropKind = "container";
    dropLocationResult = createStructureLootContainer(structure, 0, {
      label:
        includeContents === true
          ? "Destroyed Structure Container"
          : "Quantum Core Container",
      nowMs: options.nowMs,
    });
  }
  if (!dropLocationResult.success || !dropLocationResult.data) {
    return dropLocationResult;
  }

  const dropLocation = dropLocationResult.data;
  let deathOutcome = {
    items: [],
    movedChanges: [],
    destroyChanges: [],
  };
  if (includeContents && topLevelContents.length > 0) {
    const deathOutcomeResult = resolveLocationDeathOutcome(structureID, {
      rootLootLocationID: dropLocation.itemID,
      seed: `structure:${structureID}:${String(options.nowMs || Date.now())}`,
      forceAllDropped: true,
    });
    if (!deathOutcomeResult.success || !deathOutcomeResult.data) {
      return deathOutcomeResult;
    }
    deathOutcome = deathOutcomeResult.data;
  }
  if (Array.isArray(deathOutcome.items)) {
    killmailItems.push(...deathOutcome.items);
  }
  const quantumCoreResult = includeQuantumCore
    ? addQuantumCoreToDropLocation(structure, dropLocation.itemID)
    : { success: true, data: { dropped: false } };
  if (!quantumCoreResult.success) {
    log.warn(
      `[StructureDestructionLoot] Failed to create quantum-core drop for structure ${structureID}: ${quantumCoreResult.errorMsg}`,
    );
  }

  if (
    quantumCoreResult.success &&
    quantumCoreResult.data &&
    quantumCoreResult.data.dropped === true &&
    toPositiveInt(quantumCoreResult.data.typeID, 0) > 0
  ) {
    killmailItems.push({
      typeID: toPositiveInt(quantumCoreResult.data.typeID, 0),
      flag: ITEM_FLAGS.HANGAR,
      singleton: 1,
      qtyDropped: 1,
      qtyDestroyed: 0,
      contents: [],
    });
  }
  const movedItemIDs = listContainerItems(null, dropLocation.itemID, null)
    .filter((item) => toPositiveInt(item && item.locationID, 0) === dropLocation.itemID)
    .map((item) => toPositiveInt(item && item.itemID, 0))
    .filter(Boolean)
    .sort((left, right) => left - right);

  if (dropKind === "wreck") {
    wreck = {
      itemID: dropLocation.itemID,
      typeID: toPositiveInt(dropLocation.typeID, 0),
      movedItemIDs,
      quantumCore:
        quantumCoreResult.success && quantumCoreResult.data
          ? quantumCoreResult.data
          : {
              dropped: false,
            },
    };
  } else {
    containers.push({
      containerID: dropLocation.itemID,
      movedItemIDs,
      quantumCore:
        quantumCoreResult.success && quantumCoreResult.data
          ? quantumCoreResult.data
          : {
              dropped: false,
            },
    });
  }

  return {
    success: true,
    data: {
      wreck,
      containers,
      lootOutcome: {
        items: killmailItems,
        movedChanges: Array.isArray(deathOutcome.movedChanges)
          ? deathOutcome.movedChanges
          : [],
        destroyChanges: Array.isArray(deathOutcome.destroyChanges)
          ? deathOutcome.destroyChanges
          : [],
        assetSafetyItems: [],
      },
      spawnItemIDs: [dropLocation.itemID],
    },
  };
}

module.exports = {
  handleStructureDestroyedLoot,
};
