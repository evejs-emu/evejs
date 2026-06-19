const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const nativeNpcStore = require(path.join(__dirname, "./nativeNpcStore"));
const { listControllersBySystem } = require("./npcRegistry");
const {
  isAmbientStartupControllerRecord,
  isAmbientVirtualizationEnabled,
} = require(path.join(__dirname, "./npcAmbientMaterialization"));
const {
  isCombatDormancyEnabled,
  isCombatDormantControllerRecord,
} = require(path.join(__dirname, "./npcCombatDormancy"));

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function minDeadline(current, candidate) {
  const numericCandidate = toFiniteNumber(candidate, 0);
  if (numericCandidate <= 0) {
    return current;
  }
  if (current === null || numericCandidate < current) {
    return numericCandidate;
  }
  return current;
}

function mergeDeadline(current, candidate) {
  if (candidate === 0) {
    return 0;
  }
  return minDeadline(current, candidate);
}

function isColdSceneSleepEnabled() {
  return process.env.EVEJS_DISABLE_NPC_COLD_SCENE_SLEEP !== "1";
}

function isAnchorRelevanceEnabled() {
  return process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE !== "1";
}

function getEntityTimerDeadlineMs(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }

  let nextDeadlineMs = null;
  nextDeadlineMs = minDeadline(nextDeadlineMs, entity.expiresAtMs);

  if (entity.pendingDock && typeof entity.pendingDock === "object") {
    nextDeadlineMs = minDeadline(nextDeadlineMs, entity.pendingDock.completeAtMs);
  }

  if (entity.sessionlessWarpIngress && typeof entity.sessionlessWarpIngress === "object") {
    nextDeadlineMs = minDeadline(nextDeadlineMs, entity.sessionlessWarpIngress.completeAtMs);
  }

  if (entity.activeModuleEffects instanceof Map) {
    for (const effectState of entity.activeModuleEffects.values()) {
      if (!effectState || typeof effectState !== "object") {
        continue;
      }
      nextDeadlineMs = minDeadline(nextDeadlineMs, effectState.nextCycleAtMs);
      nextDeadlineMs = minDeadline(nextDeadlineMs, effectState.deactivateAtMs);
    }
  }

  if (entity.pendingTargetLocks instanceof Map) {
    for (const pendingLock of entity.pendingTargetLocks.values()) {
      if (!pendingLock || typeof pendingLock !== "object") {
        continue;
      }
      nextDeadlineMs = minDeadline(nextDeadlineMs, pendingLock.completeAtMs);
    }
  }

  return nextDeadlineMs;
}

function getSceneEntityDeadlineMs(scene) {
  if (!scene || !(scene.dynamicEntities instanceof Map)) {
    return null;
  }

  let nextDeadlineMs = null;
  for (const entity of scene.dynamicEntities.values()) {
    nextDeadlineMs = minDeadline(nextDeadlineMs, getEntityTimerDeadlineMs(entity));
  }
  return nextDeadlineMs;
}

function getSceneStargateDeadlineMs(scene) {
  if (!scene || !Array.isArray(scene.staticEntities)) {
    return null;
  }

  let nextDeadlineMs = null;
  for (const entity of scene.staticEntities) {
    if (!entity || entity.kind !== "stargate") {
      continue;
    }
    nextDeadlineMs = minDeadline(nextDeadlineMs, entity.activationTransitionAtMs);
  }
  return nextDeadlineMs;
}

function getSceneNpcDeadlineMs(scene) {
  if (!scene) {
    return null;
  }

  let nextDeadlineMs = null;
  for (const controller of listControllersBySystem(scene.systemID)) {
    if (!controller || typeof controller !== "object") {
      continue;
    }
    const runtimeKind = String(controller.runtimeKind || "").trim();
    if (runtimeKind === "nativeAmbient") {
      continue;
    }
    const nextThinkAtMs = toFiniteNumber(controller.nextThinkAtMs, 0);
    if (nextThinkAtMs <= 0) {
      return 0;
    }
    if (nextThinkAtMs < Number.MAX_SAFE_INTEGER) {
      nextDeadlineMs = minDeadline(nextDeadlineMs, nextThinkAtMs);
    }
  }

  const respawnDeadlines =
    scene._npcStartupRespawnDeadlines && typeof scene._npcStartupRespawnDeadlines === "object"
      ? Object.values(scene._npcStartupRespawnDeadlines)
      : [];
  for (const deadlineMs of respawnDeadlines) {
    nextDeadlineMs = minDeadline(nextDeadlineMs, deadlineMs);
  }

  return nextDeadlineMs;
}

