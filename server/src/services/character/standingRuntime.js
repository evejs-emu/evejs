const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "./characterState"));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  getAgentByID,
  listAgents,
} = require(path.join(__dirname, "../agent/agentAuthority"));
const {
  clearCache: clearNpcStandingsAuthorityCache,
  getRelationsForOwner,
  listNpcStandings: listNpcStandingsFromAuthority,
} = require(path.join(__dirname, "./npcStandingsAuthority"));
const {
  getCharacterIDsInCorporation,
  getCorporationRecord,
  getOwnerLookupRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  getAllFactionRecords,
  getFactionIDForCorporation,
  isFactionID,
} = require(path.join(__dirname, "../faction/factionState"));

const MAX_STANDING = 10.0;
const MIN_STANDING = -10.0;
const ZERO_STANDING_EPSILON = 1e-9;
const STANDING_TRANSACTION_LIMIT = 512;
const TYPE_SOCIAL = 3355;
const TYPE_DIPLOMACY = 3357;
const TYPE_CONNECTIONS = 3359;
const TYPE_CRIMINAL_CONNECTIONS = 3361;
const SOCIAL_GAIN_BONUS_PER_LEVEL = 0.05;
const STANDING_BONUS_PER_LEVEL = 0.4;

const EVENT_STANDING_RESET = 25;
const EVENT_STANDING_PLAYER_SET = 65;
const EVENT_STANDING_PLAYER_CORP_SET = 68;
const EVENT_STANDING_AGENT_MISSION_COMPLETED = 73;
const EVENT_STANDING_AGENT_MISSION_FAILED = 74;
const EVENT_STANDING_AGENT_MISSION_DECLINED = 75;
const EVENT_STANDING_AGENT_MISSION_BONUS = 80;
const EVENT_STANDING_DERIVED_POSITIVE = 82;
const EVENT_STANDING_DERIVED_NEGATIVE = 83;
const EVENT_STANDING_SLASH_SET = 84;
const EVENT_STANDING_AGENT_MISSION_OFFER_EXPIRED = 90;
const EVENT_STANDING_COMBAT_AGGRESSION = 76;
const EVENT_STANDING_CONTRABAND_TRAFFICKING = 126;
const EVENT_STANDING_GROUP_REWARD_CORPORATION = 485;
const EVENT_STANDING_GROUP_REWARD_FACTION = 486;

const MISSION_STANDING_EVENT_TYPE_BY_OUTCOME = Object.freeze({
  completed: EVENT_STANDING_AGENT_MISSION_COMPLETED,
  declined: EVENT_STANDING_AGENT_MISSION_DECLINED,
  failed: EVENT_STANDING_AGENT_MISSION_FAILED,
  offerExpired: EVENT_STANDING_AGENT_MISSION_OFFER_EXPIRED,
  bonus: EVENT_STANDING_AGENT_MISSION_BONUS,
});

const MISSION_STANDING_SOCIAL_BY_OUTCOME = Object.freeze({
  completed: true,
  declined: false,
  failed: false,
  offerExpired: false,
  bonus: true,
});

const PIRATE_FACTION_IDS = new Set([
  500010,
  500011,
  500012,
  500019,
  500020,
  500029,
]);

const NO_BONUS_FACTION_IDS = new Set([
  500024,
  500025,
  500026,
  500027,
]);

let cachedAgentStandingOwnerIDs = null;
let cachedFactionRecordsByName = null;
const characterStandingBucketsCache = new Map();
const corporationStandingsCache = new Map();
const standingCompositionCache = new Map();
const standingTransactionCache = new Map();

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text.length > 0 ? text : fallback;
}

function clampStanding(value) {
  return Math.max(MIN_STANDING, Math.min(MAX_STANDING, toNumber(value, 0)));
}

function roundStandingValue(value) {
  return Math.round(toNumber(value, 0) * 1000) / 1000;
}

function nowFileTimeString() {
  return (BigInt(Date.now()) * 10000n + 116444736000000000n).toString();
}

function normalizeStandingOwnerID(value) {
  const numeric = normalizePositiveInteger(value, 0);
  return numeric > 0 ? numeric : null;
}

function normalizeStandingEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const fromID = normalizeStandingOwnerID(entry.fromID);
  const toID = normalizeStandingOwnerID(entry.toID);
  if (!fromID || !toID || fromID === toID) {
    return null;
  }

  return {
    fromID,
    toID,
    standing: clampStanding(entry.standing),
  };
}

function ensureStandingData(record) {
  if (!record.standingData || typeof record.standingData !== "object") {
    record.standingData = {};
  }
  if (!Array.isArray(record.standingData.char)) {
    record.standingData.char = [];
  }
  if (!Array.isArray(record.standingData.corp)) {
    record.standingData.corp = [];
  }
  if (!Array.isArray(record.standingData.npc)) {
    record.standingData.npc = [];
  }
  return record.standingData;
}

function ensureStandingTransactions(record) {
  if (!Array.isArray(record.standingTransactions)) {
    record.standingTransactions = [];
  }
  return record.standingTransactions;
}

function buildCharacterStandingBuckets(record) {
  return {
    charRows: getLegacyOrBucketStandingRows(record, "char")
      .map((entry) => normalizeStandingEntry(entry))
      .filter(Boolean),
    corpRows: getLegacyOrBucketStandingRows(record, "corp")
      .map((entry) => normalizeStandingEntry(entry))
      .filter(Boolean),
    npcRows: getLegacyOrBucketStandingRows(record, "npc")
      .map((entry) => normalizeStandingEntry(entry))
      .filter(Boolean),
  };
}

function getCharacterStandingBuckets(characterID) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return {
      charRows: [],
      corpRows: [],
      npcRows: [],
    };
  }

  if (characterStandingBucketsCache.has(normalizedCharacterID)) {
    return characterStandingBucketsCache.get(normalizedCharacterID);
  }

  const record = getCharacterRecord(normalizedCharacterID);
  const buckets = buildCharacterStandingBuckets(record);
  characterStandingBucketsCache.set(normalizedCharacterID, buckets);
  return buckets;
}

