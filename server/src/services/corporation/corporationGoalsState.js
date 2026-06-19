const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  CORP_ROLE_DIRECTOR,
  CORP_ROLE_PROJECT_MANAGER,
  getCorporationMember,
  normalizePositiveInteger,
  toRoleMaskBigInt,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  createUuidString,
  currencyToNumber,
} = require(path.join(
  __dirname,
  "../../_secondary/express/gatewayServices/gatewayServiceHelpers",
));

const TABLE = "corporationGoals";
const ACTIVE_PROJECT_CAPACITY = 100;
const GOAL_STATE_ACTIVE = 1;
const GOAL_STATE_CLOSED = 2;
const GOAL_STATE_COMPLETED = 3;
const GOAL_STATE_EXPIRED = 4;

let cache = null;

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function nowMs() {
  return Date.now();
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value);
}

function normalizeGoalRewardPool(value = {}, fallbackIndex = 0) {
  const amount = value.amount && typeof value.amount === "object"
    ? {
        units: normalizeInteger(value.amount.units, 0),
        nanos: normalizeInteger(value.amount.nanos, 0),
      }
    : {
        units: normalizeInteger(value.units, 0),
        nanos: normalizeInteger(value.nanos, 0),
      };
  return {
    period: normalizeInteger(value.period, 1),
    amount,
    assetUUID: normalizeText(value.assetUUID, createUuidString()),
    index: normalizeInteger(value.index, fallbackIndex),
  };
}

function normalizeContributor(value = {}, characterID = null) {
  const numericCharacterID = normalizePositiveInteger(
    characterID !== null ? characterID : value.characterID,
    null,
  );
  if (!numericCharacterID) {
    return null;
  }
  return {
    characterID: numericCharacterID,
    progress: Math.max(0, normalizeInteger(value.progress, 0)),
    earningsTotal: Math.max(0, normalizeInteger(value.earningsTotal, 0)),
    earningsRedeemed: Math.max(0, normalizeInteger(value.earningsRedeemed, 0)),
    contributionsCount: Math.max(
      0,
      normalizeInteger(value.contributionsCount, 0),
    ),
    lastContributedAtMs: Math.max(
      0,
      normalizeInteger(value.lastContributedAtMs, 0),
    ),
  };
}

function normalizeGoalRecord(value = {}, explicitGoalID = null) {
  const goalID = normalizeText(explicitGoalID || value.goalID, "");
  if (!goalID) {
    return null;
  }
  const rewardPools = Array.isArray(value.rewardPools)
    ? value.rewardPools.map((entry, index) => normalizeGoalRewardPool(entry, index))
    : [];
  const contributors = {};
  if (value.contributors && typeof value.contributors === "object") {
    for (const [characterID, contributor] of Object.entries(value.contributors)) {
      const normalized = normalizeContributor(contributor, characterID);
      if (!normalized) {
        continue;
      }
      contributors[String(normalized.characterID)] = normalized;
    }
  }
  return {
    goalID,
    corporationID: normalizePositiveInteger(value.corporationID, 0) || 0,
    creatorCharacterID: normalizePositiveInteger(value.creatorCharacterID, 0) || 0,
    createdAtMs: Math.max(0, normalizeInteger(value.createdAtMs, nowMs())),
    updatedAtMs: Math.max(0, normalizeInteger(value.updatedAtMs, nowMs())),
    deletedAtMs: Math.max(0, normalizeInteger(value.deletedAtMs, 0)),
    closedAtMs: Math.max(0, normalizeInteger(value.closedAtMs, 0)),
    completedAtMs: Math.max(0, normalizeInteger(value.completedAtMs, 0)),
    expiredAtMs: Math.max(0, normalizeInteger(value.expiredAtMs, 0)),
    finishedAtMs: Math.max(0, normalizeInteger(value.finishedAtMs, 0)),
    dueAtMs: Math.max(0, normalizeInteger(value.dueAtMs, 0)),
    name: normalizeText(value.name, ""),
    description: normalizeText(value.description, ""),
    desiredProgress: Math.max(0, normalizeInteger(value.desiredProgress, 0)),
    currentProgress: Math.max(0, normalizeInteger(value.currentProgress, 0)),
    career: Math.max(0, normalizeInteger(value.career, 0)),
    participationLimit:
      value.participationLimit === null || value.participationLimit === undefined
        ? null
        : Math.max(0, normalizeInteger(value.participationLimit, 0)),
    contributionLimit:
      value.contributionLimit === null || value.contributionLimit === undefined
        ? null
        : Math.max(0, normalizeInteger(value.contributionLimit, 0)),
    scalar:
      value.scalar === null || value.scalar === undefined
        ? null
        : Number(value.scalar || 0),
    contributionConfigurationBase64: normalizeText(
      value.contributionConfigurationBase64,
      "",
    ),
    rewardPools,
    contributors,
  };
}

