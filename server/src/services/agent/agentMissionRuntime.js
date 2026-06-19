const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  buildFiletimeLong,
  buildKeyVal,
  buildMarshalReal,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  getAgentByID,
  listMissionTemplateIDsForAgent,
} = require(path.join(__dirname, "./agentAuthority"));
const {
  getMissionByID,
  getMissionArcInfo,
  listMissionIDsByTemplate,
  listMissionIDsForAgent: listClientMissionIDsForAgent,
  pickMissionForAgent,
} = require(path.join(__dirname, "./missionAuthority"));
const {
  getClientDungeonTemplate,
  getObjectiveChainByID,
  getTemplateByID,
} = require(path.join(__dirname, "../dungeon/dungeonAuthority"));
const dungeonRuntime = require(path.join(__dirname, "../dungeon/dungeonRuntime"));
const {
  getCharacterRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  adjustCharacterBalance,
} = require(path.join(__dirname, "../account/walletState"));
const {
  adjustCharacterWalletLPBalance,
} = require(path.join(__dirname, "../corporation/lpWalletState"));
const {
  mutateCharacterState,
  getCharacterStateSnapshot,
  OFFER_EXPIRY_MS,
  REPLAY_DELAY_MS,
  currentFileTimeString,
  futureFileTimeString,
} = require(path.join(__dirname, "./missionRuntimeState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getActiveShipItem,
  grantItemsToCharacterStationHangar,
  listContainerItems,
  takeItemTypeFromCharacterLocation,
  ITEM_FLAGS,
  buildRemovedItemNotificationState,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  notifyInventoryChangesToCharacter,
} = require(path.join(__dirname, "../raffles/raffleInventory"));
const {
  getDockedLocationID,
} = require(path.join(__dirname, "../structure/structureLocation"));
const bookmarkRuntime = require(path.join(
  __dirname,
  "../bookmark/bookmarkRuntimeState",
));
const {
  TYPE_SOLAR_SYSTEM,
} = require(path.join(__dirname, "../bookmark/bookmarkConstants"));
const standingRuntime = require(path.join(
  __dirname,
  "../character/standingRuntime",
));

const AGENT_DIALOGUE_BUTTON_VIEW_MISSION = 1;
const AGENT_DIALOGUE_BUTTON_REQUEST_MISSION = 2;
const AGENT_DIALOGUE_BUTTON_ACCEPT = 3;
const AGENT_DIALOGUE_BUTTON_ACCEPT_REMOTELY = 5;
const AGENT_DIALOGUE_BUTTON_COMPLETE = 6;
const AGENT_DIALOGUE_BUTTON_COMPLETE_REMOTELY = 7;
const AGENT_DIALOGUE_BUTTON_DECLINE = 9;

const AGENT_MISSION_STATE_OFFERED = 1;
const AGENT_MISSION_STATE_ACCEPTED = 2;
const AGENT_MISSION_STATE_COMPLETED = 4;
const AGENT_MISSION_STATE_CANT_REPLAY = 7;

const AGENT_MISSION_ACCEPTED = "accepted";
const AGENT_MISSION_COMPLETED = "completed";
const AGENT_MISSION_OFFERED = "offered";
const AGENT_MISSION_MODIFIED = "modified";
const AGENT_MISSION_OFFER_REMOVED = "offer_removed";
const AGENT_MISSION_RESET = "reset";

const MISSION_KIND_COURIER = "courier";
const MISSION_KIND_DISTRIBUTION = "distribution";
const OBJECTIVE_TYPE_AGENT = "agent";
const OBJECTIVE_TYPE_DUNGEON = "dungeon";
const OBJECTIVE_TYPE_FETCH = "fetch";
const OBJECTIVE_TYPE_TRANSPORT = "transport";
const PLACEHOLDER_CARGO_TYPE_ID = 16135;
const PLACEHOLDER_CARGO_QUANTITY = 1;
const PLACEHOLDER_DUNGEON_ID_OFFSET = 930000000;
const MISSION_SITE_ID_OFFSET = 9700000000000;
const MISSION_SITE_DISTANCE_METERS = 5500000000;
const MISSION_SITE_DISTANCE_JITTER_METERS = 350000000;
const MISSION_SITE_VERTICAL_JITTER_METERS = 180000000;
const MISSION_IN_DUNGEON_DISTANCE_METERS = 500000;
const MISSION_BOOKMARK_FOLDER_NAME = "Agent Missions";
const MISSION_BOOKMARK_FOLDER_DESCRIPTION =
  "System-managed mission bookmarks used by agent mission warp/location flows.";
const FILETIME_EPOCH = 116444736000000000n;
const AGENT_INTERACTION_ACTION_ID_BASE = 10000;
const ISK_REWARD_TYPE_ID = 29;
const ISK_DISPLAY_TYPE_ID = ISK_REWARD_TYPE_ID;
const MISSION_REWARD_ENTRY_TYPE = 3;
const MISSION_PLACEHOLDER_NOTE =
  "Proceed to the assigned destination, complete the listed objectives, and return to your agent for debriefing.";
const MISSION_PLACEHOLDER_COMPLETE_NOTE =
  "Objective complete. Return to your agent for final debriefing and reward collection.";

const REWARD_BY_LEVEL = Object.freeze({
  1: { isk: 120000, bonusIsk: 45000, loyaltyPoints: 250, corpRaw: 0.018, agentRaw: 0.01, factionRaw: 0.0 },
  2: { isk: 420000, bonusIsk: 140000, loyaltyPoints: 650, corpRaw: 0.026, agentRaw: 0.014, factionRaw: 0.0 },
  3: { isk: 1150000, bonusIsk: 380000, loyaltyPoints: 1600, corpRaw: 0.038, agentRaw: 0.02, factionRaw: 0.0 },
  4: { isk: 3450000, bonusIsk: 1100000, loyaltyPoints: 5200, corpRaw: 0.055, agentRaw: 0.028, factionRaw: 0.0 },
  5: { isk: 9200000, bonusIsk: 2800000, loyaltyPoints: 13500, corpRaw: 0.072, agentRaw: 0.036, factionRaw: 0.0 },
});

let cachedStationsByCorporationID = null;
const cachedMissionTemplateSelections = new Map();

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = normalizeInteger(value, 0);
  return numericValue > 0 ? numericValue : fallback;
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text.length > 0 ? text : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildDefaultMissionLastActionInfo(overrides = {}) {
  return {
    missionCompleted: 0,
    missionDeclined: 0,
    missionQuit: 0,
    missionCantReplay: 0,
    ...normalizeObject(overrides),
  };
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeMissionContentID(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const text = normalizeText(value, "");
  if (!text) {
    return fallback;
  }
  if (/^-?\d+$/.test(text)) {
    return Number.parseInt(text, 10);
  }
  return text;
}

function missionContentIDToText(value, fallback = "") {
  const normalized = normalizeMissionContentID(value, null);
  if (normalized === null || normalized === undefined) {
    return fallback;
  }
  return String(normalized);
}

function humanizeClientMissionContentTemplate(contentTemplateID) {
  const suffix = normalizeText(contentTemplateID, "")
    .replace(/^agent\.missionTemplatizedContent_/i, "");
  if (!suffix) {
    return "";
  }
  return suffix
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value === true;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clonePosition(value) {
  return {
    x: Number(value && value.x) || 0,
    y: Number(value && value.y) || 0,
    z: Number(value && value.z) || 0,
  };
}

function buildMarshalTuple(items = []) {
  return {
    type: "tuple",
    items: Array.isArray(items) ? items : [items],
  };
}

function addVectors(left, right) {
  return {
    x: (Number(left && left.x) || 0) + (Number(right && right.x) || 0),
    y: (Number(left && left.y) || 0) + (Number(right && right.y) || 0),
    z: (Number(left && left.z) || 0) + (Number(right && right.z) || 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: (Number(left && left.x) || 0) - (Number(right && right.x) || 0),
    y: (Number(left && left.y) || 0) - (Number(right && right.y) || 0),
    z: (Number(left && left.z) || 0) - (Number(right && right.z) || 0),
  };
}

function vectorMagnitude(vector) {
  const x = Number(vector && vector.x) || 0;
  const y = Number(vector && vector.y) || 0;
  const z = Number(vector && vector.z) || 0;
  return Math.sqrt((x * x) + (y * y) + (z * z));
}

function hashText(value) {
  const normalized = normalizeText(value, "");
  let state = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    state = Math.imul(state ^ normalized.charCodeAt(index), 0x45d9f3b);
    state ^= state >>> 16;
  }
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state ^= state >>> 16;
  return state >>> 0;
}

function getSpaceRuntime() {
  return require(path.join(__dirname, "../../space/runtime"));
}

function roundMoney(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.round(numericValue * 100) / 100;
}

function fileTimeStringToBigInt(value) {
  try {
    return BigInt(String(value || "0"));
  } catch (_error) {
    return 0n;
  }
}

function fileTimeBigIntToLong(fileTimeValue) {
  return buildFiletimeLong(fileTimeValue > 0n ? fileTimeValue : currentFileTime());
}

function nowFileTimeBigInt() {
  return currentFileTime();
}

function intervalMsToTicks(deltaMs) {
  const safeDeltaMs = Math.max(0, Number(deltaMs) || 0);
  return Math.trunc(safeDeltaMs * 10000);
}

function resolveReplayRemainingTicks(rawReplayUntilFileTime) {
  const replayUntil = fileTimeStringToBigInt(rawReplayUntilFileTime);
  if (replayUntil <= 0n) {
    return 0;
  }
  const delta = replayUntil - nowFileTimeBigInt();
  if (delta <= 0n) {
    return 0;
  }
  return Number(delta);
}

function getAgentRecord(agentID) {
  const agentRecord = getAgentByID(agentID);
  return agentRecord && typeof agentRecord === "object" ? agentRecord : null;
}

function getMissionTemplateRecord(missionTemplateID) {
  const template = getTemplateByID(missionTemplateID);
  return template && typeof template === "object" ? template : null;
}

function getRuntimeMissionTemplateRecord(missionRecord = null) {
  return getMissionTemplateRecord(
    normalizeText(missionRecord && missionRecord.missionTemplateID, ""),
  );
}

function getDungeonMissionTemplateRecord(missionRecord = null) {
  return getMissionTemplateRecord(
    normalizeText(missionRecord && missionRecord.dungeonTemplateID, ""),
  );
}

function getMissionInstanceTemplateRecord(missionRecord = null) {
  const runtimeMissionTemplate = getRuntimeMissionTemplateRecord(missionRecord);
  if (
    runtimeMissionTemplate &&
    normalizeText(runtimeMissionTemplate && runtimeMissionTemplate.siteFamily, "").toLowerCase() === "mission"
  ) {
    return runtimeMissionTemplate;
  }
  return getDungeonMissionTemplateRecord(missionRecord) || runtimeMissionTemplate || null;
}

function getMissionTemplatePool(agentID) {
  return listMissionTemplateIDsForAgent(agentID)
    .map((missionTemplateID) => normalizeText(missionTemplateID, ""))
    .filter(Boolean)
    .filter((missionTemplateID) => {
      const template = getMissionTemplateRecord(missionTemplateID);
      return (
        template &&
        normalizeText(template.siteFamily, "unknown") === "mission" &&
        !/^eve-survival:category/i.test(missionTemplateID)
      );
    });
}

function normalizeMissionTemplateMatchKey(value) {
  return normalizeText(value, "")
    .toLowerCase()
    .replace(/\b(?:lvl|level)\s*\d+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMissionTemplateLevel(template = null) {
  const explicitLevel = normalizePositiveInteger(template && template.level, 0);
  if (explicitLevel > 0) {
    return explicitLevel;
  }
  const titleMatch = normalizeText(template && template.title, "").match(
    /\b(?:lvl|level)\s*(\d+)\b/i,
  );
  return titleMatch ? normalizePositiveInteger(titleMatch[1], 0) : 0;
}

function buildMissionTemplateMatchCandidates(
  clientMissionRecord,
  runtimeDungeonTemplate,
) {
  const candidates = new Set();
  const pushCandidate = (value) => {
    const normalized = normalizeMissionTemplateMatchKey(value);
    if (normalized) {
      candidates.add(normalized);
    }
  };

  pushCandidate(getMissionLocalizedNameText(clientMissionRecord));
  pushCandidate(clientMissionRecord && clientMissionRecord.name);
  pushCandidate(clientMissionRecord && clientMissionRecord.contentTemplate);
  pushCandidate(runtimeDungeonTemplate && runtimeDungeonTemplate.title);
  pushCandidate(runtimeDungeonTemplate && runtimeDungeonTemplate.resolvedName);

  return Array.from(candidates);
}

function scoreMissionTemplateCandidate(
  template,
  agentRecord,
  clientMissionRecord,
  runtimeDungeonTemplate,
  fallbackMissionTemplate = null,
) {
  if (!template || typeof template !== "object") {
    return Number.NEGATIVE_INFINITY;
  }

  const candidateKeys = buildMissionTemplateMatchCandidates(
    clientMissionRecord,
    runtimeDungeonTemplate,
  );
  const templateKey = normalizeMissionTemplateMatchKey(
    template.title || template.resolvedName || template.templateID,
  );
  const templateTokens = new Set(templateKey.split(" ").filter(Boolean));
  let score = 0;

  for (const candidateKey of candidateKeys) {
    if (!candidateKey) {
      continue;
    }
    if (templateKey === candidateKey) {
      score = Math.max(score, 700);
      continue;
    }
    if (templateKey && (templateKey.includes(candidateKey) || candidateKey.includes(templateKey))) {
      score = Math.max(score, 520);
      continue;
    }
    const overlapCount = candidateKey
      .split(" ")
      .filter(Boolean)
      .filter((token) => templateTokens.has(token)).length;
    if (overlapCount > 0) {
      score = Math.max(score, overlapCount * 70);
    }
  }

  const templateSourceDungeonID = normalizePositiveInteger(
    template && template.sourceDungeonID,
    0,
  );
  const runtimeSourceDungeonID = normalizePositiveInteger(
    runtimeDungeonTemplate &&
      (runtimeDungeonTemplate.sourceDungeonID || runtimeDungeonTemplate.dungeonID),
    0,
  );
  if (templateSourceDungeonID > 0 && templateSourceDungeonID === runtimeSourceDungeonID) {
    score += 240;
  }

  if (
    normalizeText(template && template.siteFamily, "").toLowerCase() === "mission"
  ) {
    score += 120;
  }

  const desiredLevel = normalizePositiveInteger(agentRecord && agentRecord.level, 0);
  const templateLevel = extractMissionTemplateLevel(template);
  if (desiredLevel > 0 && templateLevel > 0 && desiredLevel === templateLevel) {
    score += 40;
  }

  if (
    fallbackMissionTemplate &&
    normalizeText(template && template.templateID, "") ===
      normalizeText(fallbackMissionTemplate && fallbackMissionTemplate.templateID, "")
  ) {
    score += 10;
  }

  return score;
}

function resolveMissionTemplateForClientMission(
  agentRecord,
  clientMissionRecord,
  fallbackMissionTemplate = null,
  runtimeDungeonTemplate = null,
) {
  const selectionCacheKey = [
    normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
    missionContentIDToText(clientMissionRecord && clientMissionRecord.missionID, ""),
    normalizePositiveInteger(
      clientMissionRecord &&
        clientMissionRecord.killMission &&
        clientMissionRecord.killMission.dungeonID,
      0,
    ),
  ].join(":");
  if (selectionCacheKey && cachedMissionTemplateSelections.has(selectionCacheKey)) {
    const cachedTemplateID = cachedMissionTemplateSelections.get(selectionCacheKey);
    return cachedTemplateID ? getMissionTemplateRecord(cachedTemplateID) : null;
  }

  const candidateTemplates = [];
  const seenTemplateIDs = new Set();
  const pushTemplate = (template) => {
    const templateID = normalizeText(template && template.templateID, "");
    if (!templateID || seenTemplateIDs.has(templateID)) {
      return;
    }
    seenTemplateIDs.add(templateID);
    candidateTemplates.push(template);
  };

  const agentID = normalizePositiveInteger(agentRecord && agentRecord.agentID, 0);
  for (const missionTemplateID of getMissionTemplatePool(agentID)) {
    pushTemplate(getMissionTemplateRecord(missionTemplateID));
  }
  pushTemplate(fallbackMissionTemplate);

  let bestTemplate = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const template of candidateTemplates) {
    const candidateScore = scoreMissionTemplateCandidate(
      template,
      agentRecord,
      clientMissionRecord,
      runtimeDungeonTemplate,
      fallbackMissionTemplate,
    );
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      bestTemplate = template;
    }
  }

  if (bestTemplate && bestScore >= 150) {
    cachedMissionTemplateSelections.set(
      selectionCacheKey,
      normalizeText(bestTemplate && bestTemplate.templateID, ""),
    );
    return bestTemplate;
  }
  if (
    runtimeDungeonTemplate &&
    normalizeText(runtimeDungeonTemplate && runtimeDungeonTemplate.siteFamily, "").toLowerCase() === "mission"
  ) {
    cachedMissionTemplateSelections.set(
      selectionCacheKey,
      normalizeText(runtimeDungeonTemplate && runtimeDungeonTemplate.templateID, ""),
    );
    return runtimeDungeonTemplate;
  }
  cachedMissionTemplateSelections.set(selectionCacheKey, "");
  return null;
}

function getPlausibleMissionIDs(agentID) {
  const agentRecord = getAgentRecord(agentID);
  if (!agentRecord) {
    return [];
  }
  return listClientMissionIDsForAgent(agentRecord);
}

function getStationsByCorporationID() {
  if (cachedStationsByCorporationID) {
    return cachedStationsByCorporationID;
  }

  const nextIndex = new Map();
  for (const station of readStaticRows(TABLE.STATIONS)) {
    const corporationID = normalizePositiveInteger(
      station && (station.corporationID || station.ownerID),
      0,
    );
    if (!corporationID) {
      continue;
    }
    if (!nextIndex.has(corporationID)) {
      nextIndex.set(corporationID, []);
    }
    nextIndex.get(corporationID).push(cloneValue(station));
  }

  for (const stations of nextIndex.values()) {
    stations.sort(
      (left, right) =>
        normalizePositiveInteger(left && left.solarSystemID, 0) -
          normalizePositiveInteger(right && right.solarSystemID, 0) ||
        normalizePositiveInteger(left && left.stationID, 0) -
          normalizePositiveInteger(right && right.stationID, 0),
    );
  }

  cachedStationsByCorporationID = nextIndex;
  return cachedStationsByCorporationID;
}

function getMissionStateFromRecord(record = null) {
  if (!record) {
    return null;
  }
  switch (normalizeText(record.runtimeStatus, "offered")) {
    case "accepted":
      return AGENT_MISSION_STATE_ACCEPTED;
    case "completed":
      return AGENT_MISSION_STATE_COMPLETED;
    case "offered":
    default:
      return AGENT_MISSION_STATE_OFFERED;
  }
}

function isCourierMission(agentRecord = null, missionTemplate = null) {
  const missionKind = normalizeText(agentRecord && agentRecord.missionKind, "");
  if (
    missionKind === MISSION_KIND_COURIER ||
    missionKind === MISSION_KIND_DISTRIBUTION
  ) {
    return true;
  }

  const typeLabel = normalizeText(
    agentRecord && agentRecord.missionTypeLabel,
    "",
  ).toLowerCase();
  if (typeLabel.includes("courier") || typeLabel.includes("distribution")) {
    return true;
  }

  const missionTitle = normalizeText(
    missionTemplate && missionTemplate.title,
    "",
  ).toLowerCase();
  return missionTitle.includes("courier");
}

function isResearchAgent(agentRecord = null) {
  const missionKind = normalizeText(agentRecord && agentRecord.missionKind, "");
  const missionTypeLabel = normalizeText(
    agentRecord && agentRecord.missionTypeLabel,
    "",
  ).toLowerCase();
  return missionKind === "research" || missionTypeLabel.includes("research");
}

function isCareerAgent(agentRecord = null) {
  return normalizePositiveInteger(agentRecord && agentRecord.careerID, 0) > 0;
}

function canUseAgent(characterID, agentRecord) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  return Boolean(
    normalizedCharacterID &&
      standingRuntime.canCharacterUseAgent(
        normalizedCharacterID,
        agentRecord,
      ),
  );
}

function buildMissionTypeLabel(agentRecord = null) {
  const explicitLabel = normalizeText(agentRecord && agentRecord.missionTypeLabel, "");
  if (explicitLabel) {
    return explicitLabel;
  }

  if (isCourierMission(agentRecord, null)) {
    return "UI/Agents/MissionTypes/Courier";
  }
  return "UI/Agents/MissionTypes/Encounter";
}

function normalizeMissionRewardItem(rewardRecord = null) {
  const typeID = normalizePositiveInteger(rewardRecord && rewardRecord.rewardTypeID, 0);
  const quantity = Math.max(0, normalizeInteger(rewardRecord && rewardRecord.rewardQuantity, 0));
  if (!typeID || quantity <= 0) {
    return null;
  }
  return {
    typeID,
    quantity,
    extra: null,
  };
}

function buildMissionRewards(agentRecord, importantMission = false, clientMissionRecord = null) {
  const base =
    REWARD_BY_LEVEL[normalizeInteger(agentRecord && agentRecord.level, 1)] ||
    REWARD_BY_LEVEL[1];
  const isCourier = isCourierMission(agentRecord, null);
  const courierMultiplier = isCourier ? 0.85 : 1.0;
  const importantMultiplier = importantMission ? 1.3 : 1.0;
  const missionRewards =
    clientMissionRecord &&
    clientMissionRecord.missionRewards &&
    typeof clientMissionRecord.missionRewards === "object"
      ? clientMissionRecord.missionRewards
      : null;
  const primaryReward = normalizeMissionRewardItem(missionRewards && missionRewards.reward);
  const bonusReward = normalizeMissionRewardItem(missionRewards && missionRewards.bonusReward);
  const itemRewards = [];
  const bonusItemRewards = [];
  let isk = roundMoney(base.isk * courierMultiplier * importantMultiplier);
  let bonusIsk = roundMoney(base.bonusIsk * courierMultiplier * importantMultiplier);

  if (primaryReward) {
    isk = 0;
    if (primaryReward.typeID === ISK_REWARD_TYPE_ID) {
      isk = primaryReward.quantity;
    } else {
      itemRewards.push(primaryReward);
    }
  }

  if (bonusReward) {
    bonusIsk = 0;
    if (bonusReward.typeID === ISK_REWARD_TYPE_ID) {
      bonusIsk = bonusReward.quantity;
    } else {
      bonusItemRewards.push(bonusReward);
    }
  }

  const fixedLpReward = Math.max(
    normalizeInteger(clientMissionRecord && clientMissionRecord.fixedLpRewardOmega, 0),
    normalizeInteger(clientMissionRecord && clientMissionRecord.fixedLpRewardAlpha, 0),
  );

  return {
    isk,
    bonusIsk,
    itemRewards,
    bonusItemRewards,
    bonusTimeIntervalMinutes: Math.max(
      0,
      normalizeInteger(missionRewards && missionRewards.bonusTimeInterval, 0),
    ),
    loyaltyPoints: Math.max(
      0,
      fixedLpReward ||
        Math.round(base.loyaltyPoints * courierMultiplier * importantMultiplier),
    ),
    researchPoints: 0,
    rawStandings: {
      corporation: Number(base.corpRaw || 0),
      faction: importantMission ? Number(base.factionRaw || 0.012) : 0,
      agent: Number(base.agentRaw || 0),
    },
    standingEvents: {
      completed: {
        corporation: Number(base.corpRaw || 0),
        faction: importantMission ? Number(base.factionRaw || 0.012) : 0,
        agent: Number(base.agentRaw || 0),
        applySocial: true,
      },
      declined: {
        corporation: 0,
        faction: 0,
        agent: 0,
        applySocial: false,
      },
      failed: {
        corporation: 0,
        faction: 0,
        agent: 0,
        applySocial: false,
      },
      offerExpired: {
        corporation: 0,
        faction: 0,
        agent: 0,
        applySocial: false,
      },
      bonus: {
        corporation: 0,
        faction: 0,
        agent: 0,
        applySocial: true,
      },
    },
  };
}

function resolvePlaceholderCargo() {
  const itemRecord = resolveItemByTypeID(PLACEHOLDER_CARGO_TYPE_ID);
  return {
    typeID: PLACEHOLDER_CARGO_TYPE_ID,
    quantity: PLACEHOLDER_CARGO_QUANTITY,
    volume: Number(itemRecord && itemRecord.volume) || 1,
    hasCargo: false,
  };
}

function buildLocationWrapForStation(stationID) {
  const station = worldData.getStationByID(stationID);
  if (!station) {
    return {
      locationID: normalizePositiveInteger(stationID, 0),
      typeID: 1531,
      solarsystemID: 0,
      locationType: "station",
    };
  }

  return {
    locationID: normalizePositiveInteger(station.stationID, 0),
    typeID: normalizePositiveInteger(station.stationTypeID, 1531),
    solarsystemID: normalizePositiveInteger(station.solarSystemID, 0),
    locationType: "station",
  };
}

function resolveDropoffStation(agentRecord) {
  const candidateStations =
    getStationsByCorporationID().get(
      normalizePositiveInteger(agentRecord && agentRecord.corporationID, 0),
    ) || [];
  const sourceStationID = normalizePositiveInteger(agentRecord && agentRecord.stationID, 0);
  const alternativeStation = candidateStations.find(
    (station) =>
      normalizePositiveInteger(station && station.stationID, 0) !== sourceStationID,
  );

  if (alternativeStation) {
    return alternativeStation;
  }

  return worldData.getStationByID(sourceStationID) || null;
}

function getClientMissionRecord(input) {
  const missionRecord =
    input && typeof input === "object"
      ? input
      : { contentID: normalizeMissionContentID(input, null) };
  const directMissionID = normalizeMissionContentID(
    missionRecord && missionRecord.contentID,
    null,
  );
  const directMissionRecord =
    directMissionID === null ? null : getMissionByID(directMissionID);
  if (directMissionRecord) {
    return directMissionRecord;
  }

  const agentRecord = getAgentRecord(missionRecord && missionRecord.agentID);
  const missionContentTemplateID = normalizeText(
    missionRecord && missionRecord.missionContentTemplateID,
    "",
  );
  const missionTemplateID = normalizeText(
    missionRecord && missionRecord.missionTemplateID,
    "",
  );
  const desiredMissionKind = normalizeText(
    missionRecord && missionRecord.missionKind,
    "",
  ).toLowerCase();
  const objectiveMode = normalizeText(
    missionRecord && missionRecord.objectiveMode,
    "",
  ).toLowerCase();
  const desiredNameID = normalizePositiveInteger(
    missionRecord && missionRecord.missionNameID,
    0,
  );
  const candidateMissionIDs = [];
  const seenMissionIDs = new Set();
  const pushCandidateMissionID = (missionID) => {
    const normalizedMissionID = normalizeMissionContentID(missionID, null);
    const missionKey =
      normalizedMissionID === null ? "" : String(normalizedMissionID);
    if (!missionKey || seenMissionIDs.has(missionKey)) {
      return;
    }
    seenMissionIDs.add(missionKey);
    candidateMissionIDs.push(normalizedMissionID);
  };

  if (missionContentTemplateID) {
    for (const missionID of listMissionIDsByTemplate(missionContentTemplateID)) {
      pushCandidateMissionID(missionID);
    }
  }

  const clientMissionTemplateMatch = missionTemplateID.match(/^client-mission:(.+)$/i);
  if (clientMissionTemplateMatch) {
    pushCandidateMissionID(clientMissionTemplateMatch[1]);
  }

  if (agentRecord) {
    for (const missionID of listClientMissionIDsForAgent(agentRecord)) {
      pushCandidateMissionID(missionID);
    }
  }

  const candidateMissionRecords = candidateMissionIDs
    .map((missionID) => getMissionByID(missionID))
    .filter(Boolean);
  if (!candidateMissionRecords.length) {
    return null;
  }

  const missionKindMatches = (clientMissionRecord) => {
    const clientMissionKind = normalizeText(
      clientMissionRecord && clientMissionRecord.missionKind,
      "",
    ).toLowerCase();
    if (!desiredMissionKind) {
      return true;
    }
    if (clientMissionKind === desiredMissionKind) {
      return true;
    }
    const normalizedKinds = new Set([clientMissionKind, desiredMissionKind]);
    return (
      normalizedKinds.has("courier") &&
      normalizedKinds.has("distribution")
    );
  };

  const objectiveModeMatches = (clientMissionRecord) => {
    if (!objectiveMode) {
      return true;
    }
    if (objectiveMode === OBJECTIVE_TYPE_DUNGEON) {
      return Boolean(
        clientMissionRecord &&
        clientMissionRecord.killMission &&
        Object.keys(clientMissionRecord.killMission).length > 0,
      );
    }
    if (objectiveMode === OBJECTIVE_TYPE_TRANSPORT) {
      return Boolean(
        clientMissionRecord &&
        clientMissionRecord.courierMission &&
        Object.keys(clientMissionRecord.courierMission).length > 0,
      );
    }
    if (objectiveMode === OBJECTIVE_TYPE_FETCH) {
      return normalizeText(
        clientMissionRecord && clientMissionRecord.missionKind,
        "",
      ).toLowerCase() === "trade";
    }
    if (objectiveMode === OBJECTIVE_TYPE_AGENT) {
      return (
        normalizeBoolean(clientMissionRecord && clientMissionRecord.isTalkToAgent, false) ||
        normalizeBoolean(clientMissionRecord && clientMissionRecord.isAgentInteraction, false) ||
        normalizeText(clientMissionRecord && clientMissionRecord.missionKind, "").toLowerCase() ===
          "talktoagent"
      );
    }
    return true;
  };

  const scoredCandidates = candidateMissionRecords
    .map((clientMissionRecord) => {
      let score = 0;
      if (
        missionContentTemplateID &&
        normalizeText(clientMissionRecord && clientMissionRecord.contentTemplate, "") ===
          missionContentTemplateID
      ) {
        score += 100;
      }
      if (
        desiredNameID > 0 &&
        normalizePositiveInteger(clientMissionRecord && clientMissionRecord.nameID, 0) ===
          desiredNameID
      ) {
        score += 50;
      }
      if (missionKindMatches(clientMissionRecord)) {
        score += 20;
      }
      if (objectiveModeMatches(clientMissionRecord)) {
        score += 20;
      }
      return { score, clientMissionRecord };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return normalizePositiveInteger(
        left.clientMissionRecord && left.clientMissionRecord.missionID,
        0,
      ) - normalizePositiveInteger(
        right.clientMissionRecord && right.clientMissionRecord.missionID,
        0,
      );
    });

  return scoredCandidates[0].clientMissionRecord || null;
}

function resolveClientMissionContentID(missionRecord, agentRecord = null) {
  const directMissionID = normalizeMissionContentID(
    missionRecord && missionRecord.contentID,
    null,
  );
  if (directMissionID !== null && getMissionByID(directMissionID)) {
    return directMissionID;
  }
  const clientMissionRecord = getClientMissionRecord({
    ...(missionRecord && typeof missionRecord === "object" ? missionRecord : {}),
    agentID:
      normalizePositiveInteger(missionRecord && missionRecord.agentID, 0) ||
      normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
  });
  return normalizeMissionContentID(
    clientMissionRecord && clientMissionRecord.missionID,
    directMissionID,
  );
}

function isFetchMissionRecord(missionRecord) {
  return normalizeText(missionRecord && missionRecord.objectiveMode, "") === OBJECTIVE_TYPE_FETCH;
}

function isAgentObjectiveMissionRecord(missionRecord) {
  return normalizeText(missionRecord && missionRecord.objectiveMode, "") === OBJECTIVE_TYPE_AGENT;
}

function getMissionArcDataRecord(missionRecord) {
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  if (!clientMissionRecord) {
    return null;
  }
  return getMissionArcInfo(clientMissionRecord.missionID);
}

function getMissionNextMissionIDs(missionRecord) {
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  if (clientMissionRecord && Array.isArray(clientMissionRecord.nextMissionIDs)) {
    return clientMissionRecord.nextMissionIDs
      .map((entry) => normalizeMissionContentID(entry, null))
      .filter((entry) => entry !== null);
  }
  const arcInfo = getMissionArcDataRecord(missionRecord);
  return Array.isArray(arcInfo && arcInfo.nextMissionIDs)
    ? arcInfo.nextMissionIDs
      .map((entry) => normalizeMissionContentID(entry, null))
      .filter((entry) => entry !== null)
    : [];
}

function getMissionConversationTargetAgentID(missionRecord, fallbackAgentID = 0) {
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  const fallbackSourceAgentID = normalizePositiveInteger(
    clientMissionRecord && clientMissionRecord.sourceAgentID,
    normalizePositiveInteger(fallbackAgentID, 0),
  );
  const targetAgentID = normalizePositiveInteger(
    clientMissionRecord && clientMissionRecord.targetAgentID,
    0,
  );
  if (targetAgentID > 0) {
    return targetAgentID;
  }
  if (normalizeBoolean(clientMissionRecord && clientMissionRecord.isAgentInteraction, false)) {
    return fallbackSourceAgentID;
  }
  return fallbackSourceAgentID;
}

function getMissionConversationTargetRecord(missionRecord, fallbackAgentID = 0) {
  const targetAgentID = getMissionConversationTargetAgentID(missionRecord, fallbackAgentID);
  return targetAgentID > 0 ? getAgentRecord(targetAgentID) : null;
}

function buildMissionConversationTargetLocationWrap(missionRecord, fallbackAgentRecord = null) {
  const targetAgentRecord = getMissionConversationTargetRecord(
    missionRecord,
    normalizePositiveInteger(fallbackAgentRecord && fallbackAgentRecord.agentID, 0),
  );
  if (targetAgentRecord) {
    return buildAgentLocationWrap(targetAgentRecord);
  }
  return fallbackAgentRecord ? buildAgentLocationWrap(fallbackAgentRecord) : null;
}

function translateMissionRewardTypeForDisplay(typeID) {
  const normalizedTypeID = normalizePositiveInteger(typeID, 0);
  return normalizedTypeID === ISK_REWARD_TYPE_ID
    ? ISK_DISPLAY_TYPE_ID
    : normalizedTypeID;
}

function buildMissionRewardDisplayEntry(rewardRecord = null) {
  const typeID = translateMissionRewardTypeForDisplay(rewardRecord && rewardRecord.typeID);
  const quantity = Math.max(0, normalizeInteger(rewardRecord && rewardRecord.quantity, 0));
  if (!typeID || quantity <= 0) {
    return null;
  }
  return [typeID, quantity, rewardRecord && Object.prototype.hasOwnProperty.call(rewardRecord, "extra")
    ? cloneValue(rewardRecord.extra)
    : null];
}

function resolveMissionBonusTimeRemainingTicks(missionRecord) {
  const rewards =
    missionRecord && missionRecord.rewards && typeof missionRecord.rewards === "object"
      ? missionRecord.rewards
      : {};
  const intervalMinutes = Math.max(0, normalizeInteger(rewards.bonusTimeIntervalMinutes, 0));
  if (intervalMinutes <= 0) {
    return 0;
  }

  const acceptedAt = fileTimeStringToBigInt(missionRecord && missionRecord.acceptedAtFileTime);
  if (acceptedAt <= 0n) {
    return intervalMsToTicks(intervalMinutes * 60 * 1000);
  }

  const deadline = acceptedAt + BigInt(intervalMsToTicks(intervalMinutes * 60 * 1000));
  const remaining = deadline - nowFileTimeBigInt();
  if (remaining <= 0n) {
    return 0;
  }
  return Number(remaining);
}

function isMissionBonusRewardAvailable(missionRecord) {
  const rewards =
    missionRecord && missionRecord.rewards && typeof missionRecord.rewards === "object"
      ? missionRecord.rewards
      : {};
  const hasTimedBonus = Math.max(0, normalizeInteger(rewards.bonusTimeIntervalMinutes, 0)) > 0;
  if (!hasTimedBonus) {
    return true;
  }
  return resolveMissionBonusTimeRemainingTicks(missionRecord) > 0;
}

function getMissionObjectiveChainID(missionRecord) {
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  const clientObjectives = normalizeObject(
    clientMissionRecord && clientMissionRecord.clientObjectives,
  );
  return normalizePositiveInteger(
    clientObjectives.objectiveChainID || clientObjectives.objectiveChainId,
    0,
  );
}

function getMissionObjectiveChainRecord(missionRecord) {
  const objectiveChainID = getMissionObjectiveChainID(missionRecord);
  return objectiveChainID > 0 ? getObjectiveChainByID(objectiveChainID) : null;
}

function buildMissionItemSpec(value, fallbackTypeID = 0, fallbackQuantity = 1) {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    const source = normalizeObject(candidate);
    const typeID = normalizePositiveInteger(
      source.typeID || source.type_id || source.objectiveTypeID,
      0,
    );
    const groupID = normalizePositiveInteger(
      source.groupID || source.group_id,
      0,
    );
    const quantity = Math.max(
      1,
      normalizeInteger(
        source.quantity || source.objectiveQuantity,
        fallbackQuantity,
      ),
    );
    if (typeID > 0 || groupID > 0) {
      return { typeID, groupID, quantity };
    }
  }

  const normalizedFallbackTypeID = normalizePositiveInteger(fallbackTypeID, 0);
  if (normalizedFallbackTypeID > 0) {
    return {
      typeID: normalizedFallbackTypeID,
      groupID: 0,
      quantity: Math.max(1, normalizeInteger(fallbackQuantity, 1)),
    };
  }
  return null;
}

function resolvePrimaryMissionItemSpec(missionRecord) {
  if (missionRecord && missionRecord.cargo) {
    return buildMissionItemSpec(missionRecord.cargo);
  }

  const clientMissionRecord = getClientMissionRecord(missionRecord);
  const courierMission = normalizeObject(
    clientMissionRecord && clientMissionRecord.courierMission,
  );
  const killMission = normalizeObject(
    clientMissionRecord && clientMissionRecord.killMission,
  );

  if (normalizePositiveInteger(courierMission.objectiveTypeID, 0) > 0) {
    return buildMissionItemSpec({
      typeID: courierMission.objectiveTypeID,
      quantity: courierMission.objectiveQuantity,
    });
  }

  if (normalizePositiveInteger(killMission.objectiveTypeID, 0) > 0) {
    return buildMissionItemSpec({
      typeID: killMission.objectiveTypeID,
      quantity: killMission.objectiveQuantity,
    });
  }

  return null;
}

function buildMissionObjectiveContext(agentRecord, missionRecord, objectiveChainRecord) {
  const defaults = {};
  for (const parameter of normalizeArray(
    objectiveChainRecord && objectiveChainRecord.contextParameters,
  )) {
    const parameterKey = normalizeText(parameter && parameter.parameterKey, "");
    if (!parameterKey || !Object.prototype.hasOwnProperty.call(parameter || {}, "defaultValue")) {
      continue;
    }
    defaults[parameterKey] = cloneValue(parameter.defaultValue);
  }

  const clientMissionRecord = getClientMissionRecord(missionRecord);
  const primaryItemSpec = resolvePrimaryMissionItemSpec(missionRecord);
  const deliverItemsValue = primaryItemSpec
    ? {
        type_id: primaryItemSpec.typeID || null,
        group_id: primaryItemSpec.groupID || null,
        quantity: primaryItemSpec.quantity,
      }
    : null;
  const missionSiteItemID =
    normalizePositiveInteger(missionRecord && missionRecord.missionSiteID, 0) ||
    normalizePositiveInteger(missionRecord && missionRecord.dungeonID, 0) ||
    normalizePositiveInteger(missionRecord && missionRecord.dungeonInstanceID, 0);
  const dropoffLocationID =
    normalizePositiveInteger(
      missionRecord &&
        missionRecord.dropoffLocation &&
        missionRecord.dropoffLocation.locationID,
      0,
    ) ||
    normalizePositiveInteger(agentRecord && agentRecord.stationID, 0);
  const pickupLocationID = normalizePositiveInteger(
    missionRecord &&
      missionRecord.pickupLocation &&
      missionRecord.pickupLocation.locationID,
    0,
  );

  return {
    ...defaults,
    agent_id: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
    agent_location_id: normalizePositiveInteger(agentRecord && agentRecord.stationID, 0),
    agent_solar_system_id: normalizePositiveInteger(
      agentRecord && agentRecord.solarSystemID,
      0,
    ),
    complete_mission_location_id: dropoffLocationID,
    pick_up_location: pickupLocationID,
    dungeon_id: normalizePositiveInteger(missionRecord && missionRecord.dungeonID, 0),
    dungeon_location_id: normalizePositiveInteger(
      missionRecord && missionRecord.missionSystemID,
      0,
    ),
    dungeon_bookmark: {
      ...normalizeObject(defaults.dungeon_bookmark),
      item_id: missionSiteItemID || null,
      type_id:
        normalizePositiveInteger(
          missionRecord &&
            missionRecord.pickupLocation &&
            missionRecord.pickupLocation.typeID,
          0,
        ) || TYPE_SOLAR_SYSTEM,
    },
    loot_container: {
      ...normalizeObject(defaults.loot_container),
      item_id: missionSiteItemID || null,
    },
    target: {
      ...normalizeObject(defaults.target),
      item_id: missionSiteItemID || null,
    },
    hostile_target: normalizeArray(defaults.hostile_target).length > 0
      ? normalizeArray(defaults.hostile_target).map((entry) => ({
          ...normalizeObject(entry),
          item_id:
            normalizePositiveInteger(normalizeObject(entry).item_id, 0) ||
            missionSiteItemID ||
            null,
        }))
      : [{
          item_id: missionSiteItemID || null,
          type_id: null,
        }],
    deliver_items: deliverItemsValue || defaults.deliver_items || null,
    required_ore: deliverItemsValue || defaults.required_ore || null,
    pickup_items: deliverItemsValue || defaults.pickup_items || null,
    pick_up_tritanium: deliverItemsValue || defaults.pick_up_tritanium || null,
    pick_up_veldspar: deliverItemsValue || defaults.pick_up_veldspar || null,
    clientMissionRecord,
  };
}

function resolveObjectiveParameterValue(objectiveRecord, objectiveContext, parameterKey) {
  const alias = normalizeText(
    objectiveRecord &&
      objectiveRecord.inputParametersMap &&
      objectiveRecord.inputParametersMap[parameterKey],
    parameterKey,
  );
  return objectiveContext && Object.prototype.hasOwnProperty.call(objectiveContext, alias)
    ? objectiveContext[alias]
    : null;
}

function getMissionMessageID(clientMissionRecord, messageKey) {
  return normalizePositiveInteger(
    clientMissionRecord &&
      clientMissionRecord.messages &&
      clientMissionRecord.messages[messageKey],
    0,
  );
}

function getMissionLocalizedMessageEntry(clientMissionRecord, messageKey) {
  const entry =
    clientMissionRecord &&
    clientMissionRecord.localizedMessages &&
    clientMissionRecord.localizedMessages[messageKey];
  return entry && typeof entry === "object" ? entry : null;
}

function getMissionLocalizedMessageText(clientMissionRecord, messageKey) {
  const entry = getMissionLocalizedMessageEntry(clientMissionRecord, messageKey);
  return normalizeText(
    entry && entry.text,
    "",
  );
}

function getFirstMissionMessageID(clientMissionRecord, messageKeys) {
  const keys = Array.isArray(messageKeys) ? messageKeys : [messageKeys];
  for (const key of keys) {
    const messageID = getMissionMessageID(clientMissionRecord, key);
    if (messageID > 0) {
      return messageID;
    }
  }
  return 0;
}

function getFirstMissionLocalizedMessageText(clientMissionRecord, messageKeys) {
  const keys = Array.isArray(messageKeys) ? messageKeys : [messageKeys];
  for (const key of keys) {
    const text = getMissionLocalizedMessageText(clientMissionRecord, key);
    if (text) {
      return text;
    }
  }
  return "";
}

function getMissionLocalizedNameText(clientMissionRecord) {
  return normalizeText(
    clientMissionRecord &&
      clientMissionRecord.localizedName &&
      clientMissionRecord.localizedName.text,
    "",
  );
}

function buildMissionMessageReference(missionRecord, messageID) {
  const normalizedMessageID = normalizePositiveInteger(messageID, 0);
  if (!normalizedMessageID) {
    return null;
  }
  return normalizedMessageID;
}

function buildMissionProcessMessageReference(missionRecord, messageID) {
  const normalizedMessageID = normalizePositiveInteger(messageID, 0);
  if (!normalizedMessageID) {
    return null;
  }
  return buildMarshalTuple([
    normalizedMessageID,
    resolveClientMissionContentID(missionRecord),
  ]);
}

function buildMissionMessageReferenceByKeys(
  missionRecord,
  clientMissionRecord,
  messageKeys,
) {
  return buildMissionMessageReference(
    missionRecord,
    getFirstMissionMessageID(clientMissionRecord, messageKeys),
  );
}

function buildMissionProcessMessageReferenceByKeys(
  missionRecord,
  clientMissionRecord,
  messageKeys,
) {
  return buildMissionProcessMessageReference(
    missionRecord,
    getFirstMissionMessageID(clientMissionRecord, messageKeys),
  );
}

function buildConversationAgentSays(missionRecord, clientMissionRecord, messageKeys, fallbackText) {
  const keys = Array.isArray(messageKeys) ? messageKeys : [messageKeys];
  for (const key of keys) {
    const messageID = getMissionMessageID(clientMissionRecord, key);
    if (messageID > 0) {
      return [
        buildMissionMessageReference(missionRecord, messageID),
        resolveClientMissionContentID(missionRecord),
      ];
    }
  }
  const localizedText = getFirstMissionLocalizedMessageText(
    clientMissionRecord,
    keys,
  );
  if (localizedText) {
    return [
      localizedText,
      resolveClientMissionContentID(missionRecord),
    ];
  }
  return [
    normalizeText(fallbackText, ""),
    resolveClientMissionContentID(missionRecord),
  ];
}

function resolveMissionSiteSeed(missionRecord, agentRecord) {
  return [
    normalizePositiveInteger(missionRecord && missionRecord.missionSequence, 0),
    normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
    missionContentIDToText(missionRecord && missionRecord.contentID, ""),
  ].join(":");
}

function buildMissionDungeonSiteKey(characterID, missionRecord) {
  return `mission:${normalizePositiveInteger(characterID, 0)}:${normalizePositiveInteger(
    missionRecord && missionRecord.missionSequence,
    0,
  )}`;
}

function resolveMissionAnchorCelestial(solarSystemID, seed) {
  const celestials = worldData.getCelestialsForSystem(solarSystemID);
  const candidates = celestials.filter((celestial) => (
    celestial &&
    celestial.position &&
    normalizeText(celestial.kind, "").toLowerCase() !== "sun"
  ));
  if (candidates.length > 0) {
    return candidates[hashText(`${seed}:anchor`) % candidates.length];
  }
  return celestials.find((celestial) => celestial && celestial.position) || null;
}

function buildMissionSitePosition(solarSystemID, missionRecord, agentRecord) {
  const seed = resolveMissionSiteSeed(missionRecord, agentRecord);
  const anchor = resolveMissionAnchorCelestial(solarSystemID, seed);
  const base = anchor && anchor.position ? clonePosition(anchor.position) : { x: 0, y: 0, z: 0 };
  const angle = ((hashText(`${seed}:angle`) % 3600) / 3600) * Math.PI * 2;
  const distance =
    MISSION_SITE_DISTANCE_METERS +
    ((hashText(`${seed}:distance`) % (MISSION_SITE_DISTANCE_JITTER_METERS * 2 + 1)) -
      MISSION_SITE_DISTANCE_JITTER_METERS);
  const vertical =
    ((hashText(`${seed}:vertical`) % (MISSION_SITE_VERTICAL_JITTER_METERS * 2 + 1)) -
      MISSION_SITE_VERTICAL_JITTER_METERS);
  return addVectors(base, {
    x: Math.cos(angle) * distance,
    y: vertical,
    z: Math.sin(angle) * distance,
  });
}

function buildMissionSiteLocationWrap(agentRecord, missionRecord, missionTemplate = null) {
  const solarSystemID =
    normalizePositiveInteger(missionRecord && missionRecord.missionSystemID, 0) ||
    normalizePositiveInteger(agentRecord && agentRecord.solarSystemID, 0);
  const position = clonePosition(missionRecord && missionRecord.missionPosition);
  return {
    locationID: solarSystemID,
    typeID: TYPE_SOLAR_SYSTEM,
    solarsystemID: solarSystemID,
    locationType: "dungeon",
    coords: [position.x, position.y, position.z],
    agentID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
    referringAgentID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
    shipTypeID: normalizePositiveInteger(
      missionTemplate && missionTemplate.entryObjectTypeID,
      0,
    ) || null,
  };
}

function buildMissionBookmarkPayload(bookmarkRecord) {
  if (!bookmarkRecord || typeof bookmarkRecord !== "object") {
    return null;
  }
  const metadata =
    bookmarkRecord.metadata && typeof bookmarkRecord.metadata === "object"
      ? bookmarkRecord.metadata
      : {};
  const solarSystemID =
    normalizePositiveInteger(metadata.solarsystemID, 0) ||
    normalizePositiveInteger(bookmarkRecord.locationID, 0);
  const role = normalizeText(metadata.role, "").toLowerCase();
  const originalHint = ({
    agenthomebase: "UI/Agents/StandardMission/AgentLocation",
    source: "UI/Agents/StandardMission/TransportPickupLocation",
    destination: "UI/Agents/StandardMission/TransportDropOffLocation",
    dungeon: "UI/Agents/StandardMission/ObjectiveLocation",
  })[role] || null;
  return buildKeyVal([
    ["bookmarkID", normalizePositiveInteger(bookmarkRecord.bookmarkID, 0)],
    ["itemID", normalizePositiveInteger(bookmarkRecord.itemID, 0) || null],
    ["typeID", normalizePositiveInteger(bookmarkRecord.typeID, TYPE_SOLAR_SYSTEM)],
    ["x", bookmarkRecord.x == null ? null : buildMarshalReal(bookmarkRecord.x, 0)],
    ["y", bookmarkRecord.y == null ? null : buildMarshalReal(bookmarkRecord.y, 0)],
    ["z", bookmarkRecord.z == null ? null : buildMarshalReal(bookmarkRecord.z, 0)],
    ["locationID", normalizePositiveInteger(bookmarkRecord.locationID, 0)],
    ["solarsystemID", solarSystemID],
    ["hint", normalizeText(metadata.hint, bookmarkRecord.memo || "")],
    ["originalHint", originalHint],
    ["locationNumber", 0],
    ["locationType", normalizeText(metadata.locationType, "")],
    ["agentID", normalizePositiveInteger(metadata.agentID, 0) || null],
    ["referringAgentID", normalizePositiveInteger(metadata.referringAgentID, 0) || null],
    ["isAgentBase", metadata.isAgentBase === true],
    ["created", buildFiletimeLong(fileTimeStringToBigInt(bookmarkRecord.created))],
    ["expiry", bookmarkRecord.expiry ? buildFiletimeLong(fileTimeStringToBigInt(bookmarkRecord.expiry)) : null],
  ]);
}

function listMissionBookmarks(characterID, missionRecord) {
  const bookmarkIDsByRole =
    missionRecord && missionRecord.bookmarkIDsByRole && typeof missionRecord.bookmarkIDsByRole === "object"
      ? missionRecord.bookmarkIDsByRole
      : {};
  return Object.values(bookmarkIDsByRole)
    .map((bookmarkID) => bookmarkRuntime.getBookmarkForCharacter(characterID, bookmarkID))
    .filter(Boolean)
    .map((bookmarkInfo) => buildMissionBookmarkPayload(bookmarkInfo.bookmark))
    .filter(Boolean);
}

function resolveStaticBookmarkTarget(stationID) {
  const station = worldData.getStationByID(stationID);
  if (!station) {
    return null;
  }
  return {
    itemID: normalizePositiveInteger(station.stationID, 0),
    typeID: normalizePositiveInteger(station.stationTypeID, TYPE_SOLAR_SYSTEM),
    locationID: normalizePositiveInteger(station.solarSystemID, 0),
    solarsystemID: normalizePositiveInteger(station.solarSystemID, 0),
  };
}

function ensureMissionBookmarkFolder(characterID) {
  const existingView = bookmarkRuntime.listFolderViews(characterID).find((view) => (
    view &&
    view.folder &&
    view.folder.isPersonal === true &&
    normalizeText(view.folder.folderName, "").toLowerCase() ===
      MISSION_BOOKMARK_FOLDER_NAME.toLowerCase()
  ));
  if (existingView && existingView.folder) {
    if (existingView.isActive === true) {
      try {
        bookmarkRuntime.updateKnownFolderState(
          characterID,
          existingView.folder.folderID,
          false,
        );
      } catch (_error) {
        // Ignore folder-state races and keep using the existing folder.
      }
    }
    return existingView.folder;
  }

  try {
    const createdView = bookmarkRuntime.addFolder(characterID, {
      folderName: MISSION_BOOKMARK_FOLDER_NAME,
      description: MISSION_BOOKMARK_FOLDER_DESCRIPTION,
      isPersonal: true,
    });
    if (createdView && createdView.folder) {
      try {
        bookmarkRuntime.updateKnownFolderState(
          characterID,
          createdView.folder.folderID,
          false,
        );
      } catch (_error) {
        // Folder was created; staying active is still better than failing hard.
      }
      return createdView.folder;
    }
  } catch (_error) {
    // Fall through to the normal personal folder as a safe fallback.
  }

  return bookmarkRuntime.ensureDefaultPersonalFolder(characterID);
}

function collectBookmarkIDsByFolder(bookmarks = []) {
  const bookmarkIDsByFolderID = new Map();
  for (const bookmark of Array.isArray(bookmarks) ? bookmarks : []) {
    const bookmarkID = normalizePositiveInteger(bookmark && bookmark.bookmarkID, 0);
    const folderID = normalizePositiveInteger(bookmark && bookmark.folderID, 0);
    if (!bookmarkID || !folderID) {
      continue;
    }
    if (!bookmarkIDsByFolderID.has(folderID)) {
      bookmarkIDsByFolderID.set(folderID, []);
    }
    bookmarkIDsByFolderID.get(folderID).push(bookmarkID);
  }
  return bookmarkIDsByFolderID;
}

function cleanupVisibleLegacyMissionBookmarks(characterID, agentRecord, missionRecord) {
  const activeBookmarkState = bookmarkRuntime.getMyActiveBookmarks(characterID);
  const visibleBookmarks = Array.isArray(activeBookmarkState && activeBookmarkState.bookmarks)
    ? activeBookmarkState.bookmarks
    : [];
  const expectedAgentID = normalizePositiveInteger(agentRecord && agentRecord.agentID, 0);
  const expectedMissionSiteID = normalizePositiveInteger(
    missionRecord && missionRecord.missionSiteID,
    0,
  );
  const expectedMissionInstanceID = normalizePositiveInteger(
    missionRecord && missionRecord.dungeonInstanceID,
    0,
  );
  const expectedMissionTitle = normalizeText(
    missionRecord && missionRecord.missionTitle,
    "",
  ).toLowerCase();
  const missionBookmarkFolderID = normalizePositiveInteger(
    ensureMissionBookmarkFolder(characterID).folderID,
    0,
  );

  const staleMissionBookmarks = visibleBookmarks.filter((bookmark) => {
    const metadata =
      bookmark && bookmark.metadata && typeof bookmark.metadata === "object"
        ? bookmark.metadata
        : {};
    const locationType = normalizeText(metadata.locationType, "");
    if (
      !["agenthomebase", "objective.source", "objective.destination", "dungeon"].includes(
        locationType,
      )
    ) {
      return false;
    }
    if (normalizePositiveInteger(bookmark && bookmark.folderID, 0) === missionBookmarkFolderID) {
      return false;
    }

    const bookmarkAgentID = normalizePositiveInteger(metadata.agentID, 0);
    const bookmarkReferringAgentID = normalizePositiveInteger(
      metadata.referringAgentID,
      0,
    );
    const bookmarkMissionSiteID = normalizePositiveInteger(metadata.missionSiteID, 0);
    const bookmarkMissionInstanceID = normalizePositiveInteger(metadata.missionInstanceID, 0);
    const bookmarkTitle = normalizeText(
      bookmark && (bookmark.memo || metadata.hint),
      "",
    ).toLowerCase();

    return (
      (expectedAgentID > 0 &&
        (bookmarkAgentID === expectedAgentID || bookmarkReferringAgentID === expectedAgentID)) ||
      (expectedMissionSiteID > 0 && bookmarkMissionSiteID === expectedMissionSiteID) ||
      (expectedMissionInstanceID > 0 && bookmarkMissionInstanceID === expectedMissionInstanceID) ||
      (expectedMissionTitle &&
        bookmarkTitle &&
        (bookmarkTitle.includes(expectedMissionTitle) ||
          expectedMissionTitle.includes(bookmarkTitle)))
    );
  });

  for (const [folderID, bookmarkIDs] of collectBookmarkIDsByFolder(staleMissionBookmarks).entries()) {
    try {
      bookmarkRuntime.deleteBookmarks(characterID, folderID, bookmarkIDs);
    } catch (_error) {
      // Ignore best-effort cleanup failures and proceed with fresh mission bookmarks.
    }
  }
}

function ensureMissionBookmarks(characterID, agentRecord, missionRecord, missionTemplate = null) {
  cleanupMissionBookmarks(characterID, missionRecord);
  cleanupVisibleLegacyMissionBookmarks(characterID, agentRecord, missionRecord);

  const folder = ensureMissionBookmarkFolder(characterID);
  const bookmarkIDsByRole = {};
  const stationTarget = resolveStaticBookmarkTarget(agentRecord && agentRecord.stationID);
  const missionTitle = normalizeText(
    missionRecord && missionRecord.missionTitle,
    missionContentIDToText(missionRecord && missionRecord.contentID, "Mission"),
  );

  if (stationTarget) {
    const homeResult = bookmarkRuntime.createBookmark(characterID, {
      folderID: folder.folderID,
      memo: missionTitle,
      note: normalizeText(agentRecord && agentRecord.ownerName, ""),
      ...stationTarget,
      metadata: {
        role: "agenthomebase",
        locationType: "agenthomebase",
        hint: normalizeText(agentRecord && agentRecord.ownerName, "Agent Home Base"),
        solarsystemID: stationTarget.solarsystemID,
        agentID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
        referringAgentID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
        isAgentBase: true,
      },
    });
    bookmarkIDsByRole.agenthomebase = normalizePositiveInteger(
      homeResult && homeResult.bookmark && homeResult.bookmark.bookmarkID,
      0,
    ) || null;
  }

  if (missionRecord.objectiveMode === OBJECTIVE_TYPE_TRANSPORT) {
    const pickupLocation = missionRecord.pickupLocation || null;
    if (
      pickupLocation &&
      normalizePositiveInteger(pickupLocation.locationID, 0) > 0
    ) {
      const pickupResult = bookmarkRuntime.createBookmark(characterID, {
        folderID: folder.folderID,
        memo: `${missionTitle} Pickup`,
        note: "",
        itemID: normalizePositiveInteger(agentRecord && agentRecord.stationID, 0) || null,
        typeID: pickupLocation.typeID || TYPE_SOLAR_SYSTEM,
        locationID: normalizePositiveInteger(pickupLocation.solarsystemID || pickupLocation.locationID, 0),
        metadata: {
          role: "source",
          locationType: "objective.source",
          hint: "Pickup Location",
          solarsystemID: normalizePositiveInteger(pickupLocation.solarsystemID, 0),
          agentID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
          referringAgentID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
        },
      });
      bookmarkIDsByRole.source = normalizePositiveInteger(
        pickupResult && pickupResult.bookmark && pickupResult.bookmark.bookmarkID,
        0,
      ) || null;
    }
  } else if (missionRecord.missionPosition) {
    const dungeonResult = bookmarkRuntime.createBookmark(characterID, {
      folderID: folder.folderID,
      memo: missionTitle,
      note: "",
      itemID: normalizePositiveInteger(missionRecord.missionSystemID, 0),
      typeID: TYPE_SOLAR_SYSTEM,
      locationID: normalizePositiveInteger(missionRecord.missionSystemID, 0),
      x: missionRecord.missionPosition.x,
      y: missionRecord.missionPosition.y,
      z: missionRecord.missionPosition.z,
      metadata: {
        role: "dungeon",
        locationType: "dungeon",
        hint: normalizeText(missionTemplate && missionTemplate.title, missionTitle),
        solarsystemID: normalizePositiveInteger(missionRecord.missionSystemID, 0),
        agentID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
        referringAgentID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
        missionInstanceID: normalizePositiveInteger(missionRecord.dungeonInstanceID, 0) || null,
        missionSiteID: normalizePositiveInteger(missionRecord.missionSiteID, 0) || null,
      },
    });
    bookmarkIDsByRole.dungeon = normalizePositiveInteger(
      dungeonResult && dungeonResult.bookmark && dungeonResult.bookmark.bookmarkID,
      0,
    ) || null;
  }

  const dropoffLocation = missionRecord.dropoffLocation || null;
  const dropoffStation = worldData.getStationByID(dropoffLocation && dropoffLocation.locationID);
  if (
    dropoffLocation &&
    normalizePositiveInteger(dropoffLocation.locationID, 0) > 0
  ) {
    const destinationResult = bookmarkRuntime.createBookmark(characterID, {
      folderID: folder.folderID,
      memo: `${missionTitle} Delivery`,
      note: "",
      itemID: normalizePositiveInteger(dropoffLocation.locationID, 0),
      typeID:
        normalizePositiveInteger(dropoffStation && dropoffStation.stationTypeID, 0) ||
        dropoffLocation.typeID ||
        TYPE_SOLAR_SYSTEM,
      locationID: normalizePositiveInteger(dropoffLocation.solarsystemID, 0),
      metadata: {
        role: "destination",
        locationType: "objective.destination",
        hint: "Delivery Location",
        solarsystemID: normalizePositiveInteger(dropoffLocation.solarsystemID, 0),
        agentID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
        referringAgentID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
      },
    });
    bookmarkIDsByRole.destination = normalizePositiveInteger(
      destinationResult && destinationResult.bookmark && destinationResult.bookmark.bookmarkID,
      0,
    ) || null;
  }

  return Object.fromEntries(
    Object.entries(bookmarkIDsByRole).filter(([, bookmarkID]) => bookmarkID),
  );
}

function cleanupMissionBookmarks(characterID, missionRecord) {
  const bookmarkIDs = Object.values(
    missionRecord && missionRecord.bookmarkIDsByRole && typeof missionRecord.bookmarkIDsByRole === "object"
      ? missionRecord.bookmarkIDsByRole
      : {},
  )
    .map((bookmarkID) => normalizePositiveInteger(bookmarkID, 0))
    .filter(Boolean);
  for (const bookmarkID of bookmarkIDs) {
    const bookmarkInfo = bookmarkRuntime.getBookmarkForCharacter(characterID, bookmarkID);
    if (!bookmarkInfo || !bookmarkInfo.folder) {
      continue;
    }
    try {
      bookmarkRuntime.deleteBookmarks(
        characterID,
        bookmarkInfo.folder.folderID,
        [bookmarkID],
      );
    } catch (_error) {
      // Mission cleanup should not fail hard if a bookmark was already removed.
    }
  }
}

function ensureMissionSiteState(characterID, agentRecord, missionRecord, missionTemplate = null) {
  const nextRecord = cloneValue(missionRecord);
  if (nextRecord.objectiveMode === OBJECTIVE_TYPE_TRANSPORT) {
    if (
      nextRecord.cargo &&
      nextRecord.pickupLocation &&
      normalizePositiveInteger(nextRecord.pickupLocation.locationID, 0) > 0 &&
      nextRecord.cargo.granted !== true
    ) {
      const grantResult = grantItemsToCharacterStationHangar(
        characterID,
        nextRecord.pickupLocation.locationID,
        [{
          itemType: nextRecord.cargo.typeID,
          quantity: nextRecord.cargo.quantity,
        }],
      );
      if (grantResult && grantResult.success === true) {
        nextRecord.cargo.granted = true;
        notifyMissionInventoryChanges(
          characterID,
          (grantResult.data && grantResult.data.changes) || [],
        );
      }
    }
    nextRecord.bookmarkIDsByRole = ensureMissionBookmarks(
      characterID,
      agentRecord,
      nextRecord,
      missionTemplate,
    );
    return nextRecord;
  }

  if (isFetchMissionRecord(nextRecord) || isAgentObjectiveMissionRecord(nextRecord)) {
    nextRecord.bookmarkIDsByRole = ensureMissionBookmarks(
      characterID,
      agentRecord,
      nextRecord,
      missionTemplate,
    );
    return nextRecord;
  }

  const missionSystemID =
    normalizePositiveInteger(nextRecord.missionSystemID, 0) ||
    normalizePositiveInteger(agentRecord && agentRecord.solarSystemID, 0);
  const missionPosition =
    nextRecord.missionPosition && typeof nextRecord.missionPosition === "object"
      ? clonePosition(nextRecord.missionPosition)
      : buildMissionSitePosition(missionSystemID, nextRecord, agentRecord);
  const missionSiteID =
    normalizePositiveInteger(nextRecord.missionSiteID, 0) ||
    (MISSION_SITE_ID_OFFSET + normalizePositiveInteger(nextRecord.missionSequence, 0));
  let dungeonInstanceID = normalizePositiveInteger(nextRecord.dungeonInstanceID, 0) || null;

  const runtimeInstanceTemplate = getMissionInstanceTemplateRecord(nextRecord);
  const runtimeInstanceTemplateID = normalizeText(
    runtimeInstanceTemplate && runtimeInstanceTemplate.templateID,
    normalizeText(nextRecord.dungeonTemplateID, ""),
  );
  if (dungeonInstanceID) {
    const existingInstance = dungeonRuntime.getInstance(dungeonInstanceID);
    if (!existingInstance) {
      dungeonInstanceID = null;
    } else if (
      runtimeInstanceTemplateID &&
      normalizeText(existingInstance && existingInstance.templateID, "") !== runtimeInstanceTemplateID
    ) {
      try {
        dungeonRuntime.purgeInstance(dungeonInstanceID);
      } catch (error) {
        // Ignore stale runtime rows that may already have been cleaned up elsewhere.
      }
      dungeonInstanceID = null;
    }
  }

  if (!dungeonInstanceID && runtimeInstanceTemplateID) {
    const existingInstance = dungeonRuntime.findInstanceBySiteKey(
      buildMissionDungeonSiteKey(characterID, nextRecord),
      {
        activeOnly: true,
        full: true,
      },
    );
    const existingInstanceTemplateID = normalizeText(
      existingInstance && existingInstance.templateID,
      "",
    );
    if (
      existingInstance &&
      runtimeInstanceTemplateID &&
      existingInstanceTemplateID &&
      existingInstanceTemplateID !== runtimeInstanceTemplateID
    ) {
      try {
        dungeonRuntime.purgeInstance(
          normalizePositiveInteger(existingInstance && existingInstance.instanceID, 0),
        );
      } catch (_error) {
        // Ignore stale mission-pocket rows that were already partially cleaned up.
      }
      dungeonInstanceID = null;
    } else {
      dungeonInstanceID =
        normalizePositiveInteger(existingInstance && existingInstance.instanceID, 0) || null;
    }
  }

  if (!dungeonInstanceID && runtimeInstanceTemplateID) {
    const createdInstance = dungeonRuntime.createInstance({
      templateID: runtimeInstanceTemplateID,
      solarSystemID: missionSystemID,
      position: missionPosition,
      lifecycleState: "active",
      siteKey: buildMissionDungeonSiteKey(characterID, nextRecord),
      siteKind: "mission",
      siteOrigin: "agentMission",
      instanceScope: "private",
      ownership: {
        visibilityScope: "private",
        characterID,
        missionOwnerCharacterID: characterID,
      },
      metadata: {
        siteID: missionSiteID,
        label: normalizeText(nextRecord.missionTitle, "Mission Site"),
        missionRuntime: true,
        missionAgentID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
        missionSequence: normalizePositiveInteger(nextRecord.missionSequence, 0),
        missionCharacterID: characterID,
        missionContentID: normalizeMissionContentID(nextRecord.contentID, null),
        missionPresentationTemplateID: normalizeText(nextRecord.missionTemplateID, "") ||
          normalizeText(nextRecord.dungeonTemplateID, "") ||
          null,
        missionRuntimeTemplateID: runtimeInstanceTemplateID || null,
      },
      runtimeFlags: {
        missionRuntime: true,
      },
    });
    dungeonInstanceID = normalizePositiveInteger(createdInstance && createdInstance.instanceID, 0) || null;
  }

  nextRecord.missionSystemID = missionSystemID;
  nextRecord.missionPosition = missionPosition;
  nextRecord.missionSiteID = missionSiteID;
  nextRecord.dungeonInstanceID = dungeonInstanceID;
  nextRecord.bookmarkIDsByRole = ensureMissionBookmarks(
    characterID,
    agentRecord,
    nextRecord,
    missionTemplate,
  );
  return nextRecord;
}

function listCharacterCargoStacks(characterID, locationID, flagID, typeID) {
  return listContainerItems(characterID, locationID, flagID)
    .filter((item) => normalizePositiveInteger(item && item.typeID, 0) === normalizePositiveInteger(typeID, 0));
}

function sumItemStackQuantity(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => (
    sum + (normalizePositiveInteger(item && item.singleton, 0) === 1
      ? 1
      : Math.max(0, normalizeInteger(item && (item.stacksize || item.quantity), 0)))
  ), 0);
}

