const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const structureState = require(path.join(__dirname, "./structureState"));
const structureWreckState = require(path.join(__dirname, "./structureWreckState"));
const {
  STRUCTURE_GROUP_ID,
  STRUCTURE_STATE,
} = require(path.join(__dirname, "./structureConstants"));
const {
  resolveItemByName,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));

const DEFAULT_STRUCTURE_DEATH_TEST_COUNT = 3;
const DEFAULT_STRUCTURE_DEATH_TEST_RADIUS_METERS = 180_000;
const DEFAULT_STRUCTURE_DEATH_TEST_DELAY_MS = 2_000;
const MIN_STRUCTURE_DEATH_TEST_RADIUS_METERS = 80_000;
const MAX_STRUCTURE_DEATH_TEST_COUNT = 12;
const MAX_STRUCTURE_DEATH_TEST_DELAY_MS = 30_000;

const STRUCTURE_DEATH_TEST_ALIASES = Object.freeze({
  astrahus: 35832,
  fortizar: 35833,
  keepstar: 35834,
  palatine: 40340,
  raitaru: 35825,
  azbel: 35826,
  sotiyo: 35827,
  athanor: 35835,
  tatara: 35836,
  metenox: 81826,
  moondrill: 81826,
  "moon-drill": 81826,

  sovhub: 32458,
  sov: 32458,
  hub: 32458,
  ihub: 32458,
  infrastructurehub: 32458,
  "infrastructure-hub": 32458,

  skyhook: 81080,
  orbitalskyhook: 81080,
  "orbital-skyhook": 81080,

  tcu: 32226,
  territorialclaimunit: 32226,
  "territorial-claim-unit": 32226,

  pharolux: 35840,
  beacon: 35840,
  cynobeacon: 35840,
  "cyno-beacon": 35840,
  pharoluxcynobeacon: 35840,

  ansiblex: 35841,
  bridge: 35841,
  jumpbridge: 35841,
  "jump-bridge": 35841,
  ansiblexjumpbridge: 35841,

  tenebrex: 37534,
  jammer: 37534,
  cynojammer: 37534,
  "cyno-jammer": 37534,
  tenebrexcynojammer: 37534,

  bloodfob: 46364,
  "blood-fob": 46364,
  bloodraiderfob: 46364,
  "blood-raider-fob": 46364,
  bloodraidersfob: 46364,
  "blood-raiders-fob": 46364,
  bloodraiderstronghold: 46364,
  "blood-raider-stronghold": 46364,
  bloodraidersstronghold: 46364,
  "blood-raiders-stronghold": 46364,
  bloodraidersforwardoperatingbase: 46364,
  "blood-raiders-forward-operating-base": 46364,

  guristasfob: 46363,
  "guristas-fob": 46363,
  guristasstronghold: 46363,
  "guristas-stronghold": 46363,
  guristasforwardoperatingbase: 46363,
  "guristas-forward-operating-base": 46363,

  angelfob: 78260,
  "angel-fob": 78260,
  angelcartelfob: 78260,
  "angel-cartel-fob": 78260,

  guristasinsurgencyfob: 79172,
  "guristas-insurgency-fob": 79172,
  commandogurifob: 79172,
  "commando-guri-fob": 79172,
  guristaspiratesfob: 79172,
  "guristas-pirates-fob": 79172,

  mercden: 85230,
  "merc-den": 85230,
  mercenaryden: 85230,
  "mercenary-den": 85230,

  vigilancespire: 84294,
  "vigilance-spire": 84294,
  vigilance: 84294,

  vigilantdreamer: 87227,
  "vigilant-dreamer": 87227,
  dreamer: 87227,
});

const AMBIGUOUS_FOB_ALIASES = new Set([
  "fob",
  "piratefob",
  "pirate-fob",
  "forwardoperatingbase",
  "forward-operating-base",
]);

