const path = require("path");

const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  cloneValue,
  readSovereigntyTable,
  writeSovereigntyTable,
} = require(path.join(__dirname, "./sovStore"));
const {
  createUuidString,
} = require(path.join(
  __dirname,
  "../../_secondary/express/gatewayServices/gatewayServiceHelpers",
));
const {
  DEFAULT_MERCENARY_DEN_ABSOLUTE_MAXIMUM,
  DEFAULT_MERCENARY_DEN_ACTIVITY_CAPACITY,
  MERCENARY_DEN_MANAGEMENT_SKILL_TYPE_ID,
} = require(path.join(__dirname, "./sovConstants"));

const DEFAULT_ACTIVITY_DURATION_MS = 2 * 60 * 60 * 1000;
const DEFAULT_ACTIVITY_GENERATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ACTIVITY_TEMPLATE_DEFINITIONS = Object.freeze([
  {
    templateID: 1,
    nameMessageID: 330000001,
    descriptionMessageID: 330000011,
    dungeonID: 8800001,
    developmentImpact: 1,
    anarchyImpact: 0,
    infomorphBonus: 1,
  },
  {
    templateID: 2,
    nameMessageID: 330000002,
    descriptionMessageID: 330000012,
    dungeonID: 8800002,
    developmentImpact: 0,
    anarchyImpact: 1,
    infomorphBonus: 1,
  },
  {
    templateID: 3,
    nameMessageID: 330000003,
    descriptionMessageID: 330000013,
    dungeonID: 8800003,
    developmentImpact: 2,
    anarchyImpact: 0,
    infomorphBonus: 2,
  },
]);

let cache = null;

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizePositiveInteger(value, fallback = null) {
  const numericValue = normalizeInteger(value, 0);
  return numericValue > 0 ? numericValue : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return Boolean(value);
}

function normalizeTimestampMs(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(numericValue));
}

function getSkillLevel(characterID, skillTypeID) {
  const skillMap = getCharacterSkillMap(normalizePositiveInteger(characterID, 0));
  const record = skillMap.get(Number(skillTypeID) || 0) || null;
  return Math.max(
    0,
    Math.min(
      5,
      normalizeInteger(
        record &&
          (record.effectiveSkillLevel ??
            record.trainedSkillLevel ??
            record.skillLevel),
        0,
      ),
    ),
  );
}

function buildDefaultEvolutionDefinition() {
  return {
    development: {
      unitIncreaseTimeSeconds: 3600,
      stages: [
        { stage: 1, levelLowerBound: 0, levelUpperBound: 19 },
        { stage: 2, levelLowerBound: 20, levelUpperBound: 39 },
        { stage: 3, levelLowerBound: 40, levelUpperBound: 59 },
        { stage: 4, levelLowerBound: 60, levelUpperBound: 79 },
        { stage: 5, levelLowerBound: 80, levelUpperBound: 100 },
      ],
    },
    anarchy: {
      unitIncreaseTimeSeconds: 3600,
      stages: [
        { stage: 1, levelLowerBound: 0, levelUpperBound: 19, workforceConsumption: 0 },
        { stage: 2, levelLowerBound: 20, levelUpperBound: 39, workforceConsumption: 5 },
        { stage: 3, levelLowerBound: 40, levelUpperBound: 59, workforceConsumption: 10 },
        { stage: 4, levelLowerBound: 60, levelUpperBound: 79, workforceConsumption: 15 },
        { stage: 5, levelLowerBound: 80, levelUpperBound: 100, workforceConsumption: 20 },
      ],
    },
  };
}

function buildDefaultEvolutionSimulation(now = Date.now()) {
  return {
    paused: false,
    started: true,
    development: {
      level: 0,
      stage: 1,
      pausedAtMs: 0,
      simulatedAtMs: now,
    },
    anarchy: {
      level: 0,
      stage: 1,
      pausedAtMs: 0,
      simulatedAtMs: now,
    },
  };
}

function buildDefaultInfomorphsDefinition() {
  return {
    infomorphTypeID: 88000001,
    generationTickSeconds: 3600,
    cargoCapacity: 50,
    generationBands: [
      { stage: 1, lowerBand: 0, upperBand: 1 },
      { stage: 2, lowerBand: 1, upperBand: 2 },
      { stage: 3, lowerBand: 2, upperBand: 3 },
      { stage: 4, lowerBand: 3, upperBand: 4 },
      { stage: 5, lowerBand: 4, upperBand: 5 },
    ],
  };
}

