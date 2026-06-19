const path = require("path");

const nativeNpcStore = require(path.join(__dirname, "./nativeNpcStore"));
const {
  getControllerByEntityID,
  listControllersBySystem,
} = require(path.join(__dirname, "./npcRegistry"));
const {
  tickControllersByEntityID,
} = require(path.join(__dirname, "./npcBehaviorLoop"));

const NPC_COMBAT_DORMANCY_RECENT_AGGRESSION_GRACE_MS = 15_000;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function distance(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function magnitude(vector) {
  return Math.sqrt(
    (toFiniteNumber(vector && vector.x, 0) ** 2) +
      (toFiniteNumber(vector && vector.y, 0) ** 2) +
      (toFiniteNumber(vector && vector.z, 0) ** 2),
  );
}

function resolveBehaviorProfile(controller) {
  const behaviorProfile =
    controller && controller.behaviorProfile && typeof controller.behaviorProfile === "object"
      ? controller.behaviorProfile
      : {};
  const behaviorOverrides =
    controller && controller.behaviorOverrides && typeof controller.behaviorOverrides === "object"
      ? controller.behaviorOverrides
      : {};
  return {
    ...behaviorProfile,
    ...behaviorOverrides,
  };
}

function isCombatDormancyEnabled() {
  return process.env.EVEJS_DISABLE_NPC_COMBAT_DORMANCY !== "1";
}

function getNativeNpcService() {
  return require(path.join(__dirname, "./nativeNpcService"));
}

function isCombatStartupRuleDormancyEligible(scene, rule) {
  if (!scene || !isCombatDormancyEnabled()) {
    return false;
  }
  if (scene.sessions instanceof Map && scene.sessions.size > 0) {
    return false;
  }
  if (!rule || typeof rule !== "object") {
    return false;
  }

  const startupRuleID = String(rule.startupRuleID || "").trim();
  const operatorKind = String(rule.operatorKind || "").trim();
  if (!startupRuleID && !operatorKind) {
    return false;
  }

  const runtimeKind = String(rule.runtimeKind || "").trim();
  if (runtimeKind === "nativeAmbient") {
    return false;
  }

  const entityType = String(rule.entityType || "").trim().toLowerCase();
  return entityType === "npc" || entityType === "concord";
}

function isCombatDormantControllerRecord(controllerRecord) {
  if (!controllerRecord || typeof controllerRecord !== "object") {
    return false;
  }

  const runtimeKind = String(controllerRecord.runtimeKind || "").trim();
  const entityType = String(controllerRecord.entityType || "").trim().toLowerCase();
  const startupRuleID = String(controllerRecord.startupRuleID || "").trim();
  const operatorKind = String(controllerRecord.operatorKind || "").trim();
  return (
    runtimeKind === "nativeCombat" &&
    (entityType === "npc" || entityType === "concord") &&
    (startupRuleID !== "" || operatorKind !== "")
  );
}

function listCombatDormancyControllerRecordsForSystem(systemID) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (!normalizedSystemID) {
    return [];
  }
  return nativeNpcStore
    .listNativeControllersForSystem(normalizedSystemID)
    .filter((controllerRecord) => isCombatDormantControllerRecord(controllerRecord));
}

function hasActiveLocks(scene, entity) {
  if (scene && typeof scene.getTargetsForEntity === "function") {
    try {
      if (scene.getTargetsForEntity(entity).length > 0) {
        return true;
      }
    } catch (error) {
      // Fall through to direct map checks.
    }
  }
  return Boolean(
    entity &&
      entity.lockedTargets instanceof Map &&
      entity.lockedTargets.size > 0,
  );
}

function hasPendingLocks(scene, entity) {
  if (scene && typeof scene.getSortedPendingTargetLocks === "function") {
    try {
      if (scene.getSortedPendingTargetLocks(entity).length > 0) {
        return true;
      }
    } catch (error) {
      // Fall through to direct map checks.
    }
  }
  return Boolean(
    entity &&
      entity.pendingTargetLocks instanceof Map &&
      entity.pendingTargetLocks.size > 0,
  );
}

function hasRecentAggression(controller, nowMs) {
  const lastAggressedAtMs = toFiniteNumber(
    controller && controller.lastAggressedAtMs,
    0,
  );
  if (lastAggressedAtMs <= 0) {
    return false;
  }
  return (nowMs - lastAggressedAtMs) < NPC_COMBAT_DORMANCY_RECENT_AGGRESSION_GRACE_MS;
}

function isStableDormancyHomeState(scene, entity, controller) {
  if (!scene || !entity || !controller) {
    return false;
  }

  if (controller.returningHome === true) {
    return false;
  }

  const behaviorProfile = resolveBehaviorProfile(controller);
  const anchorID = toPositiveInt(controller.anchorID, 0);
  const targetEntityID = toPositiveInt(entity.targetEntityID, 0);
  if (
    behaviorProfile.idleAnchorOrbit === true &&
    anchorID > 0 &&
    String(entity.mode || "").trim() === "ORBIT" &&
    targetEntityID === anchorID
  ) {
    return true;
  }

  const homePosition = controller.homePosition;
  if (homePosition) {
    const homeArrivalMeters = Math.max(
      250,
      toFiniteNumber(behaviorProfile.homeArrivalMeters, 1_500),
    );
    if (distance(entity.position, homePosition) <= homeArrivalMeters) {
      return true;
    }
  }

  return (
    String(entity.mode || "").trim() === "STOP" &&
    toFiniteNumber(entity.speedFraction, 0) <= 0.01 &&
    magnitude(entity.velocity) <= 1
  );
}

