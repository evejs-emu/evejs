const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const structureState = require(path.join(__dirname, "./structureState"));
const structureLog = require(path.join(__dirname, "./structureLog"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_STATE,
  STRUCTURE_STATE_NAME_BY_ID,
  STRUCTURE_UPKEEP_STATE,
  STRUCTURE_UPKEEP_NAME_BY_ID,
} = require(path.join(__dirname, "./structureConstants"));

const AUTO_INTERVAL_MS = 10000;
const ONLINE_FAST_FORWARD_SHORT_SECONDS = 1000;
const ONLINE_FAST_FORWARD_LONG_SECONDS = 90000;
const REINFORCE_FAST_FORWARD_SECONDS = 400000;

const activeJobs = new Map();
let nextJobID = 1;

function normalizeInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = normalizeInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function getCurrentSolarSystemID(session) {
  return normalizePositiveInt(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
}

function getSeedPosition(session) {
  const entity = spaceRuntime.getEntity(
    session,
    session && session._space ? session._space.shipID : null,
  );
  const solarSystemID = getCurrentSolarSystemID(session);
  const seededStructureCount = solarSystemID > 0
    ? structureState.listStructuresForSystem(solarSystemID, {
      includeDestroyed: true,
      refresh: false,
    }).filter((structure) => !structure.destroyedAt).length
    : 0;
  const spokeCount = 6;
  const ringIndex = Math.floor(seededStructureCount / spokeCount);
  const spokeIndex = seededStructureCount % spokeCount;
  const ringDistance = 120000 + (ringIndex * 60000);
  const angleRadians = ((Math.PI * 2) / spokeCount) * spokeIndex;
  const offsetX = Math.cos(angleRadians) * ringDistance;
  const offsetZ = Math.sin(angleRadians) * ringDistance;

  if (entity && entity.position) {
    return {
      x: Number(entity.position.x || 0) + offsetX,
      y: Number(entity.position.y || 0),
      z: Number(entity.position.z || 0) + offsetZ,
    };
  }

  return {
    x: 100000 + offsetX,
    y: 0,
    z: 100000 + offsetZ,
  };
}

function cloneSessionForAutomation(session) {
  return {
    clientID: normalizePositiveInt(session && session.clientID, 0),
    characterID: normalizePositiveInt(session && (session.characterID || session.charid || session.userid), 0),
    charid: normalizePositiveInt(session && (session.charid || session.characterID || session.userid), 0),
    userid: normalizePositiveInt(session && (session.userid || session.userID || session.characterID), 0),
    corporationID: normalizePositiveInt(session && (session.corporationID || session.corpid), 0),
    corpid: normalizePositiveInt(session && (session.corpid || session.corporationID), 0),
    allianceID: normalizePositiveInt(session && (session.allianceID || session.allianceid), 0),
    allianceid: normalizePositiveInt(session && (session.allianceid || session.allianceID), 0),
    solarsystemid2: normalizePositiveInt(session && session.solarsystemid2, 0),
    solarsystemid: normalizePositiveInt(session && session.solarsystemid, 0),
  };
}

function formatStructureSummary(structure) {
  if (!structure) {
    return "structure=?";
  }
  const stateName = STRUCTURE_STATE_NAME_BY_ID[normalizeInt(structure.state, 0)] || "unknown";
  const upkeepName = STRUCTURE_UPKEEP_NAME_BY_ID[normalizeInt(structure.upkeepState, 0)] || "unknown";
  return `${structure.itemName || structure.name || `Structure ${structure.structureID}`}(${structure.structureID}) state=${stateName} upkeep=${upkeepName} core=${structure.hasQuantumCore === true ? "installed" : "missing"}`;
}

function hasActiveTimer(structure) {
  const timerValue = Number(structure && structure.stateEndsAt);
  return (
    structure &&
    structure.stateEndsAt !== null &&
    structure.stateEndsAt !== undefined &&
    Number.isFinite(timerValue) &&
    timerValue > 0
  );
}

function syncStructureRuntime(structureOrSystemID) {
  const systemID =
    typeof structureOrSystemID === "object" && structureOrSystemID !== null
      ? normalizePositiveInt(structureOrSystemID.solarSystemID, 0)
      : normalizePositiveInt(structureOrSystemID, 0);
  if (systemID <= 0) {
    return;
  }
  if (typeof spaceRuntime.syncStructureSceneState === "function") {
    spaceRuntime.syncStructureSceneState(systemID);
  }
}

function getJobByStructureID(structureID) {
  const targetID = normalizePositiveInt(structureID, 0);
  for (const job of activeJobs.values()) {
    if (normalizePositiveInt(job.structureID, 0) === targetID) {
      return job;
    }
  }
  return null;
}

function stopJobInternal(job, reason, status = "stopped") {
  if (!job) {
    return null;
  }
  if (job.timer) {
    clearInterval(job.timer);
  }
  activeJobs.delete(job.jobID);
  structureLog.logAutomationEvent(
    job,
    `${status.toUpperCase()} ${reason}`,
    status === "failed" ? "ERR" : "INF",
  );
  return {
    success: true,
    data: {
      ...job,
      status,
      reason,
    },
  };
}

function applyStructureAction(job, actionLabel, fn) {
  let result = null;
  try {
    result = fn();
  } catch (error) {
    structureLog.logAutomationEvent(
      job,
      `${actionLabel} threw ${error.stack || error.message}`,
      "ERR",
    );
    return stopJobInternal(job, `${actionLabel} threw ${error.message}`, "failed");
  }

  if (!result || result.success !== true) {
    const errorMsg = result && result.errorMsg ? result.errorMsg : "UNKNOWN_ERROR";
    structureLog.logAutomationEvent(job, `${actionLabel} failed error=${errorMsg}`, "ERR");
    return stopJobInternal(job, `${actionLabel} failed: ${errorMsg}`, "failed");
  }

  structureState.tickStructures(Date.now());
  const nextStructure = structureState.getStructureByID(job.structureID, { refresh: false });
  if (nextStructure) {
    syncStructureRuntime(nextStructure);
  }
  job.lastAction = actionLabel;
  job.lastActionAt = Date.now();
  structureLog.logAutomationEvent(
    job,
    `${actionLabel} ok ${formatStructureSummary(nextStructure || result.data && result.data.structure || result.data)}`,
  );
  return {
    success: true,
    data: nextStructure || result.data,
  };
}

function executeOnlineStep(job, structure) {
  if (!structure) {
    return stopJobInternal(job, "structure no longer exists", "failed");
  }
  if (structure.destroyedAt) {
    return stopJobInternal(job, "structure was destroyed before online automation finished", "failed");
  }

  const dockingState = normalizeInt(
    structure.serviceStates && structure.serviceStates[String(STRUCTURE_SERVICE_ID.DOCKING)],
    STRUCTURE_SERVICE_STATE.OFFLINE,
  );

  if (
    normalizeInt(structure.state, 0) === STRUCTURE_STATE.SHIELD_VULNERABLE &&
    dockingState === STRUCTURE_SERVICE_STATE.ONLINE
  ) {
    return stopJobInternal(job, "structure reached online+docking-ready state", "completed");
  }

  if (normalizeInt(structure.state, 0) === STRUCTURE_STATE.UNANCHORED) {
    return applyStructureAction(job, `/upwell anchor ${structure.structureID}`, () => (
      structureState.startAnchoring(structure.structureID)
    ));
  }

  if (normalizeInt(structure.state, 0) === STRUCTURE_STATE.ANCHOR_VULNERABLE) {
    return applyStructureAction(job, `/upwell ff ${structure.structureID} ${ONLINE_FAST_FORWARD_SHORT_SECONDS}`, () => (
      structureState.fastForwardStructure(structure.structureID, ONLINE_FAST_FORWARD_SHORT_SECONDS)
    ));
  }

  if (normalizeInt(structure.state, 0) === STRUCTURE_STATE.ANCHORING) {
    if (structure.hasQuantumCore !== true && hasActiveTimer(structure)) {
      return applyStructureAction(job, `/upwell ff ${structure.structureID} ${ONLINE_FAST_FORWARD_LONG_SECONDS}`, () => (
        structureState.fastForwardStructure(structure.structureID, ONLINE_FAST_FORWARD_LONG_SECONDS)
      ));
    }
    if (structure.hasQuantumCore !== true) {
      return applyStructureAction(job, `/upwell core ${structure.structureID} on`, () => (
        structureState.setStructureQuantumCoreInstalled(structure.structureID, true)
      ));
    }
  }

  if (normalizeInt(structure.state, 0) === STRUCTURE_STATE.ONLINING_VULNERABLE) {
    if (structure.hasQuantumCore !== true) {
      return applyStructureAction(job, `/upwell core ${structure.structureID} on`, () => (
        structureState.setStructureQuantumCoreInstalled(structure.structureID, true)
      ));
    }
    if (dockingState !== STRUCTURE_SERVICE_STATE.ONLINE) {
      const serviceResult = applyStructureAction(
        job,
        `/upwell service ${structure.structureID} docking online`,
        () => structureState.setStructureServiceState(
          structure.structureID,
          STRUCTURE_SERVICE_ID.DOCKING,
          STRUCTURE_SERVICE_STATE.ONLINE,
        ),
      );
      if (serviceResult && serviceResult.success !== true) {
        return serviceResult;
      }
      structure = structureState.getStructureByID(job.structureID, { refresh: false });
    }
    return applyStructureAction(job, `/upwell ff ${structure.structureID} ${ONLINE_FAST_FORWARD_SHORT_SECONDS}`, () => (
      structureState.fastForwardStructure(structure.structureID, ONLINE_FAST_FORWARD_SHORT_SECONDS)
    ));
  }

  if (normalizeInt(structure.state, 0) === STRUCTURE_STATE.SHIELD_VULNERABLE) {
    return applyStructureAction(job, `/upwell service ${structure.structureID} docking online`, () => (
      structureState.setStructureServiceState(
        structure.structureID,
        STRUCTURE_SERVICE_ID.DOCKING,
        STRUCTURE_SERVICE_STATE.ONLINE,
      )
    ));
  }

  return stopJobInternal(
    job,
    `online automation does not know how to advance state=${STRUCTURE_STATE_NAME_BY_ID[normalizeInt(structure.state, 0)] || structure.state}`,
    "failed",
  );
}

function executeDestroyStep(job, structure) {
  if (!structure) {
    return stopJobInternal(job, "structure no longer exists", "failed");
  }
  if (structure.destroyedAt) {
    return stopJobInternal(job, "structure is destroyed", "completed");
  }

  const stateID = normalizeInt(structure.state, 0);

  if (
    stateID === STRUCTURE_STATE.UNANCHORED ||
    stateID === STRUCTURE_STATE.ANCHOR_VULNERABLE ||
    stateID === STRUCTURE_STATE.ANCHORING ||
    stateID === STRUCTURE_STATE.ONLINING_VULNERABLE
  ) {
    return executeOnlineStep(job, structure);
  }

  if (job.prepared !== true) {
    if (normalizeInt(structure.upkeepState, 0) !== STRUCTURE_UPKEEP_STATE.FULL_POWER) {
      return applyStructureAction(job, `/upwell upkeep ${structure.structureID} full_power`, () => (
        structureState.setStructureUpkeepState(structure.structureID, STRUCTURE_UPKEEP_STATE.FULL_POWER)
      ));
    }
    job.prepared = true;
    return applyStructureAction(job, `/upwell repair ${structure.structureID}`, () => (
      structureState.repairStructure(structure.structureID)
    ));
  }

  if (stateID === STRUCTURE_STATE.SHIELD_VULNERABLE) {
    return applyStructureAction(job, `/upwell damage ${structure.structureID} shield 1`, () => (
      structureState.applyAdminStructureDamage(
        structure.structureID,
        "shield",
        1,
        { session: job.session },
      )
    ));
  }

  if (stateID === STRUCTURE_STATE.ARMOR_REINFORCE || stateID === STRUCTURE_STATE.HULL_REINFORCE) {
    return applyStructureAction(job, `/upwell ff ${structure.structureID} ${REINFORCE_FAST_FORWARD_SECONDS}`, () => (
      structureState.fastForwardStructure(structure.structureID, REINFORCE_FAST_FORWARD_SECONDS)
    ));
  }

  if (stateID === STRUCTURE_STATE.ARMOR_VULNERABLE) {
    return applyStructureAction(job, `/upwell damage ${structure.structureID} armor 1`, () => (
      structureState.applyAdminStructureDamage(
        structure.structureID,
        "armor",
        1,
        { session: job.session },
      )
    ));
  }

  if (stateID === STRUCTURE_STATE.HULL_VULNERABLE) {
    return applyStructureAction(job, `/upwell damage ${structure.structureID} hull 1`, () => (
      structureState.applyAdminStructureDamage(
        structure.structureID,
        "hull",
        1,
        { session: job.session },
      )
    ));
  }

  return stopJobInternal(
    job,
    `destroy automation does not know how to advance state=${STRUCTURE_STATE_NAME_BY_ID[stateID] || structure.state}`,
    "failed",
  );
}

function runJobNow(jobID) {
  const job = activeJobs.get(normalizePositiveInt(jobID, 0));
  if (!job) {
    return {
      success: false,
      errorMsg: "JOB_NOT_FOUND",
    };
  }
  const structure = structureState.getStructureByID(job.structureID, { refresh: false });
  if (job.mode === "online") {
    return executeOnlineStep(job, structure);
  }
  if (job.mode === "destroy") {
    return executeDestroyStep(job, structure);
  }
  if (typeof job.executeStep === "function") {
    let result = null;
    try {
      result = job.executeStep(job, structure);
    } catch (error) {
      structureLog.logAutomationEvent(
        job,
        `custom step threw ${error.stack || error.message}`,
        "ERR",
      );
      return stopJobInternal(job, `custom step threw ${error.message}`, "failed");
    }

    if (!result || result.success !== true) {
      const errorMsg = result && result.errorMsg ? result.errorMsg : "UNKNOWN_ERROR";
      structureLog.logAutomationEvent(job, `custom step failed error=${errorMsg}`, "ERR");
      return stopJobInternal(job, `custom step failed: ${errorMsg}`, "failed");
    }

    if (result.skipStructureSync !== true) {
      if (result.syncSystemID) {
        syncStructureRuntime(result.syncSystemID);
      } else if (structure) {
        syncStructureRuntime(structure);
      }
    }

    job.lastAction = result.actionLabel || `${job.mode} step`;
    job.lastActionAt = Date.now();
    if (result.logMessage) {
      structureLog.logAutomationEvent(job, result.logMessage, result.logLevel || "INF");
    }

    if (result.completed === true) {
      return stopJobInternal(
        job,
        result.completionReason || "custom automation completed",
        "completed",
      );
    }

    return {
      success: true,
      data: result.data || null,
    };
  }
  return stopJobInternal(job, `unknown automation mode=${job.mode}`, "failed");
}

function createJob(mode, structureID, session, options = {}) {
  const existingJob = getJobByStructureID(structureID);
  if (existingJob) {
    stopJobInternal(existingJob, "replaced by a new automation request", "replaced");
  }

  const job = {
    jobID: nextJobID++,
    mode,
    structureID: normalizePositiveInt(structureID, 0),
    session: cloneSessionForAutomation(session),
    startedAt: Date.now(),
    lastActionAt: 0,
    lastAction: null,
    prepared: options.prepared === true,
    intervalMs: AUTO_INTERVAL_MS,
    timer: null,
  };

  job.timer = setInterval(() => {
    runJobNow(job.jobID);
  }, AUTO_INTERVAL_MS);
  if (typeof job.timer.unref === "function") {
    job.timer.unref();
  }

  activeJobs.set(job.jobID, job);
  structureLog.logAutomationEvent(job, `STARTED intervalMs=${AUTO_INTERVAL_MS}`);
  return job;
}

function createCustomJob(mode, structureID, session, executeStep, options = {}) {
  const existingJob = getJobByStructureID(structureID);
  if (existingJob) {
    stopJobInternal(existingJob, "replaced by a new automation request", "replaced");
  }

  const intervalMs = normalizePositiveInt(options.intervalMs, AUTO_INTERVAL_MS);
  const job = {
    jobID: nextJobID++,
    mode,
    structureID: normalizePositiveInt(structureID, 0),
    session: cloneSessionForAutomation(session),
    startedAt: Date.now(),
    lastActionAt: 0,
    lastAction: null,
    prepared: options.prepared === true,
    intervalMs,
    timer: null,
    executeStep,
  };

  if (options.metadata && typeof options.metadata === "object") {
    Object.assign(job, options.metadata);
  }

  job.timer = setInterval(() => {
    runJobNow(job.jobID);
  }, intervalMs);
  if (typeof job.timer.unref === "function") {
    job.timer.unref();
  }

  activeJobs.set(job.jobID, job);
  structureLog.logAutomationEvent(job, `STARTED intervalMs=${intervalMs}`);

  if (options.runImmediately === true) {
    runJobNow(job.jobID);
  }

  return job;
}

function buildDefaultAutoName(typeToken) {
  const normalizedType = String(typeToken || "structure").trim().toLowerCase();
  const suffix = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  return `Auto ${normalizedType} ${suffix}`;
}

function startAutoOnline(session, typeToken, options = {}) {
  const seedResult = structureState.seedStructureForSession(session, typeToken, {
    solarSystemID: getCurrentSolarSystemID(session) || 30000142,
    position: getSeedPosition(session),
    name: String(options.name || "").trim() || buildDefaultAutoName(typeToken),
  });
  if (!seedResult.success) {
    return seedResult;
  }

  syncStructureRuntime(seedResult.data);
  const job = createJob("online", seedResult.data.structureID, session, {});
  const firstStepResult = runJobNow(job.jobID);
  const structure = structureState.getStructureByID(seedResult.data.structureID, { refresh: false });
  return {
    success: true,
    data: {
      job,
      structure,
      firstStepResult,
    },
  };
}

function startAutoDestroy(session, structureID) {
  const structure = structureState.getStructureByID(structureID, { refresh: false });
  if (!structure) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }
  const job = createJob("destroy", structure.structureID, session, {
    prepared: false,
  });
  const firstStepResult = runJobNow(job.jobID);
  return {
    success: true,
    data: {
      job,
      structure: structureState.getStructureByID(structure.structureID, { refresh: false }),
      firstStepResult,
    },
  };
}

function stopAutomation(token) {
  const normalized = String(token || "").trim().toLowerCase();
  if (!normalized) {
    return {
      success: false,
      errorMsg: "STOP_TARGET_REQUIRED",
    };
  }
  if (normalized === "all") {
    const jobs = [...activeJobs.values()];
    for (const job of jobs) {
      stopJobInternal(job, "stopped by /upwellauto stop all", "stopped");
    }
    return {
      success: true,
      data: {
        stoppedCount: jobs.length,
      },
    };
  }

  const numericToken = normalizePositiveInt(token, 0);
  let job = activeJobs.get(numericToken);
  if (!job && numericToken > 0) {
    job = getJobByStructureID(numericToken);
  }
  if (!job) {
    return {
      success: false,
      errorMsg: "JOB_NOT_FOUND",
    };
  }
  return stopJobInternal(job, "stopped by /upwellauto stop", "stopped");
}

function listActiveJobs() {
  return [...activeJobs.values()].map((job) => ({
    jobID: job.jobID,
    mode: job.mode,
    structureID: job.structureID,
    startedAt: job.startedAt,
    lastActionAt: job.lastActionAt,
    lastAction: job.lastAction,
    intervalMs: job.intervalMs,
  }));
}

function clearAllJobs() {
  for (const job of [...activeJobs.values()]) {
    if (job.timer) {
      clearInterval(job.timer);
    }
  }
  activeJobs.clear();
  nextJobID = 1;
}

module.exports = {
  AUTO_INTERVAL_MS,
  startAutoOnline,
  startAutoDestroy,
  createCustomJob,
  stopAutomation,
  listActiveJobs,
  _testing: {
    runJobNow,
    clearAllJobs,
    getJobByStructureID,
    getJobs: () => [...activeJobs.values()],
  },
};