function buildDefaultInfomorphsContents(now = Date.now()) {
  return {
    count: 0,
    lastGenerationTickMs: now,
  };
}

function normalizeEvolutionRecord(value = {}) {
  const fallbackDefinition = buildDefaultEvolutionDefinition();
  const fallbackSimulation = buildDefaultEvolutionSimulation();
  const developmentDefinition = value.definition && value.definition.development
    ? value.definition.development
    : {};
  const anarchyDefinition = value.definition && value.definition.anarchy
    ? value.definition.anarchy
    : {};
  const developmentSimulation = value.simulation && value.simulation.development
    ? value.simulation.development
    : {};
  const anarchySimulation = value.simulation && value.simulation.anarchy
    ? value.simulation.anarchy
    : {};
  return {
    definition: {
      development: {
        unitIncreaseTimeSeconds: Math.max(
          1,
          normalizeInteger(
            developmentDefinition.unitIncreaseTimeSeconds,
            fallbackDefinition.development.unitIncreaseTimeSeconds,
          ),
        ),
        stages: (Array.isArray(developmentDefinition.stages)
          ? developmentDefinition.stages
          : fallbackDefinition.development.stages
        ).map((entry, index) => ({
          stage: Math.max(1, normalizeInteger(entry && entry.stage, index + 1)),
          levelLowerBound: Math.max(
            0,
            normalizeInteger(entry && entry.levelLowerBound, index * 20),
          ),
          levelUpperBound: Math.max(
            0,
            normalizeInteger(entry && entry.levelUpperBound, index * 20 + 19),
          ),
        })),
      },
      anarchy: {
        unitIncreaseTimeSeconds: Math.max(
          1,
          normalizeInteger(
            anarchyDefinition.unitIncreaseTimeSeconds,
            fallbackDefinition.anarchy.unitIncreaseTimeSeconds,
          ),
        ),
        stages: (Array.isArray(anarchyDefinition.stages)
          ? anarchyDefinition.stages
          : fallbackDefinition.anarchy.stages
        ).map((entry, index) => ({
          stage: Math.max(1, normalizeInteger(entry && entry.stage, index + 1)),
          levelLowerBound: Math.max(
            0,
            normalizeInteger(entry && entry.levelLowerBound, index * 20),
          ),
          levelUpperBound: Math.max(
            0,
            normalizeInteger(entry && entry.levelUpperBound, index * 20 + 19),
          ),
          workforceConsumption: Math.max(
            0,
            normalizeInteger(entry && entry.workforceConsumption, index * 5),
          ),
        })),
      },
    },
    simulation: {
      paused: normalizeBoolean(
        value.simulation && value.simulation.paused,
        fallbackSimulation.paused,
      ),
      started: normalizeBoolean(
        value.simulation && value.simulation.started,
        fallbackSimulation.started,
      ),
      development: {
        level: Math.max(
          0,
          normalizeInteger(
            developmentSimulation.level,
            fallbackSimulation.development.level,
          ),
        ),
        stage: Math.max(
          1,
          normalizeInteger(
            developmentSimulation.stage,
            fallbackSimulation.development.stage,
          ),
        ),
        pausedAtMs: normalizeTimestampMs(
          developmentSimulation.pausedAtMs,
          fallbackSimulation.development.pausedAtMs,
        ),
        simulatedAtMs: normalizeTimestampMs(
          developmentSimulation.simulatedAtMs,
          fallbackSimulation.development.simulatedAtMs,
        ),
      },
      anarchy: {
        level: Math.max(
          0,
          normalizeInteger(
            anarchySimulation.level,
            fallbackSimulation.anarchy.level,
          ),
        ),
        stage: Math.max(
          1,
          normalizeInteger(
            anarchySimulation.stage,
            fallbackSimulation.anarchy.stage,
          ),
        ),
        pausedAtMs: normalizeTimestampMs(
          anarchySimulation.pausedAtMs,
          fallbackSimulation.anarchy.pausedAtMs,
        ),
        simulatedAtMs: normalizeTimestampMs(
          anarchySimulation.simulatedAtMs,
          fallbackSimulation.anarchy.simulatedAtMs,
        ),
      },
    },
  };
}