function clearStandingTransactionCacheForCharacter(characterID) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return;
  }

  for (const key of standingTransactionCache.keys()) {
    const [, toID] = String(key).split(":");
    if (toInt(toID, 0) === normalizedCharacterID) {
      standingTransactionCache.delete(key);
    }
  }
}

function clearStandingCompositionCacheForCorporation(corporationID) {
  const normalizedCorporationID = normalizePositiveInteger(corporationID, 0);
  if (!normalizedCorporationID) {
    return;
  }

  corporationStandingsCache.delete(normalizedCorporationID);
  for (const key of standingCompositionCache.keys()) {
    const [, toID] = String(key).split(":");
    if (toInt(toID, 0) === normalizedCorporationID) {
      standingCompositionCache.delete(key);
    }
  }
}

function clearStandingRuntimeCaches(options = {}) {
  const includeStaticCaches = options && options.includeStaticCaches === true;
  characterStandingBucketsCache.clear();
  corporationStandingsCache.clear();
  standingCompositionCache.clear();
  standingTransactionCache.clear();
  if (includeStaticCaches) {
    cachedAgentStandingOwnerIDs = null;
    cachedFactionRecordsByName = null;
    clearNpcStandingsAuthorityCache();
  }
}

function invalidateStandingCachesForCharacter(characterID, record = null) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return;
  }

  characterStandingBucketsCache.delete(normalizedCharacterID);
  clearStandingTransactionCacheForCharacter(normalizedCharacterID);
  const characterRecord = record || getCharacterRecord(normalizedCharacterID);
  clearStandingCompositionCacheForCorporation(
    normalizePositiveInteger(characterRecord && characterRecord.corporationID, 0),
  );
}

function isNpcOwner(ownerID) {
  return Boolean(getOwnerLookupRecord(normalizePositiveInteger(ownerID, 0)));
}

function readAllCharacterRecords() {
  const result = database.read("characters", "/");
  const records =
    result.success && result.data && typeof result.data === "object"
      ? result.data
      : {};
  return Object.entries(records).map(([characterID, record]) => ({
    characterID: normalizePositiveInteger(characterID, 0),
    record,
  }));
}

function getLegacyOrBucketStandingRows(record, bucketName) {
  const standingData =
    record && record.standingData && typeof record.standingData === "object"
      ? record.standingData
      : {};
  return Array.isArray(standingData[bucketName]) ? standingData[bucketName] : [];
}

function getCharacterRawStandingFromRecord(record, ownerID, characterID) {
  const normalizedOwnerID = normalizePositiveInteger(ownerID, 0);
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!record || !normalizedOwnerID || !normalizedCharacterID) {
    return null;
  }

  const buckets = buildCharacterStandingBuckets(record);

  const directMatch = buckets.charRows.find(
    (entry) =>
      entry.fromID === normalizedOwnerID &&
      entry.toID === normalizedCharacterID,
  );
  if (directMatch) {
    return directMatch;
  }

  return buckets.npcRows.find(
    (entry) =>
      entry.fromID === normalizedOwnerID &&
      entry.toID === normalizedCharacterID,
  ) || null;
}

function listCharacterStandings(characterID) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return [];
  }

  const buckets = getCharacterStandingBuckets(normalizedCharacterID);
  const directRows = buckets.charRows
    .filter(
      (entry) =>
        entry !== null &&
        entry.toID === normalizedCharacterID,
    );
  const legacyRows = buckets.npcRows
    .filter(
      (entry) =>
        entry !== null &&
        entry.toID === normalizedCharacterID,
    );
  const rows = directRows.length > 0 ? directRows : legacyRows;

  const deduped = new Map();
  for (const row of rows) {
    if (!deduped.has(row.fromID)) {
      deduped.set(row.fromID, row);
    }
  }

  return [...deduped.values()].sort((left, right) => left.fromID - right.fromID);
}

function listNpcStandings() {
  const authorityRows = listNpcStandingsFromAuthority();
  if (authorityRows.length) {
    return authorityRows.sort(
      (left, right) =>
        left.fromID - right.fromID ||
        left.toID - right.toID,
    );
  }

  const deduped = new Map();
  for (const { record } of readAllCharacterRecords()) {
    for (const row of getLegacyOrBucketStandingRows(record, "npc")) {
      const normalizedRow = normalizeStandingEntry(row);
      if (
        !normalizedRow ||
        !isNpcOwner(normalizedRow.fromID) ||
        !isNpcOwner(normalizedRow.toID)
      ) {
        continue;
      }
      deduped.set(
        `${normalizedRow.fromID}:${normalizedRow.toID}`,
        normalizedRow,
      );
    }
  }

  return [...deduped.values()].sort(
    (left, right) =>
      left.fromID - right.fromID ||
      left.toID - right.toID,
  );
}

function getExplicitCorporationStandingRows(corporationID) {
  const normalizedCorporationID = normalizePositiveInteger(corporationID, 0);
  if (!normalizedCorporationID) {
    return [];
  }

  const deduped = new Map();
  for (const characterID of getCharacterIDsInCorporation(normalizedCorporationID)) {
    const characterRecord = getCharacterRecord(characterID);
    if (!characterRecord) {
      continue;
    }
    for (const row of getLegacyOrBucketStandingRows(characterRecord, "corp")) {
      const normalizedRow = normalizeStandingEntry(row);
      if (!normalizedRow || normalizedRow.toID !== normalizedCorporationID) {
        continue;
      }
      deduped.set(normalizedRow.fromID, normalizedRow);
    }
  }

  return [...deduped.values()].sort((left, right) => left.fromID - right.fromID);
}