function getCourierProgress(characterID, missionRecord) {
  const cargo = missionRecord && missionRecord.cargo ? missionRecord.cargo : null;
  if (!cargo) {
    return {
      sourceHangarQuantity: 0,
      shipCargoQuantity: 0,
      destinationHangarQuantity: 0,
    };
  }
  const pickupLocationID = normalizePositiveInteger(
    missionRecord && missionRecord.pickupLocation && missionRecord.pickupLocation.locationID,
    0,
  );
  const dropoffLocationID = normalizePositiveInteger(
    missionRecord && missionRecord.dropoffLocation && missionRecord.dropoffLocation.locationID,
    0,
  );
  const activeShip = getActiveShipItem(characterID);
  return {
    sourceHangarQuantity: pickupLocationID > 0
      ? sumItemStackQuantity(
          listCharacterCargoStacks(
            characterID,
            pickupLocationID,
            ITEM_FLAGS.HANGAR,
            cargo.typeID,
          ),
        )
      : 0,
    shipCargoQuantity:
      activeShip && normalizePositiveInteger(activeShip.itemID, 0) > 0
        ? sumItemStackQuantity(
            listCharacterCargoStacks(
              characterID,
              activeShip.itemID,
              ITEM_FLAGS.CARGO_HOLD,
              cargo.typeID,
            ),
          )
        : 0,
    destinationHangarQuantity: dropoffLocationID > 0
      ? sumItemStackQuantity(
          listCharacterCargoStacks(
            characterID,
            dropoffLocationID,
            ITEM_FLAGS.HANGAR,
            cargo.typeID,
          ),
        )
      : 0,
  };
}