function normalizeInfomorphsRecord(value = {}) {
  const fallbackDefinition = buildDefaultInfomorphsDefinition();
  const fallbackContents = buildDefaultInfomorphsContents();
  const definition = value.definition || {};
  const contents = value.contents || {};
  return {
    definition: {
      infomorphTypeID: normalizePositiveInteger(
        definition.infomorphTypeID,
        fallbackDefinition.infomorphTypeID,
      ),
      generationTickSeconds: Math.max(
        1,
        normalizeInteger(
          definition.generationTickSeconds,
          fallbackDefinition.generationTickSeconds,
        ),
      ),
      cargoCapacity: Math.max(
        0,
        normalizeInteger(
          definition.cargoCapacity,
          fallbackDefinition.cargoCapacity,
        ),
      ),
      generationBands: (Array.isArray(definition.generationBands)
        ? definition.generationBands
        : fallbackDefinition.generationBands
      ).map((entry, index) => ({
        stage: Math.max(1, normalizeInteger(entry && entry.stage, index + 1)),
        lowerBand: Math.max(
          0,
          normalizeInteger(entry && entry.lowerBand, index),
        ),
        upperBand: Math.max(
          0,
          normalizeInteger(entry && entry.upperBand, index + 1),
        ),
      })),
    },
    contents: {
      count: Math.max(0, normalizeInteger(contents.count, fallbackContents.count)),
      lastGenerationTickMs: normalizeTimestampMs(
        contents.lastGenerationTickMs,
        fallbackContents.lastGenerationTickMs,
      ),
    },
  };
}

function normalizeActivityTemplateDefinition(value = {}, fallback = {}) {
  return {
    templateID: normalizePositiveInteger(value.templateID, fallback.templateID || 1),
    nameMessageID: normalizePositiveInteger(
      value.nameMessageID,
      fallback.nameMessageID || 330000001,
    ),
    descriptionMessageID: normalizePositiveInteger(
      value.descriptionMessageID,
      fallback.descriptionMessageID || 330000011,
    ),
    dungeonID: normalizePositiveInteger(value.dungeonID, fallback.dungeonID || 8800001),
    developmentImpact: normalizeInteger(
      value.developmentImpact,
      fallback.developmentImpact || 0,
    ),
    anarchyImpact: normalizeInteger(
      value.anarchyImpact,
      fallback.anarchyImpact || 0,
    ),
    infomorphBonus: Math.max(
      0,
      normalizeInteger(value.infomorphBonus, fallback.infomorphBonus || 0),
    ),
  };
}

function normalizeMercenaryActivityRecord(value = {}, fallback = {}) {
  return {
    activityID: String(value.activityID || fallback.activityID || createUuidString())
      .trim()
      .toLowerCase(),
    mercenaryDenID: normalizePositiveInteger(
      value.mercenaryDenID,
      fallback.mercenaryDenID,
    ),
    solarSystemID: normalizePositiveInteger(
      value.solarSystemID,
      fallback.solarSystemID,
    ),
    started: normalizeBoolean(value.started, fallback.started || false),
    expiryMs: normalizeTimestampMs(value.expiryMs, fallback.expiryMs || 0),
    template: normalizeActivityTemplateDefinition(
      value.template,
      fallback.template || {},
    ),
  };
}

function buildDefaultActivitiesForDen(den, now = Date.now()) {
  return DEFAULT_ACTIVITY_TEMPLATE_DEFINITIONS.slice(
    0,
    DEFAULT_MERCENARY_DEN_ACTIVITY_CAPACITY,
  ).map((templateDefinition, index) =>
    normalizeMercenaryActivityRecord(
      {
        activityID: createUuidString(),
        mercenaryDenID: den.mercenaryDenID,
        solarSystemID: den.solarSystemID,
        started: false,
        expiryMs: now + DEFAULT_ACTIVITY_DURATION_MS + index * 15 * 60 * 1000,
        template: templateDefinition,
      },
      {
        mercenaryDenID: den.mercenaryDenID,
        solarSystemID: den.solarSystemID,
      },
    ),
  );
}

function normalizeMercenaryDenRecord(value = {}) {
  const now = Date.now();
  const mercenaryDenID = normalizePositiveInteger(
    value.mercenaryDenID || value.denID || value.id,
    null,
  );
  return {
    mercenaryDenID,
    ownerCharacterID: normalizePositiveInteger(value.ownerCharacterID, null),
    skyhookID: normalizePositiveInteger(value.skyhookID, null),
    solarSystemID: normalizePositiveInteger(value.solarSystemID, null),
    planetID: normalizePositiveInteger(value.planetID, null),
    typeID: normalizePositiveInteger(value.typeID, 1),
    enabled: normalizeBoolean(value.enabled, true),
    cargoExtractionEnabled: normalizeBoolean(value.cargoExtractionEnabled, false),
    skyhookOwnerCorporationID: normalizePositiveInteger(
      value.skyhookOwnerCorporationID,
      null,
    ),
    evolution: normalizeEvolutionRecord(value.evolution || {}),
    infomorphs: normalizeInfomorphsRecord(value.infomorphs || {}),
    nextGenerationAtMs: normalizeTimestampMs(
      value.nextGenerationAtMs,
      now + DEFAULT_ACTIVITY_GENERATION_INTERVAL_MS,
    ),
    activities: Array.isArray(value.activities)
      ? value.activities
          .map((entry) =>
            normalizeMercenaryActivityRecord(entry, {
              mercenaryDenID,
              solarSystemID: value.solarSystemID,
            }),
          )
          .filter((entry) => entry.mercenaryDenID && entry.solarSystemID)
      : [],
  };
}

