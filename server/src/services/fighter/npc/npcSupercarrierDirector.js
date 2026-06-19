const path = require("path");

const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../inventory/itemTypeRegistry"));
const {
  ITEM_FLAGS,
  FIGHTER_TUBE_FLAGS,
  grantItemToOwnerLocation,
  moveItemToLocation,
  updateInventoryItem,
} = require(path.join(__dirname, "../../inventory/itemStore"));
const {
  getFighterAbilityMetaForSlot,
  TARGET_MODE_ITEMTARGETED,
  TARGET_MODE_UNTARGETED,
} = require(path.join(__dirname, "../fighterAbilities"));
const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../../fitting/liveFittingState"));
const {
  getCapitalRuntimeConfig,
} = require(path.join(__dirname, "../../../space/npc/capitals/capitalNpcRuntimeConfig"));
const {
  cloneVector,
  getCapitalControllerState,
  listControlledNpcFighters,
  toFiniteNumber,
  toPositiveInt,
} = require(path.join(__dirname, "../../../space/npc/capitals/capitalNpcState"));
const {
  hydrateNpcFighterEntity,
} = require("./npcFighterSessionAdapter");
const {
  buildTrackedTubeFlagSet,
  resetNpcSupercarrierTubeState,
} = require("./npcSupercarrierTubeState");

function resolveFighterSquadronSize(typeID) {
  return Math.max(
    1,
    toPositiveInt(
      getTypeAttributeValue(typeID, "fighterSquadronMaxSize"),
      toPositiveInt(getTypeAttributeValue(typeID, "fighterSquadronSize"), 1),
    ),
  );
}