function notifyMissionInventoryChanges(characterID, changes = []) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const liveSession = getPreferredCharacterSession(normalizedCharacterID);
  if (!liveSession) {
    notifyInventoryChangesToCharacter(normalizedCharacterID, changes);
    return;
  }

  notifyInventoryChangesToCharacter(normalizedCharacterID, changes, {
    excludeSession: liveSession,
  });

  const dockedLocationID = normalizePositiveInteger(
    getDockedLocationID(liveSession),
    0,
  );
  for (const change of Array.isArray(changes) ? changes : []) {
    const previousState = normalizeObject(
      change && (change.previousData || change.previousState),
    );
    const notificationItem =
      change && change.item
        ? change.item
        : (
          change &&
          change.removed === true &&
          Object.keys(previousState).length > 0
        )
          ? buildRemovedItemNotificationState(previousState)
          : null;
    if (!notificationItem) {
      continue;
    }
    const currentLocationID = normalizePositiveInteger(notificationItem.locationID, 0);
    const previousLocationID = normalizePositiveInteger(previousState.locationID, 0);
    const currentFlagID = normalizeInteger(notificationItem.flagID, 0);
    const previousFlagID = normalizeInteger(previousState.flagID, 0);
    const touchesDockedHangar =
      dockedLocationID > 0 &&
      (
        (currentLocationID === dockedLocationID && currentFlagID === ITEM_FLAGS.HANGAR) ||
        (previousLocationID === dockedLocationID && previousFlagID === ITEM_FLAGS.HANGAR)
      );
    syncInventoryItemForSession(
      liveSession,
      notificationItem,
      previousState,
      {
        emitCfgLocation: touchesDockedHangar,
      },
    );
  }
}