function buildEmptyCache() {
  return {
    records: new Map(),
    corporationIndexes: new Map(),
    dirty: false,
  };
}

function indexRecord(record) {
  if (!cache.corporationIndexes.has(record.corporationID)) {
    cache.corporationIndexes.set(record.corporationID, new Set());
  }
  cache.corporationIndexes.get(record.corporationID).add(record.goalID);
}

function unindexRecord(record) {
  const index = cache.corporationIndexes.get(record.corporationID);
  if (!index) {
    return;
  }
  index.delete(record.goalID);
  if (index.size === 0) {
    cache.corporationIndexes.delete(record.corporationID);
  }
}

function persistCache() {
  const records = {};
  for (const [goalID, record] of cache.records.entries()) {
    records[goalID] = cloneValue(record);
  }
  const writeResult = database.write(TABLE, "/", {
    _meta: {
      version: 1,
      updatedAt: new Date().toISOString(),
    },
    records,
  });
  cache.dirty = false;
  return Boolean(writeResult && writeResult.success);
}

function ensureCache() {
  if (cache) {
    return cache;
  }

  cache = buildEmptyCache();
  const result = database.read(TABLE, "/");
  const table =
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : { _meta: { version: 1 }, records: {} };
  const records = table.records && typeof table.records === "object"
    ? table.records
    : {};
  for (const [goalID, record] of Object.entries(records)) {
    const normalized = normalizeGoalRecord(record, goalID);
    if (!normalized) {
      continue;
    }
    cache.records.set(normalized.goalID, normalized);
    indexRecord(normalized);
  }
  return cache;
}

function getCorporationIDForCharacter(characterID) {
  const character = getCharacterRecord(characterID) || {};
  return normalizePositiveInteger(character.corporationID, null);
}

function isCharacterInCorporation(characterID, corporationID) {
  return getCorporationIDForCharacter(characterID) === corporationID;
}

function canCharacterManageGoals(characterID, corporationID = null) {
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  const numericCorporationID =
    normalizePositiveInteger(corporationID, null) ||
    getCorporationIDForCharacter(numericCharacterID);
  if (!numericCharacterID || !numericCorporationID) {
    return false;
  }
  const member = getCorporationMember(numericCorporationID, numericCharacterID);
  if (!member) {
    return false;
  }
  if (member.isCEO) {
    return true;
  }
  const roles = toRoleMaskBigInt(member.roles, 0n);
  return (
    (roles & CORP_ROLE_DIRECTOR) === CORP_ROLE_DIRECTOR ||
    (roles & CORP_ROLE_PROJECT_MANAGER) === CORP_ROLE_PROJECT_MANAGER
  );
}

function deriveGoalState(record, currentMs = nowMs()) {
  if (!record) {
    return GOAL_STATE_ACTIVE;
  }
  if (record.completedAtMs > 0) {
    return GOAL_STATE_COMPLETED;
  }
  if (record.closedAtMs > 0) {
    return GOAL_STATE_CLOSED;
  }
  if (record.expiredAtMs > 0) {
    return GOAL_STATE_EXPIRED;
  }
  if (record.dueAtMs > 0 && record.dueAtMs <= currentMs) {
    return GOAL_STATE_EXPIRED;
  }
  return GOAL_STATE_ACTIVE;
}

function refreshGoalLifecycle(goalID, currentMs = nowMs()) {
  ensureCache();
  const record = cache.records.get(goalID);
  if (!record) {
    return null;
  }

  let changed = false;
  if (
    !record.expiredAtMs &&
    !record.completedAtMs &&
    !record.closedAtMs &&
    record.dueAtMs > 0 &&
    record.dueAtMs <= currentMs
  ) {
    record.expiredAtMs = currentMs;
    record.finishedAtMs = currentMs;
    record.updatedAtMs = currentMs;
    changed = true;
  }
  if (
    !record.completedAtMs &&
    !record.closedAtMs &&
    record.desiredProgress > 0 &&
    record.currentProgress >= record.desiredProgress
  ) {
    record.completedAtMs = currentMs;
    record.finishedAtMs = currentMs;
    record.updatedAtMs = currentMs;
    changed = true;
  }
  if (changed) {
    cache.dirty = true;
    persistCache();
  }
  return cloneValue(record);
}