function launchNpcFighterWing(scene, controllerEntity, behaviorProfile, options = {}) {
  const wing = Array.isArray(behaviorProfile && behaviorProfile.capitalFighterWingTypeIDs)
    ? behaviorProfile.capitalFighterWingTypeIDs
    : [];
  if (!scene || !controllerEntity || wing.length === 0) {
    return {
      success: false,
      launched: [],
      launchedTubeFlagIDs: [],
      completed: false,
    };
  }

  const launched = [];
  const trackedTubeFlagIDs = options.launchedTubeFlagIDs instanceof Set
    ? new Set(options.launchedTubeFlagIDs)
    : new Set();
  const maxLaunchCount = Math.max(1, toPositiveInt(options.maxLaunchCount, wing.length));
  let launchedThisPass = 0;
  let launchIndex = 0;

  for (const wingEntry of wing) {
    const fighterTypeID = toPositiveInt(wingEntry && wingEntry.typeID, 0);
    const fighterType = resolveItemByTypeID(fighterTypeID);
    const tubeFlagID = toPositiveInt(
      wingEntry && wingEntry.tubeFlagID,
      FIGHTER_TUBE_FLAGS[launchIndex] || ITEM_FLAGS.FIGHTER_TUBE_0,
    );
    launchIndex += 1;
    if (!fighterType || tubeFlagID <= 0 || trackedTubeFlagIDs.has(tubeFlagID)) {
      continue;
    }
    if (launchedThisPass >= maxLaunchCount) {
      break;
    }

    const squadronSize = resolveFighterSquadronSize(fighterTypeID);
    const grantResult = grantItemToOwnerLocation(
      toPositiveInt(controllerEntity.ownerID || controllerEntity.corporationID, 1),
      controllerEntity.itemID,
      tubeFlagID,
      fighterType,
      squadronSize,
      {
        singleton: false,
        transient: controllerEntity.transient === true,
      },
    );
    const fighterItem = grantResult &&
      grantResult.success &&
      grantResult.data &&
      Array.isArray(grantResult.data.items)
        ? grantResult.data.items[0] || null
        : null;
    if (!fighterItem) {
      continue;
    }

    const moveResult = moveItemToLocation(fighterItem.itemID, scene.systemID, 0);
    if (!moveResult || moveResult.success !== true) {
      continue;
    }

    const updateResult = updateInventoryItem(fighterItem.itemID, (currentItem) => ({
      ...currentItem,
      launcherID: controllerEntity.itemID,
      spaceState: {
        systemID: toPositiveInt(controllerEntity.systemID, scene.systemID),
        position: cloneVector(controllerEntity.position),
        velocity: { x: 0, y: 0, z: 0 },
        direction: cloneVector(controllerEntity.direction, { x: 1, y: 0, z: 0 }),
        targetPoint: cloneVector(controllerEntity.position),
        speedFraction: 0,
        mode: "STOP",
        targetEntityID: null,
        followRange: 0,
        orbitDistance: 0,
        orbitNormal: { x: 0, y: 1, z: 0 },
        orbitSign: 1,
        pendingWarp: null,
        warpState: null,
      },
      fighterState: {
        tubeFlagID,
        controllerID: controllerEntity.itemID,
        controllerOwnerID: 0,
      },
    }));
    if (!updateResult || updateResult.success !== true || !updateResult.data) {
      continue;
    }

    const spawnRuntime = require(path.join(__dirname, "../../../space/runtime"));
    const spawnResult = spawnRuntime.spawnDynamicInventoryEntity(scene.systemID, fighterItem.itemID, {
      broadcast: true,
      excludedSession: null,
    });
    if (!spawnResult || !spawnResult.success || !spawnResult.data || !spawnResult.data.entity) {
      continue;
    }

    const fighterEntity = hydrateNpcFighterEntity(
      spawnResult.data.entity,
      updateResult.data,
    );
    fighterEntity.launcherID = controllerEntity.itemID;
    fighterEntity.controllerID = controllerEntity.itemID;
    fighterEntity.controllerOwnerID = 0;
    fighterEntity.tubeFlagID = tubeFlagID;
    fighterEntity.squadronSize = squadronSize;
    fighterEntity.fighterAbilityStates = {};
    scene.orbitShipEntity(
      fighterEntity,
      controllerEntity.itemID,
      1_500,
      { broadcast: true },
    );
    launched.push(fighterEntity.itemID);
    trackedTubeFlagIDs.add(tubeFlagID);
    launchedThisPass += 1;
  }

  return {
    success: true,
    launched,
    launchedTubeFlagIDs: [...trackedTubeFlagIDs],
    completed: trackedTubeFlagIDs.size >= wing.length,
  };
}

function syncNpcFighterAttack(scene, controllerEntity, behaviorProfile, targetEntity, nowMs) {
  if (!scene || !controllerEntity || !behaviorProfile || !targetEntity) {
    return false;
  }

  const slotID = toPositiveInt(behaviorProfile.capitalFighterAbilitySlotID, 0);
  let changed = false;
  for (const fighterEntity of listControlledNpcFighters(scene, controllerEntity.itemID)) {
    const abilityMeta = getFighterAbilityMetaForSlot(fighterEntity.typeID, slotID);
    if (!abilityMeta) {
      continue;
    }
    if (
      abilityMeta.targetMode !== TARGET_MODE_ITEMTARGETED &&
      abilityMeta.targetMode !== TARGET_MODE_UNTARGETED
    ) {
      continue;
    }

    const currentState =
      fighterEntity.fighterAbilityStates &&
      typeof fighterEntity.fighterAbilityStates === "object"
        ? fighterEntity.fighterAbilityStates[slotID]
        : null;
    if (
      currentState &&
      toPositiveInt(currentState.targetID, 0) === toPositiveInt(targetEntity.itemID, 0) &&
      toFiniteNumber(currentState.activeUntilMs, 0) > nowMs
    ) {
      continue;
    }

    if (!fighterEntity.fighterAbilityStates || typeof fighterEntity.fighterAbilityStates !== "object") {
      fighterEntity.fighterAbilityStates = {};
    }
    fighterEntity.fighterAbilityStates[slotID] = {
      activeSinceMs: nowMs,
      durationMs: Math.max(1, toPositiveInt(abilityMeta.durationMs, 1_000)),
      activeUntilMs: nowMs + Math.max(1, toPositiveInt(abilityMeta.durationMs, 1_000)),
      targetID:
        abilityMeta.targetMode === TARGET_MODE_ITEMTARGETED
          ? toPositiveInt(targetEntity.itemID, 0)
          : null,
    };
    changed = true;
  }
  return changed;
}