function evaluateMissionProgress(characterID, missionRecord) {
  const nextRecord = cloneValue(missionRecord);
  if (!nextRecord) {
    return null;
  }

  if (normalizeBoolean(nextRecord.gmCompleted, false)) {
    if (nextRecord.cargo && typeof nextRecord.cargo === "object") {
      nextRecord.cargo = {
        ...nextRecord.cargo,
        hasCargo: true,
        granted: nextRecord.cargo.granted === true,
      };
    }
    nextRecord.objectiveCompleted = true;
    return nextRecord;
  }

  if (nextRecord.objectiveMode === OBJECTIVE_TYPE_TRANSPORT) {
    const progress = getCourierProgress(characterID, nextRecord);
    const requiredQuantity = Math.max(1, normalizeInteger(nextRecord.cargo && nextRecord.cargo.quantity, 1));
    const currentDockedLocationID = normalizePositiveInteger(
      getDockedLocationID(getPreferredCharacterSession(characterID)),
      0,
    );
    const dropoffLocationID = normalizePositiveInteger(
      nextRecord &&
        nextRecord.dropoffLocation &&
        nextRecord.dropoffLocation.locationID,
      0,
    );
    const dockedAtDropoff =
      currentDockedLocationID > 0 &&
      currentDockedLocationID === dropoffLocationID;
    const hasCargo =
      progress.shipCargoQuantity >= requiredQuantity ||
      progress.destinationHangarQuantity >= requiredQuantity;
    nextRecord.cargo = {
      ...(nextRecord.cargo || resolvePlaceholderCargo()),
      hasCargo,
      granted: nextRecord.cargo && nextRecord.cargo.granted === true,
    };
    nextRecord.objectiveCompleted =
      progress.destinationHangarQuantity >= requiredQuantity ||
      (dockedAtDropoff && progress.shipCargoQuantity >= requiredQuantity);
    return nextRecord;
  }

  if (isFetchMissionRecord(nextRecord)) {
    const itemSpec = nextRecord.cargo || resolvePlaceholderCargo();
    const progress = buildMissionItemProgressSnapshot(characterID, nextRecord, itemSpec, {
      destinationLocationID: normalizePositiveInteger(
        nextRecord &&
          nextRecord.dropoffLocation &&
          nextRecord.dropoffLocation.locationID,
        0,
      ),
      currentStationID: normalizePositiveInteger(
        nextRecord &&
          nextRecord.dropoffLocation &&
          nextRecord.dropoffLocation.locationID,
        0,
      ),
    });
    const requiredQuantity = Math.max(1, normalizeInteger(itemSpec && itemSpec.quantity, 1));
    const currentDockedLocationID = normalizePositiveInteger(
      getDockedLocationID(getPreferredCharacterSession(characterID)),
      0,
    );
    const dropoffLocationID = normalizePositiveInteger(
      nextRecord &&
        nextRecord.dropoffLocation &&
        nextRecord.dropoffLocation.locationID,
      0,
    );
    const dockedAtDropoff =
      currentDockedLocationID > 0 &&
      currentDockedLocationID === dropoffLocationID;
    nextRecord.cargo = {
      ...itemSpec,
      hasCargo:
        progress.shipCargoQuantity >= requiredQuantity ||
        progress.destinationHangarQuantity >= requiredQuantity,
      granted: false,
    };
    nextRecord.objectiveCompleted =
      progress.destinationHangarQuantity >= requiredQuantity ||
      (dockedAtDropoff && progress.shipCargoQuantity >= requiredQuantity);
    return nextRecord;
  }

  if (isAgentObjectiveMissionRecord(nextRecord)) {
    return nextRecord;
  }

  const instance = normalizePositiveInteger(nextRecord.dungeonInstanceID, 0)
    ? dungeonRuntime.getInstance(nextRecord.dungeonInstanceID)
    : null;
  const objectiveState =
    instance && instance.objectiveState && typeof instance.objectiveState === "object"
      ? instance.objectiveState
      : {};
  nextRecord.objectiveCompleted = (
    normalizeText(objectiveState.state, "").toLowerCase() === "completed" ||
    normalizePositiveInteger(objectiveState.completedAtMs, 0) > 0 ||
    normalizeText(instance && instance.lifecycleState, "").toLowerCase() === "completed"
  );
  return nextRecord;
}

function syncMissionRecordState(characterID, agentID) {
  const missionRecord = getMissionRecord(characterID, agentID);
  if (!missionRecord) {
    return null;
  }
  const updatedMissionRecord = evaluateMissionProgress(characterID, missionRecord);
  if (!updatedMissionRecord) {
    return null;
  }
  const changed =
    JSON.stringify({
      objectiveCompleted: missionRecord.objectiveCompleted,
      cargo: missionRecord.cargo || null,
    }) !== JSON.stringify({
      objectiveCompleted: updatedMissionRecord.objectiveCompleted,
      cargo: updatedMissionRecord.cargo || null,
    });
  if (!changed) {
    return updatedMissionRecord;
  }
  const completionChanged =
    normalizeBoolean(missionRecord && missionRecord.objectiveCompleted, false) !==
    normalizeBoolean(updatedMissionRecord && updatedMissionRecord.objectiveCompleted, false);
  mutateCharacterState(characterID, (characterState) => {
    const storedMission = characterState.missionsByAgentID[String(agentID)];
    if (!storedMission) {
      return null;
    }
    storedMission.objectiveCompleted = updatedMissionRecord.objectiveCompleted;
    storedMission.cargo = cloneValue(updatedMissionRecord.cargo || null);
    storedMission.lastUpdatedAtMs = Date.now();
    return cloneValue(storedMission);
  });
  notifyMissionTrackerUpdate(characterID, agentID);
  if (completionChanged) {
    notifyMissionChange(characterID, AGENT_MISSION_MODIFIED, agentID);
  }
  return getMissionRecord(characterID, agentID) || updatedMissionRecord;
}

function buildMissionTrackerInfoTuple(characterID, missionRecord, options = {}) {
  const sequence = buildMissionObjectiveSequence(characterID, missionRecord, options);
  return sequence.length > 0 ? sequence[sequence.length - 1] : null;
}

function getTupleItems(tupleValue) {
  if (tupleValue && tupleValue.type === "tuple" && Array.isArray(tupleValue.items)) {
    return tupleValue.items;
  }
  return Array.isArray(tupleValue) ? tupleValue : [];
}

function getTupleKey(tupleValue) {
  return normalizeText(getTupleItems(tupleValue)[0], "");
}

function buildMissionItemProgressSnapshot(characterID, missionRecord, itemSpec, options = {}) {
  if (!itemSpec || normalizePositiveInteger(itemSpec.typeID, 0) <= 0) {
    return {
      sourceHangarQuantity: 0,
      destinationHangarQuantity: 0,
      currentStationHangarQuantity: 0,
      shipCargoQuantity: 0,
      totalQuantity: 0,
    };
  }

  const sourceLocationID = normalizePositiveInteger(options.sourceLocationID, 0);
  const destinationLocationID = normalizePositiveInteger(options.destinationLocationID, 0);
  const currentStationID = normalizePositiveInteger(options.currentStationID, 0);
  const typeID = normalizePositiveInteger(itemSpec.typeID, 0);
  const activeShip = getActiveShipItem(characterID);

  const countHangarStacks = (locationID) => (
    locationID > 0
      ? sumItemStackQuantity(
          listCharacterCargoStacks(
            characterID,
            locationID,
            ITEM_FLAGS.HANGAR,
            typeID,
          ),
        )
      : 0
  );

  const sourceHangarQuantity = countHangarStacks(sourceLocationID);
  const destinationHangarQuantity = countHangarStacks(destinationLocationID);
  const currentStationHangarQuantity = countHangarStacks(currentStationID);
  const shipCargoQuantity =
    activeShip && normalizePositiveInteger(activeShip.itemID, 0) > 0
      ? sumItemStackQuantity(
          listCharacterCargoStacks(
            characterID,
            activeShip.itemID,
            ITEM_FLAGS.CARGO_HOLD,
            typeID,
          ),
        )
      : 0;
  const uniqueHangarLocations = [...new Set(
    [sourceLocationID, destinationLocationID, currentStationID].filter(Boolean),
  )];
  const totalQuantity = shipCargoQuantity + uniqueHangarLocations.reduce(
    (sum, locationID) => sum + countHangarStacks(locationID),
    0,
  );

  return {
    sourceHangarQuantity,
    destinationHangarQuantity,
    currentStationHangarQuantity,
    shipCargoQuantity,
    totalQuantity,
  };
}

function buildMissionFetchTuple(tupleKey, itemSpec) {
  const normalizedTypeID = normalizePositiveInteger(itemSpec && itemSpec.typeID, 0);
  if (!normalizedTypeID) {
    return null;
  }
  const quantity = Math.max(1, normalizeInteger(itemSpec && itemSpec.quantity, 1));
  return buildMarshalTuple([
    tupleKey,
    normalizedTypeID,
    quantity > 1 ? quantity : null,
  ]);
}

function buildMissionDeliveryTuple(missionRecord, itemSpec, itemProgress, options = {}) {
  const normalizedTypeID = normalizePositiveInteger(itemSpec && itemSpec.typeID, 0);
  if (!normalizedTypeID) {
    return null;
  }
  const requiredQuantity = Math.max(1, normalizeInteger(itemSpec && itemSpec.quantity, 1));
  const destinationLocationID = normalizePositiveInteger(
    options.destinationLocationID,
    0,
  );
  const atDestination =
    destinationLocationID > 0 &&
    normalizePositiveInteger(options.currentLocationID, 0) === destinationLocationID &&
    normalizePositiveInteger(options.currentStationID, 0) === destinationLocationID;

  if (itemProgress.destinationHangarQuantity >= requiredQuantity) {
    return buildMarshalTuple(["MissionTransport", normalizedTypeID]);
  }
  if (itemProgress.shipCargoQuantity >= requiredQuantity && atDestination) {
    return buildMarshalTuple(["MissionTransport", normalizedTypeID]);
  }
  if (itemProgress.shipCargoQuantity >= requiredQuantity || itemProgress.totalQuantity >= requiredQuantity) {
    return buildMarshalTuple([
      "TransportItemsPresent",
      normalizedTypeID,
      destinationLocationID || null,
      requiredQuantity,
    ]);
  }
  if (itemProgress.sourceHangarQuantity >= requiredQuantity) {
    return buildMarshalTuple(["TransportItemsMissing", normalizedTypeID, requiredQuantity]);
  }
  return buildMarshalTuple(["DropOffItemsMissing", normalizedTypeID, requiredQuantity]);
}

function dedupeObjectiveTuples(tuples = []) {
  const result = [];
  let previousFingerprint = "";
  for (const tupleValue of tuples) {
    const items = getTupleItems(tupleValue);
    if (items.length <= 0) {
      continue;
    }
    const fingerprint = JSON.stringify(items);
    if (fingerprint === previousFingerprint) {
      continue;
    }
    previousFingerprint = fingerprint;
    result.push(tupleValue);
  }
  return result;
}

function isMiningMissionRecord(missionRecord) {
  return normalizeText(missionRecord && missionRecord.missionKind, "") === "mining";
}

function isMiningObjectiveRecord(missionRecord, objectiveRecord = null) {
  const key = normalizeText(objectiveRecord && objectiveRecord.key, "").toLowerCase();
  return (
    isMiningMissionRecord(missionRecord) ||
    key.includes("mine") ||
    key.includes("ore") ||
    [16, 25, 28].includes(
      normalizePositiveInteger(objectiveRecord && objectiveRecord.objectiveType, 0),
    )
  );
}

function buildAuthoredObjectiveEntry(characterID, agentRecord, missionRecord, objectiveRecord, objectiveContext, options = {}) {
  const objectiveType = normalizePositiveInteger(objectiveRecord && objectiveRecord.objectiveType, 0);
  const key = normalizeText(objectiveRecord && objectiveRecord.key, "").toLowerCase();
  const currentLocationID = normalizePositiveInteger(options.currentLocationID, 0);
  const currentStationID = normalizePositiveInteger(options.currentStationID, 0);
  const inActiveDungeon = options.inActiveDungeon === true;
  const objectiveCompleted = normalizeBoolean(
    missionRecord && missionRecord.objectiveCompleted,
    false,
  );

  const resolveItemProgress = (parameterKey, fallbackLocationID = 0) => {
    const itemSpec = buildMissionItemSpec(resolveObjectiveParameterValue(
      objectiveRecord,
      objectiveContext,
      parameterKey,
    ));
    if (!itemSpec) {
      return { itemSpec: null, progress: null };
    }
    const sourceLocationID =
      parameterKey === "items"
        ? normalizePositiveInteger(
            objectiveContext.pick_up_location || fallbackLocationID,
            0,
          )
        : normalizePositiveInteger(fallbackLocationID, 0);
    const destinationLocationID = normalizePositiveInteger(
      resolveObjectiveParameterValue(
        objectiveRecord,
        objectiveContext,
        "destination_location_id",
      ) || objectiveContext.complete_mission_location_id,
      0,
    );
    return {
      itemSpec,
      progress: buildMissionItemProgressSnapshot(characterID, missionRecord, itemSpec, {
        sourceLocationID,
        destinationLocationID,
        currentStationID,
      }),
      destinationLocationID,
    };
  };

  switch (objectiveType) {
    case 1: {
      const {
        itemSpec,
        progress,
        destinationLocationID,
      } = resolveItemProgress("items");
      if (!itemSpec || !progress) {
        return null;
      }
      return {
        tuple: buildMissionDeliveryTuple(missionRecord, itemSpec, progress, {
          currentLocationID,
          currentStationID,
          destinationLocationID,
        }),
        completed:
          progress.destinationHangarQuantity >= itemSpec.quantity ||
          objectiveCompleted,
      };
    }
    case 2:
      return {
        tuple: buildMarshalTuple([
          "AllObjectivesComplete",
          normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
        ]),
        completed: objectiveCompleted,
      };
    case 5:
      return {
        tuple: buildMarshalTuple(["KillAllTrigger"]),
        completed: objectiveCompleted,
      };
    case 7:
    case 15: {
      const locationID = normalizePositiveInteger(
        resolveObjectiveParameterValue(
          objectiveRecord,
          objectiveContext,
          "location_id",
        ) || objectiveContext.dungeon_location_id,
        0,
      );
      if (!locationID) {
        return null;
      }
      return {
        tuple: buildMarshalTuple(["TravelTo", locationID]),
        completed:
          inActiveDungeon ||
          currentLocationID === locationID ||
          currentStationID === locationID ||
          objectiveCompleted,
      };
    }
    case 9:
      return {
        tuple: buildMarshalTuple(["DestroyAll"]),
        completed: objectiveCompleted,
      };
    case 10:
      return {
        tuple: buildMarshalTuple([
          "GoToGate",
          normalizePositiveInteger(missionRecord && missionRecord.missionSiteID, 0) ||
            normalizePositiveInteger(missionRecord && missionRecord.dungeonID, 0) ||
            normalizePositiveInteger(missionRecord && missionRecord.missionSequence, 0),
        ]),
        completed: objectiveCompleted,
      };
    case 11: {
      const { itemSpec, progress } = resolveItemProgress("items");
      const container = normalizeObject(resolveObjectiveParameterValue(
        objectiveRecord,
        objectiveContext,
        "loot_container",
      ));
      const containerID = normalizePositiveInteger(container.item_id, 0) ||
        normalizePositiveInteger(missionRecord && missionRecord.missionSiteID, 0);
      if (!itemSpec || !containerID) {
        return null;
      }
      return {
        tuple: buildMarshalTuple([
          "MissionFetchContainer",
          itemSpec.typeID,
          containerID,
        ]),
        completed:
          (progress && progress.totalQuantity >= itemSpec.quantity) ||
          objectiveCompleted,
      };
    }
    case 12: {
      const container = normalizeObject(resolveObjectiveParameterValue(
        objectiveRecord,
        objectiveContext,
        "salvage_wreck",
      ));
      const typeID = normalizePositiveInteger(container.type_id, 0);
      const itemID = normalizePositiveInteger(container.item_id, 0) ||
        normalizePositiveInteger(missionRecord && missionRecord.missionSiteID, 0);
      if (!typeID || !itemID) {
        return null;
      }
      return {
        tuple: buildMarshalTuple(["Salvage", typeID, itemID]),
        completed: objectiveCompleted,
      };
    }
    case 13: {
      const container = normalizeObject(resolveObjectiveParameterValue(
        objectiveRecord,
        objectiveContext,
        "container",
      ));
      const typeID = normalizePositiveInteger(container.type_id, 0);
      const itemID = normalizePositiveInteger(container.item_id, 0) ||
        normalizePositiveInteger(missionRecord && missionRecord.missionSiteID, 0);
      if (!typeID || !itemID) {
        return null;
      }
      const { itemSpec, progress } = resolveItemProgress("items");
      return {
        tuple: buildMarshalTuple(["Hack", typeID, itemID]),
        completed:
          (itemSpec && progress && progress.totalQuantity >= itemSpec.quantity) ||
          objectiveCompleted,
      };
    }
    case 16:
    case 25: {
      const { itemSpec, progress } = resolveItemProgress("items");
      if (!itemSpec || !progress) {
        return null;
      }
      return {
        tuple: buildMissionFetchTuple("MissionFetchMine", itemSpec),
        completed:
          progress.totalQuantity >= itemSpec.quantity ||
          objectiveCompleted,
      };
    }
    case 17: {
      const { itemSpec, progress } = resolveItemProgress("items");
      if (!itemSpec || !progress) {
        return null;
      }
      return {
        tuple: buildMissionFetchTuple("MissionFetch", itemSpec),
        completed:
          progress.destinationHangarQuantity >= itemSpec.quantity ||
          objectiveCompleted,
      };
    }
    case 21:
    case 26: {
      const { itemSpec, progress } = resolveItemProgress(
        "items",
        objectiveContext.pick_up_location || objectiveContext.agent_location_id,
      );
      if (!itemSpec || !progress) {
        return null;
      }
      return {
        tuple: buildMissionFetchTuple(
          isMiningObjectiveRecord(missionRecord, objectiveRecord)
            ? "MissionFetchMine"
            : "MissionFetch",
          itemSpec,
        ),
        completed: progress.totalQuantity >= itemSpec.quantity,
      };
    }
    case 22: {
      const target = normalizeObject(resolveObjectiveParameterValue(
        objectiveRecord,
        objectiveContext,
        "target",
      ));
      const typeID = normalizePositiveInteger(target.type_id, 0);
      const itemID = normalizePositiveInteger(target.item_id, 0);
      if (!typeID || !itemID) {
        return null;
      }
      return {
        tuple: buildMarshalTuple(["Approach", typeID, itemID]),
        completed: objectiveCompleted,
      };
    }
    default:
      if (key === "complete_mission") {
        return {
          tuple: buildMarshalTuple([
            "AllObjectivesComplete",
            normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
          ]),
          completed: objectiveCompleted,
        };
      }
      return null;
  }
}