const pendingStructureDeathTests = new Map();
let nextPendingStructureDeathTestID = 1;
let pendingStructureDeathTestTimer = null;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function clamp(value, min, max) {
  const numeric = toFiniteNumber(value, min);
  return Math.min(max, Math.max(min, numeric));
}

function normalizeAliasToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "");
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
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

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = Math.sqrt((resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2));
  if (!Number.isFinite(length) || length <= 0) {
    return { ...fallback };
  }
  return {
    x: resolved.x / length,
    y: resolved.y / length,
    z: resolved.z / length,
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function buildStructureDeathPositions(anchorEntity, count, radiusMeters) {
  const anchorPosition = cloneVector(anchorEntity && anchorEntity.position);
  const anchorDirection = normalizeVector(
    anchorEntity && anchorEntity.direction,
    { x: 1, y: 0, z: 0 },
  );
  const resolvedCount = Math.max(1, toPositiveInt(count, DEFAULT_STRUCTURE_DEATH_TEST_COUNT));
  const resolvedRadius = Math.max(
    MIN_STRUCTURE_DEATH_TEST_RADIUS_METERS,
    toFiniteNumber(radiusMeters, DEFAULT_STRUCTURE_DEATH_TEST_RADIUS_METERS),
  );
  const positions = [];
  const ringCount = Math.max(1, Math.ceil(resolvedCount / 6));

  for (let index = 0; index < resolvedCount; index += 1) {
    const ringIndex = Math.floor(index / 6);
    const spokeIndex = index % 6;
    const ringRadius = Math.min(
      resolvedRadius,
      MIN_STRUCTURE_DEATH_TEST_RADIUS_METERS + (
        ringIndex *
        Math.max(40_000, Math.floor((resolvedRadius - MIN_STRUCTURE_DEATH_TEST_RADIUS_METERS) / ringCount))
      ),
    );
    const angle = (((Math.PI * 2) / 6) * spokeIndex) + (ringIndex * 0.43);
    const lateral = normalizeVector({
      x: -anchorDirection.z,
      y: 0,
      z: anchorDirection.x,
    }, { x: 0, y: 0, z: 1 });
    const radial = normalizeVector({
      x: (anchorDirection.x * Math.cos(angle)) + (lateral.x * Math.sin(angle)),
      y: 0,
      z: (anchorDirection.z * Math.cos(angle)) + (lateral.z * Math.sin(angle)),
    }, { x: Math.cos(angle), y: 0, z: Math.sin(angle) });
    positions.push(addVectors(anchorPosition, scaleVector(radial, ringRadius)));
  }

  return positions;
}

function parseStructureDeathTestArgs(argumentText) {
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      typeToken: "",
      count: null,
      delaySeconds: null,
    };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (/^\d+$/.test(tokens[0] || "")) {
    return {
      typeToken: tokens[0],
      count:
        tokens.length >= 2
          ? Math.max(1, Math.min(MAX_STRUCTURE_DEATH_TEST_COUNT, toPositiveInt(tokens[1], 1)))
          : null,
      delaySeconds:
        tokens.length >= 3 && /^\d+(?:\.\d+)?$/.test(tokens[2])
          ? clamp(Number(tokens[2]), 0, MAX_STRUCTURE_DEATH_TEST_DELAY_MS / 1000)
          : null,
    };
  }

  const numericTail = [];
  while (tokens.length > 0 && /^\d+(?:\.\d+)?$/.test(tokens[tokens.length - 1])) {
    numericTail.unshift(tokens.pop());
  }

  const typeToken = tokens.join(" ").trim();
  return {
    typeToken,
    count:
      numericTail.length >= 1
        ? Math.max(1, Math.min(MAX_STRUCTURE_DEATH_TEST_COUNT, toPositiveInt(numericTail[0], 1)))
        : null,
    delaySeconds:
      numericTail.length >= 2
        ? clamp(Number(numericTail[1]), 0, MAX_STRUCTURE_DEATH_TEST_DELAY_MS / 1000)
        : null,
  };
}