function getStandingCompositions(fromID, toID) {
  const normalizedFromID = normalizePositiveInteger(fromID, 0);
  const normalizedCorporationID = normalizePositiveInteger(toID, 0);
  const corporationRecord = getCorporationRecord(normalizedCorporationID);
  if (!normalizedFromID || !corporationRecord || corporationRecord.isNPC) {
    return [];
  }

  const cacheKey = `${normalizedFromID}:${normalizedCorporationID}`;
  if (standingCompositionCache.has(cacheKey)) {
    return cloneValue(standingCompositionCache.get(cacheKey));
  }

  const rows = [];
  for (const characterID of getCharacterIDsInCorporation(normalizedCorporationID)) {
    const characterRecord = getCharacterRecord(characterID);
    if (!characterRecord) {
      continue;
    }
    const standingRow = getCharacterRawStandingFromRecord(
      characterRecord,
      normalizedFromID,
      characterID,
    );
    if (!standingRow) {
      continue;
    }
    rows.push({
      ownerID: characterID,
      standing: roundStandingValue(standingRow.standing),
    });
  }

  rows.sort(
    (left, right) =>
      right.standing - left.standing ||
      left.ownerID - right.ownerID,
  );
  standingCompositionCache.set(cacheKey, cloneValue(rows));
  return rows;
}

function listCorporationStandings(corporationID) {
  const normalizedCorporationID = normalizePositiveInteger(corporationID, 0);
  if (!normalizedCorporationID) {
    return [];
  }

  if (corporationStandingsCache.has(normalizedCorporationID)) {
    return cloneValue(corporationStandingsCache.get(normalizedCorporationID));
  }

  const explicitRows = getExplicitCorporationStandingRows(normalizedCorporationID);
  if (explicitRows.length > 0) {
    const rows = explicitRows.map((row) => ({
      fromID: row.fromID,
      standing: roundStandingValue(row.standing),
    }));
    corporationStandingsCache.set(normalizedCorporationID, cloneValue(rows));
    return rows;
  }

  const rowsByOwnerID = new Map(
    [],
  );

  const memberStandingOwnerIDs = new Set();
  for (const characterID of getCharacterIDsInCorporation(normalizedCorporationID)) {
    for (const row of listCharacterStandings(characterID)) {
      memberStandingOwnerIDs.add(row.fromID);
    }
  }

  for (const ownerID of memberStandingOwnerIDs) {
    const compositions = getStandingCompositions(ownerID, normalizedCorporationID);
    if (!compositions.length) {
      continue;
    }
    const average =
      compositions.reduce((sum, row) => sum + toNumber(row.standing, 0), 0) /
      compositions.length;
    rowsByOwnerID.set(ownerID, {
      fromID: ownerID,
      standing: roundStandingValue(average),
    });
  }

  const rows = [...rowsByOwnerID.values()].sort((left, right) => left.fromID - right.fromID);
  corporationStandingsCache.set(normalizedCorporationID, cloneValue(rows));
  return rows;
}

function getCharacterRawStanding(characterID, ownerID) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const normalizedOwnerID = normalizePositiveInteger(ownerID, 0);
  if (!normalizedCharacterID || !normalizedOwnerID) {
    return 0;
  }

  const characterRecord = getCharacterRecord(normalizedCharacterID);
  const row = getCharacterRawStandingFromRecord(
    characterRecord,
    normalizedOwnerID,
    normalizedCharacterID,
  );
  return row ? roundStandingValue(row.standing) : 0;
}

function getStandingBonusSkillTypeID(ownerID, rawStanding) {
  const factionID = getOwnerFactionID(ownerID);
  if (factionID && NO_BONUS_FACTION_IDS.has(factionID)) {
    return null;
  }

  if (toNumber(rawStanding, 0) < 0) {
    return TYPE_DIPLOMACY;
  }

  if (factionID && PIRATE_FACTION_IDS.has(factionID)) {
    return TYPE_CRIMINAL_CONNECTIONS;
  }

  return TYPE_CONNECTIONS;
}

function getOwnerFactionID(ownerID) {
  const normalizedOwnerID = normalizePositiveInteger(ownerID, 0);
  if (!normalizedOwnerID) {
    return null;
  }

  if (isFactionID(normalizedOwnerID)) {
    return normalizedOwnerID;
  }

  const agentRecord = getAgentByID(normalizedOwnerID);
  if (agentRecord && normalizePositiveInteger(agentRecord.factionID, 0)) {
    return normalizePositiveInteger(agentRecord.factionID, 0);
  }

  return getFactionIDForCorporation(normalizedOwnerID);
}

function getSkillLevel(skillMap, skillTypeID) {
  if (!(skillMap instanceof Map)) {
    return 0;
  }
  const skillRecord = skillMap.get(normalizePositiveInteger(skillTypeID, 0));
  if (!skillRecord) {
    return 0;
  }
  return Math.max(
    0,
    toInt(
      skillRecord.effectiveSkillLevel ??
        skillRecord.trainedSkillLevel ??
        skillRecord.skillLevel,
      0,
    ),
  );
}

function getStandingBonusForCharacter(characterID, ownerID, rawStanding) {
  const bonusSkillTypeID = getStandingBonusSkillTypeID(ownerID, rawStanding);
  if (!bonusSkillTypeID) {
    return {
      skillTypeID: null,
      bonus: 0,
    };
  }

  const skillLevel = getSkillLevel(
    getCharacterSkillMap(normalizePositiveInteger(characterID, 0)),
    bonusSkillTypeID,
  );
  return {
    skillTypeID: bonusSkillTypeID,
    bonus: skillLevel * STANDING_BONUS_PER_LEVEL,
  };
}

function applyStandingBonusToValue(rawStanding, bonus) {
  const numericStanding = clampStanding(rawStanding);
  const numericBonus = Math.max(0, toNumber(bonus, 0));
  if (!(numericBonus > 0)) {
    return numericStanding;
  }

  return roundStandingValue(
    (1 - (1 - numericStanding / 10) * (1 - numericBonus / 10)) * 10,
  );
}