function refreshCorporationGoals(corporationID, currentMs = nowMs()) {
  ensureCache();
  const index = cache.corporationIndexes.get(corporationID);
  if (!index || index.size === 0) {
    return;
  }
  for (const goalID of index) {
    refreshGoalLifecycle(goalID, currentMs);
  }
}

function getGoalRecord(goalID, options = {}) {
  ensureCache();
  const normalizedGoalID = normalizeText(goalID, "").toLowerCase();
  if (!normalizedGoalID) {
    return null;
  }
  if (options.refresh !== false) {
    refreshGoalLifecycle(normalizedGoalID, nowMs());
  }
  const record = cache.records.get(normalizedGoalID);
  return record ? cloneValue(record) : null;
}

function listCorporationGoals(corporationID, options = {}) {
  ensureCache();
  const numericCorporationID = normalizePositiveInteger(corporationID, null);
  if (!numericCorporationID) {
    return [];
  }
  if (options.refresh !== false) {
    refreshCorporationGoals(numericCorporationID, nowMs());
  }
  const index = cache.corporationIndexes.get(numericCorporationID);
  if (!index || index.size === 0) {
    return [];
  }
  const stateFilter =
    options.state === undefined || options.state === null
      ? null
      : Number(options.state);
  return [...index]
    .map((goalID) => cache.records.get(goalID))
    .filter(Boolean)
    .filter((record) => record.deletedAtMs <= 0)
    .filter((record) => (stateFilter === null ? true : deriveGoalState(record) === stateFilter))
    .sort((left, right) => {
      const leftFinished = Math.max(
        left.finishedAtMs || 0,
        left.updatedAtMs || 0,
        left.createdAtMs || 0,
      );
      const rightFinished = Math.max(
        right.finishedAtMs || 0,
        right.updatedAtMs || 0,
        right.createdAtMs || 0,
      );
      if (rightFinished !== leftFinished) {
        return rightFinished - leftFinished;
      }
      return String(right.goalID).localeCompare(String(left.goalID));
    })
    .map((record) => cloneValue(record));
}

function getGoalCapacity(corporationID) {
  return {
    count: listCorporationGoals(corporationID, {
      state: GOAL_STATE_ACTIVE,
    }).length,
    capacity: ACTIVE_PROJECT_CAPACITY,
  };
}

function createGoal({
  characterID,
  name,
  description,
  desiredProgress,
  contributionConfigurationBase64 = "",
  career = 0,
  dueAtMs = 0,
  participationLimit = null,
  contributionLimit = null,
  scalar = null,
  rewardPools = [],
} = {}) {
  ensureCache();
  const corporationID = getCorporationIDForCharacter(characterID);
  if (!corporationID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_IN_CORPORATION",
    };
  }
  if (!canCharacterManageGoals(characterID, corporationID)) {
    return {
      success: false,
      errorMsg: "FORBIDDEN",
    };
  }
  const capacity = getGoalCapacity(corporationID);
  if (capacity.count >= capacity.capacity) {
    return {
      success: false,
      errorMsg: "AT_CAPACITY",
    };
  }
  const currentMs = nowMs();
  const goalID = createUuidString();
  const normalized = normalizeGoalRecord(
    {
      goalID,
      corporationID,
      creatorCharacterID: characterID,
      createdAtMs: currentMs,
      updatedAtMs: currentMs,
      dueAtMs,
      name,
      description,
      desiredProgress,
      currentProgress: 0,
      career,
      participationLimit,
      contributionLimit,
      scalar,
      contributionConfigurationBase64,
      rewardPools,
      contributors: {},
    },
    goalID,
  );
  cache.records.set(goalID, normalized);
  indexRecord(normalized);
  cache.dirty = true;
  persistCache();
  return {
    success: true,
    data: cloneValue(normalized),
  };
}