function resolveStructureTypeByID(typeID) {
  const numericTypeID = toPositiveInt(typeID, 0);
  if (!numericTypeID) {
    return null;
  }
  return structureState.getStructureTypeByID(numericTypeID);
}

function buildStructureTypeResolution(typeRecord, source = "lookup") {
  if (!typeRecord) {
    return {
      success: false,
      errorMsg: "STRUCTURE_TYPE_NOT_FOUND",
      suggestions: [],
    };
  }
  return {
    success: true,
    typeRecord,
    wreckType: structureWreckState.resolveStructureWreckType(typeRecord),
    source,
  };
}

function resolveStructureDeathTestType(typeToken) {
  const trimmed = String(typeToken || "").trim();
  if (!trimmed) {
    return {
      success: false,
      errorMsg: "STRUCTURE_TYPE_REQUIRED",
      suggestions: [
        "sovhub",
        "skyhook",
        "bloodraiderfob",
        "guristasfob",
        "angelfob",
        "mercden",
        "astrahus",
      ],
    };
  }

  const alias = normalizeAliasToken(trimmed);
  if (AMBIGUOUS_FOB_ALIASES.has(alias)) {
    return {
      success: false,
      errorMsg: "FOB_ALIAS_AMBIGUOUS",
      suggestions: [
        "bloodraiderfob",
        "guristasfob",
        "guristasinsurgencyfob",
        "angelfob",
      ],
    };
  }
  if (STRUCTURE_DEATH_TEST_ALIASES[alias]) {
    return buildStructureTypeResolution(
      resolveStructureTypeByID(STRUCTURE_DEATH_TEST_ALIASES[alias]),
      "alias",
    );
  }

  if (/^\d+$/.test(trimmed)) {
    return buildStructureTypeResolution(resolveStructureTypeByID(trimmed), "typeID");
  }

  const lookup = resolveItemByName(trimmed);
  if (!lookup.success || !lookup.match) {
    return {
      success: false,
      errorMsg: lookup.errorMsg || "ITEM_NOT_FOUND",
      suggestions: lookup.suggestions || [],
    };
  }

  const groupName = String(lookup.match.groupName || "").trim().toLowerCase();
  if (groupName === "wreck") {
    return {
      success: false,
      errorMsg: "STRUCTURE_TYPE_REQUIRED",
      suggestions: [`${lookup.match.name} is a wreck; use the live structure type or alias.`],
    };
  }

  return buildStructureTypeResolution(
    resolveStructureTypeByID(lookup.match.typeID),
    "itemName",
  );
}

function resolveDeathTestStructureState(typeRecord) {
  const groupID = toPositiveInt(typeRecord && typeRecord.groupID, 0);
  if (groupID === STRUCTURE_GROUP_ID.FOB) {
    return STRUCTURE_STATE.FOB_INVULNERABLE;
  }
  return STRUCTURE_STATE.SHIELD_VULNERABLE;
}

function syncStructureRuntime(systemID, options = {}) {
  if (typeof spaceRuntime.syncStructureSceneState === "function") {
    return spaceRuntime.syncStructureSceneState(systemID, options);
  }
  return {
    success: true,
    data: {
      added: [],
      updated: [],
    },
  };
}

function clearPendingStructureDeathTestTimer() {
  if (!pendingStructureDeathTestTimer) {
    return;
  }
  clearInterval(pendingStructureDeathTestTimer);
  pendingStructureDeathTestTimer = null;
}

function ensurePendingStructureDeathTestTimer() {
  if (pendingStructureDeathTestTimer) {
    return;
  }
  pendingStructureDeathTestTimer = setInterval(() => {
    try {
      processPendingStructureDeathTests();
    } catch (error) {
      log.warn(`[StructureDeathTest] Pending structure death-test processing failed: ${error.message}`);
    }
  }, 100);
  if (
    pendingStructureDeathTestTimer &&
    typeof pendingStructureDeathTestTimer.unref === "function"
  ) {
    pendingStructureDeathTestTimer.unref();
  }
}