function getCharacterEffectiveStanding(characterID, ownerID) {
  const rawStanding = getCharacterRawStanding(characterID, ownerID);
  const { bonus, skillTypeID } = getStandingBonusForCharacter(
    characterID,
    ownerID,
    rawStanding,
  );
  return {
    rawStanding,
    bonus,
    skillTypeID,
    standing: applyStandingBonusToValue(rawStanding, bonus),
  };
}

function calculateStandingsByRawChange(currentStanding, rawChange) {
  const standing = clampStanding(currentStanding);
  const change = toNumber(rawChange, 0);
  if (change > 0) {
    if (standing < MAX_STANDING) {
      return roundStandingValue(
        Math.min(
          MAX_STANDING,
          10 * (1 - (1 - standing / 10) * (1 - change)),
        ),
      );
    }
    return standing;
  }

  if (change < 0) {
    if (standing > MIN_STANDING) {
      return roundStandingValue(
        Math.max(
          MIN_STANDING,
          10 * (standing / 10 + (1 + standing / 10) * change),
        ),
      );
    }
    return standing;
  }

  return standing;
}

function calculateNewStandings(rawChange) {
  return roundStandingValue(
    Math.max(Math.min(10 * toNumber(rawChange, 0), MAX_STANDING), MIN_STANDING),
  );
}

function calculateStandingPreviewDelta(currentStanding, rawChange) {
  const current = clampStanding(currentStanding);
  const nextStanding = calculateStandingsByRawChange(current, rawChange);
  return roundStandingValue(nextStanding - current);
}

function calculateSocialAdjustedRawChange(characterID, rawChange) {
  const baseRawChange = toNumber(rawChange, 0);
  if (baseRawChange === 0) {
    return 0;
  }

  const skillLevel = getSkillLevel(
    getCharacterSkillMap(normalizePositiveInteger(characterID, 0)),
    TYPE_SOCIAL,
  );
  return roundStandingValue(
    baseRawChange * (1 + skillLevel * SOCIAL_GAIN_BONUS_PER_LEVEL),
  );
}

function buildStandingPreview(characterID, entries = [], options = {}) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return {};
  }

  const preview = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const ownerID = normalizePositiveInteger(entry && entry.ownerID, 0);
    if (!ownerID) {
      continue;
    }
    const rawChange = options.applySocial === false
      ? toNumber(entry && entry.rawChange, 0)
      : calculateSocialAdjustedRawChange(
          normalizedCharacterID,
          entry && entry.rawChange,
        );
    if (rawChange === 0) {
      continue;
    }
    const currentStanding = getCharacterRawStanding(normalizedCharacterID, ownerID);
    preview[ownerID] = calculateStandingPreviewDelta(currentStanding, rawChange);
  }
  return preview;
}

function buildStandingSourceIDs(characterRecord, characterID) {
  const sourceIDs = new Set([
    normalizePositiveInteger(characterID, 0),
    normalizePositiveInteger(characterRecord && characterRecord.corporationID, 0),
    normalizePositiveInteger(characterRecord && characterRecord.allianceID, 0),
    normalizePositiveInteger(characterRecord && characterRecord.factionID, 0),
    normalizePositiveInteger(characterRecord && characterRecord.warFactionID, 0),
  ]);
  sourceIDs.delete(0);
  return sourceIDs;
}

function resolveBestStandingValue(characterID, targetOwnerIDs = []) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return {
      standing: 0,
      matchedOwnerID: 0,
      matchedSourceID: 0,
      matchedEntry: null,
    };
  }

  const characterRecord = getCharacterRecord(normalizedCharacterID);
  if (!characterRecord) {
    return {
      standing: 0,
      matchedOwnerID: 0,
      matchedSourceID: 0,
      matchedEntry: null,
    };
  }

  const sourceIDs = buildStandingSourceIDs(characterRecord, normalizedCharacterID);
  const targetSet = new Set(
    (Array.isArray(targetOwnerIDs) ? targetOwnerIDs : [targetOwnerIDs])
      .map((ownerID) => normalizePositiveInteger(ownerID, 0))
      .filter((ownerID) => ownerID > 0),
  );
  const buckets = getCharacterStandingBuckets(normalizedCharacterID);
  let bestMatch = null;
  let bestPriority = -1;
  let bestAbsoluteStanding = -1;

  for (const [priorityFloor, rows] of [
    [3, buckets.charRows],
    [2, buckets.corpRows],
    [2, buckets.npcRows],
  ]) {
    for (const entry of rows) {
      if (!entry || !sourceIDs.has(entry.fromID) || !targetSet.has(entry.toID)) {
        continue;
      }
      const priority =
        entry.fromID === normalizedCharacterID
          ? 3
          : priorityFloor;
      const absoluteStanding = Math.abs(entry.standing);
      if (
        !bestMatch ||
        priority > bestPriority ||
        (priority === bestPriority && absoluteStanding > bestAbsoluteStanding)
      ) {
        bestMatch = {
          standing: roundStandingValue(entry.standing),
          matchedOwnerID: entry.toID,
          matchedSourceID: entry.fromID,
          matchedEntry: entry,
        };
        bestPriority = priority;
        bestAbsoluteStanding = absoluteStanding;
      }
    }
  }

  return bestMatch || {
    standing: 0,
    matchedOwnerID: 0,
    matchedSourceID: 0,
    matchedEntry: null,
  };
}

