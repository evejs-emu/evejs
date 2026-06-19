const path = require("path");

const {
  TABLE,
  readStaticRows,
  readStaticTable,
} = require(path.join(__dirname, "../../_shared/referenceData"));
const {
  getNowFileTime,
} = require(path.join(__dirname, "../training/skillTrainingMath"));

const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MILLISECOND = 10000n;
const DAILY_DOWNTIME_HOUR_UTC = 11;

const TYPE_SKILL_EXTRACTOR = 40519;
const TYPE_LARGE_SKILL_INJECTOR = 40520;
const TYPE_SMALL_SKILL_INJECTOR = 45635;
const TYPE_DAILY_ALPHA_INJECTOR = 46375;
const TYPE_MINI_SKILL_INJECTOR = 43630;
const TYPE_AIR_SKILL_INJECTOR = 60033;
const TYPE_QA_SKILL_INJECTOR = 42523;
const TYPE_ASI_2018_11 = 49703;
const TYPE_OSI_2018_11 = 49704;

const ATTRIBUTE_CHARACTER_SKILL_POINT_LIMIT = 2459;
const ATTRIBUTE_SKILL_POINTS = 2461;

const SKILL_TRADING_BUCKET_SIZE = 500000;
const SKILL_TRADING_FREE_ZONE = 5000000;
const SKILL_TRADING_MINIMUM_SP_TO_EXTRACT =
  SKILL_TRADING_FREE_ZONE + SKILL_TRADING_BUCKET_SIZE;
const SKILL_TRADING_SMALL_INJECTOR_DIVISOR = 5;

const LARGE_DIMINISHING_BANDS = Object.freeze([
  { upperBound: 5000000, skillPoints: 500000 },
  { upperBound: 50000000, skillPoints: 400000 },
  { upperBound: 80000000, skillPoints: 300000 },
  { upperBound: Infinity, skillPoints: 150000 },
]);
const SMALL_DIMINISHING_BANDS = Object.freeze(
  LARGE_DIMINISHING_BANDS.map((band) => ({
    upperBound: band.upperBound,
    skillPoints: Math.trunc(band.skillPoints / SKILL_TRADING_SMALL_INJECTOR_DIVISOR),
  })),
);

const INJECTOR_SEED_SPECS = Object.freeze({
  [TYPE_LARGE_SKILL_INJECTOR]: {
    injectionFamily: "large",
    injectionMode: "diminishing",
    fullSkillPoints: 500000,
    diminishingBands: LARGE_DIMINISHING_BANDS,
  },
  [TYPE_SMALL_SKILL_INJECTOR]: {
    injectionFamily: "small",
    injectionMode: "diminishing",
    fullSkillPoints: 100000,
    diminishingBands: SMALL_DIMINISHING_BANDS,
  },
  [TYPE_DAILY_ALPHA_INJECTOR]: {
    injectionFamily: "daily_alpha",
    injectionMode: "fixed",
    alphaOnly: true,
    oncePerDowntime: true,
    maxQuantityPerUse: 1,
  },
  [TYPE_MINI_SKILL_INJECTOR]: {
    injectionFamily: "mini",
    injectionMode: "fixed",
  },
  [TYPE_AIR_SKILL_INJECTOR]: {
    injectionFamily: "air",
    injectionMode: "fixed",
  },
  [TYPE_QA_SKILL_INJECTOR]: {
    injectionFamily: "qa",
    injectionMode: "fixed",
  },
  [TYPE_ASI_2018_11]: {
    injectionFamily: "asi_2018_11",
    injectionMode: "fixed",
  },
  [TYPE_OSI_2018_11]: {
    injectionFamily: "osi_2018_11",
    injectionMode: "fixed",
  },
});

let authorityCache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toBigInt(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value);
    }
    if (value && typeof value === "object" && value.type === "long") {
      return toBigInt(value.value, fallback);
    }
  } catch (error) {
    return fallback;
  }
  return fallback;
}

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function fileTimeToDate(fileTime) {
  const normalized = toBigInt(fileTime, 0n);
  const millis = Number((normalized - FILETIME_EPOCH_OFFSET) / FILETIME_TICKS_PER_MILLISECOND);
  return new Date(millis);
}

function dateToFileTime(date) {
  return BigInt(date.getTime()) * FILETIME_TICKS_PER_MILLISECOND + FILETIME_EPOCH_OFFSET;
}