function syncNpcSupercarrierSystems(scene, entity, controller, behaviorProfile, targetEntity, options = {}) {
  if (!scene || !entity || !controller || !behaviorProfile) {
    return false;
  }

  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const classConfig = getCapitalRuntimeConfig(entity && entity.capitalClassID);
  const capitalState = getCapitalControllerState(controller);
  let changed = false;
  const launchIntervalMs = Math.max(
    250,
    toPositiveInt(
      behaviorProfile.capitalFighterLaunchIntervalMs,
      classConfig.fighterLaunchIntervalMs,
    ),
  );
  const launchQuota = Math.max(
    1,
    toPositiveInt(
      behaviorProfile.capitalFighterLaunchPerThink,
      classConfig.fighterLaunchPerThink,
    ),
  );
  const trackedTubeFlagIDs = buildTrackedTubeFlagSet(scene, entity, controller);
  if (
    trackedTubeFlagIDs.size < behaviorProfile.capitalFighterWingTypeIDs.length &&
    nowMs >= toFiniteNumber(capitalState.nextFighterLaunchAtMs, 0)
  ) {
    const launchResult = launchNpcFighterWing(scene, entity, behaviorProfile, {
      launchedTubeFlagIDs: trackedTubeFlagIDs,
      maxLaunchCount: launchQuota,
    });
    if (launchResult.success) {
      capitalState.launchedTubeFlagIDs = launchResult.launchedTubeFlagIDs;
      capitalState.nextFighterLaunchAtMs = nowMs + launchIntervalMs;
      controller.capitalNpcFighterWingLaunched = launchResult.completed === true;
      changed = launchResult.launched.length > 0 || changed;
    }
  } else {
    controller.capitalNpcFighterWingLaunched =
      trackedTubeFlagIDs.size >= behaviorProfile.capitalFighterWingTypeIDs.length;
  }

  if (targetEntity) {
    const abilitySyncIntervalMs = Math.max(
      250,
      toPositiveInt(
        behaviorProfile.capitalFighterAbilitySyncIntervalMs,
        classConfig.fighterAbilitySyncIntervalMs,
      ),
    );
    if (nowMs >= toFiniteNumber(capitalState.nextFighterAbilitySyncAtMs, 0)) {
      changed = syncNpcFighterAttack(
        scene,
        entity,
        behaviorProfile,
        targetEntity,
        nowMs,
      ) || changed;
      capitalState.nextFighterAbilitySyncAtMs = nowMs + abilitySyncIntervalMs;
    }
  }

  return changed;
}

function resetNpcSupercarrierWing(scene, controllerEntity, controller, options = {}) {
  if (!scene || !controllerEntity || !controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  let destroyedCount = 0;
  for (const fighterEntity of listControlledNpcFighters(scene, controllerEntity.itemID)) {
    const destroyResult = scene.destroyInventoryBackedDynamicEntity(fighterEntity.itemID, {
      removeContents: options.removeContents !== false,
    });
    if (destroyResult && destroyResult.success) {
      destroyedCount += 1;
    }
  }
  resetNpcSupercarrierTubeState(controller);
  return {
    success: true,
    data: {
      destroyedCount,
    },
  };
}

module.exports = {
  launchNpcFighterWing,
  syncNpcFighterAttack,
  syncNpcSupercarrierSystems,
  resetNpcSupercarrierWing,
};