function canCharacterUseAgent(characterID, agentRecord) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const level = Math.max(1, toInt(agentRecord && agentRecord.level, 1));
  const agentTypeID = normalizePositiveInteger(agentRecord && agentRecord.agentTypeID, 0);
  if (!normalizedCharacterID || !agentTypeID) {
    return false;
  }

  // Match CCP eveCfg.CanUseAgent: Aura is always usable.
  if (agentTypeID === 11) {
    return true;
  }

  // Retail allows level 1 agents without a standings gate except research agents.
  if (level === 1 && agentTypeID !== 4) {
    return true;
  }

  const factionStanding = getCharacterEffectiveStanding(
    normalizedCharacterID,
    agentRecord && agentRecord.factionID,
  ).standing;
  const corporationStanding = getCharacterEffectiveStanding(
    normalizedCharacterID,
    agentRecord && agentRecord.corporationID,
  ).standing;
  const agentStanding = getCharacterEffectiveStanding(
    normalizedCharacterID,
    agentRecord && agentRecord.agentID,
  ).standing;
  const threshold = (level - 1) * 2.0 - 1.0;

  if (
    Math.max(factionStanding, corporationStanding, agentStanding) >= threshold &&
    Math.min(factionStanding, corporationStanding, agentStanding) > -2.0
  ) {
    if (agentTypeID === 4 && corporationStanding < threshold - 2.0) {
      return false;
    }
    return true;
  }

  return false;
}

function normalizeStandingTransaction(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const fromID = normalizePositiveInteger(entry.fromID, 0);
  const toID = normalizePositiveInteger(entry.toID, 0);
  const eventTypeID = toInt(entry.eventTypeID, 0);
  if (!fromID || !toID || !eventTypeID) {
    return null;
  }

  return {
    fromID,
    toID,
    eventTypeID,
    eventDateTime: normalizeText(entry.eventDateTime, nowFileTimeString()),
    modification: toNumber(entry.modification, 0),
    msg: normalizeText(entry.msg, ""),
    int_1: entry.int_1 == null ? null : toInt(entry.int_1, 0),
    int_2: entry.int_2 == null ? null : toInt(entry.int_2, 0),
    int_3: entry.int_3 == null ? null : toInt(entry.int_3, 0),
  };
}

function appendStandingTransaction(record, transaction) {
  const transactions = ensureStandingTransactions(record);
  const normalized = normalizeStandingTransaction(transaction);
  if (!normalized) {
    return;
  }
  transactions.unshift(normalized);
  if (transactions.length > STANDING_TRANSACTION_LIMIT) {
    transactions.length = STANDING_TRANSACTION_LIMIT;
  }
}

function getStandingTransactions(fromID, toID) {
  const normalizedFromID = normalizePositiveInteger(fromID, 0);
  const normalizedToID = normalizePositiveInteger(toID, 0);
  const characterRecord = getCharacterRecord(normalizedToID);
  if (!normalizedFromID || !characterRecord) {
    return [];
  }

  const cacheKey = `${normalizedFromID}:${normalizedToID}`;
  if (standingTransactionCache.has(cacheKey)) {
    return cloneValue(standingTransactionCache.get(cacheKey));
  }

  const rows = ensureStandingTransactions(characterRecord)
    .map((entry) => normalizeStandingTransaction(entry))
    .filter(
      (entry) =>
        entry &&
        entry.fromID === normalizedFromID &&
        entry.toID === normalizedToID,
    )
    .sort((left, right) =>
      String(right.eventDateTime).localeCompare(String(left.eventDateTime)),
    );
  standingTransactionCache.set(cacheKey, cloneValue(rows));
  return rows;
}

function upsertStandingRow(rows, fromID, toID, standing) {
  const normalizedFromID = normalizePositiveInteger(fromID, 0);
  const normalizedToID = normalizePositiveInteger(toID, 0);
  const normalizedStanding = roundStandingValue(standing);
  if (!normalizedFromID || !normalizedToID || normalizedFromID === normalizedToID) {
    return;
  }

  const index = rows.findIndex((row) => {
    const normalizedRow = normalizeStandingEntry(row);
    return (
      normalizedRow &&
      normalizedRow.fromID === normalizedFromID &&
      normalizedRow.toID === normalizedToID
    );
  });

  if (Math.abs(normalizedStanding) <= ZERO_STANDING_EPSILON) {
    if (index >= 0) {
      rows.splice(index, 1);
    }
    return;
  }

  const nextRow = {
    fromID: normalizedFromID,
    toID: normalizedToID,
    standing: clampStanding(normalizedStanding),
  };
  if (index >= 0) {
    rows[index] = nextRow;
    return;
  }
  rows.push(nextRow);
}

function notifyStandingSet(characterID, fromID, toID, standing) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return;
  }

  for (const session of sessionRegistry.getSessions()) {
    if (
      normalizePositiveInteger(session && session.characterID, 0) !== normalizedCharacterID ||
      typeof session.sendNotification !== "function"
    ) {
      continue;
    }
    session.sendNotification("OnStandingSet", "clientID", [
      normalizePositiveInteger(fromID, 0),
      normalizePositiveInteger(toID, 0),
      toNumber(standing, 0),
    ]);
  }
}

function notifyStandingsModified(characterID, modifications) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID || !Array.isArray(modifications) || !modifications.length) {
    return;
  }

  for (const session of sessionRegistry.getSessions()) {
    if (
      normalizePositiveInteger(session && session.characterID, 0) !== normalizedCharacterID ||
      typeof session.sendNotification !== "function"
    ) {
      continue;
    }
    session.sendNotification("OnStandingsModified", "clientID", [modifications]);
  }
}