function getAuthoredObjectiveSortWeight(objectiveRecord = null) {
  const objectiveType = normalizePositiveInteger(objectiveRecord && objectiveRecord.objectiveType, 0);
  const key = normalizeText(objectiveRecord && objectiveRecord.key, "").toLowerCase();
  const groups = normalizeArray(objectiveRecord && objectiveRecord.groups)
    .map((entry) => normalizeText(entry, "").toLowerCase())
    .filter(Boolean);
  const inGroup = (group) => groups.includes(group);

  if (objectiveType === 2 || key === "complete_mission") {
    return 100;
  }
  if (objectiveType === 1 || key.includes("deliver") || inGroup("post_dungeon") || inGroup("delivering_items")) {
    return 80;
  }
  if (objectiveType === 17 || key.includes("reprocess")) {
    return 70;
  }
  if ([11, 12, 13, 16, 25].includes(objectiveType) || inGroup("in_dungeon")) {
    return 60;
  }
  if ([5, 9, 10, 22, 23].includes(objectiveType) || key.includes("destroy") || key.includes("hack")) {
    return 50;
  }
  if ([21, 26].includes(objectiveType) || key.includes("pick_up") || key.includes("pickup") || key.includes("acquire")) {
    return 30;
  }
  if ([7, 14, 15, 31].includes(objectiveType) || key.includes("enter_dungeon") || key.includes("travel")) {
    return 20;
  }
  if ([6, 8, 27, 28, 29, 30].includes(objectiveType) || inGroup("prerequisite") || inGroup("fit_objective") || inGroup("fit")) {
    return 10;
  }
  return 40;
}

function buildAuthoredMissionObjectiveSequence(characterID, agentRecord, missionRecord, options = {}) {
  const objectiveChainRecord = getMissionObjectiveChainRecord(missionRecord);
  if (!objectiveChainRecord) {
    return [];
  }

  const objectiveContext = buildMissionObjectiveContext(
    agentRecord,
    missionRecord,
    objectiveChainRecord,
  );
  const visibleTuples = [];
  let foundCurrent = false;

  const sortedObjectives = normalizeArray(objectiveChainRecord.objectives)
    .map((objectiveRecord, index) => ({
      objectiveRecord,
      index,
      weight: getAuthoredObjectiveSortWeight(objectiveRecord),
      renderingOrder: normalizeInteger(objectiveRecord && objectiveRecord.renderingOrder, 0),
    }))
    .sort((left, right) => (
      left.weight - right.weight ||
      left.renderingOrder - right.renderingOrder ||
      left.index - right.index
    ))
    .map((entry) => entry.objectiveRecord);

  for (const objectiveRecord of sortedObjectives) {
    const entry = buildAuthoredObjectiveEntry(
      characterID,
      agentRecord,
      missionRecord,
      objectiveRecord,
      objectiveContext,
      options,
    );
    if (!entry || !entry.tuple) {
      continue;
    }
    visibleTuples.push(entry.tuple);
    if (!entry.completed) {
      foundCurrent = true;
      break;
    }
  }

  if (!visibleTuples.length) {
    return [];
  }

  if (!foundCurrent && normalizeBoolean(missionRecord && missionRecord.objectiveCompleted, false)) {
    const completionTuple = buildMarshalTuple([
      "AllObjectivesComplete",
      normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
    ]);
    visibleTuples.push(completionTuple);
  }

  return dedupeObjectiveTuples(visibleTuples);
}

function buildTransportObjectiveTuples(missionRecord) {
  const cargo = missionRecord && missionRecord.cargo ? missionRecord.cargo : resolvePlaceholderCargo();
  const typeID = normalizePositiveInteger(cargo && cargo.typeID, PLACEHOLDER_CARGO_TYPE_ID);
  const quantity = Math.max(1, normalizeInteger(cargo && cargo.quantity, PLACEHOLDER_CARGO_QUANTITY));
  const destinationLocationID = normalizePositiveInteger(
    missionRecord && missionRecord.dropoffLocation && missionRecord.dropoffLocation.locationID,
    0,
  );
  return {
    missing: buildMarshalTuple(["TransportItemsMissing", typeID, quantity]),
    present: buildMarshalTuple(["TransportItemsPresent", typeID, destinationLocationID || null, quantity]),
    transport: buildMarshalTuple(["MissionTransport", typeID]),
    complete: buildMarshalTuple([
      "AllObjectivesComplete",
      normalizePositiveInteger(missionRecord && missionRecord.agentID, 0),
    ]),
  };
}

function buildFetchObjectiveTuples(missionRecord) {
  const itemSpec = resolvePrimaryMissionItemSpec(missionRecord) || {
    typeID: PLACEHOLDER_CARGO_TYPE_ID,
    quantity: PLACEHOLDER_CARGO_QUANTITY,
  };
  return {
    fetch: buildMissionFetchTuple("MissionFetch", itemSpec),
    complete: buildMarshalTuple([
      "AllObjectivesComplete",
      normalizePositiveInteger(missionRecord && missionRecord.agentID, 0),
    ]),
  };
}

function buildMiningObjectiveTuples(missionRecord) {
  const itemSpec = resolvePrimaryMissionItemSpec(missionRecord) || {
    typeID: PLACEHOLDER_CARGO_TYPE_ID,
    quantity: PLACEHOLDER_CARGO_QUANTITY,
  };
  return {
    travel: buildMarshalTuple([
      "TravelTo",
      normalizePositiveInteger(missionRecord && missionRecord.missionSystemID, 0),
    ]),
    mine: buildMissionFetchTuple("MissionFetchMine", itemSpec),
    complete: buildMarshalTuple([
      "AllObjectivesComplete",
      normalizePositiveInteger(missionRecord && missionRecord.agentID, 0),
    ]),
  };
}

function buildEncounterObjectiveTuples(missionRecord) {
  return {
    travel: buildMarshalTuple([
      "TravelTo",
      normalizePositiveInteger(missionRecord && missionRecord.missionSystemID, 0),
    ]),
    kill: buildMarshalTuple(["KillAllTrigger"]),
    complete: buildMarshalTuple([
      "AllObjectivesComplete",
      normalizePositiveInteger(missionRecord && missionRecord.agentID, 0),
    ]),
  };
}

function buildMissionObjectiveSequence(characterID, missionRecord, options = {}) {
  const currentRecord = evaluateMissionProgress(characterID, missionRecord);
  const agentRecord = getAgentRecord(currentRecord && currentRecord.agentID);
  if (!currentRecord || !agentRecord) {
    return [];
  }

  const authoredSequence = buildAuthoredMissionObjectiveSequence(
    characterID,
    agentRecord,
    currentRecord,
    options,
  );
  if (authoredSequence.length > 0) {
    return authoredSequence;
  }

  if (currentRecord.objectiveMode === OBJECTIVE_TYPE_TRANSPORT) {
    const currentObjective = (() => {
      if (currentRecord.objectiveCompleted === true) {
        return buildMarshalTuple([
          "AllObjectivesComplete",
          normalizePositiveInteger(currentRecord && currentRecord.agentID, 0),
        ]);
      }
      const cargo = currentRecord.cargo || resolvePlaceholderCargo();
      const progress = getCourierProgress(characterID, currentRecord);
      const requiredQuantity = Math.max(1, normalizeInteger(cargo.quantity, 1));
      const destinationLocationID = normalizePositiveInteger(
        currentRecord.dropoffLocation && currentRecord.dropoffLocation.locationID,
        0,
      );
      if (progress.shipCargoQuantity >= requiredQuantity) {
        if (
          normalizePositiveInteger(options.currentLocationID, 0) === destinationLocationID &&
          normalizePositiveInteger(options.currentStationID, 0) === destinationLocationID
        ) {
          return buildMarshalTuple(["MissionTransport", cargo.typeID]);
        }
        return buildMarshalTuple([
          "TransportItemsPresent",
          cargo.typeID,
          destinationLocationID,
          requiredQuantity,
        ]);
      }
      if (progress.sourceHangarQuantity >= requiredQuantity) {
        return buildMarshalTuple(["TransportItemsMissing", cargo.typeID, requiredQuantity]);
      }
      return buildMarshalTuple(["DropOffItemsMissing", cargo.typeID, requiredQuantity]);
    })();
    const currentKey = getTupleKey(currentObjective);
    const tuples = buildTransportObjectiveTuples(missionRecord);
    switch (currentKey) {
      case "TransportItemsMissing":
        return [tuples.missing];
      case "TransportItemsPresent":
        return [tuples.missing, tuples.present];
      case "MissionTransport":
        return [tuples.missing, tuples.present, tuples.transport];
      case "AllObjectivesComplete":
        return [tuples.missing, tuples.present, tuples.transport, tuples.complete];
      default:
        return [currentObjective];
    }
  }

  if (isFetchMissionRecord(currentRecord)) {
    const itemSpec = resolvePrimaryMissionItemSpec(currentRecord) || resolvePlaceholderCargo();
    const progress = buildMissionItemProgressSnapshot(characterID, currentRecord, itemSpec, {
      destinationLocationID: normalizePositiveInteger(
        currentRecord &&
          currentRecord.dropoffLocation &&
          currentRecord.dropoffLocation.locationID,
        0,
      ),
      currentStationID: normalizePositiveInteger(options.currentStationID, 0),
    });
    const fetchTuple = buildMissionFetchTuple("MissionFetch", itemSpec);
    const deliveryTuple = buildMissionDeliveryTuple(currentRecord, itemSpec, progress, {
      currentLocationID: normalizePositiveInteger(options.currentLocationID, 0),
      currentStationID: normalizePositiveInteger(options.currentStationID, 0),
      destinationLocationID: normalizePositiveInteger(
        currentRecord &&
          currentRecord.dropoffLocation &&
          currentRecord.dropoffLocation.locationID,
        0,
      ),
    });
    const tuples = buildFetchObjectiveTuples(currentRecord);
    if (currentRecord.objectiveCompleted === true) {
      return dedupeObjectiveTuples([fetchTuple, deliveryTuple, tuples.complete].filter(Boolean));
    }
    if (progress.totalQuantity >= Math.max(1, normalizeInteger(itemSpec && itemSpec.quantity, 1))) {
      return dedupeObjectiveTuples([fetchTuple, deliveryTuple].filter(Boolean));
    }
    return dedupeObjectiveTuples([fetchTuple].filter(Boolean));
  }

  if (isAgentObjectiveMissionRecord(currentRecord)) {
    const targetLocation = buildMissionConversationTargetLocationWrap(currentRecord, agentRecord);
    const targetSystemID = normalizePositiveInteger(
      targetLocation && targetLocation.solarsystemID,
      normalizePositiveInteger(currentRecord && currentRecord.missionSystemID, 0),
    );
    if (currentRecord.objectiveCompleted === true) {
      return [buildMarshalTuple([
        "AllObjectivesComplete",
        normalizePositiveInteger(currentRecord && currentRecord.agentID, 0),
      ])];
    }
    if (targetSystemID > 0) {
      return [buildMarshalTuple(["TravelTo", targetSystemID])];
    }
    return [];
  }

  if (isMiningMissionRecord(currentRecord)) {
    const tuples = buildMiningObjectiveTuples(currentRecord);
    if (currentRecord.objectiveCompleted === true) {
      return dedupeObjectiveTuples([tuples.travel, tuples.mine, tuples.complete].filter(Boolean));
    }
    if (options.inActiveDungeon === true) {
      return dedupeObjectiveTuples([tuples.travel, tuples.mine].filter(Boolean));
    }
    return dedupeObjectiveTuples([tuples.travel].filter(Boolean));
  }

  const currentObjective = currentRecord.objectiveCompleted === true
    ? buildMarshalTuple([
        "AllObjectivesComplete",
        normalizePositiveInteger(currentRecord && currentRecord.agentID, 0),
      ])
    : options.inActiveDungeon === true
    ? buildMarshalTuple(["KillAllTrigger"])
    : buildMarshalTuple([
        "TravelTo",
        normalizePositiveInteger(currentRecord.missionSystemID, 0),
      ]);
  const currentKey = getTupleKey(currentObjective);
  const tuples = buildEncounterObjectiveTuples(currentRecord);
  switch (currentKey) {
    case "TravelTo":
      return [tuples.travel];
    case "KillAllTrigger":
      return [tuples.travel, tuples.kill];
    case "AllObjectivesComplete":
      return [tuples.travel, tuples.kill, tuples.complete];
    default:
      return [currentObjective];
  }
}

function isSessionInActiveMissionDungeon(session, missionRecord) {
  if (!session || !missionRecord) {
    return false;
  }
  const missionSystemID = normalizePositiveInteger(missionRecord.missionSystemID, 0);
  const missionPosition =
    missionRecord.missionPosition && typeof missionRecord.missionPosition === "object"
      ? clonePosition(missionRecord.missionPosition)
      : null;
  if (!missionSystemID || !missionPosition) {
    return false;
  }
  const spaceRuntime = getSpaceRuntime();
  const scene =
    spaceRuntime && typeof spaceRuntime.getSceneForSession === "function"
      ? spaceRuntime.getSceneForSession(session)
      : null;
  const shipEntity =
    scene && typeof scene.getShipEntityForSession === "function"
      ? scene.getShipEntityForSession(session)
      : null;
  if (!shipEntity || !shipEntity.position) {
    return false;
  }
  const currentSystemID = normalizePositiveInteger(scene && scene.systemID, 0);
  if (currentSystemID !== missionSystemID) {
    return false;
  }
  return vectorMagnitude(subtractVectors(shipEntity.position, missionPosition)) <=
    MISSION_IN_DUNGEON_DISTANCE_METERS;
}

function getMissionRecordForRead(characterID, agentID) {
  const missionRecord = getMissionRecord(characterID, agentID);
  if (!missionRecord) {
    return null;
  }
  if (normalizeText(missionRecord.runtimeStatus, "offered") === "accepted") {
    return syncMissionRecordState(characterID, agentID) || missionRecord;
  }
  return missionRecord;
}

function getMissionInfoItems(characterID, agentID, options = {}) {
  const missionRecord = getMissionRecordForRead(characterID, agentID);
  if (!missionRecord || normalizeText(missionRecord.runtimeStatus, "offered") !== "accepted") {
    return null;
  }
  return buildMissionTrackerInfoTuple(characterID, missionRecord, {
    currentLocationID: normalizePositiveInteger(options.currentLocationID, 0),
    currentStationID: normalizePositiveInteger(options.currentStationID, 0),
    inActiveDungeon: options.inActiveDungeon === true,
  });
}

function getAllMissionObjectives(characterID, agentID, options = {}) {
  const missionRecord = getMissionRecordForRead(characterID, agentID);
  if (!missionRecord || normalizeText(missionRecord.runtimeStatus, "offered") !== "accepted") {
    return [];
  }
  return buildMissionObjectiveSequence(characterID, missionRecord, {
    currentLocationID: normalizePositiveInteger(options.currentLocationID, 0),
    currentStationID: normalizePositiveInteger(options.currentStationID, 0),
    inActiveDungeon: options.inActiveDungeon === true,
  });
}

function buildPlaceholderBriefing(agentRecord, missionRecord, missionTemplate) {
  const missionTitle = normalizeText(
    missionRecord && missionRecord.missionTitle,
    normalizeText(missionTemplate && missionTemplate.title, "Placeholder Mission"),
  );
  const advisory = missionTemplate && typeof missionTemplate.advisory === "object"
    ? missionTemplate.advisory
    : {};
  const rawRooms = Array.isArray(missionTemplate && missionTemplate.rooms)
    ? missionTemplate.rooms
    : [];
  const gateHints = [
    ...new Set([
      ...((missionTemplate &&
        missionTemplate.siteSceneProfile &&
        Array.isArray(missionTemplate.siteSceneProfile.gateProfiles)
          ? missionTemplate.siteSceneProfile.gateProfiles
          : [])
        .map((gateProfile) => normalizeText(gateProfile && gateProfile.label, ""))
        .filter(Boolean)),
      ...rawRooms
        .map((room) => normalizeText(room && room.gateHint, ""))
        .filter(Boolean),
    ]),
  ].slice(0, 3);
  const objectiveHints = [
    ...new Set(
      (Array.isArray(missionTemplate && missionTemplate.objectiveHints)
        ? missionTemplate.objectiveHints
        : [])
        .map((entry) => normalizeText(entry, ""))
        .filter(Boolean),
    ),
  ].slice(0, 3);
  const triggerHints = [
    ...new Set(
      (Array.isArray(missionTemplate && missionTemplate.triggerHints)
        ? missionTemplate.triggerHints
        : [])
        .map((entry) => normalizeText(entry, ""))
        .filter(Boolean),
    ),
  ].slice(0, 3);
  const transportHints = [
    ...new Set(
      (Array.isArray(missionTemplate && missionTemplate.transportHints)
        ? missionTemplate.transportHints
        : [])
        .map((entry) => normalizeText(entry, ""))
        .filter(Boolean),
    ),
  ].slice(0, 3);
  const roomNotes = rawRooms
    .slice(0, 3)
    .map((room) => {
      const label = normalizeText(room && room.title, "");
      const note = normalizeText(
        Array.isArray(room && room.notes) ? room.notes[0] : "",
        "",
      );
      if (!label || !note) {
        return "";
      }
      return `${label}: ${note}`;
    })
    .filter(Boolean);
  const advisoryLines = [
    normalizeText(missionTemplate && missionTemplate.faction, "")
      ? `Faction: ${normalizeText(missionTemplate && missionTemplate.faction, "")}`
      : "",
    normalizeText(
      missionTemplate &&
        missionTemplate.spaceType &&
        missionTemplate.spaceType.raw,
      "",
    )
      ? `Space: ${normalizeText(missionTemplate.spaceType.raw, "")}`
      : "",
    normalizeText(advisory.damageDealt, "")
      ? `Damage dealt: ${normalizeText(advisory.damageDealt, "")}`
      : "",
    normalizeText(advisory.recommendedDamage, "")
      ? `Recommended damage: ${normalizeText(advisory.recommendedDamage, "")}`
      : "",
    normalizeText(advisory.webScramble, "")
      ? `EWAR: ${normalizeText(advisory.webScramble, "")}`
      : "",
    normalizeText(advisory.recommendedShips, "")
      ? `Recommended ships: ${normalizeText(advisory.recommendedShips, "")}`
      : "",
  ].filter(Boolean);
  const chainSummary = Array.isArray(missionTemplate && missionTemplate.missionParts) &&
    missionTemplate.missionParts.length > 1
    ? `Mission chain intelligence includes ${missionTemplate.missionParts.length} linked stages.`
    : "";
  const sections = [];

  const pushSection = (title, values) => {
    const lines = (Array.isArray(values) ? values : [])
      .map((entry) => normalizeText(entry, ""))
      .filter(Boolean);
    if (lines.length <= 0) {
      return;
    }
    sections.push(`<br><br><b>${escapeHtml(title)}</b>`);
    for (const line of lines) {
      sections.push(`<br>${escapeHtml(line)}`);
    }
  };

  pushSection("Operational Intel", [
    ...advisoryLines,
    normalizePositiveInteger(missionTemplate && missionTemplate.missionLevel, 0) > 0
      ? `Mission level: ${normalizePositiveInteger(missionTemplate.missionLevel, 0)}`
      : "",
    chainSummary,
  ]);
  pushSection(
    "Objective Intel",
    objectiveHints.length > 0
      ? objectiveHints
      : transportHints,
  );
  pushSection("Pocket Notes", roomNotes);
  pushSection("Acceleration Gates", gateHints);
  pushSection("Trigger Notes", triggerHints);

  if (sections.length > 0) {
    return [
      `<b>${escapeHtml(missionTitle)}</b>`,
      `<br><br>Review the following operational briefing before departure.`,
      ...sections,
    ].join("");
  }

  const missionType = isCourierMission(agentRecord, missionTemplate)
    ? "courier"
    : "encounter";
  return [
    `<b>${escapeHtml(missionTitle)}</b>`,
    `<br><br>Your ${escapeHtml(missionType)} assignment is ready for review.`,
    `<br>Agent: ${escapeHtml(normalizeText(agentRecord && agentRecord.ownerName, "Unknown Agent"))}`,
    `<br><br>${escapeHtml(MISSION_PLACEHOLDER_NOTE)}`,
  ].join("");
}

function buildMissionKeywords(agentRecord, missionRecord, missionTemplate) {
  return {
    agentName: normalizeText(agentRecord && agentRecord.ownerName, "Unknown Agent"),
    missionName: normalizeText(
      missionRecord && missionRecord.missionTitle,
      normalizeText(missionTemplate && missionTemplate.title, "Placeholder Mission"),
    ),
    missionTypeLabel: buildMissionTypeLabel(agentRecord),
    missionContentID: missionContentIDToText(missionRecord && missionRecord.contentID, ""),
  };
}

function resolveMissionEnemyOwnerID(...missionTemplates) {
  for (const missionTemplate of missionTemplates) {
    const factionID = normalizePositiveInteger(missionTemplate && missionTemplate.factionID, 0);
    if (factionID > 0) {
      return factionID;
    }
  }
  return null;
}

function hasMissionShipRestrictions(...missionTemplates) {
  return missionTemplates.some((missionTemplate) => {
    const gateProfiles = Array.isArray(
      missionTemplate &&
      missionTemplate.siteSceneProfile &&
      missionTemplate.siteSceneProfile.gateProfiles,
    )
      ? missionTemplate.siteSceneProfile.gateProfiles
      : [];
    return gateProfiles.some((gateProfile) => (
      normalizePositiveInteger(gateProfile && gateProfile.allowedShipsList, 0) > 0
    ));
  });
}

function resolveMissionTitleValue(missionRecord, missionTemplate) {
  const missionNameID = normalizePositiveInteger(
    missionRecord && missionRecord.missionNameID,
    0,
  );
  if (missionNameID > 0) {
    return missionNameID;
  }
  return normalizeText(
    missionRecord && missionRecord.missionTitle,
    normalizeText(missionTemplate && missionTemplate.title, "Placeholder Mission"),
  );
}

function resolveMissionBriefingValue(
  agentRecord,
  missionRecord,
  missionTemplate,
  clientMissionRecord,
  messageKeys,
) {
  const messageID = getFirstMissionMessageID(clientMissionRecord, messageKeys);
  if (messageID > 0) {
    return messageID;
  }
  const localizedText = getFirstMissionLocalizedMessageText(
    clientMissionRecord,
    messageKeys,
  );
  if (localizedText) {
    return localizedText;
  }
  return buildPlaceholderBriefing(
    agentRecord,
    missionRecord,
    missionTemplate,
  );
}

