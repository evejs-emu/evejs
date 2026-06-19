const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const structureState = require(path.join(__dirname, "../structure/structureState"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_STATE_NAME_BY_ID,
} = require(path.join(__dirname, "../structure/structureConstants"));
const {
  getDevelopmentIndicesForSystem,
  getSystemState,
  listAllDevelopmentIndices,
  wipeAllSovereigntyState,
} = require(path.join(__dirname, "./sovState"));
const {
  buildSessionAnchorLayout,
  ensureSessionInSolarSystem,
  findUnclaimedSolarSystem,
  getStructurePositionsForSystem,
  isClaimedSystemState,
  teleportSessionToPrimarySovAnchor,
} = require(path.join(__dirname, "./sovAutoNavigation"));
const {
  anchorSovereigntyStructures,
  buildSovereigntyStatusReport,
  captureSystemForOwner,
  clearSystemSovereignty,
  ensureValidSolarSystem,
  fastForwardSovereigntyTimers,
  loseSystemSovereignty,
  setCampaignScoresForKind,
  setSystemDevelopmentIndexValue,
  setVulnerabilityWindowForKind,
  startCampaignForKind,
} = require(path.join(__dirname, "./sovGmState"));
const {
  getHubIDForSolarSystem,
  getHubUpgrades,
  seedHubFuelForInstalledUpgrades,
  setHubUpgradeInstallations,
} = require(path.join(__dirname, "./sovModernState"));
const {
  DEFAULT_SOV_FLEX_FUEL_HOURS,
  deploySovereigntyFlexStructure,
  getSovereigntyFlexDefinitions,
  seedSovereigntyFlexFuel,
} = require(path.join(__dirname, "./sovFlexStructures"));
const {
  isSovereigntyAuxiliaryStructure,
} = require(path.join(__dirname, "./sovSpaceInterop"));
const {
  MAX_OPERATIONAL_INDEX_POINTS,
  MAX_STRATEGIC_CLAIM_DAYS,
  TYPE_CYNO_SUPPRESSION_UPGRADE,
  TYPE_TENEBREX_CYNO_JAMMER,
  canSolarSystemSupportUpgrade,
  getUpgradeDefinition,
  getLocalSovereigntyResourceCapacity,
} = require(path.join(__dirname, "./sovUpgradeSupport"));
const sovLog = require(path.join(__dirname, "./sovLog"));

const AUTO_INTERVAL_MS = 10000;
const AUTO_VULNERABILITY_SECONDS = 900;
const AUTO_CAMPAIGN_EVENT_TYPE = 7;
const AUTO_VULNERABILITY_FAST_FORWARD_SECONDS = AUTO_VULNERABILITY_SECONDS + 1;
const AUTO_CAMPAIGN_OFFSET_SECONDS = 300;
const AUTO_CAMPAIGN_FAST_FORWARD_SECONDS = AUTO_CAMPAIGN_OFFSET_SECONDS + 1;
const AUTO_STRUCTURE_FAST_FORWARD_SHORT_SECONDS = 901;
const AUTO_STRUCTURE_FAST_FORWARD_LONG_SECONDS = 86_401;
const AUTO_TAKEOVER_SCORES = Object.freeze({ 1: 25, 2: 75 });
const AUTO_LOSS_SCORES = Object.freeze({ 1: 0, 2: 100 });
const JAMMER_OFFSET = Object.freeze({ x: 50_000, y: 0, z: 40_000 });
const AUTO_SHOWCASE_FLEX_DEFINITIONS = Object.freeze(
  getSovereigntyFlexDefinitions("all").map((definition) => Object.freeze({ ...definition })),
);

let nextJobID = 1;
const activeJobs = new Map();

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = normalizeInteger(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneSessionForAutomation(session) {
  return {
    clientID: normalizePositiveInteger(session && session.clientID, 0),
    characterID: normalizePositiveInteger(
      session && (session.characterID || session.charid || session.userid),
      0,
    ),
    charid: normalizePositiveInteger(
      session && (session.charid || session.characterID || session.userid),
      0,
    ),
    userid: normalizePositiveInteger(
      session && (session.userid || session.userID || session.characterID),
      0,
    ),
    corporationID: normalizePositiveInteger(
      session && (session.corporationID || session.corpid),
      0,
    ),
    corpid: normalizePositiveInteger(
      session && (session.corpid || session.corporationID),
      0,
    ),
    allianceID: normalizePositiveInteger(
      session && (session.allianceID || session.allianceid),
      0,
    ),
    allianceid: normalizePositiveInteger(
      session && (session.allianceid || session.allianceID),
      0,
    ),
    solarsystemid2: normalizePositiveInteger(session && session.solarsystemid2, 0),
    solarsystemid: normalizePositiveInteger(session && session.solarsystemid, 0),
  };
}

function clonePoint(value, fallback = null) {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return fallback;
  }
  return { x, y, z };
}

function addPoint(left, right) {
  const leftPoint = clonePoint(left, null);
  const rightPoint = clonePoint(right, null);
  if (!leftPoint || !rightPoint) {
    return null;
  }
  return {
    x: leftPoint.x + rightPoint.x,
    y: leftPoint.y + rightPoint.y,
    z: leftPoint.z + rightPoint.z,
  };
}

function formatPoint(value) {
  const point = clonePoint(value, null);
  if (!point) {
    return "unknown position";
  }
  return `${Math.round(point.x)},${Math.round(point.y)},${Math.round(point.z)}`;
}

function getCurrentSystemOwner(job) {
  const system = getSystemState(job.solarSystemID) || {};
  return {
    allianceID:
      normalizePositiveInteger(system.allianceID, null) ||
      normalizePositiveInteger(job.targetAllianceID, null) ||
      normalizePositiveInteger(job.nextAllianceID, null),
    corporationID:
      normalizePositiveInteger(system.corporationID, null) ||
      normalizePositiveInteger(job.targetCorporationID, null) ||
      normalizePositiveInteger(job.nextCorporationID, null),
  };
}

function buildOwnershipIdentity(job) {
  const owner = getCurrentSystemOwner(job);
  return {
    characterID: normalizePositiveInteger(job.session && job.session.characterID, 0) || 0,
    allianceID: owner.allianceID || 0,
    corporationID: owner.corporationID || 0,
    solarSystemID: normalizePositiveInteger(job.solarSystemID, 0) || 0,
  };
}

function getSolarSystemLabel(solarSystemID) {
  const solarSystem = worldData.getSolarSystemByID(
    normalizePositiveInteger(solarSystemID, 0),
  );
  return solarSystem && (solarSystem.solarSystemName || solarSystem.itemName)
    ? `${solarSystem.solarSystemName || solarSystem.itemName}(${solarSystem.solarSystemID})`
    : `System ${solarSystemID}`;
}

function getFlexShowcaseDefinitionsForJob(job, options = {}) {
  const includeTenebrex = options.includeTenebrex !== false;
  const supportedDefinitions =
    Array.isArray(job && job.showcaseDefinitions) && job.showcaseDefinitions.length > 0
      ? job.showcaseDefinitions
      : AUTO_SHOWCASE_FLEX_DEFINITIONS.filter((definition) => (
        canSolarSystemSupportUpgrade(
          job && job.solarSystemID,
          definition.requiredUpgradeTypeID,
        )
      ));
  return includeTenebrex
    ? supportedDefinitions
    : supportedDefinitions.filter((definition) => definition.kind !== "tenebrex");
}

function buildFlexShowcaseSummary(job) {
  const labels = getFlexShowcaseDefinitionsForJob(job).map((definition) => definition.label);
  if (labels.length === 0) {
    return "No Sov flex structures were supported by this system's local resource capacity.";
  }
  if (labels.length === 1) {
    return `${labels[0]} is online and fueled.`;
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]} are online and fueled.`;
}

function getJobBySolarSystemID(solarSystemID) {
  const targetSolarSystemID = normalizePositiveInteger(solarSystemID, 0);
  for (const job of activeJobs.values()) {
    if (normalizePositiveInteger(job.solarSystemID, 0) === targetSolarSystemID) {
      return job;
    }
  }
  return null;
}

function syncStructureRuntime(structureOrSystemID) {
  const solarSystemID =
    typeof structureOrSystemID === "object" && structureOrSystemID !== null
      ? normalizePositiveInteger(structureOrSystemID.solarSystemID, 0)
      : normalizePositiveInteger(structureOrSystemID, 0);
  if (!solarSystemID) {
    return;
  }
  if (typeof spaceRuntime.syncStructureSceneState === "function") {
    spaceRuntime.syncStructureSceneState(solarSystemID);
  }
}

function sendJobFeedback(job, message) {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage || !job || !job.chatHub || !job.liveSession) {
    return;
  }
  job.chatHub.sendSystemMessage(
    job.liveSession,
    `[SOVAUTO ${job.jobID}] ${normalizedMessage}`,
  );
}

function stopJobInternal(job, reason, status = "stopped") {
  if (!job) {
    return null;
  }
  if (job.timer) {
    clearInterval(job.timer);
  }
  activeJobs.delete(job.jobID);
  sovLog.logAutomationEvent(
    job,
    `${status.toUpperCase()} ${reason}`,
    status === "failed" ? "ERR" : "INF",
  );
  if (status === "completed") {
    sendJobFeedback(job, `Done. ${reason}`);
  } else if (status === "failed") {
    sendJobFeedback(job, `Failed. ${reason}`);
  } else if (status === "stopped") {
    sendJobFeedback(job, `Stopped. ${reason}`);
  }
  return {
    success: true,
    data: {
      ...job,
      status,
      reason,
    },
  };
}

function buildJobSummary(job) {
  return [
    `job=${job.jobID}`,
    `mode=${job.mode}`,
    `system=${job.solarSystemID}`,
    `step=${job.step}`,
    `last=${job.lastAction || "none"}`,
  ].join(" | ");
}

function applyAutomationStep(job, actionLabel, fn, options = {}) {
  const announceBefore =
    typeof options.before === "function"
      ? options.before()
      : options.before;
  if (announceBefore) {
    sendJobFeedback(job, announceBefore);
  }

  let result = null;
  try {
    result = fn();
  } catch (error) {
    sovLog.logAutomationEvent(
      job,
      `${actionLabel} threw ${error.stack || error.message}`,
      "ERR",
    );
    stopJobInternal(job, `${actionLabel} threw ${error.message}`, "failed");
    return {
      success: false,
      errorMsg: error.message || "AUTOMATION_STEP_THROW",
    };
  }

  if (!result || result.success !== true) {
    const errorMsg = result && result.errorMsg ? result.errorMsg : "UNKNOWN_ERROR";
    sovLog.logAutomationEvent(job, `${actionLabel} failed error=${errorMsg}`, "ERR");
    stopJobInternal(job, `${actionLabel} failed: ${errorMsg}`, "failed");
    return {
      success: false,
      errorMsg,
    };
  }

  job.lastAction = actionLabel;
  job.lastActionAt = Date.now();
  sovLog.logAutomationEvent(
    job,
    `${actionLabel} ok ${JSON.stringify(buildSovereigntyStatusReport(job.solarSystemID))}`,
  );

  const announceAfter =
    typeof options.after === "function"
      ? options.after(result.data)
      : options.after;
  if (announceAfter) {
    sendJobFeedback(job, announceAfter);
  }
  return {
    success: true,
    data: result.data,
  };
}

function ensureClaimedSystem(job) {
  const currentSystem = getSystemState(job.solarSystemID) || null;
  if (
    !currentSystem ||
    !normalizePositiveInteger(currentSystem.allianceID, null) ||
    !normalizePositiveInteger(currentSystem.claimStructureID, null) ||
    !normalizePositiveInteger(currentSystem.infrastructureHubID, null)
  ) {
    return {
      success: false,
      errorMsg: "CLAIMED_SYSTEM_REQUIRED",
    };
  }
  return {
    success: true,
    data: currentSystem,
  };
}

function ensureUnclaimedSystem(job) {
  const currentSystem = getSystemState(job.solarSystemID) || null;
  if (isClaimedSystemState(currentSystem)) {
    return {
      success: false,
      errorMsg: "UNCLAIMED_SYSTEM_REQUIRED",
    };
  }
  return {
    success: true,
    data: currentSystem,
  };
}

function travelSessionForJob(job) {
  return ensureSessionInSolarSystem(job.liveSession || null, job.solarSystemID);
}

function focusSessionForJob(job) {
  return teleportSessionToPrimarySovAnchor(job.liveSession || null, job.solarSystemID);
}

function focusSessionOnStructure(job, structureID) {
  const structure = structureState.getStructureByID(structureID, { refresh: false });
  if (!structure || !job.liveSession) {
    return {
      success: true,
      data: {
        skipped: true,
      },
    };
  }
  const point = clonePoint(structure.position, null);
  if (!point) {
    return {
      success: false,
      errorMsg: "STRUCTURE_POSITION_NOT_FOUND",
    };
  }
  const shipEntity = job.liveSession._space
    ? spaceRuntime.getEntity(job.liveSession, job.liveSession._space.shipID)
    : null;
  const direction = clonePoint(shipEntity && shipEntity.direction, { x: 1, y: 0, z: 0 }) || {
    x: 1,
    y: 0,
    z: 0,
  };
  return spaceRuntime.teleportSessionShipToPoint(job.liveSession, point, {
    direction,
    refreshOwnerSession: true,
  });
}

function anchorClaimForJob(job, kind) {
  const layout = buildSessionAnchorLayout(job.liveSession || null, job.solarSystemID);
  const anchorResult = anchorSovereigntyStructures(
    job.solarSystemID,
    kind,
    job.targetAllianceID,
    job.targetCorporationID,
    {
      positionsByKind: layout.positionsByKind,
    },
  );
  if (!anchorResult.success) {
    return anchorResult;
  }
  return {
    success: true,
    data: {
      ...anchorResult.data,
      positionsByKind: getStructurePositionsForSystem(job.solarSystemID).positionsByKind,
    },
  };
}

function maxIndicesForJob(job) {
  const indexOps = [
    ["military", MAX_OPERATIONAL_INDEX_POINTS],
    ["industrial", MAX_OPERATIONAL_INDEX_POINTS],
    ["strategic", 5],
    ["claimed", MAX_STRATEGIC_CLAIM_DAYS],
  ];
  for (const [indexKind, value] of indexOps) {
    const result = setSystemDevelopmentIndexValue(job.solarSystemID, indexKind, value);
    if (!result.success) {
      return result;
    }
  }
  return {
    success: true,
    data: {
      solarSystemID: job.solarSystemID,
      militaryPoints: MAX_OPERATIONAL_INDEX_POINTS,
      industrialPoints: MAX_OPERATIONAL_INDEX_POINTS,
      claimedForDays: MAX_STRATEGIC_CLAIM_DAYS,
    },
  };
}

function maxAndVerifyIndicesForJob(job) {
  const maxResult = maxIndicesForJob(job);
  if (!maxResult.success) {
    return maxResult;
  }

  const perSystemIndices = getDevelopmentIndicesForSystem(job.solarSystemID) || {};
  const allDevelopmentIndices = Array.isArray(listAllDevelopmentIndices())
    ? listAllDevelopmentIndices()
    : [];
  const summaryRow = allDevelopmentIndices.find(
    (row) => normalizePositiveInteger(row && row.solarSystemID, null) === job.solarSystemID,
  ) || null;

  const militaryPoints = Number(
    perSystemIndices[1583] && perSystemIndices[1583].points,
  ) || 0;
  const industrialPoints = Number(
    perSystemIndices[1584] && perSystemIndices[1584].points,
  ) || 0;
  const claimedForSeconds = Number(
    perSystemIndices[1615] && perSystemIndices[1615].points,
  ) || 0;

  if (
    !summaryRow ||
    militaryPoints !== MAX_OPERATIONAL_INDEX_POINTS ||
    industrialPoints !== MAX_OPERATIONAL_INDEX_POINTS ||
    Number(summaryRow.militaryPoints || 0) !== MAX_OPERATIONAL_INDEX_POINTS ||
    Number(summaryRow.industrialPoints || 0) !== MAX_OPERATIONAL_INDEX_POINTS ||
    Number(summaryRow.claimedFor || 0) !== MAX_STRATEGIC_CLAIM_DAYS ||
    claimedForSeconds !== MAX_STRATEGIC_CLAIM_DAYS * 86400
  ) {
    return {
      success: false,
      errorMsg: "CLIENT_DEVELOPMENT_INDICES_OUT_OF_SYNC",
    };
  }

  return {
    success: true,
    data: {
      ...maxResult.data,
      summaryRow,
      perSystemIndices,
    },
  };
}

function enableCynoSuppressionForJob(job) {
  const hubID = normalizePositiveInteger(getHubIDForSolarSystem(job.solarSystemID), null);
  if (!hubID) {
    return {
      success: false,
      errorMsg: "HUB_NOT_FOUND",
    };
  }

  if (!canSolarSystemSupportUpgrade(job.solarSystemID, TYPE_CYNO_SUPPRESSION_UPGRADE)) {
    return {
      success: true,
      data: {
        skipped: true,
        reason: "INSUFFICIENT_LOCAL_CAPACITY",
        hubID,
        capacity: getLocalSovereigntyResourceCapacity(job.solarSystemID),
        definition: getUpgradeDefinition(TYPE_CYNO_SUPPRESSION_UPGRADE),
      },
    };
  }

  const upgradeResult = setHubUpgradeInstallations(
    hubID,
    [{ typeID: TYPE_CYNO_SUPPRESSION_UPGRADE, online: true }],
    buildOwnershipIdentity(job),
  );
  if (!upgradeResult.ok) {
    return {
      success: false,
      errorMsg: upgradeResult.errorCode || "UPGRADE_CONFIGURATION_FAILED",
    };
  }
  const upgrades = getHubUpgrades(hubID, buildOwnershipIdentity(job));
  const jammerUpgrade = upgrades && Array.isArray(upgrades.upgrades)
    ? upgrades.upgrades.find(
      (entry) => Number(entry && entry.typeID) === TYPE_CYNO_SUPPRESSION_UPGRADE,
    ) || null
    : null;
  if (!jammerUpgrade || Number(jammerUpgrade.powerState) !== 2) {
    return {
      success: true,
      data: {
        skipped: true,
        reason: "LOW_POWER_OR_WORKFORCE",
        hubID,
      },
    };
  }
  const fuelResult = seedHubFuelForInstalledUpgrades(
    hubID,
    DEFAULT_SOV_FLEX_FUEL_HOURS,
    buildOwnershipIdentity(job),
  );
  return {
    success: true,
    data: {
      hubID,
      upgrade: jammerUpgrade,
      fuel: fuelResult && fuelResult.ok ? fuelResult : null,
    },
  };
}

function enableRequiredCynoSuppressionForJob(job) {
  const result = enableCynoSuppressionForJob(job);
  if (!result.success) {
    return result;
  }
  if (result.data && result.data.skipped) {
    return {
      success: false,
      errorMsg: result.data.reason || "CYNO_SUPPRESSION_UNAVAILABLE",
    };
  }
  return result;
}

function buildJammerSeedPosition(job) {
  const positions = getStructurePositionsForSystem(job.solarSystemID);
  const basePoint = clonePoint(
    positions.positionsByKind.ihub || positions.positionsByKind.tcu,
    null,
  );
  if (basePoint) {
    return addPoint(basePoint, JAMMER_OFFSET);
  }
  const layout = buildSessionAnchorLayout(job.liveSession || null, job.solarSystemID);
  return addPoint(layout.primaryPoint, JAMMER_OFFSET);
}

function ensureJammerSeeded(job) {
  if (job.jammerStructureID) {
    const structure = structureState.getStructureByID(job.jammerStructureID, { refresh: false });
    if (structure) {
      return {
        success: true,
        data: structure,
      };
    }
    job.jammerStructureID = null;
  }

  const owner = getCurrentSystemOwner(job);
  const seedResult = structureState.seedStructureForSession(
    job.liveSession || job.session,
    TYPE_TENEBREX_CYNO_JAMMER,
    {
      solarSystemID: job.solarSystemID,
      ownerCorpID: owner.corporationID,
      allianceID: owner.allianceID,
      position: buildJammerSeedPosition(job),
      name: `Auto Tenebrex ${job.solarSystemID}`,
      devFlags: {
        sovAutomation: true,
        sovereigntyAuxiliary: "tenebrex",
        sovereigntyFlex: true,
        sovereigntyFlexKind: "tenebrex",
        sovAutoJobID: job.jobID,
      },
    },
  );
  if (!seedResult.success) {
    return seedResult;
  }
  syncStructureRuntime(seedResult.data);
  job.jammerStructureID = seedResult.data.structureID;
  return {
    success: true,
    data: seedResult.data,
  };
}

function advanceStructureTimers(structureID, seconds) {
  const result = structureState.fastForwardStructure(structureID, seconds);
  if (!result.success) {
    return result;
  }
  structureState.tickStructures(Date.now());
  const structure = structureState.getStructureByID(structureID, { refresh: false });
  syncStructureRuntime(structure || result.data);
  return {
    success: true,
    data: structure || result.data,
  };
}

function startJammerAnchoring(job) {
  const seedResult = ensureJammerSeeded(job);
  if (!seedResult.success) {
    return seedResult;
  }
  const result = structureState.startAnchoring(seedResult.data.structureID);
  if (!result.success) {
    return result;
  }
  syncStructureRuntime(result.data);
  return result;
}

function fastForwardJammerShort(job) {
  return advanceStructureTimers(job.jammerStructureID, AUTO_STRUCTURE_FAST_FORWARD_SHORT_SECONDS);
}

function fastForwardJammerLong(job) {
  return advanceStructureTimers(job.jammerStructureID, AUTO_STRUCTURE_FAST_FORWARD_LONG_SECONDS);
}

function installJammerCore(job) {
  const result = structureState.setStructureQuantumCoreInstalled(
    job.jammerStructureID,
    true,
  );
  if (!result.success) {
    return result;
  }
  syncStructureRuntime(result.data);
  return result;
}

function onlineJammerService(job) {
  const serviceResult = structureState.setStructureServiceState(
    job.jammerStructureID,
    STRUCTURE_SERVICE_ID.CYNO_JAMMER,
    STRUCTURE_SERVICE_STATE.ONLINE,
  );
  if (!serviceResult.success) {
    return serviceResult;
  }
  syncStructureRuntime(serviceResult.data);
  const onlineResult = advanceStructureTimers(
    job.jammerStructureID,
    AUTO_STRUCTURE_FAST_FORWARD_SHORT_SECONDS,
  );
  if (!onlineResult.success) {
    return onlineResult;
  }
  const fuelResult = seedSovereigntyFlexFuel(
    job.jammerStructureID,
    DEFAULT_SOV_FLEX_FUEL_HOURS,
  );
  if (!fuelResult.success) {
    return fuelResult;
  }
  return {
    success: true,
    data: fuelResult.data,
  };
}

function deployFlexStructureForJob(job, definition) {
  const deployResult = deploySovereigntyFlexStructure(
    job.liveSession || job.session,
    definition.kind,
    {
      solarSystemID: job.solarSystemID,
      allianceID: job.targetAllianceID,
      corporationID: job.targetCorporationID,
      fuelHours: DEFAULT_SOV_FLEX_FUEL_HOURS,
      reuseExisting: false,
      devFlags: {
        sovAutomation: true,
        sovereigntyAuxiliary: definition.kind,
        sovereigntyFlex: true,
        sovereigntyFlexKind: definition.kind,
        sovAutoJobID: job.jobID,
      },
    },
  );
  if (!deployResult.success) {
    return deployResult;
  }
  const structure =
    deployResult.data && deployResult.data.structure
      ? deployResult.data.structure
      : null;
  if (structure && normalizePositiveInteger(structure.structureID, null)) {
    job.flexStructureIDs = {
      ...(job.flexStructureIDs || {}),
      [definition.kind]: structure.structureID,
    };
    if (definition.kind === "tenebrex") {
      job.jammerStructureID = structure.structureID;
    }
  }
  return deployResult;
}

function focusSessionOnFlexKind(job, kind) {
  const structureID = normalizePositiveInteger(
    job &&
      job.flexStructureIDs &&
      job.flexStructureIDs[String(kind || "").trim().toLowerCase()],
    null,
  );
  if (!structureID) {
    return {
      success: false,
      errorMsg: "FLEX_STRUCTURE_NOT_FOUND",
    };
  }
  return focusSessionOnStructure(job, structureID);
}

function clearAutomationStructuresForSystem(job) {
  const structures = structureState.listStructuresForSystem(job.solarSystemID, {
    includeDestroyed: true,
    refresh: false,
  }).filter((structure) => isSovereigntyAuxiliaryStructure(structure));
  const removedStructureIDs = [];
  for (const structure of structures) {
    const removeResult = structureState.removeStructure(structure.structureID);
    if (!removeResult.success) {
      return removeResult;
    }
    removedStructureIDs.push(structure.structureID);
  }
  if (removedStructureIDs.length > 0) {
    syncStructureRuntime(job.solarSystemID);
  }
  job.flexStructureIDs = {};
  job.jammerStructureID = null;
  return {
    success: true,
    data: {
      removedStructureIDs,
    },
  };
}

function runPostCaptureSequence(job, baseStep, completionReason) {
  const relativeStep = job.step - baseStep;
  const showcaseDefinitions = getFlexShowcaseDefinitionsForJob(job);
  const nonJammerDefinitions = showcaseDefinitions.filter(
    (definition) => definition.kind !== "tenebrex",
  );
  const supportsTenebrex = showcaseDefinitions.some(
    (definition) => definition.kind === "tenebrex",
  );

  const postCaptureSteps = [
    {
      actionLabel: `/tr me sovanchor ${job.solarSystemID}`,
      run: () => focusSessionForJob(job),
      before: `Landing on the sovereignty anchor in ${getSolarSystemLabel(job.solarSystemID)}.`,
      after: () => `On grid with the Sov Hub and TCU in ${getSolarSystemLabel(job.solarSystemID)}.`,
    },
    {
      actionLabel: `/sov index strategic=5 military=${MAX_OPERATIONAL_INDEX_POINTS} industrial=${MAX_OPERATIONAL_INDEX_POINTS}`,
      run: () => maxAndVerifyIndicesForJob(job),
      before: `Maxing military, industrial, and strategic indices in ${getSolarSystemLabel(job.solarSystemID)}.`,
      after: () => "Client-facing development-index payloads now report military V, industrial V, and strategic V.",
    },
    {
      actionLabel: `/upwell purge sov auxiliaries ${job.solarSystemID}`,
      run: () => clearAutomationStructuresForSystem(job),
      before: "Removing stale sovereignty flex structures before the showcase run.",
      after: (data) => (
        data && Array.isArray(data.removedStructureIDs) && data.removedStructureIDs.length > 0
          ? `Removed ${data.removedStructureIDs.length} stale sovereignty auxiliary structure${data.removedStructureIDs.length === 1 ? "" : "s"} before deploying the showcase set.`
          : "No stale sovereignty auxiliary structures were present in the target system."
      ),
    },
  ];

  for (const definition of nonJammerDefinitions) {
    postCaptureSteps.push({
      actionLabel: `/sov deploy ${definition.kind} ${job.solarSystemID}`,
      run: () => deployFlexStructureForJob(job, definition),
      before: `Deploying ${definition.label} and bringing its required Sov Hub upgrade online.`,
      after: (data) => {
        const structure =
          data && data.structure
            ? data.structure
            : data;
        return `${definition.label} is anchored, online, and fueled at ${formatPoint(structure && structure.position)}.`;
      },
    });
    postCaptureSteps.push({
      actionLabel: `/tr me ${definition.kind}`,
      run: () => focusSessionOnFlexKind(job, definition.kind),
      before: `Landing on the ${definition.label}.`,
      after: () => `On grid with the live ${definition.label}.`,
    });
  }

  if (supportsTenebrex) {
    postCaptureSteps.push(
      {
        actionLabel: `/sovhub install ${TYPE_CYNO_SUPPRESSION_UPGRADE}`,
        run: () => enableRequiredCynoSuppressionForJob(job),
        before: `Configuring Sov Hub Cynosural Suppression for ${getSolarSystemLabel(job.solarSystemID)}.`,
        after: () => "Sov Hub Cynosural Suppression is online and its fuel reserve has been seeded for the automation run.",
      },
      {
        actionLabel: `/upwell seed ${TYPE_TENEBREX_CYNO_JAMMER}`,
        run: () => ensureJammerSeeded(job),
        before: "Deploying a Tenebrex Cyno Jammer near the Sov Hub.",
        after: (structure) => `Tenebrex Cyno Jammer ${structure.structureID} deployed at ${formatPoint(structure.position)}.`,
      },
      {
        actionLabel: `/upwell anchor ${job.jammerStructureID}`,
        run: () => startJammerAnchoring(job),
        before: "Beginning Tenebrex anchoring.",
        after: (structure) => `Tenebrex anchoring started: ${STRUCTURE_STATE_NAME_BY_ID[normalizeInteger(structure && structure.state, 0)] || "unknown"}.`,
      },
      {
        actionLabel: `/upwell ff ${job.jammerStructureID} ${AUTO_STRUCTURE_FAST_FORWARD_SHORT_SECONDS}`,
        run: () => fastForwardJammerShort(job),
        before: "Fast-forwarding the Tenebrex deploy vulnerability window.",
        after: (structure) => `Tenebrex advanced to ${STRUCTURE_STATE_NAME_BY_ID[normalizeInteger(structure && structure.state, 0)] || "unknown"}.`,
      },
      {
        actionLabel: `/upwell ff ${job.jammerStructureID} ${AUTO_STRUCTURE_FAST_FORWARD_LONG_SECONDS}`,
        run: () => fastForwardJammerLong(job),
        before: "Fast-forwarding the Tenebrex anchoring timer.",
        after: (structure) => `Tenebrex anchoring wait cleared: ${STRUCTURE_STATE_NAME_BY_ID[normalizeInteger(structure && structure.state, 0)] || "unknown"}.`,
      },
      {
        actionLabel: `/upwell core ${job.jammerStructureID} on`,
        run: () => installJammerCore(job),
        before: "Installing the Tenebrex quantum core and moving into onlining.",
        after: (structure) => `Tenebrex is ${STRUCTURE_STATE_NAME_BY_ID[normalizeInteger(structure && structure.state, 0)] || "unknown"}.`,
      },
      {
        actionLabel: `/upwell service ${job.jammerStructureID} cyno_jammer online`,
        run: () => onlineJammerService(job),
        before: "Onlining the Tenebrex cyno jammer service.",
        after: (structure) => `Tenebrex is now ${STRUCTURE_STATE_NAME_BY_ID[normalizeInteger(structure && structure.state, 0)] || "unknown"} with the cyno jammer service online and liquid ozone loaded.`,
      },
      {
        actionLabel: `/tr me ${job.jammerStructureID}`,
        run: () => focusSessionOnStructure(job, job.jammerStructureID),
        before: "Landing on the Tenebrex Cyno Jammer.",
        after: () => "On grid with the live cyno jammer.",
      },
    );
  }

  const step = postCaptureSteps[relativeStep];
  if (!step) {
    return stopJobInternal(job, "automation ran out of post-capture steps", "failed");
  }

  const result = applyAutomationStep(
    job,
    step.actionLabel,
    step.run,
    {
      before: step.before,
      after: step.after,
    },
  );
  if (!result.success) {
    return result;
  }

  job.step += 1;
  if (relativeStep === postCaptureSteps.length - 1) {
    return stopJobInternal(
      job,
      `${completionReason} ${buildFlexShowcaseSummary(job)}`,
      "completed",
    );
  }
  return result;
}

function executeClaimStep(job) {
  if (job.step === 0) {
    const result = applyAutomationStep(
      job,
      `/solar ${job.solarSystemID}`,
      () => travelSessionForJob(job),
      {
        before: `Jumping to unclaimed target ${getSolarSystemLabel(job.solarSystemID)}.`,
        after: () => `Arrived in ${getSolarSystemLabel(job.solarSystemID)}.`,
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 1) {
    const claimCheck = ensureUnclaimedSystem(job);
    if (!claimCheck.success) {
      return stopJobInternal(
        job,
        "claim automation requires an unclaimed system; use /sovauto takeover for hostile systems",
        "failed",
      );
    }
    const result = applyAutomationStep(
      job,
      `/sov anchor tcu ${job.solarSystemID} ${job.targetAllianceID} ${job.targetCorporationID}`,
      () => anchorClaimForJob(job, "tcu"),
      {
        before: `Deploying the Territorial Claim Unit in ${getSolarSystemLabel(job.solarSystemID)}.`,
        after: (data) => `Territorial Claim Unit anchored at ${formatPoint(data && data.positionsByKind && data.positionsByKind.tcu)}.`,
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 2) {
    const result = applyAutomationStep(
      job,
      `/tr me sovanchor ${job.solarSystemID}`,
      () => focusSessionForJob(job),
      {
        before: "Landing on the Territorial Claim Unit.",
        after: () => "On grid with the Territorial Claim Unit.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 3) {
    const result = applyAutomationStep(
      job,
      `/sov anchor ihub ${job.solarSystemID} ${job.targetAllianceID} ${job.targetCorporationID}`,
      () => anchorClaimForJob(job, "ihub"),
      {
        before: `Deploying the Sov Hub in ${getSolarSystemLabel(job.solarSystemID)}.`,
        after: (data) => `Sov Hub anchored at ${formatPoint(data && data.positionsByKind && data.positionsByKind.ihub)}.`,
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  return runPostCaptureSequence(
    job,
    4,
    `Claim automation completed in ${getSolarSystemLabel(job.solarSystemID)}.`,
  );
}

function executeTakeoverStep(job) {
  const claimCheck = ensureClaimedSystem(job);
  if (!claimCheck.success) {
    return stopJobInternal(
      job,
      "takeover automation requires an already-claimed system; use /sovauto claim first",
      "failed",
    );
  }

  const currentSystem = claimCheck.data;
  if (
    job.step === 0 &&
    normalizePositiveInteger(currentSystem.allianceID, 0) === job.targetAllianceID &&
    normalizePositiveInteger(currentSystem.corporationID, 0) === job.targetCorporationID
  ) {
    return stopJobInternal(job, "system is already owned by the takeover target", "completed");
  }

  if (job.step === 0) {
    const result = applyAutomationStep(
      job,
      `/solar ${job.solarSystemID}`,
      () => travelSessionForJob(job),
      {
        before: `Jumping to hostile target ${getSolarSystemLabel(job.solarSystemID)}.`,
        after: () => `Arrived in ${getSolarSystemLabel(job.solarSystemID)}.`,
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 1) {
    const result = applyAutomationStep(
      job,
      `/tr me sovanchor ${job.solarSystemID}`,
      () => focusSessionForJob(job),
      {
        before: "Landing on the current sovereignty anchor.",
        after: () => "On grid with the defender sovereignty structures.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 2) {
    const result = applyAutomationStep(
      job,
      `/sov vuln both ${AUTO_VULNERABILITY_SECONDS} ${job.solarSystemID}`,
      () => setVulnerabilityWindowForKind(
        job.solarSystemID,
        "both",
        AUTO_VULNERABILITY_SECONDS,
      ),
      {
        before: "Opening sovereignty vulnerability windows.",
        after: () => "TCU and Sov Hub are now vulnerable.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 3) {
    const result = applyAutomationStep(
      job,
      `/sov ff ${AUTO_VULNERABILITY_FAST_FORWARD_SECONDS} ${job.solarSystemID}`,
      () => fastForwardSovereigntyTimers(
        job.solarSystemID,
        AUTO_VULNERABILITY_FAST_FORWARD_SECONDS,
      ),
      {
        before: "Fast-forwarding the vulnerability timer.",
        after: () => "The sovereignty capture timer is ready.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 4) {
    const result = applyAutomationStep(
      job,
      `/sov campaign ihub ${AUTO_CAMPAIGN_EVENT_TYPE} ${AUTO_CAMPAIGN_OFFSET_SECONDS} ${job.solarSystemID}`,
      () => startCampaignForKind(
        job.solarSystemID,
        "ihub",
        AUTO_CAMPAIGN_EVENT_TYPE,
        AUTO_CAMPAIGN_OFFSET_SECONDS,
      ),
      {
        before: "Starting the Sov Hub capture campaign.",
        after: () => "Sov Hub campaign started.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 5) {
    const result = applyAutomationStep(
      job,
      `/sov ff ${AUTO_CAMPAIGN_FAST_FORWARD_SECONDS} ${job.solarSystemID}`,
      () => fastForwardSovereigntyTimers(
        job.solarSystemID,
        AUTO_CAMPAIGN_FAST_FORWARD_SECONDS,
      ),
      {
        before: "Fast-forwarding the campaign start timer.",
        after: () => "Campaign nodes are ready to score.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 6) {
    const result = applyAutomationStep(
      job,
      `/sov score ihub 1=${AUTO_TAKEOVER_SCORES[1]} 2=${AUTO_TAKEOVER_SCORES[2]}`,
      () => setCampaignScoresForKind(
        job.solarSystemID,
        "ihub",
        AUTO_TAKEOVER_SCORES,
      ),
      {
        before: "Applying attacker-leaning campaign scores.",
        after: () => "Attackers now control the Sov Hub score.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 7) {
    const result = applyAutomationStep(
      job,
      `/sov capture ${job.targetAllianceID} ${job.targetCorporationID} ${job.solarSystemID}`,
      () => captureSystemForOwner(
        job.solarSystemID,
        job.targetAllianceID,
        job.targetCorporationID,
      ),
      {
        before: `Capturing ${getSolarSystemLabel(job.solarSystemID)} for alliance ${job.targetAllianceID}.`,
        after: () => "System ownership has changed to the takeover target.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  return runPostCaptureSequence(
    job,
    8,
    `Takeover automation completed in ${getSolarSystemLabel(job.solarSystemID)}.`,
  );
}

function executeLossStep(job) {
  const claimCheck = ensureClaimedSystem(job);
  if (!claimCheck.success) {
    return stopJobInternal(
      job,
      "loss automation requires an already-claimed system; use /sovauto claim first",
      "failed",
    );
  }

  if (job.step === 0) {
    const result = applyAutomationStep(
      job,
      `/solar ${job.solarSystemID}`,
      () => travelSessionForJob(job),
      {
        before: `Jumping to ${getSolarSystemLabel(job.solarSystemID)} for sovereignty loss automation.`,
        after: () => `Arrived in ${getSolarSystemLabel(job.solarSystemID)}.`,
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 1) {
    const result = applyAutomationStep(
      job,
      `/tr me sovanchor ${job.solarSystemID}`,
      () => focusSessionForJob(job),
      {
        before: "Landing on the sovereignty anchor.",
        after: () => "On grid with the sovereignty structures.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 2) {
    const result = applyAutomationStep(
      job,
      `/sov vuln both ${AUTO_VULNERABILITY_SECONDS} ${job.solarSystemID}`,
      () => setVulnerabilityWindowForKind(
        job.solarSystemID,
        "both",
        AUTO_VULNERABILITY_SECONDS,
      ),
      {
        before: "Opening sovereignty vulnerability windows.",
        after: () => "TCU and Sov Hub are now vulnerable.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 3) {
    const result = applyAutomationStep(
      job,
      `/sov ff ${AUTO_VULNERABILITY_FAST_FORWARD_SECONDS} ${job.solarSystemID}`,
      () => fastForwardSovereigntyTimers(
        job.solarSystemID,
        AUTO_VULNERABILITY_FAST_FORWARD_SECONDS,
      ),
      {
        before: "Fast-forwarding the vulnerability timer.",
        after: () => "Loss campaign can now begin.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 4) {
    const result = applyAutomationStep(
      job,
      `/sov campaign ihub ${AUTO_CAMPAIGN_EVENT_TYPE} ${AUTO_CAMPAIGN_OFFSET_SECONDS} ${job.solarSystemID}`,
      () => startCampaignForKind(
        job.solarSystemID,
        "ihub",
        AUTO_CAMPAIGN_EVENT_TYPE,
        AUTO_CAMPAIGN_OFFSET_SECONDS,
      ),
      {
        before: "Starting the Sov Hub loss campaign.",
        after: () => "Loss campaign started.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 5) {
    const result = applyAutomationStep(
      job,
      `/sov ff ${AUTO_CAMPAIGN_FAST_FORWARD_SECONDS} ${job.solarSystemID}`,
      () => fastForwardSovereigntyTimers(
        job.solarSystemID,
        AUTO_CAMPAIGN_FAST_FORWARD_SECONDS,
      ),
      {
        before: "Fast-forwarding the loss campaign timer.",
        after: () => "Defender-loss scoring is ready.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 6) {
    const result = applyAutomationStep(
      job,
      `/sov score ihub 1=${AUTO_LOSS_SCORES[1]} 2=${AUTO_LOSS_SCORES[2]}`,
      () => setCampaignScoresForKind(
        job.solarSystemID,
        "ihub",
        AUTO_LOSS_SCORES,
      ),
      {
        before: "Applying defender-loss campaign scores.",
        after: () => "The current owner has now lost the Sov Hub score.",
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 7) {
    const result = applyAutomationStep(
      job,
      `/upwell remove sov flex showcase structures`,
      () => clearAutomationStructuresForSystem(job),
      {
        before: "Removing sovereignty flex and automation auxiliaries from space.",
        after: (data) => (
          data && Array.isArray(data.removedStructureIDs) && data.removedStructureIDs.length > 0
            ? `Removed ${data.removedStructureIDs.length} sovereignty auxiliary structure${data.removedStructureIDs.length === 1 ? "" : "s"}.`
            : "No sovereignty auxiliary structures were left to remove."
        ),
      },
    );
    if (result.success) {
      job.step += 1;
    }
    return result;
  }

  if (job.step === 8) {
    const result = applyAutomationStep(
      job,
      job.nextAllianceID && job.nextCorporationID
        ? `/sov lose ${job.nextAllianceID} ${job.nextCorporationID} ${job.solarSystemID}`
        : `/sov lose ${job.solarSystemID}`,
      () => (
        job.nextAllianceID && job.nextCorporationID
          ? loseSystemSovereignty(
            job.solarSystemID,
            job.nextAllianceID,
            job.nextCorporationID,
          )
          : clearSystemSovereignty(job.solarSystemID)
      ),
      {
        before: job.nextAllianceID && job.nextCorporationID
          ? `Transferring sovereignty to alliance ${job.nextAllianceID} corporation ${job.nextCorporationID}.`
          : `Clearing sovereignty ownership in ${getSolarSystemLabel(job.solarSystemID)}.`,
        after: () => job.nextAllianceID && job.nextCorporationID
          ? "System ownership transferred."
          : "Sovereignty ownership cleared.",
      },
    );
    if (result.success) {
      job.step += 1;
      return stopJobInternal(
        job,
        job.nextAllianceID && job.nextCorporationID
          ? `Loss automation completed and sovereignty transferred in ${getSolarSystemLabel(job.solarSystemID)}.`
          : `Loss automation completed and sovereignty was cleared in ${getSolarSystemLabel(job.solarSystemID)}.`,
        "completed",
      );
    }
    return result;
  }

  return stopJobInternal(job, "loss automation ran out of steps", "failed");
}

function runJobNow(jobID) {
  const job = activeJobs.get(normalizePositiveInteger(jobID, 0));
  if (!job) {
    return {
      success: false,
      errorMsg: "JOB_NOT_FOUND",
    };
  }
  if (job.mode === "claim") {
    return executeClaimStep(job);
  }
  if (job.mode === "takeover") {
    return executeTakeoverStep(job);
  }
  if (job.mode === "loss") {
    return executeLossStep(job);
  }
  return stopJobInternal(job, `unknown automation mode=${job.mode}`, "failed");
}

function createJob(mode, solarSystemID, session, options = {}) {
  const existingJob = getJobBySolarSystemID(solarSystemID);
  if (existingJob) {
    stopJobInternal(existingJob, "replaced by a new sovereignty automation request", "replaced");
  }

  const job = {
    jobID: nextJobID++,
    mode,
    solarSystemID: normalizePositiveInteger(solarSystemID, 0),
    session: cloneSessionForAutomation(session),
    liveSession: session || null,
    chatHub: options.chatHub || null,
    targetAllianceID: normalizePositiveInteger(options.targetAllianceID, null),
    targetCorporationID: normalizePositiveInteger(options.targetCorporationID, null),
    nextAllianceID: normalizePositiveInteger(options.nextAllianceID, null),
    nextCorporationID: normalizePositiveInteger(options.nextCorporationID, null),
    jammerStructureID: null,
    flexStructureIDs: {},
    showcaseDefinitions: AUTO_SHOWCASE_FLEX_DEFINITIONS.filter((definition) => (
      canSolarSystemSupportUpgrade(
        normalizePositiveInteger(solarSystemID, 0),
        definition.requiredUpgradeTypeID,
      )
    )),
    step: 0,
    startedAt: Date.now(),
    lastActionAt: 0,
    lastAction: null,
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
  sovLog.logAutomationEvent(job, `STARTED intervalMs=${AUTO_INTERVAL_MS}`);
  sendJobFeedback(
    job,
    `Started ${job.mode} automation in ${getSolarSystemLabel(job.solarSystemID)}. The next step runs now, then every 10 seconds.`,
  );
  return job;
}

function startClaim(session, solarSystemID, targetAllianceID, targetCorporationID, options = {}) {
  const validation = ensureValidSolarSystem(solarSystemID);
  if (!validation.success) {
    return validation;
  }
  const allianceID = normalizePositiveInteger(targetAllianceID, null);
  const corporationID = normalizePositiveInteger(targetCorporationID, null);
  if (!allianceID || !corporationID) {
    return {
      success: false,
      errorMsg: "TARGET_OWNER_REQUIRED",
    };
  }
  const job = createJob("claim", validation.data.solarSystemID, session, {
    chatHub: options.chatHub || null,
    targetAllianceID: allianceID,
    targetCorporationID: corporationID,
  });
  const firstStepResult = runJobNow(job.jobID);
  return {
    success: true,
    data: {
      job,
      firstStepResult,
    },
  };
}

function startTakeover(session, solarSystemID, targetAllianceID, targetCorporationID, options = {}) {
  const validation = ensureValidSolarSystem(solarSystemID);
  if (!validation.success) {
    return validation;
  }
  const allianceID = normalizePositiveInteger(targetAllianceID, null);
  const corporationID = normalizePositiveInteger(targetCorporationID, null);
  if (!allianceID || !corporationID) {
    return {
      success: false,
      errorMsg: "TARGET_OWNER_REQUIRED",
    };
  }
  const job = createJob("takeover", validation.data.solarSystemID, session, {
    chatHub: options.chatHub || null,
    targetAllianceID: allianceID,
    targetCorporationID: corporationID,
  });
  const firstStepResult = runJobNow(job.jobID);
  return {
    success: true,
    data: {
      job,
      firstStepResult,
    },
  };
}

function startLoss(session, solarSystemID, nextAllianceID = null, nextCorporationID = null, options = {}) {
  const validation = ensureValidSolarSystem(solarSystemID);
  if (!validation.success) {
    return validation;
  }
  if (
    (normalizePositiveInteger(nextAllianceID, null) && !normalizePositiveInteger(nextCorporationID, null)) ||
    (!normalizePositiveInteger(nextAllianceID, null) && normalizePositiveInteger(nextCorporationID, null))
  ) {
    return {
      success: false,
      errorMsg: "OWNER_PAIR_REQUIRED",
    };
  }
  const job = createJob("loss", validation.data.solarSystemID, session, {
    chatHub: options.chatHub || null,
    nextAllianceID,
    nextCorporationID,
  });
  const firstStepResult = runJobNow(job.jobID);
  return {
    success: true,
    data: {
      job,
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
      stopJobInternal(job, "stopped by /sovauto stop all", "stopped");
    }
    return {
      success: true,
      data: {
        stoppedCount: jobs.length,
      },
    };
  }

  const numericToken = normalizePositiveInteger(token, 0);
  let job = activeJobs.get(numericToken);
  if (!job && numericToken > 0) {
    job = getJobBySolarSystemID(numericToken);
  }
  if (!job) {
    return {
      success: false,
      errorMsg: "JOB_NOT_FOUND",
    };
  }
  return stopJobInternal(job, "stopped by /sovauto stop", "stopped");
}

function resetAutomationAndState() {
  clearAllJobs();
  const table = wipeAllSovereigntyState({
    preserveResources: true,
    preserveVersion: true,
    broadcast: false,
    syncScene: false,
  });
  return {
    success: true,
    data: {
      systemCount: Object.keys((table && table.systems) || {}).length,
      hubCount: Object.keys((table && table.hubs) || {}).length,
      skyhookCount: Object.keys((table && table.skyhooks) || {}).length,
    },
  };
}

function listActiveJobs() {
  return [...activeJobs.values()].map((job) => ({
    jobID: job.jobID,
    mode: job.mode,
    solarSystemID: job.solarSystemID,
    step: job.step,
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
  buildJobSummary,
  listActiveJobs,
  resetAutomationAndState,
  startClaim,
  startLoss,
  startTakeover,
  stopAutomation,
  _testing: {
    clearAllJobs,
    getJobBySolarSystemID,
    getJobs: () => [...activeJobs.values()],
    runJobNow,
  },
};