function canDematerializeDormantCombatController(scene, controller, entity, options = {}) {
  if (!scene || !controller || !entity) {
    return false;
  }
  if (!isCombatDormantControllerRecord(controller)) {
    return false;
  }
  const ignoreSceneSessionCount = options.ignoreSceneSessionCount === true;
  if (
    !(scene.sessions instanceof Map) ||
    (!ignoreSceneSessionCount && scene.sessions.size > 0)
  ) {
    return false;
  }
  if (controller.manualOrder) {
    return false;
  }
  if (toPositiveInt(controller.currentTargetID, 0) > 0) {
    return false;
  }
  if (
    entity.pendingDock &&
    typeof entity.pendingDock === "object"
  ) {
    return false;
  }
  if (
    entity.sessionlessWarpIngress &&
    typeof entity.sessionlessWarpIngress === "object"
  ) {
    return false;
  }
  if (
    entity.activeModuleEffects instanceof Map &&
    entity.activeModuleEffects.size > 0
  ) {
    return false;
  }
  if (hasActiveLocks(scene, entity) || hasPendingLocks(scene, entity)) {
    return false;
  }

  const nowMs = toFiniteNumber(
    options.nowMs,
    scene.getCurrentSimTimeMs ? scene.getCurrentSimTimeMs() : Date.now(),
  );
  if (hasRecentAggression(controller, nowMs)) {
    return false;
  }

  return isStableDormancyHomeState(scene, entity, controller);
}

function materializeDormantCombatControllersForScene(scene, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const materialized = [];
  for (const controllerRecord of listCombatDormancyControllerRecordsForSystem(scene.systemID)) {
    const entityID = toPositiveInt(controllerRecord && controllerRecord.entityID, 0);
    if (!entityID) {
      continue;
    }
    if (scene.getEntityByID(entityID) || getControllerByEntityID(entityID)) {
      continue;
    }

    const materializeResult = getNativeNpcService().materializeStoredNativeController(
      scene,
      entityID,
      {
        broadcast: options.broadcast === true,
        excludedSession: options.excludedSession || null,
      },
    );
    if (!materializeResult.success || !materializeResult.data) {
      return materializeResult;
    }
    if (materializeResult.data.prunedInvalidStoredController === true) {
      continue;
    }

    materialized.push({
      entityID,
      startupRuleID: String(controllerRecord.startupRuleID || "").trim() || null,
      operatorKind: String(controllerRecord.operatorKind || "").trim() || null,
      anchorID: toPositiveInt(controllerRecord.anchorID, 0),
      entityType: String(controllerRecord.entityType || "").trim().toLowerCase() || null,
    });
  }

  if (materialized.length > 0 && options.catchUpBehavior !== false) {
    const nowMs = toFiniteNumber(
      options.nowMs,
      scene.getCurrentSimTimeMs ? scene.getCurrentSimTimeMs() : Date.now(),
    );
    tickControllersByEntityID(
      scene,
      materialized.map((entry) => entry.entityID),
      nowMs,
    );
  }

  return {
    success: true,
    data: {
      materialized,
      materializedCount: materialized.length,
    },
  };
}

function dematerializeDormantCombatControllersForScene(scene, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const nowMs = toFiniteNumber(
    options.nowMs,
    scene.getCurrentSimTimeMs ? scene.getCurrentSimTimeMs() : Date.now(),
  );
  const dematerialized = [];
  const skipped = [];

  for (const controller of listControllersBySystem(scene.systemID)) {
    const entityID = toPositiveInt(controller && controller.entityID, 0);
    if (!entityID || !isCombatDormantControllerRecord(controller)) {
      continue;
    }
    const entity = scene.getEntityByID(entityID);
    if (!entity) {
      continue;
    }

    if (!canDematerializeDormantCombatController(scene, controller, entity, { nowMs })) {
      skipped.push({
        entityID,
        startupRuleID: String(controller.startupRuleID || "").trim() || null,
        operatorKind: String(controller.operatorKind || "").trim() || null,
      });
      continue;
    }

    const dematerializeResult = getNativeNpcService().dematerializeNativeController(
      controller,
      {
        broadcast: options.broadcast === true,
        persistState: options.persistState !== false,
      },
    );
    if (!dematerializeResult.success) {
      return dematerializeResult;
    }

    dematerialized.push({
      entityID,
      startupRuleID: String(controller.startupRuleID || "").trim() || null,
      operatorKind: String(controller.operatorKind || "").trim() || null,
      anchorID: toPositiveInt(controller.anchorID, 0),
      entityType: String(controller.entityType || "").trim().toLowerCase() || null,
    });
  }

  return {
    success: true,
    data: {
      dematerialized,
      dematerializedCount: dematerialized.length,
      skipped,
      skippedCount: skipped.length,
    },
  };
}

module.exports = {
  NPC_COMBAT_DORMANCY_RECENT_AGGRESSION_GRACE_MS,
  isCombatDormancyEnabled,
  isCombatStartupRuleDormancyEligible,
  isCombatDormantControllerRecord,
  listCombatDormancyControllerRecordsForSystem,
  canDematerializeDormantCombatController,
  materializeDormantCombatControllersForScene,
  dematerializeDormantCombatControllersForScene,
};