function getSceneCrimewatchDeadlineMs(scene, sceneNowMs) {
  if (!scene) {
    return null;
  }

  try {
    const crimewatchState = require(path.join(__dirname, "../../services/security/crimewatchState"));
    if (
      crimewatchState &&
      typeof crimewatchState.getSceneTickDeadlineMs === "function"
    ) {
      return crimewatchState.getSceneTickDeadlineMs(scene, sceneNowMs);
    }
  } catch (error) {
    return null;
  }

  return null;
}

function getSceneActivityState(scene, wallclockNow = Date.now()) {
  if (!scene) {
    return {
      hasSessions: false,
      sessionCount: 0,
      sceneNowMs: toFiniteNumber(wallclockNow, Date.now()),
      nextDeadlineMs: null,
      shouldTick: false,
      sleepReason: "scene-missing",
    };
  }

  const normalizedWallclockNow = toFiniteNumber(wallclockNow, Date.now());
  const sessionCount = scene.sessions instanceof Map ? scene.sessions.size : 0;
  const hasSessions = sessionCount > 0;
  const sceneNowMs =
    typeof scene.peekSimTimeForWallclock === "function"
      ? toFiniteNumber(scene.peekSimTimeForWallclock(normalizedWallclockNow), normalizedWallclockNow)
      : normalizedWallclockNow;

  let nextDeadlineMs = null;
  nextDeadlineMs = mergeDeadline(nextDeadlineMs, getSceneEntityDeadlineMs(scene));
  nextDeadlineMs = mergeDeadline(nextDeadlineMs, getSceneStargateDeadlineMs(scene));
  nextDeadlineMs = mergeDeadline(nextDeadlineMs, getSceneNpcDeadlineMs(scene));
  nextDeadlineMs = mergeDeadline(nextDeadlineMs, getSceneCrimewatchDeadlineMs(scene, sceneNowMs));

  if (hasSessions) {
    return {
      hasSessions,
      sessionCount,
      sceneNowMs,
      nextDeadlineMs,
      shouldTick: true,
      sleepReason: "sessions-present",
    };
  }

  if (!isColdSceneSleepEnabled()) {
    return {
      hasSessions,
      sessionCount,
      sceneNowMs,
      nextDeadlineMs,
      shouldTick: true,
      sleepReason: "cold-scene-sleep-disabled",
    };
  }

  if (nextDeadlineMs === 0 || (nextDeadlineMs !== null && nextDeadlineMs <= sceneNowMs)) {
    return {
      hasSessions,
      sessionCount,
      sceneNowMs,
      nextDeadlineMs,
      shouldTick: true,
      sleepReason: "deadline-due",
    };
  }

  return {
    hasSessions,
    sessionCount,
    sceneNowMs,
    nextDeadlineMs,
    shouldTick: false,
    sleepReason: nextDeadlineMs === null ? "cold-no-deadline" : "sleep-until-deadline",
  };
}

