const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const spaceRuntime = require(path.join(__dirname, "../runtime"));
const {
  findShipItemById,
  removeInventoryItem,
} = require(path.join(__dirname, "../../services/inventory/itemStore"));
const {
  unregisterController,
} = require(path.join(__dirname, "./npcRegistry"));
const {
  normalizeBehaviorOverrides,
} = require(path.join(__dirname, "./npcBehaviorLoop"));
const {
  cloneVector,
} = require(path.join(__dirname, "./npcAnchors"));

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function parseNpcCustomInfo(customInfo) {
  if (!customInfo) {
    return null;
  }

  try {
    const parsed = JSON.parse(customInfo);
    const npc = parsed && typeof parsed === "object" ? parsed.npc : null;
    if (!npc || typeof npc !== "object") {
      return null;
    }

    return {
      schemaVersion: toPositiveInt(npc.schemaVersion, 1),
      profileID: String(npc.profileID || "").trim() || null,
      loadoutID: String(npc.loadoutID || "").trim() || null,
      behaviorProfileID: String(npc.behaviorProfileID || "").trim() || null,
      lootTableID: String(npc.lootTableID || "").trim() || null,
      entityType: String(npc.entityType || "").trim().toLowerCase() || null,
      presentationTypeID: toPositiveInt(npc.presentationTypeID, 0),
      presentationName: String(npc.presentationName || "").trim() || null,
      ownerCharacterID: toPositiveInt(npc.ownerCharacterID, 0),
      preferredTargetID: toPositiveInt(npc.preferredTargetID, 0),
      selectionKind: String(npc.selectionKind || "").trim() || null,
      selectionID: String(npc.selectionID || "").trim() || null,
      selectionName: String(npc.selectionName || "").trim() || null,
      spawnGroupID: String(npc.spawnGroupID || "").trim() || null,
      spawnSiteID: String(npc.spawnSiteID || "").trim() || null,
      startupRuleID: String(npc.startupRuleID || "").trim() || null,
      operatorKind: String(npc.operatorKind || "").trim() || null,
      transient: npc.transient === true,
      anchorKind: String(npc.anchorKind || "").trim() || null,
      anchorID: toPositiveInt(npc.anchorID, 0),
      anchorName: String(npc.anchorName || "").trim() || null,
      spawnedAtMs: toFiniteNumber(npc.spawnedAtMs, 0),
      homePosition:
        npc.homePosition && typeof npc.homePosition === "object"
          ? cloneVector(npc.homePosition)
          : null,
      homeDirection:
        npc.homeDirection && typeof npc.homeDirection === "object"
          ? cloneVector(npc.homeDirection, { x: 1, y: 0, z: 0 })
          : null,
      behaviorOverrides: normalizeBehaviorOverrides(npc.behaviorOverrides),
    };
  } catch (error) {
    return null;
  }
}

function cleanupNpcOwnerArtifacts(ownerCharacterID) {
  const normalizedOwnerCharacterID = toPositiveInt(ownerCharacterID, 0);
  if (!normalizedOwnerCharacterID) {
    return;
  }

  database.remove("skills", `/${String(normalizedOwnerCharacterID)}`);
  database.remove("characters", `/${String(normalizedOwnerCharacterID)}`);
}

function destroyLegacySyntheticNpcController(controller, options = {}) {
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  const systemID = toPositiveInt(controller.systemID, 0);
  const entityID = toPositiveInt(controller.entityID, 0);
  const removeContents = options.removeContents !== false;
  let destroyResult = null;
  if (systemID > 0 && entityID > 0) {
    const scene = spaceRuntime.ensureScene(systemID);
    const runtimeEntity = scene ? scene.getEntityByID(entityID) : null;
    if (runtimeEntity) {
      destroyResult = spaceRuntime.removeDynamicEntity(systemID, entityID, {
        allowSessionOwned: true,
      });
    }
  }

  const shipItem = findShipItemById(entityID);
  if (shipItem) {
    removeInventoryItem(entityID, {
      removeContents,
    });
  }

  unregisterController(entityID);
  cleanupNpcOwnerArtifacts(controller.ownerCharacterID);
  return {
    success: true,
    data: {
      entityID,
      systemID,
      removedRuntimeEntity: destroyResult ? destroyResult.success === true : false,
      removedInventoryItem: Boolean(shipItem),
    },
  };
}

function cleanupLegacySyntheticNpcShips(scene) {
  if (!scene) {
    return [];
  }

  const removed = [];
  for (const entity of [...scene.dynamicEntities.values()]) {
    if (!entity || entity.kind !== "ship" || entity.nativeNpc === true) {
      continue;
    }

    const shipItem = findShipItemById(entity.itemID);
    const npcMetadata = parseNpcCustomInfo(shipItem && shipItem.customInfo);
    if (!shipItem || !npcMetadata) {
      continue;
    }

    const ownerCharacterID = toPositiveInt(
      npcMetadata.ownerCharacterID,
      toPositiveInt(shipItem.ownerID, 0),
    );
    const destroyResult = destroyLegacySyntheticNpcController(
      {
        entityID: entity.itemID,
        systemID: scene.systemID,
        ownerCharacterID,
        entityType: npcMetadata.entityType || "npc",
        runtimeKind: "legacySyntheticCleanup",
      },
      {
        removeContents: true,
      },
    );
    if (!destroyResult.success) {
      continue;
    }

    removed.push({
      entityID: entity.itemID,
      ownerCharacterID,
      entityType: npcMetadata.entityType || "npc",
      startupRuleID: npcMetadata.startupRuleID || null,
      selectionKind: npcMetadata.selectionKind || null,
      selectionID: npcMetadata.selectionID || null,
    });
  }

  return removed;
}

module.exports = {
  parseNpcCustomInfo,
  cleanupLegacySyntheticNpcShips,
  destroyLegacySyntheticNpcController,
};