function applyStandingChanges(characterID, changes = [], options = {}) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID || !Array.isArray(changes) || !changes.length) {
    return {
      success: false,
      errorMsg: "STANDING_CHANGE_REQUIRED",
    };
  }

  const modifications = [];
  const appliedChanges = [];
  const derivedAccumulator = new Map();
  const writeResult = updateCharacterRecord(normalizedCharacterID, (record) => {
    const standingData = ensureStandingData(record);
    for (const change of changes) {
      const ownerID = normalizePositiveInteger(change && change.ownerID, 0);
      if (!ownerID) {
        continue;
      }
      const rawChange = change && change.applySocial === false
        ? toNumber(change.rawChange, 0)
        : calculateSocialAdjustedRawChange(normalizedCharacterID, change && change.rawChange);
      if (Math.abs(rawChange) <= ZERO_STANDING_EPSILON) {
        continue;
      }

      const currentRow = getCharacterRawStandingFromRecord(
        record,
        ownerID,
        normalizedCharacterID,
      );
      const currentStanding = currentRow ? currentRow.standing : 0;
      const nextStanding = currentRow
        ? calculateStandingsByRawChange(currentStanding, rawChange)
        : calculateNewStandings(rawChange);

      upsertStandingRow(
        standingData.char,
        ownerID,
        normalizedCharacterID,
        nextStanding,
      );
      modifications.push([ownerID, normalizedCharacterID, rawChange, MIN_STANDING, MAX_STANDING]);
      appliedChanges.push({
        fromID: ownerID,
        toID: normalizedCharacterID,
        rawChange,
        previousStanding: currentStanding,
        standing: nextStanding,
      });

      if (!options.disableDerived) {
        for (const relation of getRelationsForOwner(ownerID)) {
          const targetID = normalizePositiveInteger(relation && relation.toID, 0);
          const relationValue = toNumber(
            relation && (
              Object.prototype.hasOwnProperty.call(relation, "propagationMultiplier")
                ? relation.propagationMultiplier
                : relation.standing
            ),
            0,
          );
          if (!targetID || targetID === ownerID || !Number.isFinite(relationValue)) {
            continue;
          }
          const derivedRawChange = rawChange * relationValue;
          if (Math.abs(derivedRawChange) <= ZERO_STANDING_EPSILON) {
            continue;
          }
          const existing = derivedAccumulator.get(targetID);
          if (existing) {
            existing.rawChange += derivedRawChange;
            continue;
          }
          derivedAccumulator.set(targetID, {
            rawChange: derivedRawChange,
            sourceOwnerID: ownerID,
          });
        }
      }

      appendStandingTransaction(record, {
        fromID: ownerID,
        toID: normalizedCharacterID,
        eventTypeID: toInt(
          change && change.eventTypeID,
          EVENT_STANDING_AGENT_MISSION_COMPLETED,
        ),
        eventDateTime: nowFileTimeString(),
        modification: rawChange,
        msg: normalizeText(change && change.msg, ""),
        int_1:
          change && Object.prototype.hasOwnProperty.call(change, "int_1")
            ? change.int_1
            : null,
        int_2:
          change && Object.prototype.hasOwnProperty.call(change, "int_2")
            ? change.int_2
            : null,
        int_3:
          change && Object.prototype.hasOwnProperty.call(change, "int_3")
            ? change.int_3
            : null,
      });
    }

    for (const [targetOwnerID, derived] of derivedAccumulator.entries()) {
      const derivedRawChange = toNumber(derived && derived.rawChange, 0);
      if (Math.abs(derivedRawChange) <= ZERO_STANDING_EPSILON) {
        continue;
      }

      const currentRow = getCharacterRawStandingFromRecord(
        record,
        targetOwnerID,
        normalizedCharacterID,
      );
      const currentStanding = currentRow ? currentRow.standing : 0;
      const nextStanding = currentRow
        ? calculateStandingsByRawChange(currentStanding, derivedRawChange)
        : calculateNewStandings(derivedRawChange);

      upsertStandingRow(
        standingData.char,
        targetOwnerID,
        normalizedCharacterID,
        nextStanding,
      );

      modifications.push([
        targetOwnerID,
        normalizedCharacterID,
        derivedRawChange,
        MIN_STANDING,
        MAX_STANDING,
      ]);
      appliedChanges.push({
        fromID: targetOwnerID,
        toID: normalizedCharacterID,
        rawChange: derivedRawChange,
        previousStanding: currentStanding,
        standing: nextStanding,
      });

      appendStandingTransaction(record, {
        fromID: targetOwnerID,
        toID: normalizedCharacterID,
        eventTypeID:
          derivedRawChange >= 0
            ? EVENT_STANDING_DERIVED_POSITIVE
            : EVENT_STANDING_DERIVED_NEGATIVE,
        eventDateTime: nowFileTimeString(),
        modification: derivedRawChange,
        msg: "Derived standings",
        int_1: derived && derived.sourceOwnerID ? derived.sourceOwnerID : null,
        int_2: null,
        int_3: null,
      });
    }

    return record;
  });

  if (!writeResult.success) {
    return writeResult;
  }

  invalidateStandingCachesForCharacter(normalizedCharacterID);

  if (modifications.length) {
    notifyStandingsModified(normalizedCharacterID, modifications);
  }

  return {
    success: true,
    data: {
      modifications,
      appliedChanges,
    },
  };
}