function applyMercenaryDenTimeTransitions(table) {
  let changed = false;
  const now = Date.now();

  for (const [mercenaryDenID, rawDen] of Object.entries(table.mercenaryDens || {})) {
    let den = normalizeMercenaryDenRecord(rawDen);
    const activeActivities = [];
    for (const activity of den.activities) {
      if (normalizeTimestampMs(activity.expiryMs, 0) > now) {
        activeActivities.push(activity);
      } else {
        changed = true;
      }
    }
    den.activities = activeActivities;
    if (
      den.activities.length === 0 &&
      normalizeTimestampMs(den.nextGenerationAtMs, 0) <= now
    ) {
      den.activities = buildDefaultActivitiesForDen(den, now);
      den.nextGenerationAtMs = now + DEFAULT_ACTIVITY_GENERATION_INTERVAL_MS;
      changed = true;
    }
    table.mercenaryDens[mercenaryDenID] = den;
  }

  return changed;
}

function buildCache(table) {
  const densByID = new Map();
  const denIDsByOwnerCharacterID = new Map();
  const activitiesByDenID = new Map();
  const activityByID = new Map();
  const activitiesByOwnerCharacterID = new Map();

  for (const rawDen of Object.values(table.mercenaryDens || {})) {
    const den = normalizeMercenaryDenRecord(rawDen);
    if (!den.mercenaryDenID || !den.ownerCharacterID) {
      continue;
    }
    densByID.set(den.mercenaryDenID, den);
    if (!denIDsByOwnerCharacterID.has(den.ownerCharacterID)) {
      denIDsByOwnerCharacterID.set(den.ownerCharacterID, []);
    }
    denIDsByOwnerCharacterID.get(den.ownerCharacterID).push(den.mercenaryDenID);
    activitiesByDenID.set(den.mercenaryDenID, den.activities);
    if (!activitiesByOwnerCharacterID.has(den.ownerCharacterID)) {
      activitiesByOwnerCharacterID.set(den.ownerCharacterID, []);
    }
    activitiesByOwnerCharacterID.get(den.ownerCharacterID).push(...den.activities);
    for (const activity of den.activities) {
      activityByID.set(activity.activityID, {
        ...activity,
        ownerCharacterID: den.ownerCharacterID,
      });
    }
  }

  for (const denIDs of denIDsByOwnerCharacterID.values()) {
    denIDs.sort((left, right) => left - right);
  }
  for (const activities of activitiesByOwnerCharacterID.values()) {
    activities.sort((left, right) => left.activityID.localeCompare(right.activityID));
  }

  return {
    updatedAt: table && table._meta ? table._meta.updatedAt || null : null,
    densByID,
    denIDsByOwnerCharacterID,
    activitiesByDenID,
    activityByID,
    activitiesByOwnerCharacterID,
  };
}

function ensureLoaded() {
  const table = readSovereigntyTable();
  const updatedAt = table && table._meta ? table._meta.updatedAt || null : null;
  if (cache && cache.updatedAt === updatedAt) {
    return cache;
  }

  const nextTable = cloneValue(table);
  if (applyMercenaryDenTimeTransitions(nextTable)) {
    writeSovereigntyTable(nextTable);
    cache = buildCache(nextTable);
    return cache;
  }

  cache = buildCache(nextTable);
  return cache;
}

function requireOwner(mercenaryDenID, characterID) {
  const current = ensureLoaded();
  const den = current.densByID.get(normalizePositiveInteger(mercenaryDenID, 0)) || null;
  if (!den) {
    return {
      ok: false,
      statusCode: 404,
      errorCode: "UNKNOWN_MERCENARY_DEN",
    };
  }
  if (normalizePositiveInteger(characterID, 0) !== den.ownerCharacterID) {
    return {
      ok: false,
      statusCode: 403,
      errorCode: "ACCESS_DENIED",
    };
  }
  return {
    ok: true,
    den: cloneValue(den),
  };
}

