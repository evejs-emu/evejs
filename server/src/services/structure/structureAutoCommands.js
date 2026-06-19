const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  getAllShipTypes,
} = require(path.join(__dirname, "../chat/shipTypeRegistry"));
const structureAutoState = require(path.join(__dirname, "./structureAutoState"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_STATE_NAME_BY_ID,
} = require(path.join(__dirname, "./structureConstants"));

const AUTO_TYPES = new Set([
  "astrahus",
  "fortizar",
  "keepstar",
  "palatine",
  "raitaru",
  "azbel",
  "sotiyo",
  "athanor",
  "tatara",
]);
const DEFAULT_UNDOCK_DUMMY_COUNT = 100;
const MAX_UNDOCK_DUMMY_COUNT = 500;
const UNDOCK_DUMMY_TARGET_DISTANCE = 1.0e16;
const UNDOCK_WAVE_INTERVAL_MS = 200;
const TARGET_UNDOCK_BATCH_COUNT = 20;
const MIN_UNDOCK_BATCH_SIZE = 4;
const MAX_UNDOCK_BATCH_SIZE = 12;
const UNDOCK_HULL_MODE = Object.freeze({
  MIXED: "mixed",
  PUBLISHED: "published",
  UNPUBLISHED: "unpublished",
});
const UNDOCK_HULL_MODE_ALIASES = Object.freeze({
  all: UNDOCK_HULL_MODE.MIXED,
  any: UNDOCK_HULL_MODE.MIXED,
  mixed: UNDOCK_HULL_MODE.MIXED,
  published: UNDOCK_HULL_MODE.PUBLISHED,
  publishedonly: UNDOCK_HULL_MODE.PUBLISHED,
  "published-only": UNDOCK_HULL_MODE.PUBLISHED,
  unpublished: UNDOCK_HULL_MODE.UNPUBLISHED,
  unpublishedonly: UNDOCK_HULL_MODE.UNPUBLISHED,
  "unpublished-only": UNDOCK_HULL_MODE.UNPUBLISHED,
  unpub: UNDOCK_HULL_MODE.UNPUBLISHED,
});

let nextUndockDummyEntityID = 3920000000000000;

function normalizeInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = normalizeInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 1 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function allocateUndockDummyEntityID() {
  const allocated = nextUndockDummyEntityID;
  nextUndockDummyEntityID += 1;
  return allocated;
}

function normalizeUndockHullMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return UNDOCK_HULL_MODE_ALIASES[normalized] || null;
}

function formatUndockHullMode(mode) {
  if (mode === UNDOCK_HULL_MODE.UNPUBLISHED) {
    return "unpublished-only";
  }
  if (mode === UNDOCK_HULL_MODE.PUBLISHED) {
    return "published-only";
  }
  return "published+unpublished";
}

function shuffleEntries(entries, random = Math.random) {
  const shuffled = [...entries];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(Math.max(0, Math.min(0.999999999, random())) * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[nextIndex];
    shuffled[nextIndex] = current;
  }
  return shuffled;
}

function selectShipTypesForUndockWave(shipTypes, count, random = Math.random) {
  const candidates = Array.isArray(shipTypes) ? shipTypes.filter(Boolean) : [];
  const requestedCount = Math.max(0, normalizePositiveInt(count, 0));
  if (candidates.length === 0 || requestedCount <= 0) {
    return [];
  }

  const selection = [];
  while (selection.length < requestedCount) {
    const remaining = requestedCount - selection.length;
    selection.push(...shuffleEntries(candidates, random).slice(0, remaining));
  }
  return selection;
}

function getUndockBatchSize(count) {
  const requestedCount = Math.max(1, normalizePositiveInt(count, DEFAULT_UNDOCK_DUMMY_COUNT));
  return clamp(
    Math.ceil(requestedCount / TARGET_UNDOCK_BATCH_COUNT),
    MIN_UNDOCK_BATCH_SIZE,
    MAX_UNDOCK_BATCH_SIZE,
  );
}

