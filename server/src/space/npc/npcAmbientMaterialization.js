const path = require("path");

const nativeNpcStore = require(path.join(__dirname, "./nativeNpcStore"));
const {
  getControllerByEntityID,
} = require(path.join(__dirname, "./npcRegistry"));

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function isAmbientVirtualizationEnabled() {
  return process.env.EVEJS_DISABLE_NPC_AMBIENT_VIRTUALIZATION !== "1";
}

function getNativeNpcService() {
  return require(path.join(__dirname, "./nativeNpcService"));
}

function isAmbientStartupRuleVirtualizable(scene, rule) {
  if (!scene || !isAmbientVirtualizationEnabled()) {
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
  return getNativeNpcService().isNativeAmbientRuleOptions({
    entityType: rule.entityType,
    behaviorOverrides: rule.behaviorOverrides,
    runtimeKind: rule.runtimeKind,
  });
}

function isAmbientStartupControllerRecord(controllerRecord) {
  if (!controllerRecord || typeof controllerRecord !== "object") {
    return false;
  }
  const runtimeKind = String(controllerRecord.runtimeKind || "").trim();
  const entityType = String(controllerRecord.entityType || "").trim().toLowerCase();
  const startupRuleID = String(controllerRecord.startupRuleID || "").trim();
  const operatorKind = String(controllerRecord.operatorKind || "").trim();
  return (
    runtimeKind === "nativeAmbient" &&
    entityType === "concord" &&
    (startupRuleID !== "" || operatorKind !== "")
  );
}

function listAmbientStartupControllerRecordsForSystem(systemID) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (!normalizedSystemID) {
    return [];
  }
  return nativeNpcStore
    .listNativeControllersForSystem(normalizedSystemID)
    .filter((controllerRecord) => isAmbientStartupControllerRecord(controllerRecord));
}

function materializeAmbientStartupControllersForScene(scene, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const broadcast = options.broadcast === true;
  const materialized = [];
  for (const controllerRecord of listAmbientStartupControllerRecordsForSystem(scene.systemID)) {
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
        broadcast,
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
      anchorID: toPositiveInt(controllerRecord.anchorID, 0),
      operatorKind: String(controllerRecord.operatorKind || "").trim() || null,
    });
  }

  return {
    success: true,
    data: {
      materialized,
      materializedCount: materialized.length,
    },
  };
}

function canDematerializeAmbientStartupController(scene, controllerRecord, entity, options = {}) {
  if (!scene || !controllerRecord || !entity) {
    return false;
  }
  if (!isAmbientStartupControllerRecord(controllerRecord)) {
    return false;
  }
  const ignoreSceneSessionCount = options.ignoreSceneSessionCount === true;
  if (
    !(scene.sessions instanceof Map) ||
    (!ignoreSceneSessionCount && scene.sessions.size > 0)
  ) {
    return false;
  }
  if (controllerRecord.manualOrder) {
    return false;
  }
  if (controllerRecord.returningHome === true) {
    return false;
  }
  if (toPositiveInt(controllerRecord.currentTargetID, 0) > 0) {
    return false;
  }
  if (entity.pendingDock && typeof entity.pendingDock === "object") {
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
  if (
    entity.pendingTargetLocks instanceof Map &&
    entity.pendingTargetLocks.size > 0
  ) {
    return false;
  }
  return true;
}

function dematerializeAmbientStartupControllersForScene(scene, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const dematerialized = [];
  const skipped = [];
  for (const controllerRecord of listAmbientStartupControllerRecordsForSystem(scene.systemID)) {
    const entityID = toPositiveInt(controllerRecord && controllerRecord.entityID, 0);
    if (!entityID) {
      continue;
    }
    const entity = scene.getEntityByID(entityID);
    if (!entity) {
      continue;
    }

    const liveController = getControllerByEntityID(entityID) || controllerRecord;
    if (!canDematerializeAmbientStartupController(scene, liveController, entity)) {
      skipped.push({
        entityID,
        startupRuleID: String(controllerRecord.startupRuleID || "").trim() || null,
      });
      continue;
    }

    const dematerializeResult = getNativeNpcService().dematerializeNativeController(
      liveController,
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
      startupRuleID: String(controllerRecord.startupRuleID || "").trim() || null,
      anchorID: toPositiveInt(controllerRecord.anchorID, 0),
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
  isAmbientVirtualizationEnabled,
  isAmbientStartupRuleVirtualizable,
  isAmbientStartupControllerRecord,
  listAmbientStartupControllerRecordsForSystem,
  canDematerializeAmbientStartupController,
  materializeAmbientStartupControllersForScene,
  dematerializeAmbientStartupControllersForScene,
};