function setCharacterStandings(characterID, entries = [], options = {}) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID || !Array.isArray(entries) || !entries.length) {
    return {
      success: false,
      errorMsg: "STANDING_ENTRY_REQUIRED",
    };
  }

  const appliedChanges = [];
  const writeResult = updateCharacterRecord(normalizedCharacterID, (record) => {
    const standingData = ensureStandingData(record);
    for (const entry of entries) {
      const ownerID = normalizePositiveInteger(entry && entry.ownerID, 0);
      if (!ownerID) {
        continue;
      }
      const currentRow = getCharacterRawStandingFromRecord(
        record,
        ownerID,
        normalizedCharacterID,
      );
      const currentStanding = currentRow ? currentRow.standing : 0;
      const nextStanding = clampStanding(entry && entry.standing);

      if (
        currentRow &&
        Math.abs(currentStanding - nextStanding) <= ZERO_STANDING_EPSILON
      ) {
        continue;
      }

      upsertStandingRow(
        standingData.char,
        ownerID,
        normalizedCharacterID,
        nextStanding,
      );

      const eventTypeID =
        Math.abs(nextStanding) <= ZERO_STANDING_EPSILON
          ? EVENT_STANDING_RESET
          : toInt(options.eventTypeID, EVENT_STANDING_SLASH_SET);
      appendStandingTransaction(record, {
        fromID: ownerID,
        toID: normalizedCharacterID,
        eventTypeID,
        eventDateTime: nowFileTimeString(),
        modification: roundStandingValue((nextStanding - currentStanding) / 10),
        msg: normalizeText(options.message, ""),
        int_1: ownerID,
        int_2: null,
        int_3: null,
      });

      appliedChanges.push({
        fromID: ownerID,
        toID: normalizedCharacterID,
        previousStanding: roundStandingValue(currentStanding),
        standing: roundStandingValue(nextStanding),
      });
    }

    return record;
  });

  if (!writeResult.success) {
    return writeResult;
  }

  invalidateStandingCachesForCharacter(normalizedCharacterID);

  for (const entry of appliedChanges) {
    notifyStandingSet(
      normalizedCharacterID,
      entry.fromID,
      entry.toID,
      entry.standing,
    );
  }

  return {
    success: true,
    data: {
      appliedChanges,
    },
  };
}

function setCharacterStanding(characterID, ownerID, standing, options = {}) {
  return setCharacterStandings(
    characterID,
    [{ ownerID, standing }],
    options,
  );
}

function escapeProtocolZeroPickleString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/'/g, "\\'");
}

function buildProtocolZeroPickleHexFromDict(payload = {}) {
  const entries = Object.entries(payload)
    .map(([key, value]) => [
      normalizeText(key, ""),
      value == null ? "" : String(value),
    ])
    .filter(([key]) => key.length > 0);
  if (entries.length <= 0) {
    return "";
  }

  const lines = ["(dp0"];
  let pointer = 1;
  for (const [key, value] of entries) {
    lines.push(`S'${escapeProtocolZeroPickleString(key)}'`);
    lines.push(`p${pointer}`);
    pointer += 1;
    lines.push(`S'${escapeProtocolZeroPickleString(value)}'`);
    lines.push(`p${pointer}`);
    pointer += 1;
    lines.push("s");
  }
  lines.push(".");
  return Buffer.from(`${lines.join("\n")}\n`, "ascii").toString("hex");
}

function normalizeMissionStandingOutcome(outcome = "completed") {
  const normalizedOutcome = normalizeText(outcome, "completed");
  return Object.prototype.hasOwnProperty.call(
    MISSION_STANDING_EVENT_TYPE_BY_OUTCOME,
    normalizedOutcome,
  )
    ? normalizedOutcome
    : "completed";
}

function resolveMissionStandingEventDefinition(rewards, outcome) {
  const normalizedOutcome = normalizeMissionStandingOutcome(outcome);
  if (
    rewards &&
    rewards.standingEvents &&
    typeof rewards.standingEvents === "object" &&
    rewards.standingEvents[normalizedOutcome] &&
    typeof rewards.standingEvents[normalizedOutcome] === "object"
  ) {
    return rewards.standingEvents[normalizedOutcome];
  }

  if (normalizedOutcome === "completed") {
    return rewards && rewards.rawStandings && typeof rewards.rawStandings === "object"
      ? rewards.rawStandings
      : {};
  }

  const legacyKey = `${normalizedOutcome}RawStandings`;
  return rewards && rewards[legacyKey] && typeof rewards[legacyKey] === "object"
    ? rewards[legacyKey]
    : {};
}

function buildMissionStandingMessage(outcome, missionName, eventDefinition = {}) {
  if (normalizeMissionStandingOutcome(outcome) !== "bonus") {
    return normalizeText(eventDefinition.msg, missionName);
  }

  const explicitMessage = normalizeText(eventDefinition.msg, "");
  if (explicitMessage) {
    return explicitMessage;
  }

  const header = normalizeText(eventDefinition.messageHeader, missionName);
  const body = normalizeText(
    eventDefinition.messageBody,
    `${missionName} bonus standing adjustment`,
  );
  return buildProtocolZeroPickleHexFromDict({
    header,
    body,
  });
}