function getCompatibleUndockShipTypes(structure, hullMode = UNDOCK_HULL_MODE.MIXED) {
  return getAllShipTypes({ includeUnpublished: true }).filter((shipType) => {
    if (
      hullMode === UNDOCK_HULL_MODE.UNPUBLISHED &&
      shipType.published !== false
    ) {
      return false;
    }
    if (
      hullMode === UNDOCK_HULL_MODE.PUBLISHED &&
      shipType.published === false
    ) {
      return false;
    }
    const dockResult = structureState.canShipTypeDockAtStructure(shipType.typeID, structure);
    return dockResult.success && !(dockResult.data && dockResult.data.oneWayUndock === true);
  });
}

function buildUndockDummyShipSpec(session, structure, shipType, itemID) {
  const undockState = spaceRuntime.getStationUndockSpawnState(structure, {
    shipTypeID: shipType.typeID,
    selectionStrategy: "hash",
    selectionKey: `${structure.structureID}:${itemID}`,
  });
  const position = cloneVector(undockState.position, cloneVector(structure && structure.position));
  const direction = cloneVector(undockState.direction);
  const ownerID =
    normalizePositiveInt(
      session && (session.characterID || session.charid || session.userid),
      normalizePositiveInt(structure && (structure.ownerID || structure.ownerCorpID), 1),
    ) || 1;
  const corporationID = normalizePositiveInt(
    session && (session.corporationID || session.corpid),
    normalizePositiveInt(structure && structure.ownerCorpID, 0),
  );
  return {
    itemID,
    typeID: shipType.typeID,
    groupID: shipType.groupID,
    categoryID: shipType.categoryID || 6,
    itemName: `${shipType.name} Undock Dummy`,
    ownerID,
    characterID: 0,
    corporationID,
    allianceID: normalizePositiveInt(session && session.allianceID, 0),
    warFactionID: normalizePositiveInt(session && session.warFactionID, 0),
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction,
    targetPoint: addVectors(position, scaleVector(direction, UNDOCK_DUMMY_TARGET_DISTANCE)),
    mode: "GOTO",
    speedFraction: 1,
    conditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
      incapacitated: false,
    },
  };
}