function mutateMercenaryDens(mutator) {
  const table = cloneValue(readSovereigntyTable());
  const result = mutator(table);
  if (result && result.ok === false) {
    return result;
  }
  const writtenTable = writeSovereigntyTable(table);
  cache = buildCache(writtenTable);
  return result;
}

function getMercenaryDenMaximumForCharacter(characterID) {
  const numericCharacterID = normalizePositiveInteger(characterID, 0);
  const skillLevel = getSkillLevel(
    numericCharacterID,
    MERCENARY_DEN_MANAGEMENT_SKILL_TYPE_ID,
  );
  return {
    currentMaximum: Math.max(
      1,
      Math.min(DEFAULT_MERCENARY_DEN_ABSOLUTE_MAXIMUM, skillLevel + 1),
    ),
    absoluteMaximum: DEFAULT_MERCENARY_DEN_ABSOLUTE_MAXIMUM,
  };
}

function listOwnedMercenaryDenIDs(characterID) {
  const current = ensureLoaded();
  return cloneValue(
    current.denIDsByOwnerCharacterID.get(
      normalizePositiveInteger(characterID, 0),
    ) || [],
  );
}

function getMercenaryDenAsOwner(characterID, mercenaryDenID) {
  const access = requireOwner(mercenaryDenID, characterID);
  if (!access.ok) {
    return access;
  }
  return {
    ok: true,
    den: access.den,
  };
}

function listMercenaryDenActivitiesForCharacter(characterID) {
  const current = ensureLoaded();
  return cloneValue(
    current.activitiesByOwnerCharacterID.get(
      normalizePositiveInteger(characterID, 0),
    ) || [],
  );
}

function getMercenaryDenActivities(characterID, mercenaryDenID) {
  const access = requireOwner(mercenaryDenID, characterID);
  if (!access.ok) {
    return access;
  }
  return {
    ok: true,
    mercenaryDenID: access.den.mercenaryDenID,
    nextGenerationAtMs: access.den.nextGenerationAtMs,
    activities: cloneValue(access.den.activities),
  };
}

function getMercenaryActivityCapacity() {
  return DEFAULT_MERCENARY_DEN_ACTIVITY_CAPACITY;
}

function startMercenaryDenActivity(characterID, activityID) {
  const current = ensureLoaded();
  const existingActivity = current.activityByID.get(
    String(activityID || "").trim().toLowerCase(),
  );
  if (!existingActivity) {
    return {
      ok: false,
      statusCode: 404,
      errorCode: "UNKNOWN_ACTIVITY",
    };
  }
  const access = requireOwner(existingActivity.mercenaryDenID, characterID);
  if (!access.ok) {
    return access;
  }
  if (existingActivity.started) {
    return {
      ok: false,
      statusCode: 409,
      errorCode: "ACTIVITY_ALREADY_STARTED",
    };
  }

  return mutateMercenaryDens((table) => {
    const denKey = String(existingActivity.mercenaryDenID);
    const den = normalizeMercenaryDenRecord(table.mercenaryDens[denKey]);
    const activityIndex = den.activities.findIndex(
      (entry) => entry.activityID === existingActivity.activityID,
    );
    if (activityIndex < 0) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: "UNKNOWN_ACTIVITY",
      };
    }
    const nextActivity = normalizeMercenaryActivityRecord(
      {
        ...den.activities[activityIndex],
        started: true,
        expiryMs: Math.max(
          normalizeTimestampMs(den.activities[activityIndex].expiryMs, 0),
          Date.now() + DEFAULT_ACTIVITY_DURATION_MS,
        ),
      },
      den.activities[activityIndex],
    );
    den.activities[activityIndex] = nextActivity;
    table.mercenaryDens[denKey] = den;
    return {
      ok: true,
      mercenaryDenID: den.mercenaryDenID,
      ownerCharacterID: den.ownerCharacterID,
      solarSystemID: den.solarSystemID,
      activity: nextActivity,
    };
  });
}

function resetMercenaryDenStateForTests() {
  cache = null;
}

module.exports = {
  getMercenaryActivityCapacity,
  getMercenaryDenActivities,
  getMercenaryDenAsOwner,
  getMercenaryDenMaximumForCharacter,
  listMercenaryDenActivitiesForCharacter,
  listOwnedMercenaryDenIDs,
  resetMercenaryDenStateForTests,
  startMercenaryDenActivity,
};
