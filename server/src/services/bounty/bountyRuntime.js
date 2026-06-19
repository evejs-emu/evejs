const path = require("path");
const { performance } = require("perf_hooks");

const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  JOURNAL_ENTRY_TYPE,
  adjustCharacterBalance,
} = require(path.join(__dirname, "../account/walletState"));

const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;
const DEFAULT_PAYOUT_INTERVAL_MS = 20 * 60 * 1000;
const MAX_SOURCE_REFERENCES = 32;

let payoutIntervalMs = DEFAULT_PAYOUT_INTERVAL_MS;
let nowProvider = () => Date.now();
let timerEnabled = true;
let payoutTimer = null;
let nextDueAtMs = Number.POSITIVE_INFINITY;

const bucketsByKey = new Map();

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = null) {
  const numeric = toInt(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeMoney(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.round(numeric * 100) / 100;
}

function formatFiletime(whenMs) {
  const normalizedWhenMs = Number.isFinite(Number(whenMs))
    ? Math.trunc(Number(whenMs))
    : nowProvider();
  return (
    BigInt(normalizedWhenMs) * FILETIME_TICKS_PER_MS +
    FILETIME_EPOCH_OFFSET
  ).toString();
}

function resolvePayoutAtMs(nowMs = nowProvider()) {
  const interval = Math.max(1, toInt(payoutIntervalMs, DEFAULT_PAYOUT_INTERVAL_MS));
  return (Math.floor(nowMs / interval) + 1) * interval;
}

function buildBucketKey(characterID, solarSystemID, payoutTime) {
  return `${toPositiveInt(characterID, 0) || 0}:${toPositiveInt(solarSystemID, 0) || 0}:${String(payoutTime || "")}`;
}

function isPlayerVictim(entity) {
  return toPositiveInt(entity && (entity.pilotCharacterID ?? entity.characterID), null) !== null;
}

function resolveAuthoredMultiplier(entity = {}, context = {}) {
  const candidates = [
    context.bountyPayoutMultiplier,
    context.bountyPayOutMultiplier,
    entity.bountyPayoutMultiplier,
    entity.bountyPayOutMultiplier,
    entity.spawnBountyPayoutMultiplier,
    entity.spawnBountyPayOutMultiplier,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }
  return 1;
}

function resolveSolarSystemBountyMultiplier(_solarSystemID, _context = {}) {
  return 1;
}

function resolveEssBountySplit(_solarSystemID, amount, _context = {}) {
  return {
    playerAmount: normalizeMoney(amount, 0),
    essMainBankAmount: 0,
    reserveBankAmount: 0,
    securityTaxAmount: 0,
  };
}

function resolveNpcBountyAmount(victimEntity = {}, context = {}) {
  if (!victimEntity || isPlayerVictim(victimEntity)) {
    return {
      eligible: false,
      amount: 0,
      baseAmount: 0,
      isModified: false,
    };
  }

  const baseAmount = Math.max(0, normalizeMoney(victimEntity.bounty, 0));
  if (baseAmount <= 0) {
    return {
      eligible: false,
      amount: 0,
      baseAmount,
      isModified: false,
    };
  }

  const solarSystemID = toPositiveInt(
    context.solarSystemID,
    toPositiveInt(victimEntity.systemID, 0),
  ) || 0;
  const authoredMultiplier = resolveAuthoredMultiplier(victimEntity, context);
  const solarSystemMultiplier = resolveSolarSystemBountyMultiplier(solarSystemID, context);
  const grossAmount = normalizeMoney(baseAmount * authoredMultiplier * solarSystemMultiplier, 0);
  const split = resolveEssBountySplit(solarSystemID, grossAmount, context);
  const amount = Math.max(0, normalizeMoney(split.playerAmount, 0));

  return {
    eligible: amount > 0,
    amount,
    baseAmount,
    grossAmount,
    solarSystemID,
    authoredMultiplier,
    solarSystemMultiplier,
    essMainBankAmount: normalizeMoney(split.essMainBankAmount, 0),
    reserveBankAmount: normalizeMoney(split.reserveBankAmount, 0),
    securityTaxAmount: normalizeMoney(split.securityTaxAmount, 0),
    isModified:
      normalizeMoney(baseAmount, 0) !== amount ||
      authoredMultiplier !== 1 ||
      solarSystemMultiplier !== 1 ||
      normalizeMoney(split.essMainBankAmount, 0) > 0 ||
      normalizeMoney(split.reserveBankAmount, 0) > 0 ||
      normalizeMoney(split.securityTaxAmount, 0) > 0,
  };
}

function notifyBountyAdded(characterID, payload) {
  const sessions = sessionRegistry
    .getSessions()
    .filter((session) => Number((session && session.characterID) || 0) === Number(characterID || 0));

  for (const session of sessions) {
    if (session && typeof session.sendNotification === "function") {
      session.sendNotification("OnBountyAddedToPayout", "charid", [payload]);
    }
  }
}

function clearTimer() {
  if (payoutTimer) {
    clearTimeout(payoutTimer);
    payoutTimer = null;
  }
}

function refreshNextDueAt() {
  nextDueAtMs = Number.POSITIVE_INFINITY;
  for (const bucket of bucketsByKey.values()) {
    if (bucket.payoutAtMs < nextDueAtMs) {
      nextDueAtMs = bucket.payoutAtMs;
    }
  }
}

function scheduleTimer() {
  clearTimer();
  if (!timerEnabled || !Number.isFinite(nextDueAtMs)) {
    return;
  }
  const delayMs = Math.max(1, nextDueAtMs - nowProvider());
  payoutTimer = setTimeout(() => {
    payoutTimer = null;
    flushDuePayouts();
  }, delayMs);
  if (typeof payoutTimer.unref === "function") {
    payoutTimer.unref();
  }
}

function noteBucketDueAt(payoutAtMs) {
  if (payoutAtMs < nextDueAtMs) {
    nextDueAtMs = payoutAtMs;
    scheduleTimer();
  }
}

function getOrCreateBucket(characterID, solarSystemID, payoutAtMs) {
  const payoutTime = formatFiletime(payoutAtMs);
  const key = buildBucketKey(characterID, solarSystemID, payoutTime);
  const existing = bucketsByKey.get(key);
  if (existing) {
    return existing;
  }

  const bucket = {
    key,
    characterID,
    solarSystemID,
    payoutAtMs,
    payoutTime,
    amount: 0,
    kills: 0,
    npcTypes: {},
    sourceReferences: [],
  };
  bucketsByKey.set(key, bucket);
  noteBucketDueAt(payoutAtMs);
  return bucket;
}

function addToBucket(bucket, award = {}) {
  bucket.amount = normalizeMoney(bucket.amount + normalizeMoney(award.amount, 0), 0);
  bucket.kills += 1;

  const typeID = toPositiveInt(award.enemyTypeID, 0) || 0;
  if (typeID > 0) {
    bucket.npcTypes[String(typeID)] = (toInt(bucket.npcTypes[String(typeID)], 0) || 0) + 1;
  }

  const sourceReference = toPositiveInt(award.referenceID, null);
  if (sourceReference && bucket.sourceReferences.length < MAX_SOURCE_REFERENCES) {
    bucket.sourceReferences.push(sourceReference);
  }
}

function recordNpcBountyKill(victimEntity = {}, finalAttacker = {}, context = {}) {
  const characterID = toPositiveInt(
    context.characterID,
    toPositiveInt(finalAttacker && finalAttacker.characterID, null),
  );
  if (!characterID) {
    return null;
  }

  const resolution = resolveNpcBountyAmount(victimEntity, context);
  if (!resolution.eligible) {
    return null;
  }

  const solarSystemID = toPositiveInt(
    resolution.solarSystemID,
    toPositiveInt(victimEntity && victimEntity.systemID, 0),
  ) || 0;
  const nowMs = Number.isFinite(Number(context.nowMs)) ? Number(context.nowMs) : nowProvider();
  const payoutAtMs = Number.isFinite(Number(context.payoutAtMs))
    ? Math.trunc(Number(context.payoutAtMs))
    : resolvePayoutAtMs(nowMs);
  const bucket = getOrCreateBucket(characterID, solarSystemID, payoutAtMs);
  const enemyTypeID = toPositiveInt(victimEntity && victimEntity.typeID, 0) || 0;

  addToBucket(bucket, {
    amount: resolution.amount,
    enemyTypeID,
    referenceID: toPositiveInt(victimEntity && victimEntity.itemID, null),
  });

  const payload = {
    enemyTypeID,
    amount: resolution.amount,
    payoutTime: bucket.payoutTime,
    isModified: Boolean(resolution.isModified),
  };
  notifyBountyAdded(characterID, payload);

  return {
    ...resolution,
    characterID,
    solarSystemID,
    payoutAtMs,
    payoutTime: bucket.payoutTime,
    bucketKey: bucket.key,
    notification: payload,
  };
}

function buildWalletDescription(bucket) {
  return JSON.stringify({
    NBL: bucket.npcTypes,
    solarSystemID: bucket.solarSystemID,
    kills: bucket.kills,
  });
}

function payoutBucket(bucket) {
  if (!bucket || !(bucket.amount > 0) || !(bucket.characterID > 0)) {
    return {
      success: false,
      errorMsg: "INVALID_BOUNTY_BUCKET",
    };
  }

  return adjustCharacterBalance(bucket.characterID, bucket.amount, {
    entryTypeID: bucket.kills > 1
      ? JOURNAL_ENTRY_TYPE.NPC_BOUNTY_PRIZES
      : JOURNAL_ENTRY_TYPE.NPC_BOUNTY_PRIZE,
    description: buildWalletDescription(bucket),
    ownerID1: bucket.characterID,
    ownerID2: 0,
    referenceID:
      bucket.sourceReferences[0] ||
      bucket.solarSystemID ||
      bucket.characterID,
  });
}

function flushDuePayouts(nowMs = nowProvider()) {
  if (nowMs < nextDueAtMs) {
    return {
      flushed: 0,
      amount: 0,
      due: false,
    };
  }

  let flushed = 0;
  let amount = 0;
  const results = [];
  for (const [key, bucket] of bucketsByKey.entries()) {
    if (bucket.payoutAtMs > nowMs) {
      continue;
    }
    bucketsByKey.delete(key);
    const result = payoutBucket(bucket);
    results.push({
      key,
      result,
      amount: bucket.amount,
      kills: bucket.kills,
    });
    if (result && result.success === true) {
      flushed += 1;
      amount = normalizeMoney(amount + bucket.amount, 0);
    }
  }

  refreshNextDueAt();
  scheduleTimer();
  return {
    flushed,
    amount,
    due: true,
    results,
  };
}

function listPendingBuckets() {
  return Array.from(bucketsByKey.values()).map((bucket) => ({
    ...bucket,
    npcTypes: { ...bucket.npcTypes },
    sourceReferences: [...bucket.sourceReferences],
  }));
}

function resetForTests() {
  clearTimer();
  bucketsByKey.clear();
  payoutIntervalMs = DEFAULT_PAYOUT_INTERVAL_MS;
  nowProvider = () => Date.now();
  timerEnabled = true;
  nextDueAtMs = Number.POSITIVE_INFINITY;
}

function configureForTests(options = {}) {
  if (Number.isFinite(Number(options.payoutIntervalMs))) {
    payoutIntervalMs = Math.max(1, Math.trunc(Number(options.payoutIntervalMs)));
  }
  if (typeof options.nowProvider === "function") {
    nowProvider = options.nowProvider;
  }
  if (options.timerEnabled !== undefined) {
    timerEnabled = options.timerEnabled === true;
  }
  scheduleTimer();
}

function benchmarkAccrual(count = 1000) {
  resetForTests();
  configureForTests({
    timerEnabled: false,
    nowProvider: () => 1_000,
    payoutIntervalMs: DEFAULT_PAYOUT_INTERVAL_MS,
  });
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    recordNpcBountyKill(
      {
        itemID: 90_000_000 + index,
        typeID: 16994,
        bounty: 1000,
        systemID: 30000142,
      },
      {
        characterID: 99_000_001,
      },
      {
        nowMs: 1_000,
      },
    );
  }
  return {
    count,
    elapsedMs: performance.now() - started,
    pendingBuckets: bucketsByKey.size,
  };
}

function benchmarkBucketAggregation(count = 1000) {
  resetForTests();
  configureForTests({
    timerEnabled: false,
    nowProvider: () => 1_000,
    payoutIntervalMs: DEFAULT_PAYOUT_INTERVAL_MS,
  });
  const bucket = getOrCreateBucket(99_000_001, 30000142, resolvePayoutAtMs(1_000));
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    addToBucket(bucket, {
      amount: 1000,
      enemyTypeID: 16994,
      referenceID: 90_000_000 + index,
    });
  }
  return {
    count,
    elapsedMs: performance.now() - started,
    pendingBuckets: bucketsByKey.size,
    amount: bucket.amount,
  };
}

module.exports = {
  DEFAULT_PAYOUT_INTERVAL_MS,
  formatFiletime,
  resolvePayoutAtMs,
  resolveNpcBountyAmount,
  recordNpcBountyKill,
  flushDuePayouts,
  listPendingBuckets,
  benchmarkAccrual,
  benchmarkBucketAggregation,
  _testing: {
    resetForTests,
    configureForTests,
    buildBucketKey,
    buildWalletDescription,
  },
};