function spawnUndockWaveBatch(session, structure, shipTypes = []) {
  const candidates = Array.isArray(shipTypes) ? shipTypes.filter(Boolean) : [];
  if (candidates.length <= 0) {
    return {
      success: false,
      errorMsg: "NO_SHIPS_REQUESTED",
    };
  }

  const scene = spaceRuntime.ensureScene(structure.solarSystemID);
  if (!scene || typeof scene.spawnDynamicEntity !== "function") {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const spawned = [];
  for (const shipType of candidates) {
    const itemID = allocateUndockDummyEntityID();
    const shipSpec = buildUndockDummyShipSpec(session, structure, shipType, itemID);
    const entity =
      spaceRuntime._testing &&
      typeof spaceRuntime._testing.buildRuntimeShipEntityForTesting === "function"
        ? spaceRuntime._testing.buildRuntimeShipEntityForTesting(shipSpec, structure.solarSystemID)
        : null;
    const resolvedEntity = entity || shipSpec;
    resolvedEntity.mode = "GOTO";
    resolvedEntity.speedFraction = 1;
    resolvedEntity.targetPoint = cloneVector(shipSpec.targetPoint, resolvedEntity.targetPoint);
    resolvedEntity.direction = cloneVector(shipSpec.direction, resolvedEntity.direction);
    resolvedEntity.velocity =
      toFiniteNumber(resolvedEntity.maxVelocity, 0) > 0
        ? scaleVector(resolvedEntity.direction, resolvedEntity.maxVelocity)
        : { x: 0, y: 0, z: 0 };

    const spawnResult = entity
      ? scene.spawnDynamicEntity(resolvedEntity)
      : spaceRuntime.spawnDynamicShip(structure.solarSystemID, resolvedEntity);
    if (spawnResult.success && spawnResult.data && spawnResult.data.entity) {
      spawned.push({
        shipType,
        entity: spawnResult.data.entity,
      });
    }
  }

  if (spawned.length <= 0) {
    return {
      success: false,
      errorMsg: "UNDOCK_DUMMY_SPAWN_FAILED",
    };
  }

  return {
    success: true,
    data: {
      spawned,
    },
  };
}

function startUndockWave(
  session,
  structure,
  count = DEFAULT_UNDOCK_DUMMY_COUNT,
  options = {},
) {
  const hullMode = normalizeUndockHullMode(options.hullMode) || UNDOCK_HULL_MODE.MIXED;
  const compatibleShipTypes = getCompatibleUndockShipTypes(structure, hullMode);
  if (compatibleShipTypes.length === 0) {
    return {
      success: false,
      errorMsg: "NO_COMPATIBLE_SHIP_TYPES",
    };
  }

  spaceRuntime.ensureScene(structure.solarSystemID);
  spaceRuntime.syncStructureSceneState(structure.solarSystemID, {
    broadcast: true,
  });

  const requestedCount = Math.max(1, normalizePositiveInt(count, DEFAULT_UNDOCK_DUMMY_COUNT));
  const selectedShipTypes = selectShipTypesForUndockWave(compatibleShipTypes, requestedCount);
  const pendingShipTypes = [...selectedShipTypes];
  const batchSize = getUndockBatchSize(requestedCount);

  const job = structureAutoState.createCustomJob(
    "undock",
    structure.structureID,
    session,
    (jobState, currentStructure) => {
      if (!currentStructure) {
        return {
          success: false,
          errorMsg: "STRUCTURE_NOT_FOUND",
        };
      }
      if (normalizePositiveInt(currentStructure.destroyedAt, 0) > 0) {
        return {
          success: false,
          errorMsg: "STRUCTURE_DESTROYED",
        };
      }

      const nextBatch = pendingShipTypes.splice(0, batchSize);
      if (nextBatch.length <= 0) {
        return {
          success: true,
          skipStructureSync: true,
          completed: true,
          actionLabel: `undock ${jobState.totalSpawned || 0}/${jobState.requestedCount || 0}`,
          completionReason: `staggered undock wave completed ${jobState.totalSpawned || 0}/${jobState.requestedCount || 0}`,
        };
      }

      const spawnResult = spawnUndockWaveBatch(jobState.session || session, currentStructure, nextBatch);
      if (!spawnResult.success) {
        return spawnResult;
      }

      jobState.totalSpawned = normalizePositiveInt(jobState.totalSpawned, 0) + spawnResult.data.spawned.length;
      jobState.remainingCount = pendingShipTypes.length;
      const isComplete = pendingShipTypes.length <= 0;
      return {
        success: true,
        skipStructureSync: true,
        completed: isComplete,
        actionLabel: `undock ${jobState.totalSpawned}/${jobState.requestedCount}`,
        logMessage: `spawned ${spawnResult.data.spawned.length} undock dummies (${jobState.totalSpawned}/${jobState.requestedCount}) remaining=${jobState.remainingCount}`,
        completionReason: `staggered undock wave completed ${jobState.totalSpawned}/${jobState.requestedCount}`,
        data: {
          spawnedThisStep: spawnResult.data.spawned.length,
          totalSpawned: jobState.totalSpawned,
          remainingCount: jobState.remainingCount,
        },
      };
    },
    {
      intervalMs: UNDOCK_WAVE_INTERVAL_MS,
      runImmediately: true,
      metadata: {
        requestedCount,
        totalSpawned: 0,
        remainingCount: requestedCount,
        batchSize,
        hullMode,
        compatibleShipTypeCount: compatibleShipTypes.length,
      },
    },
  );

  return {
    success: true,
    data: {
      jobID: job.jobID,
      intervalMs: UNDOCK_WAVE_INTERVAL_MS,
      batchSize,
      requestedCount,
      compatibleShipTypeCount: compatibleShipTypes.length,
      hullMode,
      initialSpawnCount: normalizePositiveInt(job.totalSpawned, 0),
    },
  };
}

function parseUndockCommandOptions(tokens = []) {
  const structureID = normalizePositiveInt(tokens[0], 0);
  let requestedCount = DEFAULT_UNDOCK_DUMMY_COUNT;
  let hullMode = UNDOCK_HULL_MODE.MIXED;
  let countProvided = false;
  let hullModeProvided = false;

  for (const token of tokens.slice(1)) {
    const numericCount = normalizePositiveInt(token, 0);
    if (numericCount > 0) {
      if (countProvided) {
        return {
          success: false,
          errorMsg: "TOO_MANY_COUNT_ARGS",
        };
      }
      requestedCount = numericCount;
      countProvided = true;
      continue;
    }

    const normalizedMode = normalizeUndockHullMode(token);
    if (normalizedMode) {
      if (hullModeProvided) {
        return {
          success: false,
          errorMsg: "TOO_MANY_MODE_ARGS",
        };
      }
      hullMode = normalizedMode;
      hullModeProvided = true;
      continue;
    }

    return {
      success: false,
      errorMsg: "INVALID_UNDOCK_ARG",
    };
  }

  return {
    success: structureID > 0,
    errorMsg: structureID > 0 ? null : "STRUCTURE_ID_REQUIRED",
    data: {
      structureID,
      requestedCount,
      hullMode,
    },
  };
}

function buildHelpText() {
  return [
    "/upwellauto help",
    "/upwellauto status",
    "/upwellauto stop <jobID|structureID|all>",
    `/upwellauto undock <structureID> [count=${DEFAULT_UNDOCK_DUMMY_COUNT}] [all|unpublished|published]`,
    "/upwellauto <astrahus|fortizar|keepstar|raitaru|azbel|sotiyo|athanor|tatara|palatine> [name]",
    "/upwellauto <structureID>",
  ].join("\n");
}

function formatJobSummary(job) {
  const parts = [
    `job=${job.jobID}`,
    `mode=${job.mode}`,
    `structure=${job.structureID}`,
    `last=${job.lastAction || "none"}`,
  ];
  if (job.mode === "undock") {
    parts.push(`spawned=${normalizePositiveInt(job.totalSpawned, 0)}/${normalizePositiveInt(job.requestedCount, 0)}`);
    parts.push(`batch=${normalizePositiveInt(job.batchSize, 0)}@${normalizePositiveInt(job.intervalMs, 0)}ms`);
  }
  return parts.join(" | ");
}

function formatStructureSummary(structure) {
  if (!structure) {
    return "structure=?";
  }
  return [
    `${structure.itemName || structure.name || `Structure ${structure.structureID}`}(${structure.structureID})`,
    `state=${STRUCTURE_STATE_NAME_BY_ID[normalizeInt(structure.state, 0)] || "unknown"}`,
    `core=${structure.hasQuantumCore === true ? "installed" : "missing"}`,
  ].join(" | ");
}

function executeUpwellAutoCommand(session, argumentText) {
  const trimmed = String(argumentText || "").trim();
  const [firstTokenRaw, ...rest] = trimmed.split(/\s+/).filter(Boolean);
  const firstToken = String(firstTokenRaw || "help").trim();
  const normalizedFirstToken = firstToken.toLowerCase();

  if (!firstToken || normalizedFirstToken === "help" || normalizedFirstToken === "?") {
    return {
      success: true,
      message: buildHelpText(),
    };
  }

  if (normalizedFirstToken === "status") {
    const jobs = structureAutoState.listActiveJobs();
    return {
      success: true,
      message: jobs.length > 0
        ? jobs.map((job) => formatJobSummary(job)).join("\n")
        : "No active Upwell automation jobs.",
    };
  }

  if (normalizedFirstToken === "stop") {
    const stopTarget = String(rest.join(" ").trim() || "");
    if (!stopTarget) {
      return {
        success: false,
        message: "Usage: /upwellauto stop <jobID|structureID|all>",
      };
    }
    const stopResult = structureAutoState.stopAutomation(stopTarget);
    if (!stopResult.success) {
      return {
        success: false,
        message: `Failed to stop Upwell automation: ${stopResult.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: stopTarget.toLowerCase() === "all"
        ? `Stopped ${stopResult.data.stoppedCount} Upwell automation job${stopResult.data.stoppedCount === 1 ? "" : "s"}.`
        : `Stopped Upwell automation for ${stopTarget}.`,
    };
  }

  if (normalizedFirstToken === "undock") {
    const undockParse = parseUndockCommandOptions(rest);
    if (!undockParse.success) {
      return {
        success: false,
        message: `Usage: /upwellauto undock <structureID> [count=${DEFAULT_UNDOCK_DUMMY_COUNT}] [all|unpublished|published]`,
      };
    }
    const { structureID, requestedCount, hullMode } = undockParse.data;
    if (requestedCount > MAX_UNDOCK_DUMMY_COUNT) {
      return {
        success: false,
        message: `Undock wave count must be between 1 and ${MAX_UNDOCK_DUMMY_COUNT}.`,
      };
    }

    const structure = structureState.getStructureByID(structureID);
    if (!structure) {
      return {
        success: false,
        message: `Structure ${structureID} was not found.`,
      };
    }
    if (structure.dockable !== true) {
      return {
        success: false,
        message: `Structure ${structureID} is not dockable, so it cannot produce an undock wave.`,
      };
    }
    if (normalizePositiveInt(structure.destroyedAt, 0) > 0) {
      return {
        success: false,
        message: `Structure ${structureID} is already destroyed.`,
      };
    }

    const spawnResult = startUndockWave(session, structure, requestedCount, {
      hullMode,
    });
    if (!spawnResult.success) {
      const failureText =
        spawnResult.errorMsg === "NO_COMPATIBLE_SHIP_TYPES"
          ? `No compatible ${formatUndockHullMode(hullMode)} hulls were available for that structure.`
          : "Dummy undock wave spawn failed.";
      return {
        success: false,
        message: failureText,
      };
    }

    const currentSystemID = normalizePositiveInt(
      session && (
        session._space && session._space.systemID
          ? session._space.systemID
          : (session.solarsystemid2 || session.solarsystemid)
      ),
      0,
    );
    const visibilityHint =
      currentSystemID > 0 && currentSystemID !== structure.solarSystemID
        ? ` You are currently in system ${currentSystemID}; move to ${structure.solarSystemID} to watch it live.`
        : "";

    return {
      success: true,
      message: [
        `Started staggered undock wave job=${spawnResult.data.jobID} from ${formatStructureSummary(structure)}.`,
        `Wave=${spawnResult.data.requestedCount} ships, batch=${spawnResult.data.batchSize} every ${spawnResult.data.intervalMs}ms, initialSpawn=${spawnResult.data.initialSpawnCount}. Hull pool=${spawnResult.data.compatibleShipTypeCount} compatible ship types (${formatUndockHullMode(spawnResult.data.hullMode)}). They use real structure undock locators and launch at each hull's max velocity.${visibilityHint}`,
      ].join("\n"),
    };
  }

  if (AUTO_TYPES.has(normalizedFirstToken)) {
    const startResult = structureAutoState.startAutoOnline(session, normalizedFirstToken, {
      name: rest.join(" ").trim() || undefined,
    });
    if (!startResult.success) {
      return {
        success: false,
        message: `Failed to start Upwell online automation: ${startResult.errorMsg}.`,
      };
    }
    const structure = startResult.data.structure;
    return {
      success: true,
      message: [
        `Started Upwell online automation: ${formatJobSummary(startResult.data.job)}.`,
        `Seeded ${formatStructureSummary(structure)}.`,
        `It runs the next lifecycle step immediately, then every 10 seconds until docking is online.`,
        `Step-by-step output is written to server/logs/upwell.log.`,
      ].join("\n"),
    };
  }

  const structureID = normalizePositiveInt(firstToken, 0);
  if (structureID > 0) {
    const structure = structureState.getStructureByID(structureID);
    if (!structure) {
      return {
        success: false,
        message: `Structure ${structureID} was not found.`,
      };
    }
    const startResult = structureAutoState.startAutoDestroy(session, structureID);
    if (!startResult.success) {
      return {
        success: false,
        message: `Failed to start Upwell destruction automation: ${startResult.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: [
        `Started Upwell destruction automation: ${formatJobSummary(startResult.data.job)}.`,
        `Target: ${formatStructureSummary(startResult.data.structure)}.`,
        `It uses GM damage internally every 10 seconds and will fully destroy the structure automatically.`,
        `No manual attack is required unless you want to test the real combat path instead.`,
      ].join("\n"),
    };
  }

  return {
    success: false,
    message: buildHelpText(),
  };
}

module.exports = {
  executeUpwellAutoCommand,
};
