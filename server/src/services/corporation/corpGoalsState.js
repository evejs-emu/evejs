const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  createUuidString,
  sliceWithPage,
} = require(path.join(
  __dirname,
  "../../_secondary/express/gatewayServices/gatewayServiceHelpers",
));
const {
  CORP_ROLE_DIRECTOR,
  CORP_ROLE_PROJECT_MANAGER,
  getCorporationMember,
  normalizePositiveInteger,
  toRoleMaskBigInt,
} = require(path.join(__dirname, "./corporationRuntimeState"));

const TABLE_NAME = "corporationGoals";
const ROOT_VERSION = 1;
const ACTIVE_PROJECT_CAPACITY = 100;
const GOAL_STATE = Object.freeze({
  UNSPECIFIED: 0,
  ACTIVE: 1,
  CLOSED: 2,
  COMPLETED: 3,
  EXPIRED: 4,
});
const GOAL_PAYMENT_PERIOD = Object.freeze({
  UNSPECIFIED: 0,
  CONTRIBUTION: 1,
  COMPLETION: 2,
});

let cachedRoot = null;
let cachedIndexes = null;

function getCharacterRecord(characterID) {
  const characterState = require(path.join(
    __dirname,
    "../character/characterState",
  ));
  return characterState && typeof characterState.getCharacterRecord === "function"
    ? characterState.getCharacterRecord(characterID)
    : null;
}

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function readRoot() {
  const result = database.read(TABLE_NAME, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }
  return result.data;
}

function buildDefaultRoot() {
  return {
    meta: {
      version: ROOT_VERSION,
      description: "DB-backed corporation goal runtime state.",
      updatedAt: new Date().toISOString(),
    },
    goalsByID: {},
  };
}

function ensureRoot() {
  if (cachedRoot) {
    return cachedRoot;
  }

  const current = readRoot();
  const next = buildDefaultRoot();
  next.meta =
    current.meta && typeof current.meta === "object"
      ? {
          ...next.meta,
          ...current.meta,
          version: ROOT_VERSION,
        }
      : next.meta;
  next.goalsByID =
    current.goalsByID && typeof current.goalsByID === "object"
      ? current.goalsByID
      : {};

  cachedRoot = next;
  if (current.meta !== next.meta || current.goalsByID !== next.goalsByID) {
    writeRoot(next);
  }
  return cachedRoot;
}

function writeRoot(root) {
  const nextRoot = {
    meta: {
      version: ROOT_VERSION,
      description: "DB-backed corporation goal runtime state.",
      updatedAt: new Date().toISOString(),
      ...(root && root.meta && typeof root.meta === "object" ? root.meta : {}),
      version: ROOT_VERSION,
    },
    goalsByID:
      root && root.goalsByID && typeof root.goalsByID === "object"
        ? root.goalsByID
        : {},
  };
  const result = database.write(TABLE_NAME, "/", nextRoot);
  if (!result.success) {
    return false;
  }
  cachedRoot = nextRoot;
  cachedIndexes = null;
  return true;
}

function nowMs() {
  return Date.now();
}

function normalizeTimestampMs(value, fallback = 0) {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const seconds = Number(value.seconds || 0);
  const nanos = Number(value.nanos || 0);
  if (!Number.isFinite(seconds) && !Number.isFinite(nanos)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(seconds * 1000 + nanos / 1000000));
}

function normalizeOrganization(value, fallbackCharacterID = 0) {
  const organization = value && typeof value === "object" ? value : {};
  const corporationID = normalizePositiveInteger(
    organization.corporation && organization.corporation.sequential,
    null,
  );
  if (corporationID) {
    return {
      corporationID,
      characterID: null,
    };
  }
  const characterID = normalizePositiveInteger(
    organization.character && organization.character.sequential,
    fallbackCharacterID || null,
  );
  return {
    corporationID: null,
    characterID,
  };
}