function buildEncounterObjectiveBriefingMessage(
  agentRecord,
  missionRecord,
  presentationTemplate,
  dungeonTemplate,
  clientMissionRecord,
) {
  const authoredBriefing = buildMissionProcessMessageReferenceByKeys(
    missionRecord,
    clientMissionRecord,
    [
      "messages.mission.briefing",
      "messages.mission.extrainfo.body",
      "messages.mission.accepted.agentsays",
      "messages.root.missioninprogress.agentsays",
    ],
  );
  if (authoredBriefing) {
    return authoredBriefing;
  }
  const localizedBriefing = getFirstMissionLocalizedMessageText(
    clientMissionRecord,
    [
      "messages.mission.briefing",
      "messages.mission.extrainfo.body",
      "messages.mission.accepted.agentsays",
      "messages.root.missioninprogress.agentsays",
    ],
  );
  if (localizedBriefing) {
    return localizedBriefing;
  }
  const derivedBriefing = buildPlaceholderBriefing(
    agentRecord,
    missionRecord,
    presentationTemplate || dungeonTemplate || null,
  );
  const hasDerivedIntel = !derivedBriefing.includes(MISSION_PLACEHOLDER_NOTE);
  if (hasDerivedIntel) {
    return derivedBriefing;
  }
  return normalizeBoolean(missionRecord && missionRecord.objectiveCompleted, false)
    ? MISSION_PLACEHOLDER_COMPLETE_NOTE
    : MISSION_PLACEHOLDER_NOTE;
}

function buildMissionRecord(
  state,
  characterState,
  agentRecord,
  missionTemplate,
  selectionCursor = 0,
  explicitClientMissionRecord = null,
  advanceSelectionCursor = true,
) {
  const agentID = normalizePositiveInteger(agentRecord && agentRecord.agentID, 0);
  const missionSequence = normalizePositiveInteger(state.nextMissionSequence, 1);
  const clientMissionRecord = explicitClientMissionRecord || pickMissionForAgent(agentRecord, selectionCursor);
  const fallbackMissionTemplateID = normalizeText(
    missionTemplate && missionTemplate.templateID,
    "",
  );
  const contentID = normalizeMissionContentID(
    clientMissionRecord && clientMissionRecord.missionID,
    fallbackMissionTemplateID,
  );
  const clientKillMission =
    clientMissionRecord &&
    clientMissionRecord.killMission &&
    typeof clientMissionRecord.killMission === "object" &&
    Object.keys(clientMissionRecord.killMission).length > 0
      ? clientMissionRecord.killMission
      : null;
  const clientCourierMission =
    clientMissionRecord &&
    clientMissionRecord.courierMission &&
    typeof clientMissionRecord.courierMission === "object" &&
    Object.keys(clientMissionRecord.courierMission).length > 0
      ? clientMissionRecord.courierMission
      : null;
  const runtimeDungeonTemplate =
    clientKillMission && normalizePositiveInteger(clientKillMission.dungeonID, 0) > 0
      ? getClientDungeonTemplate(clientKillMission.dungeonID)
      : null;
  const matchedMissionTemplate = resolveMissionTemplateForClientMission(
    agentRecord,
    clientMissionRecord,
    missionTemplate,
    runtimeDungeonTemplate,
  );
  const importantMission = normalizeBoolean(
    agentRecord && agentRecord.importantMission,
    false,
  );
  const clientMissionKind = normalizeText(
    clientMissionRecord && clientMissionRecord.missionKind,
    "",
  );
  const sourceStationID = normalizePositiveInteger(agentRecord && agentRecord.stationID, 0);
  const objectiveMode = clientMissionRecord
    ? (
      normalizeBoolean(clientMissionRecord && clientMissionRecord.isTalkToAgent, false) ||
      clientMissionKind === "talkToAgent" ||
      normalizeBoolean(clientMissionRecord && clientMissionRecord.isAgentInteraction, false) ||
      clientMissionKind === "agentInteraction"
        ? OBJECTIVE_TYPE_AGENT
        : clientMissionKind === "trade"
        ? OBJECTIVE_TYPE_FETCH
        : clientCourierMission
        ? OBJECTIVE_TYPE_TRANSPORT
        : OBJECTIVE_TYPE_DUNGEON
    )
    : (
      normalizeText(agentRecord && agentRecord.missionKind, "") === "trade"
        ? OBJECTIVE_TYPE_FETCH
        : isCourierMission(agentRecord, missionTemplate)
        ? OBJECTIVE_TYPE_TRANSPORT
        : OBJECTIVE_TYPE_DUNGEON
    );
  const dropoffStation = resolveDropoffStation(agentRecord);
  const fetchDropoffStationID = sourceStationID;
  const cargo =
    objectiveMode === OBJECTIVE_TYPE_TRANSPORT || objectiveMode === OBJECTIVE_TYPE_FETCH
    ? (() => {
        const typeID = normalizePositiveInteger(
          clientCourierMission && clientCourierMission.objectiveTypeID,
          PLACEHOLDER_CARGO_TYPE_ID,
        );
        const quantity = Math.max(
          1,
          normalizeInteger(
            clientCourierMission && clientCourierMission.objectiveQuantity,
            PLACEHOLDER_CARGO_QUANTITY,
          ),
        );
        const itemRecord = resolveItemByTypeID(typeID);
        return {
          typeID,
          quantity,
          volume: Number(itemRecord && itemRecord.volume) || 1,
          hasCargo: false,
          granted: false,
        };
      })()
    : null;
  const presentationMissionTemplate =
    matchedMissionTemplate || runtimeDungeonTemplate || missionTemplate || null;
  const runtimeMissionTemplate =
    matchedMissionTemplate &&
    normalizeText(matchedMissionTemplate && matchedMissionTemplate.siteFamily, "").toLowerCase() === "mission"
      ? matchedMissionTemplate
      : runtimeDungeonTemplate || matchedMissionTemplate || missionTemplate || null;
  const conversationTargetLocation = buildMissionConversationTargetLocationWrap(
    {
      contentID,
      agentID,
    },
    agentRecord,
  );
  const missionTemplateID =
    objectiveMode === OBJECTIVE_TYPE_TRANSPORT || objectiveMode === OBJECTIVE_TYPE_FETCH || objectiveMode === OBJECTIVE_TYPE_AGENT
    ? `client-mission:${missionContentIDToText(contentID, "unknown")}`
    : normalizeText(
        presentationMissionTemplate && presentationMissionTemplate.templateID,
        fallbackMissionTemplateID || `client-mission:${missionContentIDToText(contentID, "unknown")}`,
      );
  const clientMissionTitle = normalizeText(
    getMissionLocalizedNameText(clientMissionRecord),
    humanizeClientMissionContentTemplate(
      clientMissionRecord && clientMissionRecord.contentTemplate,
    ),
  );
  const missionTitle =
    objectiveMode === OBJECTIVE_TYPE_TRANSPORT ||
    objectiveMode === OBJECTIVE_TYPE_FETCH ||
    objectiveMode === OBJECTIVE_TYPE_AGENT
    ? normalizeText(
        clientMissionTitle,
        missionContentIDToText(contentID, missionTemplateID),
      )
    : normalizeText(
        presentationMissionTemplate && presentationMissionTemplate.title,
        normalizeText(
          clientMissionTitle,
          missionContentIDToText(contentID, missionTemplateID),
        ),
      );
  const missionSystemID =
    objectiveMode === OBJECTIVE_TYPE_AGENT
      ? normalizePositiveInteger(
          conversationTargetLocation && conversationTargetLocation.solarsystemID,
          normalizePositiveInteger(agentRecord && agentRecord.solarSystemID, 0),
        )
      : objectiveMode === OBJECTIVE_TYPE_FETCH
      ? normalizePositiveInteger(
          agentRecord && agentRecord.solarSystemID,
          normalizePositiveInteger(agentRecord && agentRecord.solarSystemID, 0),
        )
      : objectiveMode === OBJECTIVE_TYPE_TRANSPORT
      ? normalizePositiveInteger(
          dropoffStation && dropoffStation.solarSystemID,
          normalizePositiveInteger(agentRecord && agentRecord.solarSystemID, 0),
        )
      : normalizePositiveInteger(agentRecord && agentRecord.solarSystemID, 0);
  const missionPosition =
    objectiveMode === OBJECTIVE_TYPE_TRANSPORT ||
    objectiveMode === OBJECTIVE_TYPE_FETCH ||
    objectiveMode === OBJECTIVE_TYPE_AGENT
    ? null
    : buildMissionSitePosition(missionSystemID, {
        missionSequence,
        contentID,
      }, agentRecord);

  state.nextMissionSequence = missionSequence + 1;
  if (advanceSelectionCursor) {
    characterState.missionSelectionCursorByAgentID[String(agentID)] =
      (normalizeInteger(
        characterState.missionSelectionCursorByAgentID[String(agentID)],
        0,
      ) + 1);
  }

  return {
    missionSequence,
    agentID,
    contentID,
    missionTemplateID,
    missionContentTemplateID: normalizeText(
      clientMissionRecord && clientMissionRecord.contentTemplate,
      "",
    ),
    missionNameID: normalizePositiveInteger(
      clientMissionRecord && clientMissionRecord.nameID,
      0,
    ),
    missionPoolKey: normalizeText(agentRecord && agentRecord.missionPoolKey, ""),
    missionKind: normalizeText(
      clientMissionKind,
      normalizeText(agentRecord && agentRecord.missionKind, "encounter"),
    ),
    missionTypeLabel: buildMissionTypeLabel(agentRecord),
    missionTitle,
    importantMission,
    runtimeStatus: "offered",
    placeholder: false,
    objectiveMode,
    objectiveCompleted: false,
    gmCompleted: false,
    offeredAtFileTime: currentFileTimeString(),
    acceptedAtFileTime: null,
    expiresAtFileTime: futureFileTimeString(OFFER_EXPIRY_MS),
    lastUpdatedAtMs: Date.now(),
    dungeonTemplateID:
      objectiveMode === OBJECTIVE_TYPE_DUNGEON
        ? normalizeText(
            runtimeMissionTemplate && runtimeMissionTemplate.templateID,
            missionTemplateID,
          )
        : "",
    dungeonID:
      objectiveMode === OBJECTIVE_TYPE_DUNGEON
        ? normalizePositiveInteger(runtimeMissionTemplate && runtimeMissionTemplate.sourceDungeonID, 0) ||
          PLACEHOLDER_DUNGEON_ID_OFFSET + missionSequence
        : null,
    dungeonInstanceID: null,
    missionSiteID:
      objectiveMode === OBJECTIVE_TYPE_DUNGEON
        ? MISSION_SITE_ID_OFFSET + missionSequence
        : null,
    missionSystemID,
    missionPosition,
    bookmarkIDsByRole: {},
    cargo,
    pickupLocation:
      objectiveMode === OBJECTIVE_TYPE_TRANSPORT
        ? buildLocationWrapForStation(sourceStationID)
        : objectiveMode === OBJECTIVE_TYPE_FETCH
        ? null
        : objectiveMode === OBJECTIVE_TYPE_AGENT
        ? buildAgentLocationWrap(agentRecord)
        : buildMissionSiteLocationWrap(agentRecord, {
            missionSystemID,
            missionPosition,
          }, runtimeMissionTemplate || presentationMissionTemplate),
    dropoffLocation:
      objectiveMode === OBJECTIVE_TYPE_AGENT
        ? conversationTargetLocation
        : objectiveMode === OBJECTIVE_TYPE_FETCH
        ? buildLocationWrapForStation(fetchDropoffStationID)
        : buildLocationWrapForStation(
            normalizePositiveInteger(dropoffStation && dropoffStation.stationID, sourceStationID),
          ),
    rewards: buildMissionRewards(agentRecord, importantMission, clientMissionRecord),
  };
}

function buildStandingPreview(characterID, agentRecord, missionRecord) {
  return standingRuntime.buildStandingPreview(
    normalizePositiveInteger(characterID, 0),
    standingRuntime.buildMissionRewardStandingChanges(agentRecord, missionRecord),
  );
}

function isMissionRemoteOfferable(missionRecord) {
  return false;
}

function getPreferredCharacterSession(characterID) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return null;
  }
  return sessionRegistry.findSessionByCharacterID(normalizedCharacterID) || null;
}

function isCharacterAtAgentLocation(characterID, agentRecord) {
  const session = getPreferredCharacterSession(characterID);
  if (!session || !agentRecord) {
    return false;
  }
  const agentStationID = normalizePositiveInteger(agentRecord.stationID, 0);
  if (agentStationID > 0) {
    return normalizePositiveInteger(session.stationid, 0) === agentStationID;
  }
  const agentSolarSystemID = normalizePositiveInteger(agentRecord.solarSystemID, 0);
  return agentSolarSystemID > 0 &&
    normalizePositiveInteger(session.locationid, 0) === agentSolarSystemID;
}

function hasRuntimeRemoteCompletionParity(missionRecord) {
  return (
    normalizeText(missionRecord && missionRecord.runtimeStatus, "offered") === "accepted" &&
    normalizeBoolean(missionRecord && missionRecord.objectiveCompleted, false) === true &&
    !isAgentObjectiveMissionRecord(missionRecord)
  );
}

function isMissionRemoteCompletable(missionRecord, options = {}) {
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  const explicitRemoteCompletable = normalizeBoolean(
    clientMissionRecord && clientMissionRecord.remoteCompletable,
    false,
  );
  if (!explicitRemoteCompletable && !hasRuntimeRemoteCompletionParity(missionRecord)) {
    return false;
  }
  const agentRecord =
    options.agentRecord || getAgentRecord(missionRecord && missionRecord.agentID);
  const characterID = normalizePositiveInteger(options.characterID, 0);
  if (!characterID || !agentRecord) {
    return true;
  }
  return !isCharacterAtAgentLocation(characterID, agentRecord);
}

function buildMissionJournalRow(characterID, agentRecord, missionRecord) {
  const bookmarks = listMissionBookmarks(characterID, missionRecord);
  return [
    getMissionStateFromRecord(missionRecord),
    normalizeBoolean(missionRecord && missionRecord.importantMission, false),
    buildMissionTypeLabel(agentRecord),
    resolveMissionTitleValue(missionRecord, null),
    normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
    fileTimeBigIntToLong(fileTimeStringToBigInt(missionRecord && missionRecord.expiresAtFileTime)),
    bookmarks,
    isMissionRemoteOfferable(missionRecord),
    isMissionRemoteCompletable(missionRecord, {
      characterID,
      agentRecord,
    }),
    resolveClientMissionContentID(missionRecord, agentRecord),
  ];
}

function buildMissionBriefingInfo(agentRecord, missionRecord, missionTemplate) {
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  const clientFacingContentID = resolveClientMissionContentID(
    missionRecord,
    agentRecord,
  );
  return {
    "ContentID": clientFacingContentID,
    "Mission Title ID": resolveMissionTitleValue(missionRecord, missionTemplate),
    "Mission Briefing ID": resolveMissionBriefingValue(
      agentRecord,
      missionRecord,
      missionTemplate,
      clientMissionRecord,
      [
        "messages.mission.briefing",
        "messages.mission.extrainfo.body",
        "messages.mission.offered.agentsays",
      ],
    ),
    "Mission Keywords": buildMissionKeywords(
      agentRecord,
      missionRecord,
      missionTemplate,
    ),
    "Mission Image": null,
    "Decline Time": null,
    "Expiration Time": fileTimeBigIntToLong(
      fileTimeStringToBigInt(missionRecord && missionRecord.expiresAtFileTime),
    ),
    "AcceptTimestamp":
      missionRecord && missionRecord.acceptedAtFileTime
        ? fileTimeBigIntToLong(
            fileTimeStringToBigInt(missionRecord.acceptedAtFileTime),
          )
        : null,
    "Mission ID": clientFacingContentID,
  };
}

function buildMissionObjectivePayload(agentRecord, missionRecord, missionTemplate) {
  if (!agentRecord || !missionRecord) {
    return {
      missionTitleID: null,
      missionState: null,
      completionStatus: 0,
      objectives: [],
      dungeons: [],
      locations: [],
      agentGift: [],
      normalRewards: [],
      loyaltyPoints: 0,
      researchPoints: 0,
      bonusRewards: [],
      collateral: [],
      contentID: null,
    };
  }

  const objectiveCompleted = normalizeBoolean(
    missionRecord && missionRecord.objectiveCompleted,
    false,
  );
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  const dungeonTemplate = getDungeonMissionTemplateRecord(missionRecord);
  const presentationTemplate = missionTemplate || dungeonTemplate || null;
  const completionStatus = objectiveCompleted
    ? (normalizeBoolean(missionRecord && missionRecord.gmCompleted, false) ? 2 : 1)
    : 0;
  const missionState = getMissionStateFromRecord(missionRecord);
  const rewards = missionRecord.rewards || {};
  const clientFacingContentID = resolveClientMissionContentID(
    missionRecord,
    agentRecord,
  );
  const objectives = [];
  const dungeons = [];
  const isCourier = missionRecord.objectiveMode === OBJECTIVE_TYPE_TRANSPORT;
  const isFetch = isFetchMissionRecord(missionRecord);
  const isAgentObjective = isAgentObjectiveMissionRecord(missionRecord);
  const missionLocations = [];
  if (normalizePositiveInteger(missionRecord && missionRecord.missionSystemID, 0) > 0) {
    missionLocations.push(normalizePositiveInteger(missionRecord.missionSystemID, 0));
  }
  if (
    missionRecord &&
    missionRecord.dropoffLocation &&
    normalizePositiveInteger(missionRecord.dropoffLocation.solarsystemID, 0) > 0
  ) {
    missionLocations.push(
      normalizePositiveInteger(missionRecord.dropoffLocation.solarsystemID, 0),
    );
  }
  if (
    missionRecord &&
    missionRecord.pickupLocation &&
    normalizePositiveInteger(missionRecord.pickupLocation.solarsystemID, 0) > 0
  ) {
    missionLocations.push(
      normalizePositiveInteger(missionRecord.pickupLocation.solarsystemID, 0),
    );
  }

  if (isCourier) {
    objectives.push([
      OBJECTIVE_TYPE_TRANSPORT,
      [
        normalizePositiveInteger(agentRecord.agentID, 0),
        cloneValue(missionRecord.pickupLocation || buildLocationWrapForStation(agentRecord.stationID)),
        normalizePositiveInteger(agentRecord.agentID, 0),
        cloneValue(missionRecord.dropoffLocation || buildLocationWrapForStation(agentRecord.stationID)),
        {
          ...cloneValue(missionRecord.cargo || resolvePlaceholderCargo()),
          hasCargo: normalizeBoolean(
            missionRecord &&
              missionRecord.cargo &&
              missionRecord.cargo.hasCargo,
            false,
          ),
        },
      ],
    ]);
  } else if (isFetch) {
    objectives.push([
      OBJECTIVE_TYPE_FETCH,
      [
        normalizePositiveInteger(agentRecord.agentID, 0),
        cloneValue(missionRecord.dropoffLocation || buildLocationWrapForStation(agentRecord.stationID)),
        {
          ...cloneValue(missionRecord.cargo || resolvePlaceholderCargo()),
          hasCargo: normalizeBoolean(
            missionRecord &&
              missionRecord.cargo &&
              missionRecord.cargo.hasCargo,
            false,
          ),
        },
      ],
    ]);
  } else if (isAgentObjective) {
    const targetAgentID = getMissionConversationTargetAgentID(
      missionRecord,
      normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
    );
    const targetLocation = buildMissionConversationTargetLocationWrap(
      missionRecord,
      agentRecord,
    );
    if (targetAgentID > 0 && targetLocation) {
      objectives.push([
        OBJECTIVE_TYPE_AGENT,
        [
          targetAgentID,
          cloneValue(targetLocation),
        ],
      ]);
    }
  } else {
    const dungeonObjective = {
      dungeonID:
        normalizePositiveInteger(missionRecord.dungeonID, 0) ||
        PLACEHOLDER_DUNGEON_ID_OFFSET + normalizePositiveInteger(missionRecord.missionSequence, 0),
      optional: false,
      objectiveCompleted: null,
      ownerID: resolveMissionEnemyOwnerID(presentationTemplate, dungeonTemplate),
      shipRestrictions: hasMissionShipRestrictions(presentationTemplate, dungeonTemplate) ? 1 : 0,
      location: cloneValue(
        missionRecord.pickupLocation || buildMissionSiteLocationWrap(
          agentRecord,
          missionRecord,
          dungeonTemplate || presentationTemplate,
        ),
      ),
      briefingMessage: buildEncounterObjectiveBriefingMessage(
        agentRecord,
        missionRecord,
        presentationTemplate,
        dungeonTemplate,
        clientMissionRecord,
      ),
    };
    if (objectiveCompleted) {
      dungeonObjective.objectiveCompleted = 1;
      dungeonObjective.completionStatus = 1;
    }
    dungeons.push(dungeonObjective);
  }

  const normalRewards = [
    rewards.isk
      ? [ISK_DISPLAY_TYPE_ID, Math.max(1, Math.round(Number(rewards.isk) || 0)), null]
      : null,
    ...normalizeArray(rewards.itemRewards)
      .map((rewardRecord) => buildMissionRewardDisplayEntry(rewardRecord))
      .filter(Boolean),
  ].filter(Boolean);
  const bonusTimeRemainingTicks = resolveMissionBonusTimeRemainingTicks(missionRecord);
  const bonusIntervalMinutes = Math.max(
    0,
    normalizeInteger(rewards.bonusTimeIntervalMinutes, 0),
  );
  if (bonusIntervalMinutes <= 0) {
    if (rewards.bonusIsk) {
      normalRewards.push([
        ISK_DISPLAY_TYPE_ID,
        Math.max(1, Math.round(Number(rewards.bonusIsk) || 0)),
        null,
      ]);
    }
    normalRewards.push(
      ...normalizeArray(rewards.bonusItemRewards)
        .map((rewardRecord) => buildMissionRewardDisplayEntry(rewardRecord))
        .filter(Boolean),
    );
  }
  const bonusRewards = bonusIntervalMinutes > 0
    ? [
        rewards.bonusIsk
          ? [
              bonusTimeRemainingTicks,
              ISK_DISPLAY_TYPE_ID,
              Math.max(1, Math.round(Number(rewards.bonusIsk) || 0)),
              null,
              bonusIntervalMinutes,
            ]
          : null,
        ...normalizeArray(rewards.bonusItemRewards)
          .map((rewardRecord) => {
            const rewardEntry = buildMissionRewardDisplayEntry(rewardRecord);
            if (!rewardEntry) {
              return null;
            }
            return [
              bonusTimeRemainingTicks,
              rewardEntry[0],
              rewardEntry[1],
              rewardEntry[2],
              bonusIntervalMinutes,
            ];
          })
          .filter(Boolean),
      ].filter(Boolean)
    : [];
  const missionExtraHeaderID = getMissionMessageID(
    clientMissionRecord,
    "messages.mission.extrainfo.header",
  );
  const missionExtraBodyID = getMissionMessageID(
    clientMissionRecord,
    "messages.mission.extrainfo.body",
  );
  const missionExtra = missionExtraHeaderID > 0 || missionExtraBodyID > 0
    ? [
        missionExtraHeaderID > 0
          ? missionExtraHeaderID
          : resolveMissionTitleValue(missionRecord, presentationTemplate),
        missionExtraBodyID > 0
          ? missionExtraBodyID
          : getMissionMessageID(clientMissionRecord, "messages.mission.briefing") ||
            resolveMissionTitleValue(missionRecord, presentationTemplate),
      ]
    : null;

  return {
    missionTitleID: resolveMissionTitleValue(missionRecord, presentationTemplate),
    missionState,
    completionStatus,
    importantStandings: normalizeBoolean(missionRecord.importantMission, false),
    objectives,
    dungeons,
    locations: [...new Set(missionLocations.filter(Boolean))],
    agentGift:
      normalizePositiveInteger(clientMissionRecord && clientMissionRecord.initialAgentGiftTypeID, 0) > 0
        ? [[
            normalizePositiveInteger(clientMissionRecord.initialAgentGiftTypeID, 0),
            Math.max(
              1,
              normalizeInteger(clientMissionRecord.initialAgentGiftQuantity, 1),
            ),
            null,
          ]]
        : [],
    normalRewards,
    loyaltyPoints: Math.max(0, normalizeInteger(rewards.loyaltyPoints, 0)),
    researchPoints: Math.max(0, normalizeInteger(rewards.researchPoints, 0)),
    bonusRewards,
    collateral: [],
    ...(missionExtra ? { missionExtra } : {}),
    contentID: clientFacingContentID,
  };
}