function buildAuthorityCache() {
  const itemRows = readStaticRows(TABLE.ITEM_TYPES) || [];
  const typeDogma = readStaticTable(TABLE.TYPE_DOGMA) || {};
  const dogmaByTypeID =
    typeDogma && typeof typeDogma.typesByTypeID === "object"
      ? typeDogma.typesByTypeID
      : {};
  const itemRowsByTypeID = new Map();

  for (const row of itemRows) {
    const typeID = toInt(row && row.typeID, 0);
    if (typeID > 0) {
      itemRowsByTypeID.set(typeID, row);
    }
  }

  const injectorSpecsByTypeID = new Map();
  for (const [rawTypeID, seed] of Object.entries(INJECTOR_SEED_SPECS)) {
    const typeID = toInt(rawTypeID, 0);
    const itemRow = itemRowsByTypeID.get(typeID) || {};
    const dogmaRow = dogmaByTypeID[String(typeID)] || {};
    const dogmaAttributes =
      dogmaRow && typeof dogmaRow.attributes === "object" ? dogmaRow.attributes : {};
    injectorSpecsByTypeID.set(
      typeID,
      Object.freeze({
        typeID,
        itemName: itemRow.name || itemRow.typeName || `Type ${typeID}`,
        groupName: itemRow.groupName || "",
        published: itemRow.published !== false,
        injectionFamily: seed.injectionFamily,
        injectionMode: seed.injectionMode,
        alphaOnly: seed.alphaOnly === true,
        oncePerDowntime: seed.oncePerDowntime === true,
        maxQuantityPerUse: normalizePositiveInteger(seed.maxQuantityPerUse, null),
        fullSkillPoints: normalizePositiveInteger(
          seed.fullSkillPoints ?? dogmaAttributes[String(ATTRIBUTE_SKILL_POINTS)],
          0,
        ),
        fixedSkillPoints: normalizePositiveInteger(
          seed.fixedSkillPoints ?? dogmaAttributes[String(ATTRIBUTE_SKILL_POINTS)],
          0,
        ),
        characterSkillPointLimit: normalizePositiveInteger(
          dogmaAttributes[String(ATTRIBUTE_CHARACTER_SKILL_POINT_LIMIT)],
          0,
        ),
        diminishingBands: Array.isArray(seed.diminishingBands)
          ? Object.freeze(seed.diminishingBands.map((band) => Object.freeze({ ...band })))
          : null,
      }),
    );
  }

  const extractorRow = itemRowsByTypeID.get(TYPE_SKILL_EXTRACTOR) || {};

  authorityCache = {
    injectorSpecsByTypeID,
    extractorSpec: Object.freeze({
      typeID: TYPE_SKILL_EXTRACTOR,
      itemName: extractorRow.name || "Skill Extractor",
      groupName: extractorRow.groupName || "",
      published: extractorRow.published !== false,
      extractionBucketSize: SKILL_TRADING_BUCKET_SIZE,
      minimumAllocatedSkillPoints: SKILL_TRADING_MINIMUM_SP_TO_EXTRACT,
    }),
  };

  return authorityCache;
}

function getAuthorityCache() {
  return authorityCache || buildAuthorityCache();
}

function getSkillInjectorSpec(typeID) {
  return cloneValue(getAuthorityCache().injectorSpecsByTypeID.get(toInt(typeID, 0)) || null);
}

function getAllSkillInjectorSpecs() {
  return [...getAuthorityCache().injectorSpecsByTypeID.values()].map((entry) => cloneValue(entry));
}

function getSkillExtractorSpec() {
  return cloneValue(getAuthorityCache().extractorSpec);
}

function isSkillInjectorType(typeID) {
  return getAuthorityCache().injectorSpecsByTypeID.has(toInt(typeID, 0));
}

function isSkillExtractorType(typeID) {
  return toInt(typeID, 0) === TYPE_SKILL_EXTRACTOR;
}

function getDiminishedSkillPointsForTotalSp(injectorSpec, totalSkillPoints, options = {}) {
  if (
    !injectorSpec ||
    injectorSpec.injectionMode !== "diminishing" ||
    !Array.isArray(injectorSpec.diminishingBands)
  ) {
    return 0;
  }

  if (options.nonDiminishing === true) {
    return normalizePositiveInteger(injectorSpec.fullSkillPoints, 0);
  }

  const total = Math.max(0, toInt(totalSkillPoints, 0));
  for (const band of injectorSpec.diminishingBands) {
    if (total < Number(band.upperBound)) {
      return normalizePositiveInteger(band.skillPoints, 0);
    }
  }
  return 0;
}