function normalizeRewardPools(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const amountValue =
        Number(
          entry &&
            entry.isk &&
            entry.isk.amount &&
            entry.isk.amount.units,
        ) || 0;
      const period = Number(entry && entry.period) || GOAL_PAYMENT_PERIOD.UNSPECIFIED;
      if (!amountValue && !period) {
        return null;
      }
      return {
        period,
        isk: {
          units: Math.max(0, Math.trunc(amountValue)),
          nanos: Number(
            entry &&
              entry.isk &&
              entry.isk.amount &&
              entry.isk.amount.nanos,
          ) || 0,
        },
      };
    })
    .filter(Boolean);
}

function normalizeBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return Boolean(value);
}

function getCharacterCorporationID(characterID) {
  const character = getCharacterRecord(characterID) || {};
  return normalizePositiveInteger(character.corporationID, null);
}

function canCharacterManageCorporationGoals(characterID, corporationID = null) {
  const numericCharacterID = normalizePositiveInteger(characterID, null);
  const numericCorporationID =
    normalizePositiveInteger(corporationID, null) ||
    getCharacterCorporationID(numericCharacterID);
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

function normalizeGoalRecord(goalID, value = {}) {
  const desiredProgress = Math.max(0, Number(value.desiredProgress || 0) || 0);
  const currentProgress = Math.max(0, Number(value.currentProgress || 0) || 0);
  let state = Number(value.state);
  if (!Number.isFinite(state)) {
    state = GOAL_STATE.ACTIVE;
  }
  const dueAtMs = Number(value.dueAtMs || 0) || 0;
  const finishedAtMs = Number(value.finishedAtMs || 0) || 0;
  const contributors =
    value.contributors && typeof value.contributors === "object"
      ? value.contributors
      : {};

  const normalized = {
    goalID: String(goalID || value.goalID || createUuidString()).toLowerCase(),
    corporationID: normalizePositiveInteger(value.corporationID, 0) || 0,
    createdByCharacterID:
      normalizePositiveInteger(value.createdByCharacterID, 0) || 0,
    assigner: normalizeOrganization(value.assigner, 0),
    assignee: normalizeOrganization(value.assignee, 0),
    createdAtMs: Math.max(0, Number(value.createdAtMs || 0) || 0),
    name: String(value.name || ""),
    description: String(value.description || ""),
    desiredProgress,
    currentProgress: Math.min(currentProgress, desiredProgress || currentProgress),
    career: Math.max(0, Number(value.career || 0) || 0),
    contributionConfig:
      value.contributionConfig && Buffer.isBuffer(value.contributionConfig)
        ? value.contributionConfig.toString("base64")
        : value.contributionConfig instanceof Uint8Array
        ? Buffer.from(value.contributionConfig).toString("base64")
        : typeof value.contributionConfig === "string"
        ? value.contributionConfig
        : "",
    dueAtMs,
    finishedAtMs,
    state,
    rewardPools: normalizeRewardPools(value.rewardPools),
    participationLimit:
      value.participationLimit === null || value.participationLimit === undefined
        ? null
        : Math.max(0, Number(value.participationLimit) || 0),
    contributionLimit:
      value.contributionLimit === null || value.contributionLimit === undefined
        ? null
        : Math.max(0, Number(value.contributionLimit) || 0),
    scalar:
      value.scalar === null || value.scalar === undefined
        ? null
        : Number(value.scalar),
    contributors: Object.fromEntries(
      Object.entries(contributors).map(([characterID, summary]) => [
        String(normalizePositiveInteger(characterID, 0) || 0),
        {
          characterID: normalizePositiveInteger(
            summary && summary.characterID,
            normalizePositiveInteger(characterID, 0),
          ),
          progress: Math.max(0, Number(summary && summary.progress) || 0),
          rewardTotal: Math.max(0, Number(summary && summary.rewardTotal) || 0),
          rewardRedeemed: Math.max(
            0,
            Number(summary && summary.rewardRedeemed) || 0,
          ),
          contributedAtMs: Math.max(
            0,
            Number(summary && summary.contributedAtMs) || 0,
          ),
        },
      ]),
    ),
  };

  if (normalized.dueAtMs && normalized.state === GOAL_STATE.ACTIVE && normalized.dueAtMs < nowMs()) {
    normalized.state = GOAL_STATE.EXPIRED;
  }
  if (
    normalized.currentProgress >= normalized.desiredProgress &&
    normalized.desiredProgress > 0 &&
    normalized.state === GOAL_STATE.ACTIVE
  ) {
    normalized.state = GOAL_STATE.COMPLETED;
  }
  if (
    normalized.state === GOAL_STATE.COMPLETED &&
    !normalized.finishedAtMs
  ) {
    normalized.finishedAtMs = nowMs();
  }
  return normalized;
}

function buildIndexes() {
  if (cachedIndexes) {
    return cachedIndexes;
  }
  const root = ensureRoot();
  const byCorporation = new Map();
  const byCharacter = new Map();
  const allGoals = new Map();

  for (const [goalID, rawGoal] of Object.entries(root.goalsByID || {})) {
    const goal = normalizeGoalRecord(goalID, rawGoal);
    allGoals.set(goal.goalID, goal);
    if (!byCorporation.has(goal.corporationID)) {
      byCorporation.set(goal.corporationID, []);
    }
    byCorporation.get(goal.corporationID).push(goal);
    for (const summary of Object.values(goal.contributors || {})) {
      const characterID = normalizePositiveInteger(summary.characterID, 0);
      if (!characterID) {
        continue;
      }
      if (!byCharacter.has(characterID)) {
        byCharacter.set(characterID, []);
      }
      byCharacter.get(characterID).push(goal);
    }
  }

  for (const goals of byCorporation.values()) {
    goals.sort((left, right) => right.createdAtMs - left.createdAtMs);
  }
  for (const goals of byCharacter.values()) {
    goals.sort((left, right) => right.createdAtMs - left.createdAtMs);
  }

  cachedIndexes = {
    allGoals,
    byCorporation,
    byCharacter,
  };
  return cachedIndexes;
}

function persistGoal(goal) {
  const root = ensureRoot();
  root.goalsByID[goal.goalID] = cloneValue(goal);
  writeRoot(root);
  return goal;
}

function removeGoal(goalID) {
  const root = ensureRoot();
  if (root.goalsByID && root.goalsByID[String(goalID || "").toLowerCase()]) {
    delete root.goalsByID[String(goalID || "").toLowerCase()];
    writeRoot(root);
  }
}

function getGoal(goalID) {
  const goal = buildIndexes().allGoals.get(String(goalID || "").toLowerCase());
  return goal ? cloneValue(goal) : null;
}

function getGoalsForCorporation(corporationID) {
  return cloneValue(buildIndexes().byCorporation.get(Number(corporationID) || 0) || []);
}

function getCapacityInfo(corporationID) {
  const goals = getGoalsForCorporation(corporationID);
  const count = goals.filter((goal) => goal.state === GOAL_STATE.ACTIVE).length;
  return {
    count,
    capacity: ACTIVE_PROJECT_CAPACITY,
  };
}

function createGoal(characterID, payload = {}) {
  const corporationID = getCharacterCorporationID(characterID);
  if (!canCharacterManageCorporationGoals(characterID, corporationID)) {
    return {
      success: false,
      errorMsg: "CANNOT_MANAGE_GOALS",
    };
  }
  const capacity = getCapacityInfo(corporationID);
  if (capacity.count >= capacity.capacity) {
    return {
      success: false,
      errorMsg: "GOAL_CAPACITY_REACHED",
    };
  }

  const goalID = createUuidString();
  const createdAtMs = nowMs();
  const goal = normalizeGoalRecord(goalID, {
    goalID,
    corporationID,
    createdByCharacterID: characterID,
    assigner: { corporationID },
    assignee: { corporationID },
    createdAtMs,
    name: payload.name || "",
    description: payload.description || "",
    desiredProgress: Number(payload.desired_progress || 0) || 0,
    currentProgress: 0,
    career: Number(payload.career || 0) || 0,
    contributionConfig:
      payload.contribution_configuration &&
      (Buffer.isBuffer(payload.contribution_configuration) ||
        payload.contribution_configuration instanceof Uint8Array)
        ? Buffer.from(payload.contribution_configuration).toString("base64")
        : "",
    dueAtMs: payload.timestamp ? normalizeTimestampMs(payload.timestamp, 0) : 0,
    finishedAtMs: 0,
    state: GOAL_STATE.ACTIVE,
    rewardPools: normalizeRewardPools(payload.reward_pools),
    participationLimit: payload.limit !== undefined && payload.limit !== null ? Number(payload.limit) || 0 : null,
    contributionLimit:
      payload.contribution_limit !== undefined && payload.contribution_limit !== null
        ? Number(payload.contribution_limit) || 0
        : null,
    scalar:
      payload.scalar !== undefined && payload.scalar !== null
        ? Number(payload.scalar)
        : null,
    contributors: {},
  });
  persistGoal(goal);
  return {
    success: true,
    data: cloneValue(goal),
  };
}

function updateGoalState(goalID, updater) {
  const current = getGoal(goalID);
  if (!current) {
    return null;
  }
  const next = normalizeGoalRecord(goalID, updater(cloneValue(current)) || current);
  persistGoal(next);
  return next;
}

function closeGoal(goalID, characterID) {
  const goal = getGoal(goalID);
  if (!goal) {
    return { success: false, errorMsg: "GOAL_NOT_FOUND" };
  }
  if (!canCharacterManageCorporationGoals(characterID, goal.corporationID)) {
    return { success: false, errorMsg: "CANNOT_MANAGE_GOALS" };
  }
  const next = updateGoalState(goalID, (draft) => {
    draft.state = GOAL_STATE.CLOSED;
    if (!draft.finishedAtMs) {
      draft.finishedAtMs = nowMs();
    }
    return draft;
  });
  return { success: true, data: next };
}

function deleteGoal(goalID, characterID) {
  const goal = getGoal(goalID);
  if (!goal) {
    return { success: false, errorMsg: "GOAL_NOT_FOUND" };
  }
  if (!canCharacterManageCorporationGoals(characterID, goal.corporationID)) {
    return { success: false, errorMsg: "CANNOT_MANAGE_GOALS" };
  }
  removeGoal(goalID);
  return { success: true };
}

function setGoalCurrentProgress(goalID, currentProgress, newProgress, characterID) {
  const goal = getGoal(goalID);
  if (!goal) {
    return { success: false, errorMsg: "GOAL_NOT_FOUND" };
  }
  if (!canCharacterManageCorporationGoals(characterID, goal.corporationID)) {
    return { success: false, errorMsg: "CANNOT_MANAGE_GOALS" };
  }
  const next = updateGoalState(goalID, (draft) => {
    const requestedCurrent = Math.max(0, Number(currentProgress || 0) || 0);
    const requestedNew = Math.max(0, Number(newProgress || 0) || 0);
    if (draft.currentProgress === requestedCurrent || requestedCurrent === 0) {
      draft.currentProgress = Math.min(
        requestedNew,
        draft.desiredProgress || requestedNew,
      );
    }
    if (
      draft.currentProgress >= draft.desiredProgress &&
      draft.desiredProgress > 0
    ) {
      draft.state = GOAL_STATE.COMPLETED;
      if (!draft.finishedAtMs) {
        draft.finishedAtMs = nowMs();
      }
    }
    return draft;
  });
  return {
    success: true,
    data: next,
  };
}

function listGoalIDsForCorporation(corporationID) {
  return getGoalsForCorporation(corporationID).map((goal) => goal.goalID);
}

function listActiveGoalIDsForCorporation(corporationID, page) {
  const activeGoals = getGoalsForCorporation(corporationID).filter(
    (goal) => goal.state === GOAL_STATE.ACTIVE,
  );
  return sliceWithPage(activeGoals, page);
}

function listInactiveGoalIDsForCorporation(corporationID, timespan, page) {
  const startAtMs = normalizeTimestampMs(timespan && timespan.start_time, 0);
  const durationMs =
    timespan && timespan.duration && typeof timespan.duration === "object"
      ? Math.max(
          0,
          Math.trunc(
            Number(timespan.duration.seconds || 0) * 1000 +
              Number(timespan.duration.nanos || 0) / 1000000,
          ),
        )
      : 0;
  const endAtMs = startAtMs && durationMs ? startAtMs + durationMs : 0;
  const filtered = getGoalsForCorporation(corporationID).filter((goal) => {
    if (goal.state === GOAL_STATE.ACTIVE) {
      return false;
    }
    const finishedAtMs = Number(goal.finishedAtMs || goal.createdAtMs || 0) || 0;
    if (!startAtMs || !endAtMs) {
      return true;
    }
    return finishedAtMs >= startAtMs && finishedAtMs <= endAtMs;
  });
  return sliceWithPage(filtered, page);
}

function buildContributorSummary(goal, contributor) {
  if (!goal || !contributor) {
    return null;
  }
  return {
    contributor: {
      sequential: Number(contributor.characterID || 0),
    },
    progress: Number(contributor.progress || 0),
    goal: {
      uuid: contributor.goalUUIDBuffer || null,
    },
    earnings:
      contributor.rewardTotal > 0
        ? [
            {
              quantity: {
                total: Number(contributor.rewardTotal || 0),
                redeemed: Number(contributor.rewardRedeemed || 0),
              },
            },
          ]
        : [],
  };
}

function listContributorSummariesForGoal(goalID, page) {
  const goal = getGoal(goalID);
  if (!goal) {
    return sliceWithPage([], page);
  }
  const contributors = Object.values(goal.contributors || {})
    .map((entry) => ({
      ...entry,
      goalID,
    }))
    .sort((left, right) => right.progress - left.progress);
  return sliceWithPage(contributors, page);
}

function getContributorSummaryForGoal(goalID, characterID) {
  const goal = getGoal(goalID);
  if (!goal) {
    return null;
  }
  return cloneValue(
    goal.contributors[String(normalizePositiveInteger(characterID, 0) || 0)] || null,
  );
}

function listContributorSummariesForCharacter(characterID, timespan, page) {
  const goals = cloneValue(buildIndexes().byCharacter.get(Number(characterID) || 0) || []);
  const contributorKey = String(normalizePositiveInteger(characterID, 0) || 0);
  const startAtMs = normalizeTimestampMs(timespan && timespan.start_time, 0);
  const durationMs =
    timespan && timespan.duration && typeof timespan.duration === "object"
      ? Math.max(
          0,
          Math.trunc(
            Number(timespan.duration.seconds || 0) * 1000 +
              Number(timespan.duration.nanos || 0) / 1000000,
          ),
        )
      : 0;
  const endAtMs = startAtMs && durationMs ? startAtMs + durationMs : 0;

  const summaries = goals
    .map((goal) => {
      const contributor = goal.contributors[contributorKey] || null;
      if (!contributor) {
        return null;
      }
      if (startAtMs && endAtMs) {
        const contributedAtMs = Number(contributor.contributedAtMs || 0) || 0;
        if (contributedAtMs < startAtMs || contributedAtMs > endAtMs) {
          return null;
        }
      }
      return {
        ...contributor,
        goalID: goal.goalID,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (right.contributedAtMs || 0) - (left.contributedAtMs || 0));

  return sliceWithPage(summaries, page);
}

function listRewardGoalIDsForCharacter(characterID, page) {
  const goals = cloneValue(buildIndexes().byCharacter.get(Number(characterID) || 0) || []);
  const rewards = goals.filter((goal) => {
    const contributor =
      goal.contributors[String(normalizePositiveInteger(characterID, 0) || 0)] || null;
    if (!contributor) {
      return false;
    }
    return Number(contributor.rewardTotal || 0) > Number(contributor.rewardRedeemed || 0);
  });
  return sliceWithPage(rewards, page);
}

function redeemRewardsForGoal(goalID, characterID) {
  const goal = getGoal(goalID);
  if (!goal) {
    return { success: false, errorMsg: "GOAL_NOT_FOUND" };
  }
  const contributor = getContributorSummaryForGoal(goalID, characterID);
  if (!contributor) {
    return { success: true, data: null };
  }
  updateGoalState(goalID, (draft) => {
    const key = String(normalizePositiveInteger(characterID, 0) || 0);
    const summary = draft.contributors[key];
    if (summary) {
      summary.rewardRedeemed = Number(summary.rewardTotal || 0);
    }
    return draft;
  });
  return { success: true };
}

function goalToPayload(goal) {
  const numericGoal = goal || {};
  const payload = {
    created: timestampFromMs(numericGoal.createdAtMs),
    user_input_name: String(numericGoal.name || ""),
    user_input_description: String(numericGoal.description || ""),
    creator: {
      sequential: Number(numericGoal.createdByCharacterID || 0),
    },
    progress: {
      desired: Number(numericGoal.desiredProgress || 0),
      current: Number(numericGoal.currentProgress || 0),
    },
    state: Number(numericGoal.state || GOAL_STATE.UNSPECIFIED),
    contribution_config: Buffer.from(
      String(numericGoal.contributionConfig || ""),
      "base64",
    ),
    career: Number(numericGoal.career || 0),
    payment: normalizeRewardPools(numericGoal.rewardPools).map((pool) => ({
      period: Number(pool.period || GOAL_PAYMENT_PERIOD.UNSPECIFIED),
      benefactor: {
        corporation: {
          sequential: Number(numericGoal.corporationID || 0),
        },
      },
      capacity: {
        original: Number(pool.isk && pool.isk.units ? pool.isk.units : 0),
        remaining: Number(pool.isk && pool.isk.units ? pool.isk.units : 0),
      },
      unit: {
        amount: {
          units: Number(pool.isk && pool.isk.units ? pool.isk.units : 0),
          nanos: Number(pool.isk && pool.isk.nanos ? pool.isk.nanos : 0),
        },
      },
    })),
    assigner: {
      corporation: {
        sequential: Number(numericGoal.corporationID || 0),
      },
    },
    assignee: {
      corporation: {
        sequential: Number(numericGoal.corporationID || 0),
      },
    },
  };

  if (numericGoal.finishedAtMs) {
    payload.finished = timestampFromMs(numericGoal.finishedAtMs);
  } else {
    payload.not_finished = true;
  }
  if (numericGoal.dueAtMs) {
    payload.due = timestampFromMs(numericGoal.dueAtMs);
  } else {
    payload.no_due_timestamp = true;
  }
  if (numericGoal.participationLimit === null || numericGoal.participationLimit === undefined) {
    payload.unlimited = true;
  } else {
    payload.limit = Number(numericGoal.participationLimit || 0);
  }
  if (numericGoal.contributionLimit === null || numericGoal.contributionLimit === undefined) {
    payload.contribution_unlimited = true;
  } else {
    payload.contribution_limit = Number(numericGoal.contributionLimit || 0);
  }
  if (numericGoal.scalar === null || numericGoal.scalar === undefined) {
    payload.default = true;
  } else {
    payload.scalar = Number(numericGoal.scalar || 0);
  }
  return payload;
}

function timestampFromMs(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return {
      seconds: 0,
      nanos: 0,
    };
  }
  const wholeMilliseconds = Math.trunc(numericValue);
  return {
    seconds: Math.floor(wholeMilliseconds / 1000),
    nanos: (wholeMilliseconds % 1000) * 1000000,
  };
}

module.exports = {
  ACTIVE_PROJECT_CAPACITY,
  GOAL_PAYMENT_PERIOD,
  GOAL_STATE,
  canCharacterManageCorporationGoals,
  createGoal,
  getCapacityInfo,
  getCharacterCorporationID,
  getContributorSummaryForGoal,
  getGoal,
  getGoalsForCorporation,
  goalToPayload,
  closeGoal,
  deleteGoal,
  listActiveGoalIDsForCorporation,
  listContributorSummariesForCharacter,
  listContributorSummariesForGoal,
  listGoalIDsForCorporation,
  listInactiveGoalIDsForCorporation,
  listRewardGoalIDsForCharacter,
  redeemRewardsForGoal,
  setGoalCurrentProgress,
};