function buildMissionOutcomeStandingChanges(agentRecord, missionRecord, outcome = "completed") {
  const rewards =
    missionRecord && missionRecord.rewards && typeof missionRecord.rewards === "object"
      ? missionRecord.rewards
      : {};
  const normalizedOutcome = normalizeMissionStandingOutcome(outcome);
  const eventDefinition = resolveMissionStandingEventDefinition(
    rewards,
    normalizedOutcome,
  );
  const rawStandings =
    eventDefinition && eventDefinition.rawStandings && typeof eventDefinition.rawStandings === "object"
      ? eventDefinition.rawStandings
      : eventDefinition;
  const missionName = normalizeText(
    missionRecord && missionRecord.missionTitle,
    normalizeText(missionRecord && missionRecord.contentID, "Placeholder Mission"),
  );
  const eventTypeID = toInt(
    eventDefinition && eventDefinition.eventTypeID,
    MISSION_STANDING_EVENT_TYPE_BY_OUTCOME[normalizedOutcome],
  );
  const applySocial =
    eventDefinition && Object.prototype.hasOwnProperty.call(eventDefinition, "applySocial")
      ? eventDefinition.applySocial === true
      : MISSION_STANDING_SOCIAL_BY_OUTCOME[normalizedOutcome] === true;
  const msg = buildMissionStandingMessage(
    normalizedOutcome,
    missionName,
    eventDefinition,
  );

  return [
    {
      ownerID: normalizePositiveInteger(agentRecord && agentRecord.corporationID, 0),
      rawChange: toNumber(rawStandings.corporation, 0),
      eventTypeID,
      applySocial,
      msg,
      int_1:
        eventDefinition && Object.prototype.hasOwnProperty.call(eventDefinition, "int_1")
          ? eventDefinition.int_1
          : null,
      int_2:
        eventDefinition && Object.prototype.hasOwnProperty.call(eventDefinition, "int_2")
          ? eventDefinition.int_2
          : null,
      int_3:
        eventDefinition && Object.prototype.hasOwnProperty.call(eventDefinition, "int_3")
          ? eventDefinition.int_3
          : null,
    },
    {
      ownerID: normalizePositiveInteger(agentRecord && agentRecord.factionID, 0),
      rawChange: toNumber(rawStandings.faction, 0),
      eventTypeID,
      applySocial,
      msg,
      int_1:
        eventDefinition && Object.prototype.hasOwnProperty.call(eventDefinition, "int_1")
          ? eventDefinition.int_1
          : null,
      int_2:
        eventDefinition && Object.prototype.hasOwnProperty.call(eventDefinition, "int_2")
          ? eventDefinition.int_2
          : null,
      int_3:
        eventDefinition && Object.prototype.hasOwnProperty.call(eventDefinition, "int_3")
          ? eventDefinition.int_3
          : null,
    },
    {
      ownerID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
      rawChange: toNumber(rawStandings.agent, 0),
      eventTypeID,
      applySocial,
      msg,
      int_1:
        eventDefinition && Object.prototype.hasOwnProperty.call(eventDefinition, "int_1")
          ? eventDefinition.int_1
          : null,
      int_2:
        eventDefinition && Object.prototype.hasOwnProperty.call(eventDefinition, "int_2")
          ? eventDefinition.int_2
          : null,
      int_3:
        eventDefinition && Object.prototype.hasOwnProperty.call(eventDefinition, "int_3")
          ? eventDefinition.int_3
          : null,
    },
  ].filter(
    (entry) =>
      entry.ownerID > 0 &&
      Math.abs(entry.rawChange) > ZERO_STANDING_EPSILON,
  );
}

function buildMissionRewardStandingChanges(agentRecord, missionRecord) {
  return buildMissionOutcomeStandingChanges(
    agentRecord,
    missionRecord,
    "completed",
  );
}

function applyMissionStandingChanges(characterID, agentRecord, missionRecord, outcome = "completed") {
  const changes = buildMissionOutcomeStandingChanges(
    agentRecord,
    missionRecord,
    outcome,
  );
  if (!changes.length) {
    return {
      success: true,
      data: {
        modifications: [],
        appliedChanges: [],
      },
    };
  }

  return applyStandingChanges(characterID, changes);
}

function getAllAgentStandingOwners() {
  if (cachedAgentStandingOwnerIDs) {
    return cloneValue(cachedAgentStandingOwnerIDs);
  }

  const corporationIDs = new Set();
  const factionIDs = new Set();
  for (const agentRecord of listAgents()) {
    const corporationID = normalizePositiveInteger(agentRecord && agentRecord.corporationID, 0);
    const factionID = normalizePositiveInteger(agentRecord && agentRecord.factionID, 0);
    if (corporationID) {
      corporationIDs.add(corporationID);
    }
    if (factionID) {
      factionIDs.add(factionID);
    }
  }

  cachedAgentStandingOwnerIDs = {
    corporationIDs: [...corporationIDs].sort((left, right) => left - right),
    factionIDs: [...factionIDs].sort((left, right) => left - right),
  };
  return cloneValue(cachedAgentStandingOwnerIDs);
}

function getFactionRecordsByName() {
  if (cachedFactionRecordsByName) {
    return cachedFactionRecordsByName;
  }

  cachedFactionRecordsByName = new Map();
  for (const record of getAllFactionRecords()) {
    const name = normalizeText(record && record.name, "").toLowerCase();
    if (name) {
      cachedFactionRecordsByName.set(name, cloneValue(record));
    }
  }
  return cachedFactionRecordsByName;
}

module.exports = {
  EVENT_STANDING_AGENT_MISSION_BONUS,
  EVENT_STANDING_AGENT_MISSION_COMPLETED,
  EVENT_STANDING_AGENT_MISSION_DECLINED,
  EVENT_STANDING_AGENT_MISSION_FAILED,
  EVENT_STANDING_AGENT_MISSION_OFFER_EXPIRED,
  EVENT_STANDING_COMBAT_AGGRESSION,
  EVENT_STANDING_CONTRABAND_TRAFFICKING,
  EVENT_STANDING_DERIVED_NEGATIVE,
  EVENT_STANDING_DERIVED_POSITIVE,
  EVENT_STANDING_GROUP_REWARD_CORPORATION,
  EVENT_STANDING_GROUP_REWARD_FACTION,
  EVENT_STANDING_PLAYER_CORP_SET,
  EVENT_STANDING_PLAYER_SET,
  EVENT_STANDING_RESET,
  EVENT_STANDING_SLASH_SET,
  TYPE_CONNECTIONS,
  TYPE_CRIMINAL_CONNECTIONS,
  TYPE_DIPLOMACY,
  TYPE_SOCIAL,
  applyMissionStandingChanges,
  applyStandingBonusToValue,
  applyStandingChanges,
  buildMissionRewardStandingChanges,
  buildMissionOutcomeStandingChanges,
  buildStandingPreview,
  calculateNewStandings,
  calculateSocialAdjustedRawChange,
  calculateStandingPreviewDelta,
  calculateStandingsByRawChange,
  canCharacterUseAgent,
  clearStandingRuntimeCaches,
  getAllAgentStandingOwners,
  getCharacterEffectiveStanding,
  getCharacterRawStanding,
  getCharacterRawStandingFromRecord,
  getFactionRecordsByName,
  getOwnerFactionID,
  getStandingBonusForCharacter,
  getStandingBonusSkillTypeID,
  getStandingCompositions,
  getStandingTransactions,
  listCharacterStandings,
  listCorporationStandings,
  listNpcStandings,
  resolveBestStandingValue,
  roundStandingValue,
  setCharacterStanding,
  setCharacterStandings,
};