function setGoalCurrentProgress(goalID, currentProgress, newProgress, characterID) {
  ensureCache();
  const record = cache.records.get(normalizeText(goalID, "").toLowerCase());
  if (!record || record.deletedAtMs > 0) {
    return {
      success: false,
      errorMsg: "GOAL_NOT_FOUND",
    };
  }
  if (!canCharacterManageGoals(characterID, record.corporationID)) {
    return {
      success: false,
      errorMsg: "FORBIDDEN",
    };
  }
  if (record.currentProgress !== Math.max(0, normalizeInteger(currentProgress, 0))) {
    return {
      success: false,
      errorMsg: "CURRENT_PROGRESS_MISMATCH",
    };
  }
  const previousProgress = record.currentProgress;
  record.currentProgress = Math.max(0, normalizeInteger(newProgress, 0));
  record.updatedAtMs = nowMs();
  cache.dirty = true;
  refreshGoalLifecycle(record.goalID, record.updatedAtMs);
  persistCache();
  return {
    success: true,
    data: {
      record: cloneValue(cache.records.get(record.goalID)),
      previousProgress,
      currentProgress: record.currentProgress,
    },
  };
}

function closeGoal(goalID, characterID) {
  ensureCache();
  const record = cache.records.get(normalizeText(goalID, "").toLowerCase());
  if (!record || record.deletedAtMs > 0) {
    return {
      success: false,
      errorMsg: "GOAL_NOT_FOUND",
    };
  }
  if (!canCharacterManageGoals(characterID, record.corporationID)) {
    return {
      success: false,
      errorMsg: "FORBIDDEN",
    };
  }
  if (deriveGoalState(record) !== GOAL_STATE_ACTIVE) {
    return {
      success: false,
      errorMsg: "GOAL_NOT_ACTIVE",
    };
  }
  const currentMs = nowMs();
  record.closedAtMs = currentMs;
  record.finishedAtMs = currentMs;
  record.updatedAtMs = currentMs;
  cache.dirty = true;
  persistCache();
  return {
    success: true,
    data: cloneValue(record),
  };
}

function deleteGoal(goalID, characterID) {
  ensureCache();
  const normalizedGoalID = normalizeText(goalID, "").toLowerCase();
  const record = cache.records.get(normalizedGoalID);
  if (!record || record.deletedAtMs > 0) {
    return {
      success: false,
      errorMsg: "GOAL_NOT_FOUND",
    };
  }
  if (!canCharacterManageGoals(characterID, record.corporationID)) {
    return {
      success: false,
      errorMsg: "FORBIDDEN",
    };
  }
  unindexRecord(record);
  cache.records.delete(normalizedGoalID);
  cache.dirty = true;
  persistCache();
  return {
    success: true,
    data: cloneValue(record),
  };
}

function getContributorSummary(goalID, characterID) {
  const record = getGoalRecord(goalID);
  if (!record || record.deletedAtMs > 0) {
    return null;
  }
  return cloneValue(
    record.contributors && record.contributors[String(characterID)]
      ? record.contributors[String(characterID)]
      : null,
  );
}

function listContributorSummaries(goalID) {
  const record = getGoalRecord(goalID);
  if (!record || record.deletedAtMs > 0) {
    return [];
  }
  return Object.values(record.contributors || {})
    .sort((left, right) => right.progress - left.progress || left.characterID - right.characterID)
    .map((entry) => cloneValue(entry));
}

function listGoalsWithRewards(corporationID, characterID) {
  return listCorporationGoals(corporationID)
    .filter((record) => {
      const contributor =
        record.contributors && record.contributors[String(characterID)]
          ? record.contributors[String(characterID)]
          : null;
      return contributor && contributor.earningsTotal > contributor.earningsRedeemed;
    })
    .map((record) => record.goalID);
}

function redeemGoalRewards(goalID, characterID) {
  ensureCache();
  const record = cache.records.get(normalizeText(goalID, "").toLowerCase());
  if (!record || record.deletedAtMs > 0) {
    return {
      success: false,
      errorMsg: "GOAL_NOT_FOUND",
    };
  }
  const contributor =
    record.contributors && record.contributors[String(characterID)]
      ? record.contributors[String(characterID)]
      : null;
  const quantity = contributor
    ? Math.max(0, contributor.earningsTotal - contributor.earningsRedeemed)
    : 0;
  if (contributor && quantity > 0) {
    contributor.earningsRedeemed = contributor.earningsTotal;
    record.updatedAtMs = nowMs();
    cache.dirty = true;
    persistCache();
  }
  return {
    success: true,
    data: {
      record: cloneValue(record),
      quantity,
    },
  };
}