function buildDiminishingInjectionPreview(
  injectorSpec,
  quantity,
  totalSkillPoints,
  nonDiminishingInjectionsRemaining = 0,
) {
  const normalizedQuantity = Math.max(0, toInt(quantity, 0));
  const perUsePoints = [];
  let runningTotal = Math.max(0, toInt(totalSkillPoints, 0));
  let remainingNonDiminishing = Math.max(0, toInt(nonDiminishingInjectionsRemaining, 0));

  for (let index = 0; index < normalizedQuantity; index += 1) {
    const useNonDiminishing = remainingNonDiminishing > 0;
    const skillPoints = getDiminishedSkillPointsForTotalSp(
      injectorSpec,
      runningTotal,
      { nonDiminishing: useNonDiminishing },
    );
    perUsePoints.push(skillPoints);
    runningTotal += skillPoints;
    if (useNonDiminishing) {
      remainingNonDiminishing -= 1;
    }
  }

  return {
    totalSkillPoints: perUsePoints.reduce((sum, value) => sum + value, 0),
    perUsePoints,
    nonDiminishingUsed:
      Math.max(0, toInt(nonDiminishingInjectionsRemaining, 0)) - remainingNonDiminishing,
  };
}

function getFixedInjectorSkillPointAmount(injectorSpec) {
  return normalizePositiveInteger(
    injectorSpec && (injectorSpec.fixedSkillPoints || injectorSpec.fullSkillPoints),
    0,
  );
}

function getFixedInjectorMaxUsableQuantity(injectorSpec, quantity, totalSkillPoints) {
  const normalizedQuantity = Math.max(0, toInt(quantity, 0));
  if (!injectorSpec || injectorSpec.injectionMode !== "fixed") {
    return 0;
  }

  if (injectorSpec.maxQuantityPerUse && normalizedQuantity > injectorSpec.maxQuantityPerUse) {
    return injectorSpec.maxQuantityPerUse;
  }

  const pointLimit = Math.max(0, toInt(injectorSpec.characterSkillPointLimit, 0));
  if (pointLimit <= 0) {
    return normalizedQuantity;
  }

  const fixedAmount = getFixedInjectorSkillPointAmount(injectorSpec);
  if (fixedAmount <= 0) {
    return 0;
  }

  let allowed = 0;
  let runningTotal = Math.max(0, toInt(totalSkillPoints, 0));
  while (allowed < normalizedQuantity && runningTotal < pointLimit) {
    allowed += 1;
    runningTotal += fixedAmount;
  }
  return allowed;
}

function getInjectorPreviewSkillPoints(
  injectorSpec,
  quantity,
  totalSkillPoints,
  nonDiminishingInjectionsRemaining = 0,
) {
  if (!injectorSpec) {
    return 0;
  }

  if (injectorSpec.injectionMode === "diminishing") {
    return buildDiminishingInjectionPreview(
      injectorSpec,
      quantity,
      totalSkillPoints,
      nonDiminishingInjectionsRemaining,
    ).totalSkillPoints;
  }

  const usableQuantity = getFixedInjectorMaxUsableQuantity(
    injectorSpec,
    quantity,
    totalSkillPoints,
  );
  return getFixedInjectorSkillPointAmount(injectorSpec) * usableQuantity;
}

function resolveNextDowntimeFileTime(afterFileTime = null) {
  const current = toBigInt(afterFileTime, getNowFileTime());
  const currentDate = fileTimeToDate(current);
  const nextDowntimeMillis = Date.UTC(
    currentDate.getUTCFullYear(),
    currentDate.getUTCMonth(),
    currentDate.getUTCDate(),
    DAILY_DOWNTIME_HOUR_UTC,
    0,
    0,
    0,
  );
  let nextDowntime = new Date(nextDowntimeMillis);
  if (currentDate >= nextDowntime) {
    nextDowntime = new Date(nextDowntimeMillis + (24 * 60 * 60 * 1000));
  }
  return dateToFileTime(nextDowntime);
}

module.exports = {
  DAILY_DOWNTIME_HOUR_UTC,
  SKILL_TRADING_BUCKET_SIZE,
  SKILL_TRADING_FREE_ZONE,
  SKILL_TRADING_MINIMUM_SP_TO_EXTRACT,
  SKILL_TRADING_SMALL_INJECTOR_DIVISOR,
  TYPE_SKILL_EXTRACTOR,
  TYPE_LARGE_SKILL_INJECTOR,
  TYPE_SMALL_SKILL_INJECTOR,
  TYPE_DAILY_ALPHA_INJECTOR,
  TYPE_MINI_SKILL_INJECTOR,
  TYPE_AIR_SKILL_INJECTOR,
  TYPE_QA_SKILL_INJECTOR,
  TYPE_ASI_2018_11,
  TYPE_OSI_2018_11,
  cloneValue,
  buildDiminishingInjectionPreview,
  getAllSkillInjectorSpecs,
  getDiminishedSkillPointsForTotalSp,
  getFixedInjectorMaxUsableQuantity,
  getFixedInjectorSkillPointAmount,
  getInjectorPreviewSkillPoints,
  getSkillExtractorSpec,
  getSkillInjectorSpec,
  isSkillExtractorType,
  isSkillInjectorType,
  resolveNextDowntimeFileTime,
};