function processPendingStructureDeathTests() {
  if (pendingStructureDeathTests.size <= 0) {
    clearPendingStructureDeathTestTimer();
    return 0;
  }

  let processedCount = 0;
  for (const [pendingID, pending] of [...pendingStructureDeathTests.entries()]) {
    if (!pending) {
      pendingStructureDeathTests.delete(pendingID);
      continue;
    }

    const currentSimTimeMs = spaceRuntime.getSimulationTimeMsForSystem(
      pending.systemID,
      0,
    );
    if (currentSimTimeMs < pending.completeAtSimMs) {
      continue;
    }

    pendingStructureDeathTests.delete(pendingID);
    processedCount += 1;

    const destroyed = [];
    for (const structureID of pending.structureIDs) {
      const structure = structureState.getStructureByID(structureID, {
        refresh: false,
      });
      if (!structure || structure.destroyedAt) {
        continue;
      }

      const destroyResult = structureState.destroyStructure(structureID, {
        session: pending.session || undefined,
        skipAssetSafety: true,
      });
      if (!destroyResult.success) {
        log.warn(
          `[StructureDeathTest] Failed to destroy test structure=${structureID}: ${destroyResult.errorMsg}`,
        );
        continue;
      }

      const loot = destroyResult.data && destroyResult.data.loot
        ? destroyResult.data.loot
        : null;
      const wreck = loot && loot.wreck ? loot.wreck : null;
      destroyed.push({
        structureID,
        wreckID: toPositiveInt(wreck && wreck.itemID, 0) || null,
        wreckTypeID: toPositiveInt(wreck && wreck.typeID, 0) || null,
        spawnItemIDs: Array.isArray(loot && loot.spawnItemIDs)
          ? loot.spawnItemIDs.map((itemID) => toPositiveInt(itemID, 0)).filter(Boolean)
          : [],
      });
    }

    syncStructureRuntime(pending.systemID);
    pending.resolve({
      typeRecord: pending.typeRecord,
      wreckType: pending.wreckType,
      spawnedCount: pending.spawnedCount,
      destroyed,
    });
  }

  if (pendingStructureDeathTests.size <= 0) {
    clearPendingStructureDeathTestTimer();
  }
  return processedCount;
}

function queuePendingStructureDeathTest({
  systemID,
  typeRecord,
  wreckType,
  structureIDs,
  spawnedCount,
  delayMs,
  session,
}) {
  const scene = spaceRuntime.ensureScene(systemID);
  const currentSimTimeMs = scene
    ? scene.getCurrentSimTimeMs()
    : spaceRuntime.getSimulationTimeMsForSystem(systemID);
  const completeAtSimMs = currentSimTimeMs + Math.max(0, toFiniteNumber(delayMs, 0));
  const pendingID = nextPendingStructureDeathTestID++;
  let resolvePromise = null;
  const completionPromise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  pendingStructureDeathTests.set(pendingID, {
    systemID,
    typeRecord,
    wreckType,
    structureIDs: [...structureIDs],
    spawnedCount,
    completeAtSimMs,
    session,
    resolve: resolvePromise,
  });
  ensurePendingStructureDeathTestTimer();
  processPendingStructureDeathTests();

  return {
    completionPromise,
    completeAtSimMs,
  };
}