function buildStartupPresenceSummary(systemIDs) {
  const normalizedSystemIDs = [...new Set(
    (Array.isArray(systemIDs) ? systemIDs : [systemIDs])
      .map((systemID) => toPositiveInt(systemID, 0))
      .filter((systemID) => systemID > 0),
  )];

  const summary = {
    settings: {
      skipNpcStartup: process.env.EVEJS_SKIP_NPC_STARTUP === "1",
      authoredStartupEnabled: config.npcAuthoredStartupEnabled !== false,
      defaultConcordStartupEnabled: config.npcDefaultConcordStartupEnabled === true,
      defaultConcordStationScreensEnabled: config.npcDefaultConcordStationScreensEnabled === true,
      ambientVirtualizationEnabled: isAmbientVirtualizationEnabled(),
      combatDormancyEnabled: isCombatDormancyEnabled(),
      anchorRelevanceEnabled: isAnchorRelevanceEnabled(),
    },
    systemsConsidered: normalizedSystemIDs.length,
    startupSystemsWithPresence: 0,
    totalStartupShips: 0,
    liveStartupShips: 0,
    virtualizedStartupShips: 0,
    concord: {
      ships: 0,
      liveShips: 0,
      virtualizedShips: 0,
      systems: 0,
      anchors: 0,
      stargateAnchors: 0,
    },
    npc: {
      ships: 0,
      liveShips: 0,
      virtualizedShips: 0,
      systems: 0,
      anchors: 0,
      stargateAnchors: 0,
    },
  };

  const startupSystems = new Set();
  const concordSystems = new Set();
  const concordAnchors = new Set();
  const concordStargateAnchors = new Set();
  const npcSystems = new Set();
  const npcAnchors = new Set();
  const npcStargateAnchors = new Set();

  for (const systemID of normalizedSystemIDs) {
    const startupControllersByEntityID = new Map();

    for (const controller of listControllersBySystem(systemID)) {
      if (!controller || typeof controller !== "object") {
        continue;
      }
      const startupRuleID = String(controller.startupRuleID || "").trim();
      const operatorKind = String(controller.operatorKind || "").trim();
      if (!startupRuleID && !operatorKind) {
        continue;
      }
      const entityID = toPositiveInt(controller.entityID, 0);
      if (!entityID) {
        continue;
      }
      startupControllersByEntityID.set(entityID, {
        controller,
        virtualized: false,
      });
    }

    for (const controllerRecord of nativeNpcStore.listNativeControllersForSystem(systemID)) {
      if (!controllerRecord || typeof controllerRecord !== "object") {
        continue;
      }
      const startupRuleID = String(controllerRecord.startupRuleID || "").trim();
      const operatorKind = String(controllerRecord.operatorKind || "").trim();
      if (!startupRuleID && !operatorKind) {
        continue;
      }
      const entityID = toPositiveInt(controllerRecord.entityID, 0);
      if (!entityID || startupControllersByEntityID.has(entityID)) {
        continue;
      }
      const virtualized =
        isAmbientStartupControllerRecord(controllerRecord) ||
        isCombatDormantControllerRecord(controllerRecord);
      startupControllersByEntityID.set(entityID, {
        controller: controllerRecord,
        virtualized,
      });
    }

    for (const entry of startupControllersByEntityID.values()) {
      const controller = entry.controller;

      const entityType = String(controller.entityType || "npc").trim().toLowerCase() === "concord"
        ? "concord"
        : "npc";
      const anchorID = toPositiveInt(controller.anchorID, 0);
      const anchorKey = anchorID > 0 ? `${systemID}:${anchorID}` : null;
      const anchorKind = String(controller.anchorKind || "").trim().toLowerCase();

      summary.totalStartupShips += 1;
      if (entry.virtualized) {
        summary.virtualizedStartupShips += 1;
      } else {
        summary.liveStartupShips += 1;
      }
      startupSystems.add(systemID);

      if (entityType === "concord") {
        summary.concord.ships += 1;
        if (entry.virtualized) {
          summary.concord.virtualizedShips += 1;
        } else {
          summary.concord.liveShips += 1;
        }
        concordSystems.add(systemID);
        if (anchorKey) {
          concordAnchors.add(anchorKey);
          if (anchorKind === "stargate") {
            concordStargateAnchors.add(anchorKey);
          }
        }
        continue;
      }

      summary.npc.ships += 1;
      if (entry.virtualized) {
        summary.npc.virtualizedShips += 1;
      } else {
        summary.npc.liveShips += 1;
      }
      npcSystems.add(systemID);
      if (anchorKey) {
        npcAnchors.add(anchorKey);
        if (anchorKind === "stargate") {
          npcStargateAnchors.add(anchorKey);
        }
      }
    }
  }

  summary.startupSystemsWithPresence = startupSystems.size;
  summary.concord.systems = concordSystems.size;
  summary.concord.anchors = concordAnchors.size;
  summary.concord.stargateAnchors = concordStargateAnchors.size;
  summary.npc.systems = npcSystems.size;
  summary.npc.anchors = npcAnchors.size;
  summary.npc.stargateAnchors = npcStargateAnchors.size;

  return summary;
}

module.exports = {
  buildStartupPresenceSummary,
  getSceneActivityState,
  isAnchorRelevanceEnabled,
  isColdSceneSleepEnabled,
};