function redeemAllGoalRewards(corporationID, characterID) {
  const goalIDs = listGoalsWithRewards(corporationID, characterID);
  let totalQuantity = 0;
  const redeemed = [];
  for (const goalID of goalIDs) {
    const result = redeemGoalRewards(goalID, characterID);
    if (!result.success) {
      continue;
    }
    totalQuantity += result.data.quantity;
    if (result.data.quantity > 0) {
      redeemed.push({
        goalID,
        quantity: result.data.quantity,
      });
    }
  }
  return {
    success: true,
    data: {
      totalQuantity,
      redeemed,
    },
  };
}

function recordGoalContribution(goalID, characterID, progressDelta, options = {}) {
  ensureCache();
  const record = cache.records.get(normalizeText(goalID, "").toLowerCase());
  if (!record || record.deletedAtMs > 0) {
    return {
      success: false,
      errorMsg: "GOAL_NOT_FOUND",
    };
  }
  if (!isCharacterInCorporation(characterID, record.corporationID)) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_IN_CORPORATION",
    };
  }
  if (deriveGoalState(record) !== GOAL_STATE_ACTIVE) {
    return {
      success: false,
      errorMsg: "GOAL_NOT_ACTIVE",
    };
  }
  const contributorKey = String(characterID);
  const contributor = normalizeContributor(
    record.contributors[contributorKey] || { characterID },
    characterID,
  );
  const previousProgress = record.currentProgress;
  const requestedDelta = Math.max(0, normalizeInteger(progressDelta, 0));
  if (requestedDelta <= 0) {
    return {
      success: true,
      data: {
        record: cloneValue(record),
        contributor: cloneValue(contributor),
        previousProgress,
        currentProgress: record.currentProgress,
        creditedQuantity: 0,
      },
    };
  }
  let effectiveDelta = requestedDelta;
  if (record.contributionLimit !== null) {
    const remainingCoverage = Math.max(
      0,
      record.contributionLimit - contributor.earningsTotal,
    );
    effectiveDelta = Math.min(effectiveDelta, remainingCoverage);
  }
  record.currentProgress += requestedDelta;
  contributor.progress += requestedDelta;
  contributor.contributionsCount += Math.max(
    1,
    normalizeInteger(options.contributionsCount, 1),
  );
  const scalar = Number.isFinite(Number(record.scalar))
    ? Number(record.scalar)
    : 1;
  const creditedQuantity = Math.max(
    0,
    Math.trunc(effectiveDelta * Math.max(0, scalar || 1)),
  );
  contributor.earningsTotal += creditedQuantity;
  contributor.lastContributedAtMs = nowMs();
  record.contributors[contributorKey] = contributor;
  record.updatedAtMs = contributor.lastContributedAtMs;
  cache.dirty = true;
  refreshGoalLifecycle(record.goalID, record.updatedAtMs);
  persistCache();
  return {
    success: true,
    data: {
      record: cloneValue(cache.records.get(record.goalID)),
      contributor: cloneValue(contributor),
      previousProgress,
      currentProgress: cache.records.get(record.goalID).currentProgress,
      creditedQuantity,
    },
  };
}

function buildGoalPaymentPools(record) {
  return Array.isArray(record.rewardPools) ? record.rewardPools : [];
}

function buildGoalRewardPreviewValue(record) {
  const pools = buildGoalPaymentPools(record);
  if (pools.length === 0) {
    return 0;
  }
  return currencyToNumber(pools[0].amount);
}

module.exports = {
  ACTIVE_PROJECT_CAPACITY,
  GOAL_STATE_ACTIVE,
  GOAL_STATE_CLOSED,
  GOAL_STATE_COMPLETED,
  GOAL_STATE_EXPIRED,
  TABLE,
  buildGoalPaymentPools,
  buildGoalRewardPreviewValue,
  canCharacterManageGoals,
  createGoal,
  deriveGoalState,
  getContributorSummary,
  getGoalCapacity,
  getGoalRecord,
  getCorporationIDForCharacter,
  isCharacterInCorporation,
  listContributorSummaries,
  listCorporationGoals,
  listGoalsWithRewards,
  recordGoalContribution,
  redeemAllGoalRewards,
  redeemGoalRewards,
  setGoalCurrentProgress,
  closeGoal,
  deleteGoal,
};