function buildMissionJournalInfo(characterID, agentRecord, missionRecord, missionTemplate) {
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  const clientFacingContentID = resolveClientMissionContentID(
    missionRecord,
    agentRecord,
  );
  return {
    missionNameID: resolveMissionTitleValue(missionRecord, missionTemplate),
    contentID: clientFacingContentID,
    briefingTextID: resolveMissionBriefingValue(
      agentRecord,
      missionRecord,
      missionTemplate,
      clientMissionRecord,
      [
        "messages.mission.briefing",
        "messages.mission.extrainfo.body",
        "messages.mission.offered.agentsays",
      ],
    ),
    missionImage: null,
    expirationTime: fileTimeBigIntToLong(
      fileTimeStringToBigInt(missionRecord && missionRecord.expiresAtFileTime),
    ),
    missionState: getMissionStateFromRecord(missionRecord),
    objectives: buildMissionObjectivePayload(
      agentRecord,
      missionRecord,
      missionTemplate,
    ),
    bookmarks: listMissionBookmarks(characterID, missionRecord),
    iconID: null,
  };
}

function buildAgentLocationWrap(agentRecord) {
  const stationID = normalizePositiveInteger(agentRecord && agentRecord.stationID, 0);
  if (stationID) {
    return buildLocationWrapForStation(stationID);
  }
  return {
    locationID: normalizePositiveInteger(agentRecord && agentRecord.solarSystemID, 0),
    typeID: 5,
    solarsystemID: normalizePositiveInteger(agentRecord && agentRecord.solarSystemID, 0),
    locationType: "solarsystem",
  };
}

function getAgentLocationWrap(agentID) {
  return buildAgentLocationWrap(getAgentRecord(agentID));
}

function buildMissionServiceDetails(characterID, agentRecord) {
  const activeMission = getMissionRecord(characterID, agentRecord && agentRecord.agentID);
  const replayUntilFileTime = getReplayUntilFileTime(
    characterID,
    agentRecord && agentRecord.agentID,
  );
  return buildKeyVal([
    ["agentServiceType", "mission"],
    [
      "available",
      canUseAgent(characterID, agentRecord) &&
      !activeMission &&
      resolveReplayRemainingTicks(replayUntilFileTime) <= 0,
    ],
  ]);
}

function buildLocateServiceDetails(agentRecord) {
  if (!normalizeBoolean(agentRecord && agentRecord.isLocator, false)) {
    return null;
  }

  return buildKeyVal([
    ["agentServiceType", "locate"],
    ["frequency", intervalMsToTicks(5 * 60 * 1000)],
    ["delays", [
      [0, 0, 0],
      [1, 60, 5000],
      [2, 120, 15000],
      [3, 240, 35000],
    ]],
    ["callbackID", null],
    ["lastUsed", null],
  ]);
}

function notifyMissionChange(characterID, eventName, agentID) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const normalizedAgentID = normalizePositiveInteger(agentID, 0);
  if (!normalizedCharacterID || !normalizedAgentID) {
    return;
  }

  for (const session of sessionRegistry.getSessions()) {
    if (
      Number(session && session.characterID) !== normalizedCharacterID ||
      typeof session.sendNotification !== "function"
    ) {
      continue;
    }
    session.sendNotification("OnAgentMissionChange", "clientID", [
      eventName,
      normalizedAgentID,
    ]);
  }
}

function notifyMissionTrackerUpdate(characterID, agentID) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const normalizedAgentID = normalizePositiveInteger(agentID, 0);
  if (!normalizedCharacterID || !normalizedAgentID) {
    return;
  }

  for (const session of sessionRegistry.getSessions()) {
    if (
      Number(session && session.characterID) !== normalizedCharacterID ||
      typeof session.sendNotification !== "function"
    ) {
      continue;
    }

    const missionRecord = getMissionRecord(normalizedCharacterID, normalizedAgentID);
    const info = getMissionInfoItems(normalizedCharacterID, normalizedAgentID, {
      currentLocationID: normalizePositiveInteger(session && session.locationid, 0),
      currentStationID: normalizePositiveInteger(session && session.stationid, 0),
      inActiveDungeon: isSessionInActiveMissionDungeon(session, missionRecord),
    });
    const updates = [buildKeyVal([
      ["agentID", normalizedAgentID],
      ["info", info],
    ])];
    session.sendNotification("OnMissionsUpdated", "clientID", [updates]);
  }
}

function getMissionRecord(characterID, agentID) {
  const characterState = getCharacterStateSnapshot(characterID);
  if (!characterState || !characterState.missionsByAgentID) {
    return null;
  }
  const missionRecord = characterState.missionsByAgentID[String(normalizePositiveInteger(agentID, 0))];
  return missionRecord ? cloneValue(missionRecord) : null;
}

function getReplayUntilFileTime(characterID, agentID) {
  const characterState = getCharacterStateSnapshot(characterID);
  if (!characterState || !characterState.declineTimersByAgentID) {
    return null;
  }
  return normalizeText(
    characterState.declineTimersByAgentID[String(normalizePositiveInteger(agentID, 0))],
    "",
  );
}

function offerMission(characterID, agentRecord) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const normalizedAgentID = normalizePositiveInteger(agentRecord && agentRecord.agentID, 0);
  if (!normalizedCharacterID || !normalizedAgentID) {
    return { success: false, errorMsg: "INVALID_AGENT_OR_CHARACTER" };
  }

  return mutateCharacterState(normalizedCharacterID, (characterState, state) => {
    const replayUntilFileTime = normalizeText(
      characterState.declineTimersByAgentID[String(normalizedAgentID)],
      "",
    );
    if (resolveReplayRemainingTicks(replayUntilFileTime) > 0) {
      return { kind: "cooldown", replayUntilFileTime };
    }

    const existingMissionRecord = characterState.missionsByAgentID[String(normalizedAgentID)];
    if (existingMissionRecord) {
      return { kind: "existing", missionRecord: cloneValue(existingMissionRecord) };
    }

    const pool = getMissionTemplatePool(normalizedAgentID);
    const availableClientMission = pickMissionForAgent(agentRecord, normalizeInteger(
      characterState.missionSelectionCursorByAgentID[String(normalizedAgentID)],
      0,
    ));
    if (!pool.length && !availableClientMission) {
      return { kind: "unavailable" };
    }

    const cursor = normalizeInteger(
      characterState.missionSelectionCursorByAgentID[String(normalizedAgentID)],
      0,
    );
    const selectedMissionTemplateID = pool.length > 0
      ? pool[cursor % pool.length]
      : "";
    const missionTemplate = selectedMissionTemplateID
      ? getMissionTemplateRecord(selectedMissionTemplateID)
      : null;
    const missionRecord = buildMissionRecord(
      state,
      characterState,
      agentRecord,
      missionTemplate,
      cursor,
    );
    characterState.missionsByAgentID[String(normalizedAgentID)] = missionRecord;
    return { kind: "offered", missionRecord: cloneValue(missionRecord) };
  });
}

function offerSpecificMission(characterID, agentRecord, clientMissionRecord) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const normalizedAgentID = normalizePositiveInteger(agentRecord && agentRecord.agentID, 0);
  if (!normalizedCharacterID || !normalizedAgentID || !clientMissionRecord) {
    return { success: false, errorMsg: "INVALID_AGENT_OR_MISSION" };
  }

  return mutateCharacterState(normalizedCharacterID, (characterState, state) => {
    const existingMissionRecord = characterState.missionsByAgentID[String(normalizedAgentID)];
    if (existingMissionRecord) {
      return { kind: "existing", missionRecord: cloneValue(existingMissionRecord) };
    }

    const missionRecord = buildMissionRecord(
      state,
      characterState,
      agentRecord,
      null,
      0,
      clientMissionRecord,
      false,
    );
    characterState.missionsByAgentID[String(normalizedAgentID)] = missionRecord;
    return { kind: "offered", missionRecord: cloneValue(missionRecord) };
  });
}

function grantMissionInitialAgentGift(characterID, agentRecord, missionRecord) {
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  const typeID = normalizePositiveInteger(
    clientMissionRecord && clientMissionRecord.initialAgentGiftTypeID,
    0,
  );
  if (!typeID) {
    return { success: true, data: { granted: false } };
  }

  const quantity = Math.max(
    1,
    normalizeInteger(clientMissionRecord && clientMissionRecord.initialAgentGiftQuantity, 1),
  );
  const stationID = normalizePositiveInteger(agentRecord && agentRecord.stationID, 0);
  if (!stationID) {
    return { success: true, data: { granted: false } };
  }

  const grantResult = grantItemsToCharacterStationHangar(characterID, stationID, [{
    itemType: typeID,
    quantity,
  }]);
  if (grantResult && grantResult.success === true) {
    notifyMissionInventoryChanges(
      characterID,
      (grantResult.data && grantResult.data.changes) || [],
    );
  }
  return grantResult;
}

function acceptMission(characterID, agentRecord) {
  const existingMissionRecord = getMissionRecord(characterID, agentRecord && agentRecord.agentID);
  if (!existingMissionRecord) {
    return {
      success: false,
      errorMsg: "MISSION_NOT_FOUND",
    };
  }
  const missionTemplate = getRuntimeMissionTemplateRecord(existingMissionRecord);
  const preparedMissionRecord = ensureMissionSiteState(
    characterID,
    agentRecord,
    existingMissionRecord,
    missionTemplate,
  );
  const giftResult = grantMissionInitialAgentGift(
    characterID,
    agentRecord,
    preparedMissionRecord,
  );
  if (giftResult && giftResult.success === false) {
    return giftResult;
  }
  return mutateCharacterState(characterID, (characterState) => {
    const missionRecord = characterState.missionsByAgentID[String(agentRecord.agentID)];
    if (!missionRecord) {
      return null;
    }
    Object.assign(missionRecord, cloneValue(preparedMissionRecord));
    missionRecord.runtimeStatus = "accepted";
    missionRecord.acceptedAtFileTime = currentFileTimeString();
    missionRecord.lastUpdatedAtMs = Date.now();
    return cloneValue(missionRecord);
  });
}

function clearMissionWithCooldown(characterID, agentRecord, runtimeStatus = "declined") {
  return mutateCharacterState(characterID, (characterState) => {
    const missionRecord = characterState.missionsByAgentID[String(agentRecord.agentID)];
    if (missionRecord) {
      delete characterState.missionsByAgentID[String(agentRecord.agentID)];
    }
    characterState.declineTimersByAgentID[String(agentRecord.agentID)] =
      futureFileTimeString(REPLAY_DELAY_MS);
    if (missionRecord) {
      characterState.history.unshift({
        missionSequence: missionRecord.missionSequence,
        agentID: missionRecord.agentID,
        contentID: missionRecord.contentID,
        missionTemplateID: missionRecord.missionTemplateID,
        runtimeStatus,
        completedAtFileTime: currentFileTimeString(),
        lastUpdatedAtMs: Date.now(),
      });
      characterState.history = characterState.history.slice(0, 128);
    }
    return {
      replayUntilFileTime: characterState.declineTimersByAgentID[String(agentRecord.agentID)],
      missionRecord: missionRecord ? cloneValue(missionRecord) : null,
    };
  });
}

function applyMissionRewards(characterID, agentRecord, missionRecord) {
  const rewards =
    missionRecord && missionRecord.rewards && typeof missionRecord.rewards === "object"
      ? missionRecord.rewards
      : {};
  const standingsRaw =
    rewards.rawStandings && typeof rewards.rawStandings === "object"
      ? rewards.rawStandings
      : {};
  const bonusAvailable = isMissionBonusRewardAvailable(missionRecord);
  const totalWalletReward = roundMoney(
    Number(rewards.isk || 0) +
      (bonusAvailable ? Number(rewards.bonusIsk || 0) : 0),
  );

  const walletResult = adjustCharacterBalance(
    characterID,
    totalWalletReward,
    {
      description: `Agent mission reward: ${normalizeText(missionRecord && missionRecord.missionTitle, missionContentIDToText(missionRecord && missionRecord.contentID, ""))}`,
      ownerID1: normalizePositiveInteger(agentRecord && agentRecord.corporationID, 0),
      ownerID2: normalizePositiveInteger(characterID, 0),
      referenceID: normalizePositiveInteger(agentRecord && agentRecord.agentID, 0),
      entryTypeID: MISSION_REWARD_ENTRY_TYPE,
    },
  );
  if (!walletResult.success) {
    return walletResult;
  }

  const rewardItems = [
    ...normalizeArray(rewards.itemRewards),
    ...(bonusAvailable ? normalizeArray(rewards.bonusItemRewards) : []),
  ].filter(
    (rewardRecord) =>
      normalizePositiveInteger(rewardRecord && rewardRecord.typeID, 0) > 0 &&
      Math.max(0, normalizeInteger(rewardRecord && rewardRecord.quantity, 0)) > 0,
  );
  if (rewardItems.length > 0) {
    const rewardStationID = normalizePositiveInteger(
      missionRecord &&
        missionRecord.dropoffLocation &&
        missionRecord.dropoffLocation.locationID,
      normalizePositiveInteger(agentRecord && agentRecord.stationID, 0),
    );
    if (rewardStationID > 0) {
      const grantResult = grantItemsToCharacterStationHangar(
        characterID,
        rewardStationID,
        rewardItems.map((rewardRecord) => ({
          itemType: normalizePositiveInteger(rewardRecord && rewardRecord.typeID, 0),
          quantity: Math.max(1, normalizeInteger(rewardRecord && rewardRecord.quantity, 1)),
        })),
      );
      if (!grantResult || grantResult.success !== true) {
        return grantResult || { success: false, errorMsg: "MISSION_REWARD_GRANT_FAILED" };
      }
      notifyMissionInventoryChanges(
        characterID,
        (grantResult.data && grantResult.data.changes) || [],
      );
    }
  }

  if (normalizeInteger(rewards.loyaltyPoints, 0) > 0) {
    const lpResult = adjustCharacterWalletLPBalance(
      characterID,
      normalizePositiveInteger(agentRecord && agentRecord.corporationID, 0),
      normalizeInteger(rewards.loyaltyPoints, 0),
      { changeType: "mission_reward" },
    );
    if (!lpResult.success) {
      return lpResult;
    }
  }

  const standingWriteResult = standingRuntime.applyMissionStandingChanges(
    characterID,
    agentRecord,
    missionRecord,
    "completed",
  );
  if (!standingWriteResult.success) {
    return standingWriteResult;
  }

  return {
    success: true,
    data: {
      wallet: walletResult.data,
      bonusAvailable,
      modifications: standingWriteResult.data.modifications,
    },
  };
}

function completeMission(characterID, agentRecord) {
  const missionRecord = syncMissionRecordState(characterID, agentRecord.agentID);
  if (!missionRecord) {
    return { success: false, errorMsg: "MISSION_NOT_FOUND" };
  }
  if (!missionRecord.objectiveCompleted) {
    return { success: false, errorMsg: "OBJECTIVES_NOT_COMPLETE" };
  }

  if (
    (
      missionRecord.objectiveMode === OBJECTIVE_TYPE_TRANSPORT ||
      isFetchMissionRecord(missionRecord)
    ) &&
    missionRecord.cargo &&
    normalizeBoolean(missionRecord.gmCompleted, false) !== true
  ) {
    const dropoffLocationID = normalizePositiveInteger(
      missionRecord.dropoffLocation && missionRecord.dropoffLocation.locationID,
      0,
    );
    if (dropoffLocationID > 0) {
      const preferredSession = getPreferredCharacterSession(characterID);
      const currentDockedLocationID = normalizePositiveInteger(
        getDockedLocationID(preferredSession),
        0,
      );
      let takeResult = takeItemTypeFromCharacterLocation(
        characterID,
        dropoffLocationID,
        ITEM_FLAGS.HANGAR,
        missionRecord.cargo.typeID,
        missionRecord.cargo.quantity,
      );
      if (
        (!takeResult || takeResult.success !== true) &&
        currentDockedLocationID === dropoffLocationID
      ) {
        const activeShip = getActiveShipItem(characterID);
        const activeShipID = normalizePositiveInteger(activeShip && activeShip.itemID, 0);
        if (activeShipID > 0) {
          takeResult = takeItemTypeFromCharacterLocation(
            characterID,
            activeShipID,
            ITEM_FLAGS.CARGO_HOLD,
            missionRecord.cargo.typeID,
            missionRecord.cargo.quantity,
          );
        }
      }
      if (!takeResult || takeResult.success !== true) {
        return takeResult || { success: false, errorMsg: "MISSION_CARGO_NOT_FOUND" };
      }
      notifyMissionInventoryChanges(
        characterID,
        (takeResult.data && takeResult.data.changes) || [],
      );
    }
  }

  const rewardResult = applyMissionRewards(characterID, agentRecord, missionRecord);
  if (!rewardResult.success) {
    return rewardResult;
  }

  const cleanupResult = mutateCharacterState(characterID, (characterState) => {
    delete characterState.missionsByAgentID[String(agentRecord.agentID)];
    delete characterState.declineTimersByAgentID[String(agentRecord.agentID)];
    if (isCareerAgent(agentRecord)) {
      characterState.completedCareerAgentIDs[String(agentRecord.agentID)] = true;
    }
    characterState.history.unshift({
      missionSequence: missionRecord.missionSequence,
      agentID: missionRecord.agentID,
      contentID: missionRecord.contentID,
      missionTemplateID: missionRecord.missionTemplateID,
      runtimeStatus: "completed",
      completedAtFileTime: currentFileTimeString(),
      lastUpdatedAtMs: Date.now(),
    });
    characterState.history = characterState.history.slice(0, 128);
    return cloneValue(missionRecord);
  });

  if (!cleanupResult.success) {
    return cleanupResult;
  }

  cleanupMissionBookmarks(characterID, missionRecord);
  if (normalizePositiveInteger(missionRecord.dungeonInstanceID, 0) > 0) {
    try {
      dungeonRuntime.purgeInstance(missionRecord.dungeonInstanceID);
    } catch (_error) {
      // Mission completion should still succeed if the instance already despawned.
    }
  }

  return { success: true, data: { missionRecord, rewardResult: rewardResult.data } };
}

function getJournalDetails(characterID) {
  const characterState = getCharacterStateSnapshot(characterID);
  if (!characterState) {
    return [[], []];
  }

  const missionRows = Object.values(characterState.missionsByAgentID || {})
    .map((missionRecord) => {
      const syncedMissionRecord =
        getMissionRecordForRead(characterID, missionRecord && missionRecord.agentID) ||
        missionRecord;
      const agentRecord = getAgentRecord(missionRecord && missionRecord.agentID);
      return agentRecord
        ? buildMissionJournalRow(characterID, agentRecord, syncedMissionRecord)
        : null;
    })
    .filter(Boolean);

  return [missionRows, []];
}

function getCompletedCareerAgentMap(characterID, agentIDs = []) {
  const characterState = getCharacterStateSnapshot(characterID);
  const completedByID =
    characterState &&
    characterState.completedCareerAgentIDs &&
    typeof characterState.completedCareerAgentIDs === "object"
      ? characterState.completedCareerAgentIDs
      : {};

  const response = {};
  for (const agentID of Array.isArray(agentIDs) ? agentIDs : []) {
    const normalizedAgentID = normalizePositiveInteger(agentID, 0);
    if (!normalizedAgentID) {
      continue;
    }
    response[normalizedAgentID] =
      completedByID[String(normalizedAgentID)] === true;
  }
  return response;
}

function getInfoServiceDetails(characterID, agentID) {
  const agentRecord = getAgentRecord(agentID);
  if (!agentRecord) {
    return null;
  }

  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const services = [buildMissionServiceDetails(normalizedCharacterID, agentRecord)];
  const locateService = buildLocateServiceDetails(agentRecord);
  if (locateService) {
    services.push(locateService);
  }

  return buildKeyVal([
    ["agentID", normalizePositiveInteger(agentRecord.agentID, 0)],
    ["stationID", normalizePositiveInteger(agentRecord.stationID, 0) || null],
    ["level", normalizeInteger(agentRecord.level, 1)],
    ["services", services],
    ["incompatible", null],
  ]);
}

function getMissionBriefingInfo(characterID, agentID) {
  const agentRecord = getAgentRecord(agentID);
  const missionRecord = getMissionRecordForRead(characterID, agentID);
  if (!agentRecord || !missionRecord) {
    return null;
  }

  return buildMissionBriefingInfo(
    agentRecord,
    missionRecord,
    getRuntimeMissionTemplateRecord(missionRecord),
  );
}

function getMissionJournalInfo(characterID, agentID) {
  const agentRecord = getAgentRecord(agentID);
  const missionRecord = getMissionRecordForRead(characterID, agentID);
  if (!agentRecord || !missionRecord) {
    return null;
  }

  return buildMissionJournalInfo(
    normalizePositiveInteger(characterID, 0),
    agentRecord,
    missionRecord,
    getRuntimeMissionTemplateRecord(missionRecord),
  );
}

function getMissionObjectiveInfo(characterID, agentID) {
  const agentRecord = getAgentRecord(agentID);
  const missionRecord = getMissionRecordForRead(characterID, agentID);
  if (!agentRecord || !missionRecord) {
    const replayUntilFileTime = getReplayUntilFileTime(characterID, agentID);
    if (resolveReplayRemainingTicks(replayUntilFileTime) > 0) {
      return {
        missionTitleID: null,
        missionState: AGENT_MISSION_STATE_CANT_REPLAY,
        completionStatus: 0,
        objectives: [],
        dungeons: [],
        locations: [],
        agentGift: [],
        normalRewards: [],
        loyaltyPoints: 0,
        researchPoints: 0,
        bonusRewards: [],
        collateral: [],
        contentID: null,
      };
    }
    return null;
  }

  return buildMissionObjectivePayload(
    agentRecord,
    missionRecord,
    getRuntimeMissionTemplateRecord(missionRecord),
  );
}