function spawnStructureDeathTestField(session, options = {}) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const systemID = toPositiveInt(session._space.systemID, 0);
  const scene = spaceRuntime.ensureScene(systemID);
  const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!scene || !anchorEntity) {
    return {
      success: false,
      errorMsg: "ANCHOR_ENTITY_NOT_FOUND",
    };
  }

  const resolution = options.typeRecord
    ? buildStructureTypeResolution(options.typeRecord, "option")
    : resolveStructureDeathTestType(options.typeToken || options.typeName || options.typeID);
  if (!resolution.success || !resolution.typeRecord) {
    return resolution;
  }

  const typeRecord = resolution.typeRecord;
  const count = Math.max(
    1,
    Math.min(
      MAX_STRUCTURE_DEATH_TEST_COUNT,
      toPositiveInt(options.count, DEFAULT_STRUCTURE_DEATH_TEST_COUNT),
    ),
  );
  const radiusMeters = Math.max(
    MIN_STRUCTURE_DEATH_TEST_RADIUS_METERS,
    toFiniteNumber(options.radiusMeters, DEFAULT_STRUCTURE_DEATH_TEST_RADIUS_METERS),
  );
  const delayMs = Math.max(
    0,
    Math.min(
      MAX_STRUCTURE_DEATH_TEST_DELAY_MS,
      toFiniteNumber(options.delayMs, DEFAULT_STRUCTURE_DEATH_TEST_DELAY_MS),
    ),
  );
  const positions = buildStructureDeathPositions(anchorEntity, count, radiusMeters);
  const spawned = [];
  const stateID = resolveDeathTestStructureState(typeRecord);
  const ownerCorpID = toPositiveInt(
    session.corporationID || session.corpid,
    1000009,
  );

  for (let index = 0; index < positions.length; index += 1) {
    const createResult = structureState.seedStructureForSession(
      session,
      String(typeRecord.typeID),
      {
        solarSystemID: systemID,
        position: positions[index],
        ownerCorpID,
        name: `Death Test ${typeRecord.name} ${index + 1}`,
        devFlags: {
          deathTest: true,
        },
      },
    );
    if (!createResult.success || !createResult.data) {
      log.warn(
        `[StructureDeathTest] Failed to seed ${typeRecord.typeID}: ${createResult.errorMsg}`,
      );
      continue;
    }

    const stateResult = structureState.setStructureState(
      createResult.data.structureID,
      stateID,
      {
        clearTimer: true,
      },
    );
    const structure = stateResult.success && stateResult.data
      ? stateResult.data
      : createResult.data;
    spawned.push(structure);
  }

  if (spawned.length <= 0) {
    return {
      success: false,
      errorMsg: "STRUCTURE_SPAWN_FAILED",
    };
  }

  syncStructureRuntime(systemID);
  const scheduledDetonation = queuePendingStructureDeathTest({
    systemID,
    typeRecord,
    wreckType: resolution.wreckType || null,
    structureIDs: spawned.map((structure) => structure.structureID),
    spawnedCount: spawned.length,
    delayMs,
    session,
  });

  return {
    success: true,
    data: {
      typeRecord,
      wreckType: resolution.wreckType || null,
      radiusMeters,
      delayMs,
      spawned,
      completionPromise: scheduledDetonation.completionPromise,
      detonateAtSimMs: scheduledDetonation.completeAtSimMs,
    },
  };
}

function buildStructureDeathTestUsage() {
  return "Usage: /deathstructure <sovhub|skyhook|bloodraiderfob|guristasfob|angelfob|mercden|vigilance|dreamer|astrahus|typeID> [count] [delaySeconds]";
}

module.exports = {
  DEFAULT_STRUCTURE_DEATH_TEST_COUNT,
  DEFAULT_STRUCTURE_DEATH_TEST_DELAY_MS,
  DEFAULT_STRUCTURE_DEATH_TEST_RADIUS_METERS,
  MAX_STRUCTURE_DEATH_TEST_COUNT,
  MAX_STRUCTURE_DEATH_TEST_DELAY_MS,
  buildStructureDeathPositions,
  buildStructureDeathTestUsage,
  parseStructureDeathTestArgs,
  processPendingStructureDeathTests,
  resolveStructureDeathTestType,
  spawnStructureDeathTestField,
};

module.exports._testing = {
  buildStructureDeathPositions,
  clearPendingStructureDeathTests() {
    pendingStructureDeathTests.clear();
    clearPendingStructureDeathTestTimer();
  },
  parseStructureDeathTestArgs,
  processPendingStructureDeathTests,
  resolveDeathTestStructureState,
  resolveStructureDeathTestType,
};