function getMissionKeywords(characterID, agentID, contentID = null) {
  const agentRecord = getAgentRecord(agentID);
  if (!agentRecord) {
    return {};
  }
  const missionRecord =
    getMissionRecordForRead(characterID, agentID) ||
    (contentID
      ? {
          contentID: normalizeMissionContentID(contentID, null),
          missionTitle: missionContentIDToText(contentID, "Placeholder Mission"),
        }
      : null);
  return buildMissionKeywords(
    agentRecord,
    missionRecord,
    getRuntimeMissionTemplateRecord(missionRecord),
  );
}

function getStandingGainsForMission(characterID, agentID, contentID = null) {
  const agentRecord = getAgentRecord(agentID);
  const missionRecord =
    getMissionRecordForRead(characterID, agentID) ||
    (contentID
      ? {
          contentID: normalizeMissionContentID(contentID, null),
          rewards: buildMissionRewards(agentRecord, normalizeBoolean(agentRecord && agentRecord.importantMission, false)),
        }
      : null);
  if (!agentRecord || !missionRecord || !getCharacterRecord(characterID)) {
    return {};
  }
  return buildStandingPreview(characterID, agentRecord, missionRecord);
}

function getReplayTimestamp(characterID, agentID) {
  const replayUntil = fileTimeStringToBigInt(getReplayUntilFileTime(characterID, agentID));
  return replayUntil > 0n ? fileTimeBigIntToLong(replayUntil) : buildFiletimeLong(0n);
}

function markMissionObjectiveComplete(characterID, options = {}) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  if (!normalizedCharacterID) {
    return { success: false, errorMsg: "CHARACTER_NOT_FOUND" };
  }

  const requestedAgentID = normalizeText(options.agentID, "").toLowerCase();
  const completeAll = requestedAgentID === "all";
  const normalizedAgentID = completeAll
    ? 0
    : normalizePositiveInteger(options.agentID, 0);

  const characterState = getCharacterStateSnapshot(normalizedCharacterID);
  const missionRecords = Object.values(
    (characterState && characterState.missionsByAgentID) || {},
  ).filter(
    (missionRecord) =>
      normalizeText(missionRecord && missionRecord.runtimeStatus, "offered") ===
      "accepted",
  );

  const targets = completeAll
    ? missionRecords
    : missionRecords.filter(
        (missionRecord) =>
          normalizePositiveInteger(missionRecord && missionRecord.agentID, 0) ===
          normalizedAgentID,
      );

  if (!targets.length) {
    return { success: false, errorMsg: "MISSION_NOT_FOUND" };
  }

  const markedAgentIDs = [];
  const result = mutateCharacterState(normalizedCharacterID, (mutableCharacterState) => {
    for (const missionRecord of targets) {
      const storedMission =
        mutableCharacterState.missionsByAgentID[String(missionRecord.agentID)];
      if (!storedMission) {
        continue;
      }
      storedMission.objectiveCompleted = true;
      storedMission.gmCompleted = true;
      if (storedMission.cargo && typeof storedMission.cargo === "object") {
        storedMission.cargo.hasCargo = true;
      }
      storedMission.lastUpdatedAtMs = Date.now();
      markedAgentIDs.push(storedMission.agentID);
    }
    return markedAgentIDs.slice();
  });

  if (!result.success) {
    return result;
  }

  for (const agentID of markedAgentIDs) {
    notifyMissionChange(normalizedCharacterID, AGENT_MISSION_MODIFIED, agentID);
  }

  return { success: true, data: { markedAgentIDs } };
}

function removeOfferFromJournal(characterID, agentID) {
  const missionRecord = getMissionRecord(characterID, agentID);
  if (
    !missionRecord ||
    normalizeText(missionRecord.runtimeStatus, "offered") !== "offered"
  ) {
    return null;
  }

  mutateCharacterState(characterID, (characterState) => {
    delete characterState.missionsByAgentID[String(agentID)];
    return true;
  });
  notifyMissionChange(characterID, AGENT_MISSION_OFFER_REMOVED, agentID);
  return null;
}

function setMissionObjectiveCompleted(characterID, agentID) {
  return mutateCharacterState(characterID, (characterState) => {
    const missionRecord = characterState.missionsByAgentID[String(agentID)];
    if (!missionRecord) {
      return null;
    }
    missionRecord.objectiveCompleted = true;
    missionRecord.gmCompleted = false;
    missionRecord.lastUpdatedAtMs = Date.now();
    return cloneValue(missionRecord);
  });
}

function findReferredConversationMission(characterID, targetAgentID) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const normalizedTargetAgentID = normalizePositiveInteger(targetAgentID, 0);
  if (!normalizedCharacterID || !normalizedTargetAgentID) {
    return null;
  }
  const characterState = getCharacterStateSnapshot(normalizedCharacterID);
  const acceptedMissions = Object.values(
    (characterState && characterState.missionsByAgentID) || {},
  ).filter((missionRecord) => (
    normalizeText(missionRecord && missionRecord.runtimeStatus, "offered") === "accepted" &&
    isAgentObjectiveMissionRecord(missionRecord) &&
    normalizePositiveInteger(missionRecord && missionRecord.agentID, 0) !== normalizedTargetAgentID
  ));

  return acceptedMissions.find((missionRecord) => (
    getMissionConversationTargetAgentID(missionRecord) === normalizedTargetAgentID
  )) || null;
}

function buildAgentInteractionActionPayload(agentRecord, missionRecord, nextMissionID, optionIndex = 0) {
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  const nextMissionRecord = getMissionByID(nextMissionID);
  const optionMessageID = getMissionMessageID(
    clientMissionRecord,
    `messages.mission.option${optionIndex + 1}.charsays`,
  );
  const titleID = optionMessageID > 0
    ? optionMessageID
    : normalizePositiveInteger(nextMissionRecord && nextMissionRecord.nameID, 0);
  if (titleID <= 0) {
    return null;
  }
  return {
    "Mission ID": normalizeMissionContentID(missionRecord && missionRecord.contentID, null),
    "Mission Keywords": buildMissionKeywords(
      agentRecord,
      missionRecord,
      getRuntimeMissionTemplateRecord(missionRecord),
    ),
    "Mission Title ID": titleID,
    "Mission Briefing ID":
      getMissionMessageID(clientMissionRecord, "messages.mission.extrainfo.body") ||
      getMissionMessageID(nextMissionRecord, "messages.mission.briefing") ||
      null,
  };
}

function buildAgentInteractionActions(agentRecord, missionRecord) {
  if (!isAgentObjectiveMissionRecord(missionRecord)) {
    return [];
  }
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  if (!normalizeBoolean(clientMissionRecord && clientMissionRecord.isAgentInteraction, false)) {
    return [];
  }
  const nextMissionIDs = getMissionNextMissionIDs(missionRecord);
  return nextMissionIDs
    .map((nextMissionID, index) => {
      const payload = buildAgentInteractionActionPayload(
        agentRecord,
        missionRecord,
        nextMissionID,
        index,
      );
      if (!payload) {
        return null;
      }
      return [
        AGENT_INTERACTION_ACTION_ID_BASE + index,
        payload,
      ];
    })
    .filter(Boolean);
}

function advanceConversationMission(characterID, sourceMissionRecord, nextMissionID) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const normalizedNextMissionID = normalizeMissionContentID(nextMissionID, null);
  const sourceAgentRecord = getAgentRecord(sourceMissionRecord && sourceMissionRecord.agentID);
  if (!normalizedCharacterID || !sourceMissionRecord || !sourceAgentRecord) {
    return { success: false, errorMsg: "MISSION_NOT_FOUND" };
  }

  const markResult = setMissionObjectiveCompleted(
    normalizedCharacterID,
    sourceMissionRecord.agentID,
  );
  if (!markResult.success || !markResult.data) {
    return markResult.success ? { success: false, errorMsg: "MISSION_NOT_FOUND" } : markResult;
  }

  const completionResult = completeMission(normalizedCharacterID, sourceAgentRecord);
  if (!completionResult.success) {
    return completionResult;
  }

  notifyMissionChange(
    normalizedCharacterID,
    AGENT_MISSION_COMPLETED,
    normalizePositiveInteger(sourceMissionRecord.agentID, 0),
  );

  if (normalizedNextMissionID === null) {
    return {
      success: true,
      data: buildCompletedConversation(
        sourceAgentRecord,
        completionResult.data.missionRecord,
        getRuntimeMissionTemplateRecord(completionResult.data.missionRecord),
      ),
    };
  }

  const nextMissionRecord = getMissionByID(normalizedNextMissionID);
  const nextAgentID = normalizePositiveInteger(
    nextMissionRecord &&
      (nextMissionRecord.sourceAgentID || nextMissionRecord.targetAgentID),
    0,
  );
  const nextAgentRecord = getAgentRecord(nextAgentID);
  if (!nextMissionRecord || !nextAgentRecord) {
    return {
      success: true,
      data: buildCompletedConversation(
        sourceAgentRecord,
        completionResult.data.missionRecord,
        getRuntimeMissionTemplateRecord(completionResult.data.missionRecord),
      ),
    };
  }

  const offerResult = offerSpecificMission(
    normalizedCharacterID,
    nextAgentRecord,
    nextMissionRecord,
  );
  if (!offerResult.success || !offerResult.data || !offerResult.data.missionRecord) {
    return offerResult.success
      ? {
          success: true,
          data: buildIdleConversation(nextAgentRecord, normalizedCharacterID),
        }
      : offerResult;
  }

  notifyMissionChange(normalizedCharacterID, AGENT_MISSION_OFFERED, nextAgentID);
  return {
    success: true,
    data: buildOfferedConversation(
      nextAgentRecord,
      offerResult.data.missionRecord,
      getRuntimeMissionTemplateRecord(offerResult.data.missionRecord),
    ),
  };
}

function buildIdleConversation(agentRecord, characterID) {
  if (!canUseAgent(characterID, agentRecord)) {
    return {
      agentSays: [
        "Your current standings are not high enough for this agent to issue you a mission yet.",
        null,
      ],
      actions: [],
      lastActionInfo: buildDefaultMissionLastActionInfo(),
    };
  }

  return {
    agentSays: [
      "I have work available. Request a mission when you're ready.",
      null,
    ],
    actions: [
      [AGENT_DIALOGUE_BUTTON_REQUEST_MISSION, AGENT_DIALOGUE_BUTTON_REQUEST_MISSION],
    ],
    lastActionInfo: buildDefaultMissionLastActionInfo(),
  };
}

function buildCooldownConversation(replayUntilFileTime) {
  return {
    agentSays: [
      "I don't have another mission for you just yet. Come back after the replay timer has expired.",
      null,
    ],
    actions: [],
    lastActionInfo: buildDefaultMissionLastActionInfo({
      missionCantReplay: resolveReplayRemainingTicks(replayUntilFileTime),
    }),
  };
}

function buildOfferedConversation(agentRecord, missionRecord, missionTemplate) {
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  return {
    agentSays: buildConversationAgentSays(
      missionRecord,
      clientMissionRecord,
      [
        "messages.mission.offered.agentsays",
        "messages.mission.briefing",
      ],
      buildPlaceholderBriefing(agentRecord, missionRecord, missionTemplate),
    ),
    actions: [
      [AGENT_DIALOGUE_BUTTON_ACCEPT, AGENT_DIALOGUE_BUTTON_ACCEPT],
      [AGENT_DIALOGUE_BUTTON_DECLINE, AGENT_DIALOGUE_BUTTON_DECLINE],
    ],
    lastActionInfo: buildDefaultMissionLastActionInfo(),
  };
}

function buildAcceptedConversation(characterID, agentRecord, missionRecord, missionTemplate) {
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  const actions = [];
  const interactionActions = buildAgentInteractionActions(agentRecord, missionRecord);
  if (normalizeBoolean(missionRecord.objectiveCompleted, false)) {
    const completionActionID = isMissionRemoteCompletable(missionRecord, {
      characterID,
      agentRecord,
    })
      ? AGENT_DIALOGUE_BUTTON_COMPLETE_REMOTELY
      : AGENT_DIALOGUE_BUTTON_COMPLETE;
    actions.push([completionActionID, completionActionID]);
  }
  if (interactionActions.length > 0) {
    actions.push(...interactionActions);
  }
  actions.push([AGENT_DIALOGUE_BUTTON_VIEW_MISSION, AGENT_DIALOGUE_BUTTON_VIEW_MISSION]);

  return {
    agentSays: normalizeBoolean(missionRecord.objectiveCompleted, false)
      ? buildConversationAgentSays(
          missionRecord,
          clientMissionRecord,
          [
            "messages.mission.completed.agentsays",
            "messages.mission.completed.nextmission.agentsays",
            "messages.root.missioninprogress.agentsays",
            "messages.mission.accepted.agentsays",
          ],
          `${buildPlaceholderBriefing(agentRecord, missionRecord, missionTemplate)}<br><br>${MISSION_PLACEHOLDER_COMPLETE_NOTE}`,
        )
      : buildConversationAgentSays(
          missionRecord,
          clientMissionRecord,
          [
            "messages.root.missioninprogress.agentsays",
            "messages.mission.accepted.agentsays",
            "messages.mission.briefing",
          ],
          buildPlaceholderBriefing(agentRecord, missionRecord, missionTemplate),
        ),
    actions,
    lastActionInfo: buildDefaultMissionLastActionInfo(),
  };
}

function buildCompletedConversation(agentRecord, missionRecord, missionTemplate) {
  const clientMissionRecord = getClientMissionRecord(missionRecord);
  return {
    agentSays: buildConversationAgentSays(
      missionRecord,
      clientMissionRecord,
      [
        "messages.mission.completed.agentsays",
        "messages.mission.completed.nextmission.agentsays",
      ],
      `Mission complete. Rewards and standings have been applied for ${normalizeText(
        missionRecord && missionRecord.missionTitle,
        missionContentIDToText(missionRecord && missionRecord.contentID, ""),
      )}.`,
    ),
    actions: [],
    lastActionInfo: buildDefaultMissionLastActionInfo({
      missionCompleted: 1,
    }),
  };
}

function doAgentAction(characterID, agentID, actionID = null) {
  const normalizedCharacterID = normalizePositiveInteger(characterID, 0);
  const agentRecord = getAgentRecord(agentID);
  const characterRecord = getCharacterRecord(normalizedCharacterID);
  if (!normalizedCharacterID || !agentRecord || !characterRecord) {
    return {
      success: true,
      data: {
        agentSays: ["This agent is unavailable right now.", null],
        actions: [],
        lastActionInfo: buildDefaultMissionLastActionInfo(),
      },
    };
  }

  const normalizedActionID =
    actionID === null || actionID === undefined
      ? null
      : normalizeInteger(actionID, 0);
  const syncedMission = getMissionRecordForRead(normalizedCharacterID, agentID);
  const replayUntilFileTime = getReplayUntilFileTime(normalizedCharacterID, agentID);
  const replayTicks = resolveReplayRemainingTicks(replayUntilFileTime);
  const referredMission =
    !syncedMission
      ? findReferredConversationMission(normalizedCharacterID, agentID)
      : null;

  if (normalizedActionID === null) {
    if (referredMission) {
      return advanceConversationMission(
        normalizedCharacterID,
        referredMission,
        getMissionNextMissionIDs(referredMission)[0] ?? null,
      );
    }
    if (syncedMission) {
      const missionTemplate = getRuntimeMissionTemplateRecord(syncedMission);
      return {
        success: true,
        data:
          normalizeText(syncedMission.runtimeStatus, "offered") === "accepted"
            ? buildAcceptedConversation(
                normalizedCharacterID,
                agentRecord,
                syncedMission,
                missionTemplate,
              )
            : buildOfferedConversation(agentRecord, syncedMission, missionTemplate),
      };
    }
    if (replayTicks > 0) {
      return { success: true, data: buildCooldownConversation(replayUntilFileTime) };
    }
    return { success: true, data: buildIdleConversation(agentRecord, normalizedCharacterID) };
  }

  if (
    normalizedActionID === AGENT_DIALOGUE_BUTTON_REQUEST_MISSION ||
    normalizedActionID === AGENT_DIALOGUE_BUTTON_VIEW_MISSION
  ) {
    if (referredMission) {
      return advanceConversationMission(
        normalizedCharacterID,
        referredMission,
        getMissionNextMissionIDs(referredMission)[0] ?? null,
      );
    }
    if (syncedMission) {
      const missionTemplate = getRuntimeMissionTemplateRecord(syncedMission);
      return {
        success: true,
        data:
          normalizeText(syncedMission.runtimeStatus, "offered") === "accepted"
            ? buildAcceptedConversation(
                normalizedCharacterID,
                agentRecord,
                syncedMission,
                missionTemplate,
              )
            : buildOfferedConversation(agentRecord, syncedMission, missionTemplate),
      };
    }
    if (replayTicks > 0) {
      return { success: true, data: buildCooldownConversation(replayUntilFileTime) };
    }
    const offerResult = offerMission(normalizedCharacterID, agentRecord);
    const offeredPayload = offerResult.success ? offerResult.data : null;
    if (!offeredPayload || offeredPayload.kind === "cooldown") {
      return {
        success: true,
        data: buildCooldownConversation(
          offeredPayload && offeredPayload.replayUntilFileTime,
        ),
      };
    }
    if (!offeredPayload.missionRecord) {
      return { success: true, data: buildIdleConversation(agentRecord, normalizedCharacterID) };
    }
    notifyMissionChange(normalizedCharacterID, AGENT_MISSION_OFFERED, agentID);
    return {
      success: true,
      data: buildOfferedConversation(
        agentRecord,
        offeredPayload.missionRecord,
        getRuntimeMissionTemplateRecord(offeredPayload.missionRecord),
      ),
    };
  }

  if (
    normalizedActionID === AGENT_DIALOGUE_BUTTON_ACCEPT ||
    normalizedActionID === AGENT_DIALOGUE_BUTTON_ACCEPT_REMOTELY
  ) {
    const acceptResult = acceptMission(normalizedCharacterID, agentRecord);
    if (!acceptResult.success || !acceptResult.data) {
      return { success: true, data: buildIdleConversation(agentRecord, normalizedCharacterID) };
    }
    notifyMissionChange(normalizedCharacterID, AGENT_MISSION_ACCEPTED, agentID);
    return {
      success: true,
      data: buildAcceptedConversation(
        normalizedCharacterID,
        agentRecord,
        acceptResult.data,
        getRuntimeMissionTemplateRecord(acceptResult.data),
      ),
    };
  }

  if (normalizedActionID === AGENT_DIALOGUE_BUTTON_DECLINE) {
    const declineResult = clearMissionWithCooldown(
      normalizedCharacterID,
      agentRecord,
      "declined",
    );
    const replayUntil = declineResult.success && declineResult.data
      ? declineResult.data.replayUntilFileTime
      : replayUntilFileTime;
    notifyMissionChange(normalizedCharacterID, AGENT_MISSION_RESET, agentID);
    return {
      success: true,
      data: {
        ...buildCooldownConversation(replayUntil),
        lastActionInfo: buildDefaultMissionLastActionInfo({
          missionDeclined: 1,
          missionCantReplay: resolveReplayRemainingTicks(replayUntil),
        }),
      },
    };
  }

  if (
    syncedMission &&
    normalizedActionID >= AGENT_INTERACTION_ACTION_ID_BASE &&
    normalizedActionID < (AGENT_INTERACTION_ACTION_ID_BASE + 16)
  ) {
    const nextMissionIDs = getMissionNextMissionIDs(syncedMission);
    const nextMissionID = nextMissionIDs[normalizedActionID - AGENT_INTERACTION_ACTION_ID_BASE] ?? null;
    if (nextMissionID !== null) {
      return advanceConversationMission(
        normalizedCharacterID,
        syncedMission,
        nextMissionID,
      );
    }
  }

  if (
    normalizedActionID === AGENT_DIALOGUE_BUTTON_COMPLETE ||
    normalizedActionID === AGENT_DIALOGUE_BUTTON_COMPLETE_REMOTELY
  ) {
    const completeResult = completeMission(normalizedCharacterID, agentRecord);
    if (!completeResult.success) {
      const activeMission = getMissionRecord(normalizedCharacterID, agentID);
      if (activeMission) {
        return {
          success: true,
          data: buildAcceptedConversation(
            normalizedCharacterID,
            agentRecord,
            activeMission,
            getRuntimeMissionTemplateRecord(activeMission),
          ),
        };
      }
      return { success: true, data: buildIdleConversation(agentRecord, normalizedCharacterID) };
    }
    notifyMissionChange(normalizedCharacterID, AGENT_MISSION_COMPLETED, agentID);
    const completedMissionRecord = completeResult.data.missionRecord;
    return {
      success: true,
      data: buildCompletedConversation(
        agentRecord,
        completedMissionRecord,
        getRuntimeMissionTemplateRecord(completedMissionRecord),
      ),
    };
  }

  return { success: true, data: buildIdleConversation(agentRecord, normalizedCharacterID) };
}

module.exports = {
  AGENT_MISSION_ACCEPTED,
  AGENT_MISSION_COMPLETED,
  AGENT_MISSION_MODIFIED,
  AGENT_MISSION_OFFERED,
  AGENT_MISSION_OFFER_REMOVED,
  AGENT_MISSION_RESET,
  AGENT_MISSION_STATE_ACCEPTED,
  AGENT_MISSION_STATE_CANT_REPLAY,
  AGENT_MISSION_STATE_COMPLETED,
  AGENT_MISSION_STATE_OFFERED,
  AGENT_DIALOGUE_BUTTON_ACCEPT,
  AGENT_DIALOGUE_BUTTON_ACCEPT_REMOTELY,
  AGENT_DIALOGUE_BUTTON_COMPLETE,
  AGENT_DIALOGUE_BUTTON_COMPLETE_REMOTELY,
  AGENT_DIALOGUE_BUTTON_DECLINE,
  AGENT_DIALOGUE_BUTTON_REQUEST_MISSION,
  AGENT_DIALOGUE_BUTTON_VIEW_MISSION,
  MISSION_PLACEHOLDER_COMPLETE_NOTE,
  MISSION_PLACEHOLDER_NOTE,
  canUseAgent,
  doAgentAction,
  getAgentLocationWrap,
  getCompletedCareerAgentMap,
  getInfoServiceDetails,
  getJournalDetails,
  getMissionBriefingInfo,
  getMissionJournalInfo,
  getMissionKeywords,
  getMissionInfoItems,
  getMissionObjectiveInfo,
  getMissionRecord,
  getMissionStateFromRecord,
  getMissionTemplatePool,
  getAllMissionObjectives,
  getPlausibleMissionIDs,
  getReplayTimestamp,
  isSessionInActiveMissionDungeon,
  getSolarSystemOfAgent(agentID) {
    const agentRecord = getAgentRecord(agentID);
    return normalizePositiveInteger(agentRecord && agentRecord.solarSystemID, 0) || null;
  },
  getStandingGainsForMission,
  markMissionObjectiveComplete,
  removeOfferFromJournal,
};
