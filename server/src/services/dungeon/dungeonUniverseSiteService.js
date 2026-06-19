const fs = require("fs");
const path = require("path");
const { isDeepStrictEqual } = require("util");

const BaseService = require(path.join(__dirname, "../baseService"));
const dungeonAuthority = require(path.join(__dirname, "./dungeonAuthority"));
const dungeonRuntime = require(path.join(__dirname, "./dungeonRuntime"));
const explorationAuthority = require(path.join(__dirname, "../exploration/explorationAuthority"));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  grantItemsToOwnerLocation,
  findItemById,
  listContainerItems,
  ITEM_FLAGS,
  removeInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));

const COSMIC_SIGNATURE_TYPE_ID = 19_728;
const COSMIC_SIGNATURE_GROUP_ID = 502;
const COSMIC_ANOMALY_TYPE_ID = 28_356;
const COSMIC_ANOMALY_GROUP_ID = 885;
const SITE_CONTENT_CONTAINER_ID_BASE = 6_200_000_000_000;
const SITE_CONTENT_HAZARD_ID_BASE = 6_300_000_000_000;
const SITE_CONTENT_ENVIRONMENT_ID_BASE = 6_400_000_000_000;
const SITE_CONTENT_GATE_ID_BASE = 6_450_000_000_000;
const SITE_CONTENT_OBJECTIVE_ID_BASE = 6_500_000_000_000;
const SITE_CONTENT_ENCOUNTER_OFFSET_METERS = 25_000;
const SITE_CONTENT_REWARD_OFFSET_METERS = 16_000;
const SITE_CONTENT_CONTAINER_RING_METERS = 12_500;
const SITE_CONTENT_CONTAINER_JITTER_METERS = 3_500;
const SITE_CONTENT_MAX_CONTAINER_COUNT = 24;
const SITE_CONTENT_MAX_ENCOUNTER_NPCS = 8;
const SITE_CONTENT_MAX_HAZARD_COUNT = 6;
const SITE_CONTENT_MAX_ENVIRONMENT_PROPS = 8;
const SITE_CONTENT_MAX_GATE_COUNT = 6;
const SITE_CONTENT_MAX_OBJECTIVE_MARKERS = 6;
const SITE_CONTENT_MAX_LOOT_ENTRIES = 4;
const SITE_CONTENT_BEHAVIOR_TICK_INTERVAL_MS = 1_000;
const CLEARED_ANOMALY_ROTATION_DELAY_MS = 0;
const SITE_CONTENT_OWNER_ID = 1;
const SITE_CONTENT_SAFE_SLIM_CATEGORY_ID = 2;
const SITE_NAME_LOOKUP_PATH = path.join(
  __dirname,
  "../../../../tools/SignalAtlas/data/siteNameLookup.json",
);

let runtimeSyncStarted = false;
let registeredListener = null;
let siteBehaviorTicker = null;
let cachedGenericContainerType = undefined;
let cachedSiteNameLookup = undefined;
const cachedContainerTypeRecordByName = new Map();
const cachedGenericTypeRecordByName = new Map();
const cachedLootTypeRecordByName = new Map();

function buildSafeSitePropSlimOverrides(typeRecord = null) {
  const rawCategoryID = Math.max(0, toInt(typeRecord && typeRecord.categoryID, 0));
  if (![11, 23].includes(rawCategoryID)) {
    return {};
  }
  return {
    // These deadspace/ambient props use entity/starbase categories in CCP data,
    // but the packaged client's bracket/state paths then expect POS/entity
    // metadata we do not send for passive site dressing. Keep the real
    // type/graphic for rendering, but advertise a safe slim category.
    slimCategoryID: SITE_CONTENT_SAFE_SLIM_CATEGORY_ID,
  };
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function normalizeLowerText(value, fallback = "") {
  return normalizeText(value, fallback).toLowerCase();
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueSorted(values) {
  return [...new Set(normalizeArray(values).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right)));
}

function normalizeIDList(value) {
  return [...new Set(
    normalizeArray(value)
      .map((entry) => Math.max(0, toInt(entry, 0)))
      .filter((entry) => entry > 0),
  )].sort((left, right) => left - right);
}

function clonePosition(value) {
  return {
    x: toFiniteNumber(value && value.x, 0),
    y: toFiniteNumber(value && value.y, 0),
    z: toFiniteNumber(value && value.z, 0),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
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

function getNpcSpawnService() {
  return require(path.join(__dirname, "../../space/npc/npcService"));
}

function getScanMgrService() {
  return require(path.join(__dirname, "../exploration/scanMgrService"));
}

function getSiteNameLookup() {
  if (cachedSiteNameLookup !== undefined) {
    return cachedSiteNameLookup;
  }
  try {
    if (!fs.existsSync(SITE_NAME_LOOKUP_PATH)) {
      cachedSiteNameLookup = null;
      return cachedSiteNameLookup;
    }
    cachedSiteNameLookup = JSON.parse(fs.readFileSync(SITE_NAME_LOOKUP_PATH, "utf8"));
    return cachedSiteNameLookup;
  } catch (error) {
    cachedSiteNameLookup = null;
    return cachedSiteNameLookup;
  }
}

function resolveSiteFamilyLabel(family) {
  switch (normalizeLowerText(family, "unknown")) {
    case "combat":
      return "Combat";
    case "combat_hacking":
      return "Combat Hacking";
    case "data":
      return "Data";
    case "relic":
      return "Relic";
    case "ore":
      return "Ore";
    case "gas":
      return "Gas";
    case "ghost":
      return "Ghost";
    default:
      return "Site";
  }
}

function resolveFallbackStrengthAttribute(family) {
  switch (normalizeLowerText(family, "")) {
    case "ghost":
    case "combat_hacking":
      return explorationAuthority.getScanStrengthAttribute("data") || 208;
    default:
      return explorationAuthority.getScanStrengthAttribute(family) || 0;
  }
}

function resolveContainerRoleLabel(role) {
  switch (normalizeLowerText(role, "container")) {
    case "data":
      return "Data Cache";
    case "relic":
      return "Relic Cache";
    case "research":
      return "Research Cache";
    case "covert_research":
      return "Covert Research Cache";
    default:
      return "Site Container";
  }
}

function resolveHazardLabel(hazard) {
  switch (normalizeLowerText(hazard, "hazard")) {
    case "ghost_site_timer":
      return "Ghost Site Timer Beacon";
    case "ghost_site_explosion":
      return "Ghost Site Blast Zone";
    case "ghost_site_npc_response":
      return "Ghost Site Response Beacon";
    case "reservoir_sleeper_response_timer":
      return "Reservoir Sleeper Response Timer";
    default:
      return "Site Hazard Beacon";
  }
}

function splitLabelTail(value) {
  const normalized = normalizeText(value, "");
  if (!normalized) {
    return "";
  }
  const lastSegment = normalized.split("/").pop();
  return lastSegment || normalized;
}

function humanizeIdentifier(value, fallback = "") {
  const tail = splitLabelTail(value);
  const normalized = String(tail || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function resolveTypeRecordName(typeRecord, fallback = "") {
  return normalizeText(
    typeRecord && (typeRecord.name || typeRecord.typeName || typeRecord.slimName),
    fallback,
  );
}

function resolveLocalizedTemplateName(template) {
  if (normalizeText(template && template.resolvedName, "")) {
    return normalizeText(template && template.resolvedName, "");
  }
  const lookup = getSiteNameLookup();
  if (!lookup || typeof lookup !== "object") {
    return "";
  }
  const templateNamesByID =
    lookup && lookup.templateNamesByID && typeof lookup.templateNamesByID === "object"
      ? lookup.templateNamesByID
      : {};
  const dungeonNamesByMessageID =
    lookup && lookup.dungeonNamesByMessageID && typeof lookup.dungeonNamesByMessageID === "object"
      ? lookup.dungeonNamesByMessageID
      : {};
  const templateID = normalizeText(template && template.templateID, "");
  if (templateID && normalizeText(templateNamesByID[templateID], "")) {
    return normalizeText(templateNamesByID[templateID], "");
  }
  const dungeonNameID = Math.max(0, toInt(template && template.dungeonNameID, 0));
  if (dungeonNameID > 0 && normalizeText(dungeonNamesByMessageID[String(dungeonNameID)], "")) {
    return normalizeText(dungeonNamesByMessageID[String(dungeonNameID)], "");
  }
  return "";
}

function resolveGenericContainerTypeRecord() {
  if (cachedGenericContainerType !== undefined) {
    return cachedGenericContainerType;
  }
  const lookup = resolveItemByName("Cargo Container");
  cachedGenericContainerType = lookup && lookup.success && lookup.match
    ? lookup.match
    : null;
  return cachedGenericContainerType;
}

function resolveContainerTypeRecordByName(candidateNames) {
  for (const rawCandidate of normalizeArray(candidateNames)) {
    const candidate = normalizeText(rawCandidate, "");
    if (!candidate) {
      continue;
    }
    if (cachedContainerTypeRecordByName.has(candidate)) {
      return cachedContainerTypeRecordByName.get(candidate);
    }
    const lookup = resolveItemByName(candidate);
    const match = lookup && lookup.success && lookup.match
      ? lookup.match
      : null;
    cachedContainerTypeRecordByName.set(candidate, match);
    if (match) {
      return match;
    }
  }
  return null;
}

function resolveGenericTypeRecordByName(candidateNames) {
  for (const rawCandidate of normalizeArray(candidateNames)) {
    const candidate = normalizeText(rawCandidate, "");
    if (!candidate) {
      continue;
    }
    if (cachedGenericTypeRecordByName.has(candidate)) {
      return cachedGenericTypeRecordByName.get(candidate);
    }
    const lookup = resolveItemByName(candidate);
    const match = lookup && lookup.success && lookup.match
      ? lookup.match
      : null;
    cachedGenericTypeRecordByName.set(candidate, match);
    if (match) {
      return match;
    }
  }
  return null;
}

function resolveLootTypeRecordByName(candidateName) {
  const normalizedCandidate = normalizeText(candidateName, "");
  if (!normalizedCandidate) {
    return null;
  }
  if (cachedLootTypeRecordByName.has(normalizedCandidate)) {
    return cachedLootTypeRecordByName.get(normalizedCandidate);
  }
  const lookup = resolveItemByName(normalizedCandidate);
  const match = lookup && lookup.success && lookup.match
    ? lookup.match
    : null;
  cachedLootTypeRecordByName.set(normalizedCandidate, match);
  return match;
}

function resolveTypeHealthState(typeID) {
  const normalizedTypeID = Math.max(0, toInt(typeID, 0));
  if (normalizedTypeID <= 0) {
    return {
      shieldCapacity: 0,
      armorHP: 0,
      structureHP: 0,
      conditionState: {
        shieldCharge: 0,
        armorDamage: 0,
        damage: 0,
      },
    };
  }
  const shieldCapacity = Math.max(
    0,
    toFiniteNumber(getTypeAttributeValue(normalizedTypeID, "shieldCapacity"), 0),
  );
  const armorHP = Math.max(
    0,
    toFiniteNumber(getTypeAttributeValue(normalizedTypeID, "armorHP"), 0),
  );
  const structureHP = Math.max(
    0,
    toFiniteNumber(
      getTypeAttributeValue(normalizedTypeID, "hp", "structureHP"),
      0,
    ),
  );
  return {
    shieldCapacity,
    armorHP,
    structureHP,
    conditionState: {
      shieldCharge: shieldCapacity > 0 ? 1 : 0,
      armorDamage: 0,
      damage: 0,
    },
  };
}

function chooseDeterministicEntry(entries, seed) {
  const normalizedEntries = normalizeArray(entries).filter(Boolean);
  if (normalizedEntries.length <= 0) {
    return null;
  }
  const index = hashText(seed) % normalizedEntries.length;
  return normalizedEntries[index] || normalizedEntries[0] || null;
}

function resolveDeterministicQuantity(seed, minimum, maximum) {
  const normalizedMinimum = Math.max(1, toInt(minimum, 1));
  const normalizedMaximum = Math.max(normalizedMinimum, toInt(maximum, normalizedMinimum));
  if (normalizedMaximum <= normalizedMinimum) {
    return normalizedMinimum;
  }
  return normalizedMinimum + (hashText(seed) % ((normalizedMaximum - normalizedMinimum) + 1));
}

function mergeLootGrantEntries(entries) {
  const mergedByTypeID = new Map();
  for (const entry of normalizeArray(entries).filter(Boolean)) {
    const itemType = entry && entry.itemType ? entry.itemType : null;
    const typeID = Math.max(0, toInt(itemType && itemType.typeID, 0));
    if (typeID <= 0) {
      continue;
    }
    const quantity = Math.max(1, toInt(entry && entry.quantity, 1));
    if (!mergedByTypeID.has(typeID)) {
      mergedByTypeID.set(typeID, {
        itemType,
        quantity,
        options: cloneValue(entry && entry.options),
      });
      continue;
    }
    mergedByTypeID.get(typeID).quantity += quantity;
  }
  return [...mergedByTypeID.values()];
}

function resolveLootProfileDefinition(populationHints, profileKey) {
  const normalizedProfileKey = normalizeText(profileKey, "");
  if (!normalizedProfileKey) {
    return null;
  }
  return normalizeArray(populationHints && populationHints.lootProfiles)
    .find((profile) => normalizeText(profile && profile.key, "") === normalizedProfileKey) || null;
}

function resolveContainerLootTags(containerEntity, populationHints) {
  const explicitTags = normalizeArray(
    containerEntity &&
    (
      containerEntity.dungeonSiteContentLootTags ||
      containerEntity.lootTags
    ),
  )
    .map((tag) => normalizeLowerText(tag, ""))
    .filter(Boolean);
  if (explicitTags.length > 0) {
    return explicitTags;
  }
  const profile = resolveLootProfileDefinition(
    populationHints,
    normalizeText(
      containerEntity &&
      (
        containerEntity.dungeonSiteContentLootProfile ||
        containerEntity.lootProfile
      ),
      "",
    ),
  );
  return normalizeArray(profile && profile.tags)
    .map((tag) => normalizeLowerText(tag, ""))
    .filter(Boolean);
}

function resolveBoosterFamilyFromText(value) {
  const normalized = normalizeText(value, "").toLowerCase();
  const knownFamilies = [
    "Mindflood",
    "Exile",
    "Crash",
    "X-Instinct",
    "Sooth Sayer",
    "Blue Pill",
    "Drop",
    "Frentix",
  ];
  return knownFamilies.find((family) => normalized.includes(family.toLowerCase())) || "";
}

function resolvePreferredLootItem(candidateNames, seed) {
  const resolved = normalizeArray(candidateNames)
    .map((candidate) => resolveLootTypeRecordByName(candidate))
    .filter(Boolean);
  return chooseDeterministicEntry(resolved, seed);
}

function buildLootGrantEntry(itemType, quantity = 1, options = {}) {
  if (!itemType || Math.max(0, toInt(itemType.typeID, 0)) <= 0) {
    return null;
  }
  return {
    itemType,
    quantity: Math.max(1, toInt(quantity, 1)),
    options: cloneValue(options),
  };
}

function buildLootEntryFromNames(candidateNames, seed, minimum = 1, maximum = minimum, options = {}) {
  const itemType = resolvePreferredLootItem(candidateNames, seed);
  if (!itemType) {
    return null;
  }
  return buildLootGrantEntry(
    itemType,
    resolveDeterministicQuantity(seed, minimum, maximum),
    options,
  );
}

function buildBoosterLootGrantEntries(seed, tags, context = {}) {
  const siteLabel = normalizeText(
    context &&
    (
      context.template && context.template.resolvedName ||
      context.siteEntity && context.siteEntity.itemName
    ),
    "",
  );
  const preferredFamily = resolveBoosterFamilyFromText(siteLabel);
  const knownFamilies = [
    "Crash",
    "Exile",
    "Mindflood",
    "X-Instinct",
    "Sooth Sayer",
    "Blue Pill",
    "Drop",
    "Frentix",
  ];
  const orderedFamilies = uniqueSorted([
    preferredFamily,
    ...knownFamilies,
  ].filter(Boolean));
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "booster_bpc":
        entries.push(buildLootEntryFromNames(
          orderedFamilies.flatMap((family) => [
            `Standard ${family} Booster Blueprint`,
            `Improved ${family} Booster Blueprint`,
            `Strong ${family} Booster Blueprint`,
          ]),
          `${seed}:booster_bpc`,
        ));
        break;
      case "reaction_formula":
        entries.push(buildLootEntryFromNames(
          orderedFamilies.map((family) => `Standard ${family} Booster Reaction Formula`),
          `${seed}:reaction_formula`,
        ));
        break;
      case "skillbook":
        entries.push(buildLootEntryFromNames(
          [
            "Biology",
            "Drug Manufacturing",
            "Neurotoxin Recovery",
            "Neurotoxin Control",
          ],
          `${seed}:skillbook`,
        ));
        break;
      case "booster_commodity":
        entries.push(buildLootEntryFromNames(
          orderedFamilies.flatMap((family) => [
            `Standard ${family} Booster`,
            `Improved ${family} Booster`,
            `Synth ${family} Booster`,
          ]),
          `${seed}:booster_commodity`,
          1,
          2,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildSleeperLootGrantEntries(seed, tags) {
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "blue_loot":
        entries.push(buildLootEntryFromNames(
          [
            "Neural Network Analyzer",
            "Sleeper Data Library",
            "Sleeper Drone AI Nexus",
          ],
          `${seed}:blue_loot`,
          1,
          3,
        ));
        break;
      case "salvage":
        entries.push(buildLootEntryFromNames(
          [
            "Melted Nanoribbons",
            "Intact Armor Plates",
            "Tripped Power Circuit",
            "Burned Logic Circuit",
            "Charred Micro Circuit",
          ],
          `${seed}:salvage`,
          2,
          6,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildPirateDataLootGrantEntries(seed, tags) {
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "datacore":
        entries.push(buildLootEntryFromNames(
          [
            "Datacore - Electronic Engineering",
            "Datacore - Mechanical Engineering",
            "Datacore - Laser Physics",
            "Datacore - Rocket Science",
            "Datacore - Quantum Physics",
          ],
          `${seed}:datacore`,
          2,
          6,
        ));
        break;
      case "decryptor":
        entries.push(buildLootEntryFromNames(
          [
            "Accelerant Decryptor",
            "Attainment Decryptor",
            "Optimized Attainment Decryptor",
            "Process Decryptor",
            "Symmetry Decryptor",
          ],
          `${seed}:decryptor`,
        ));
        break;
      case "data_material":
        entries.push(buildLootEntryFromNames(
          [
            "Esoteric Data Interface",
          ],
          `${seed}:data_material`,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildPirateRelicLootGrantEntries(seed, tags) {
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "salvage":
        entries.push(buildLootEntryFromNames(
          [
            "Burned Logic Circuit",
            "Charred Micro Circuit",
            "Contaminated Nanite Compound",
            "Fried Interface Circuit",
            "Tripped Power Circuit",
          ],
          `${seed}:salvage`,
          2,
          7,
        ));
        break;
      case "relic_component":
        entries.push(buildLootEntryFromNames(
          [
            "Alloyed Tritanium Bar",
            "Armor Plates",
            "Intact Armor Plates",
            "Melted Nanoribbons",
          ],
          `${seed}:relic_component`,
          1,
          3,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildGhostResearchLootGrantEntries(seed, tags) {
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "datacore":
        entries.push(buildLootEntryFromNames(
          [
            "Datacore - Electronic Engineering",
            "Datacore - Quantum Physics",
            "Datacore - Mechanical Engineering",
          ],
          `${seed}:datacore`,
          2,
          5,
        ));
        break;
      case "decryptor":
        entries.push(buildLootEntryFromNames(
          [
            "Accelerant Decryptor",
            "Attainment Decryptor",
            "Optimized Attainment Decryptor",
            "Process Decryptor",
            "Symmetry Decryptor",
          ],
          `${seed}:decryptor`,
        ));
        break;
      case "research_component":
        entries.push(buildLootEntryFromNames(
          [
            "Esoteric Data Interface",
            "Neural Network Analyzer",
          ],
          `${seed}:research_component`,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildGenericDataLootGrantEntries(seed, tags) {
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "datacore":
        entries.push(buildLootEntryFromNames(
          [
            "Datacore - Electronic Engineering",
            "Datacore - Mechanical Engineering",
            "Datacore - Laser Physics",
            "Datacore - Gallentean Starship Engineering",
            "Datacore - Minmatar Starship Engineering",
          ],
          `${seed}:generic_datacore`,
          1,
          4,
        ));
        break;
      case "decryptor":
        entries.push(buildLootEntryFromNames(
          [
            "Accelerant Decryptor",
            "Attainment Decryptor",
            "Optimized Attainment Decryptor",
            "Process Decryptor",
            "Symmetry Decryptor",
          ],
          `${seed}:generic_decryptor`,
        ));
        break;
      case "data_material":
        entries.push(buildLootEntryFromNames(
          [
            "Esoteric Data Interface",
            "Occult Data Interface",
            "Incognito Data Interface",
            "Engagement Plan Data Chip",
          ],
          `${seed}:generic_data_material`,
          1,
          2,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildGenericRelicLootGrantEntries(seed, tags) {
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "salvage":
        entries.push(buildLootEntryFromNames(
          [
            "Burned Logic Circuit",
            "Charred Micro Circuit",
            "Fried Interface Circuit",
            "Tripped Power Circuit",
            "Contaminated Nanite Compound",
          ],
          `${seed}:generic_salvage`,
          2,
          7,
        ));
        break;
      case "relic_component":
        entries.push(buildLootEntryFromNames(
          [
            "Alloyed Tritanium Bar",
            "Armor Plates",
            "Intact Armor Plates",
            "Melted Nanoribbons",
            "Power Circuit",
          ],
          `${seed}:generic_relic_component`,
          1,
          3,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function resolveCombatLootFlavor(context = {}) {
  const label = normalizeLowerText(
    context &&
    (
      context.template && context.template.resolvedName ||
      context.siteEntity && context.siteEntity.itemName
    ),
    "",
  );
  if (label.includes("angel") || label.includes("cartel")) {
    return "angel";
  }
  if (label.includes("blood")) {
    return "blood";
  }
  if (label.includes("guristas") || label.includes("pith")) {
    return "guristas";
  }
  if (label.includes("sansha")) {
    return "sansha";
  }
  if (label.includes("serpentis")) {
    return "serpentis";
  }
  if (label.includes("drone")) {
    return "drone";
  }
  return "generic";
}

function buildCombatLootGrantEntries(seed, tags, context = {}, options = {}) {
  const flavor = resolveCombatLootFlavor(context);
  const flavorModules = {
    angel: ["Domination Gyrostabilizer", "Domination 10MN Afterburner"],
    blood: ["Dark Blood Heat Sink", "Dark Blood Cap Recharger"],
    guristas: ["Dread Guristas Ballistic Control System", "Dread Guristas 250mm Railgun"],
    sansha: ["True Sansha Heat Sink", "True Sansha Cap Recharger"],
    serpentis: ["Shadow Serpentis Magnetic Field Stabilizer", "Shadow Serpentis 10MN Afterburner"],
    drone: ["Drone Transceiver", "Drone Link Augmentor I"],
    generic: ["Domination Gyrostabilizer", "Dread Guristas Ballistic Control System", "True Sansha Heat Sink"],
  };
  const flavorTagItems = {
    angel: ["Domination Platinum Tag", "Domination EMP L"],
    blood: ["Dark Blood Brass Tag", "Dark Blood Gamma L"],
    guristas: ["Dread Guristas Brass Tag", "Dread Guristas Antimatter Charge L"],
    sansha: ["True Sansha Brass Tag", "True Sansha Heat Sink"],
    serpentis: ["Shadow Serpentis Bronze Tag", "Shadow Serpentis Magnetic Field Stabilizer"],
    drone: ["Drone Transceiver", "Charred Micro Circuit"],
    generic: ["Domination Platinum Tag", "Dread Guristas Brass Tag"],
  };
  const overseerTierCandidates = options.overseerTierCandidates && options.overseerTierCandidates.length > 0
    ? options.overseerTierCandidates
    : [
      "4th Tier Overseer's Personal Effects",
      "5th Tier Overseer's Personal Effects",
      "6th Tier Overseer's Personal Effects",
      "7th Tier Overseer's Personal Effects",
      "8th Tier Overseer's Personal Effects",
    ];
  const entries = [];
  for (const tag of normalizeArray(tags)) {
    switch (normalizeLowerText(tag, "")) {
      case "faction_module":
        entries.push(buildLootEntryFromNames(
          flavorModules[flavor] || flavorModules.generic,
          `${seed}:combat_module`,
        ));
        break;
      case "faction_ammo":
      case "pirate_tag":
        entries.push(buildLootEntryFromNames(
          flavorTagItems[flavor] || flavorTagItems.generic,
          `${seed}:combat_tag:${tag}`,
          1,
          2,
        ));
        break;
      case "overseer_effect":
        entries.push(buildLootEntryFromNames(
          overseerTierCandidates,
          `${seed}:overseer_effect`,
        ));
        break;
      case "drone_component":
        entries.push(buildLootEntryFromNames(
          [
            "Drone Transceiver",
            "Drone Parasitic Rovers",
            "Drone Cerebral Fragment",
          ],
          `${seed}:drone_component`,
          1,
          2,
        ));
        break;
      case "salvage":
        entries.push(buildLootEntryFromNames(
          [
            "Burned Logic Circuit",
            "Charred Micro Circuit",
            "Fried Interface Circuit",
            "Tripped Power Circuit",
          ],
          `${seed}:combat_salvage`,
          2,
          5,
        ));
        break;
      default:
        break;
    }
  }
  return mergeLootGrantEntries(entries.slice(0, SITE_CONTENT_MAX_LOOT_ENTRIES));
}

function buildLootGrantEntriesForContainer(containerEntity, populationHints, context = {}) {
  const profileKey = normalizeText(
    containerEntity &&
    (
      containerEntity.dungeonSiteContentLootProfile ||
      containerEntity.lootProfile
    ),
    "",
  );
  if (!profileKey) {
    return [];
  }
  const tags = resolveContainerLootTags(containerEntity, populationHints);
  const seedBase = normalizeText(
    containerEntity && containerEntity.dungeonSiteContentKey,
    `${profileKey}:${normalizeText(containerEntity && containerEntity.itemName, "container")}`,
  );
  switch (profileKey) {
    case "booster_site_loot":
      return buildBoosterLootGrantEntries(seedBase, tags, context);
    case "sleeper_blue_loot":
      return buildSleeperLootGrantEntries(seedBase, tags);
    case "generic_data_loot":
      return buildGenericDataLootGrantEntries(seedBase, tags);
    case "generic_relic_loot":
      return buildGenericRelicLootGrantEntries(seedBase, tags);
    case "generic_combat_hacking_loot":
      return buildBoosterLootGrantEntries(seedBase, tags, context);
    case "pirate_data_loot":
      return buildPirateDataLootGrantEntries(seedBase, tags);
    case "pirate_relic_loot":
      return buildPirateRelicLootGrantEntries(seedBase, tags);
    case "ghost_research_loot":
      return buildGhostResearchLootGrantEntries(seedBase, tags);
    case "pirate_combat_loot":
      return buildCombatLootGrantEntries(seedBase, tags, context, {
        overseerTierCandidates: [
          "2nd Tier Overseer's Personal Effects",
          "3rd Tier Overseer's Personal Effects",
          "4th Tier Overseer's Personal Effects",
          "5th Tier Overseer's Personal Effects",
        ],
      });
    case "combat_overseer_loot":
      return buildCombatLootGrantEntries(seedBase, tags, context, {
        overseerTierCandidates: [
          "6th Tier Overseer's Personal Effects",
          "7th Tier Overseer's Personal Effects",
          "8th Tier Overseer's Personal Effects",
          "9th Tier Overseer's Personal Effects",
          "10th Tier Overseer's Personal Effects",
        ],
      });
    default:
      return [];
  }
}

function resolveContainerTypeRecord(containerSpec) {
  const explicitTypeID = Math.max(0, toInt(containerSpec && containerSpec.typeID, 0));
  if (explicitTypeID > 0) {
    const explicitType = resolveItemByTypeID(explicitTypeID);
    if (explicitType) {
      return explicitType;
    }
  }
  const namedType = resolveContainerTypeRecordByName(containerSpec && containerSpec.typeNameCandidates);
  if (namedType) {
    return namedType;
  }
  return resolveGenericContainerTypeRecord();
}

function resolveContainerDisplayName(containerSpec, typeRecord, ordinal) {
  const explicitLabel = normalizeText(containerSpec && containerSpec.label, "");
  if (explicitLabel) {
    return explicitLabel;
  }
  const baseLabel = explicitLabel || resolveTypeRecordName(typeRecord, "");
  const fallbackLabel = resolveContainerRoleLabel(containerSpec && containerSpec.role);
  const displayLabel = baseLabel || fallbackLabel || "Site Container";
  return ordinal > 1 ? `${displayLabel} ${ordinal}` : displayLabel;
}

function buildMissionRoomKey(room = null, index = 0) {
  const roomID = normalizeText(room && room.roomId, "");
  if (roomID) {
    return `room:${roomID}`;
  }
  return index <= 0 ? "room:entry" : `room:mission_${index + 1}`;
}

function normalizeMissionSpawnCount(entry = null) {
  const count = normalizeObject(entry && entry.count);
  return Math.max(
    1,
    Math.min(
      SITE_CONTENT_MAX_ENCOUNTER_NPCS,
      toInt(count.max, toInt(count.min, 1)),
    ),
  );
}

const LEGACY_MISSION_NPC_FACTION_MAPPINGS = Object.freeze([
  Object.freeze({
    factionKey: "blood",
    profilePrefix: "parity_blood_raider_pulse_",
    patterns: [
      /\bcorpii\b/i,
      /\bcorpior\b/i,
      /\bcorpum\b/i,
      /\bcorpatis\b/i,
      /\bcorpus\b/i,
      /\bblood raider\b/i,
    ],
  }),
  Object.freeze({
    factionKey: "sansha",
    profilePrefix: "parity_sansha_pulse_",
    patterns: [
      /\bcentii\b/i,
      /\bcentior\b/i,
      /\bcentum\b/i,
      /\bcentus\b/i,
    ],
  }),
  Object.freeze({
    factionKey: "serpentis",
    profilePrefix: "parity_serpentis_blaster_",
    patterns: [
      /\bcoreli\b/i,
      /\bcorelior\b/i,
      /\bcorelum\b/i,
      /\bcorelatis\b/i,
      /\bcore grand admiral\b/i,
    ],
  }),
  Object.freeze({
    factionKey: "angel",
    profilePrefix: "parity_angel_autocannon_",
    patterns: [
      /\bgistii\b/i,
      /\bgistior\b/i,
      /\bgistum\b/i,
      /\bgistatis\b/i,
      /\bgist(?:\s|$)/i,
      /\bangel cartel\b/i,
    ],
  }),
  Object.freeze({
    factionKey: "guristas",
    profilePrefix: "parity_guristas_missile_",
    patterns: [
      /\bpithi\b/i,
      /\bpithior\b/i,
      /\bpithum\b/i,
      /\bpithatis\b/i,
      /\bpith(?:\s|$)/i,
    ],
  }),
]);

function resolveMissionSpawnHullClass(entry = null) {
  const text = [
    normalizeText(entry && entry.label, ""),
    normalizeText(entry && entry.raw, ""),
    ...normalizeArray(entry && entry.candidateNames)
      .map((value) => normalizeText(value, ""))
      .filter(Boolean),
  ]
    .join(" ")
    .toLowerCase();

  if (!text) {
    return "";
  }
  if (/\belite frigates?\b/.test(text)) {
    return "frigate";
  }
  if (/\bfrigates?\b/.test(text)) {
    return "frigate";
  }
  if (/\bdestroyers?\b/.test(text)) {
    return "destroyer";
  }
  if (/\bcruisers?\b/.test(text)) {
    return "cruiser";
  }
  if (/\bbattlecruisers?\b/.test(text)) {
    return "battlecruiser";
  }
  if (/\bbattleships?\b/.test(text)) {
    return "battleship";
  }
  return "";
}

function isLikelyNamedMissionNpcCandidate(candidate = "") {
  const normalized = normalizeText(candidate, "").toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    /\btrue\b/.test(normalized) ||
    /\bshadow\b/.test(normalized) ||
    /\bdread\b/.test(normalized) ||
    /\bdomination\b/.test(normalized) ||
    /\bdark blood\b/.test(normalized) ||
    /\bofficer\b/.test(normalized)
  );
}

function resolveLegacyMissionNpcSpawnQuery(entry = null) {
  const candidateNames = normalizeArray(entry && entry.candidateNames)
    .map((name) => normalizeText(name, ""))
    .filter(Boolean);
  if (candidateNames.some((candidate) => isLikelyNamedMissionNpcCandidate(candidate))) {
    return "";
  }

  const hullClass = resolveMissionSpawnHullClass(entry);
  if (!hullClass) {
    return "";
  }

  const searchText = [
    normalizeText(entry && entry.label, ""),
    normalizeText(entry && entry.raw, ""),
    ...candidateNames,
  ]
    .join(" ")
    .toLowerCase();

  for (const mapping of LEGACY_MISSION_NPC_FACTION_MAPPINGS) {
    if (mapping.patterns.some((pattern) => pattern.test(searchText))) {
      return `${mapping.profilePrefix}${hullClass}`;
    }
  }

  return "";
}

function normalizeMissionSpawnQuery(entry = null) {
  const candidateNames = normalizeArray(entry && entry.candidateNames)
    .map((name) => normalizeText(name, ""))
    .filter(Boolean);
  const label = normalizeText(entry && entry.label, "");
  const raw = normalizeText(entry && entry.raw, "");
  const legacyMissionSpawnQuery = resolveLegacyMissionNpcSpawnQuery(entry);
  if (legacyMissionSpawnQuery) {
    return legacyMissionSpawnQuery;
  }
  const candidates = [
    ...candidateNames,
    label,
    raw,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (!/\bfrigates?\b|\bcruisers?\b|\bbattlecruisers?\b|\bbattleships?\b|\belite frigates?\b/i.test(candidate)) {
      return candidate;
    }
  }
  const fallbackCandidate = candidates[0] || "";
  return fallbackCandidate.replace(/\b(Fighters|Frigates|Cruisers|Battlecruisers|Battleships)\b$/, (match) => (
    match.endsWith("s") ? match.slice(0, -1) : match
  ));
}

function buildMissionDerivedObjectiveMarkers(template) {
  const objectiveHints = normalizeArray(template && template.objectiveHints)
    .map((entry) => normalizeText(entry && (entry.label || entry.text || entry.raw || entry), ""))
    .filter(Boolean);
  const advisory = normalizeObject(template && template.advisory);
  const markers = objectiveHints.map((label, index) => ({
    role: index <= 0 ? "objective" : "task",
    label,
    analyzer: /\bhack|analyzer|databank|mainframe\b/i.test(label)
      ? "data"
      : /\bsalvage|relic|archaeolog/i.test(label)
        ? "relic"
        : null,
  }));
  if (markers.length <= 0) {
    markers.push({ role: "objective", label: "Complete mission objectives" });
  }
  if (normalizeText(advisory.webScramble, "")) {
    markers.push({ role: "task", label: "Watch for tackle ships" });
  }
  return markers;
}

function buildMissionDerivedEnvironmentProps(template) {
  const rooms = normalizeArray(template && template.rooms);
  const candidates = [];
  for (const room of rooms) {
    const entries = [
      ...normalizeArray(room && room.spawnEntries),
      ...normalizeArray(room && room.groups).flatMap((group) => normalizeArray(group && group.spawnEntries)),
    ];
    for (const entry of entries) {
      if (normalizeLowerText(entry && entry.entityKind, "") !== "structure") {
        continue;
      }
      const typeNameCandidates = [
        ...normalizeArray(entry && entry.candidateNames)
          .map((name) => normalizeText(name, ""))
          .filter(Boolean),
        normalizeText(entry && entry.label, ""),
      ].filter(Boolean);
      if (typeNameCandidates.length <= 0) {
        continue;
      }
      candidates.push({
        typeNameCandidates: [...new Set(typeNameCandidates)],
        label: normalizeText(entry && entry.label, "") || null,
      });
    }
  }
  return candidates;
}

function buildMissionDerivedEncounterPlans(template) {
  const rooms = normalizeArray(template && template.rooms);
  const encounterPlans = [];
  let waveIndex = 1;

  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
    const room = rooms[roomIndex];
    const roomKey = buildMissionRoomKey(room, roomIndex);
    const groups = normalizeArray(room && room.groups);
    const groupedEntries = groups.length > 0
      ? groups.map((group, index) => ({
          key: normalizeText(group && group.groupId, "") || `group_${index + 1}`,
          notes: normalizeArray(group && group.notes),
          spawnEntries: normalizeArray(group && group.spawnEntries),
        }))
      : [{
          key: "room",
          notes: normalizeArray(room && room.notes),
          spawnEntries: normalizeArray(room && room.spawnEntries),
        }];

    for (const group of groupedEntries) {
      const npcEntries = normalizeArray(group && group.spawnEntries)
        .filter((entry) => normalizeLowerText(entry && entry.entityKind, "") === "npc");
      if (npcEntries.length <= 0) {
        continue;
      }
      const trigger = waveIndex <= 1 ? "on_load" : "wave_cleared";
      for (let entryIndex = 0; entryIndex < npcEntries.length; entryIndex += 1) {
        const entry = npcEntries[entryIndex];
        const spawnQuery = normalizeMissionSpawnQuery(entry);
        if (!spawnQuery) {
          continue;
        }
        encounterPlans.push({
          key: normalizeText(
            `${roomKey}:${normalizeText(group && group.key, "group")}:${entryIndex + 1}`,
            `mission_wave_${waveIndex}_${entryIndex + 1}`,
          ).toLowerCase().replace(/[^a-z0-9:._-]+/g, "_"),
          label: normalizeText(entry && entry.label, "") || `Encounter Wave ${waveIndex}`,
          supported: true,
          spawnQuery,
          amount: normalizeMissionSpawnCount(entry),
          deadspace: true,
          trigger,
          waveIndex,
          roomKey,
          notes: normalizeArray(group && group.notes)
            .map((note) => normalizeText(note, ""))
            .filter(Boolean),
        });
      }
      waveIndex += 1;
    }
  }

  return encounterPlans;
}

function buildDerivedMissionPopulationHints(template) {
  if (normalizeLowerText(template && template.siteFamily, "") !== "mission") {
    return null;
  }
  const encounters = buildMissionDerivedEncounterPlans(template);
  const environmentProps = buildMissionDerivedEnvironmentProps(template);
  const objectiveMarkers = buildMissionDerivedObjectiveMarkers(template);
  return {
    source: "mission_runtime_derived",
    roomCount: normalizeArray(template && template.rooms).length,
    encounter:
      encounters.length === 1
        ? cloneValue(encounters[0])
        : null,
    encounters,
    environmentProps,
    objectiveMarkers,
  };
}

function mergeDerivedMissionPopulationHints(baseHints, derivedHints) {
  if (!derivedHints) {
    return baseHints ? cloneValue(baseHints) : null;
  }
  const merged = {
    ...(baseHints ? cloneValue(baseHints) : {}),
    source: normalizeText(
      baseHints && baseHints.source,
      normalizeText(derivedHints && derivedHints.source, "mission_runtime_derived"),
    ),
    roomCount: Math.max(
      toInt(baseHints && baseHints.roomCount, 0),
      toInt(derivedHints && derivedHints.roomCount, 0),
    ),
    encounter:
      normalizeObject(baseHints && baseHints.encounter).supported !== undefined
        ? cloneValue(baseHints.encounter)
        : cloneValue(derivedHints.encounter),
    encounters: [
      ...normalizeArray(baseHints && baseHints.encounters),
      ...normalizeArray(derivedHints && derivedHints.encounters),
    ],
    environmentProps: [
      ...normalizeArray(baseHints && baseHints.environmentProps),
      ...normalizeArray(derivedHints && derivedHints.environmentProps),
    ],
    objectiveMarkers: [
      ...normalizeArray(baseHints && baseHints.objectiveMarkers),
      ...normalizeArray(derivedHints && derivedHints.objectiveMarkers),
    ],
  };
  return merged;
}

function resolvePopulationHints(instance, template) {
  const spawnHints =
    instance &&
    instance.spawnState &&
    typeof instance.spawnState === "object" &&
    instance.spawnState.populationHints &&
    typeof instance.spawnState.populationHints === "object"
      ? instance.spawnState.populationHints
      : null;
  if (spawnHints) {
    return cloneValue(spawnHints);
  }
  const templateHints =
    template &&
    template.populationHints &&
    typeof template.populationHints === "object"
      ? template.populationHints
      : null;
  const baseHints = templateHints ? cloneValue(templateHints) : null;
  if (normalizeLowerText(template && template.siteFamily, "") !== "mission") {
    return baseHints;
  }
  return mergeDerivedMissionPopulationHints(baseHints, buildDerivedMissionPopulationHints(template));
}

function resolveEncounterPlans(populationHints) {
  const explicitPlans = normalizeArray(populationHints && populationHints.encounters)
    .filter((entry) => entry && typeof entry === "object");
  const fallbackPlan =
    populationHints &&
    populationHints.encounter &&
    typeof populationHints.encounter === "object"
      ? [populationHints.encounter]
      : [];
  const normalizedPlans = (explicitPlans.length > 0 ? explicitPlans : fallbackPlan)
    .map((entry, index) => ({
      key: normalizeText(entry && entry.key, "") || `encounter_${index + 1}`,
      label: normalizeText(entry && entry.label, "") || `Encounter ${index + 1}`,
      supported: entry && entry.supported !== false,
      spawnQuery: normalizeText(entry && entry.spawnQuery, ""),
      amount: Math.max(0, toInt(entry && entry.amount, 0)),
      deadspace: entry && entry.deadspace === true,
      trigger: normalizeLowerText(entry && entry.trigger, "on_load"),
      countdownSeconds: Math.max(0, toInt(entry && entry.countdownSeconds, 0)) || null,
      waveIndex: Math.max(1, toInt(entry && entry.waveIndex, index + 1)),
      prerequisiteKey: normalizeText(entry && entry.prerequisiteKey, "") || null,
      lootProfile: normalizeText(entry && entry.lootProfile, "") || null,
      lootTags: normalizeArray(entry && entry.lootTags)
        .map((tag) => normalizeLowerText(tag, ""))
        .filter(Boolean),
      notes: normalizeArray(entry && entry.notes)
        .map((note) => normalizeText(note, ""))
        .filter(Boolean),
      roomKey: normalizeText(entry && entry.roomKey, "") || null,
    }))
    .filter((entry) => entry.spawnQuery && entry.amount > 0);
  return normalizedPlans;
}

function listOrderedInstanceRoomKeys(instance) {
  const roomStatesByKey =
    instance &&
    instance.roomStatesByKey &&
    typeof instance.roomStatesByKey === "object"
      ? instance.roomStatesByKey
      : {};
  const dynamicRoomKeys = Object.keys(roomStatesByKey)
    .filter((roomKey) => roomKey && roomKey !== "room:entry")
    .sort((left, right) => toInt(left.split(":").pop(), 0) - toInt(right.split(":").pop(), 0));
  return ["room:entry", ...dynamicRoomKeys];
}

function listOrderedInstanceGateKeys(instance) {
  const gateStatesByKey =
    instance &&
    instance.gateStatesByKey &&
    typeof instance.gateStatesByKey === "object"
      ? instance.gateStatesByKey
      : {};
  return Object.keys(gateStatesByKey)
    .sort((left, right) => {
      const leftState = gateStatesByKey[left] || {};
      const rightState = gateStatesByKey[right] || {};
      return (
        toInt(leftState && leftState.metadata && leftState.metadata.connectionIndex, 0) -
        toInt(rightState && rightState.metadata && rightState.metadata.connectionIndex, 0)
      ) || left.localeCompare(right);
    });
}

function resolveEncounterRoomKey(instance, populationHints, encounterPlan) {
  const explicitRoomKey = normalizeText(encounterPlan && encounterPlan.roomKey, "");
  if (explicitRoomKey) {
    return explicitRoomKey;
  }
  const orderedRoomKeys = listOrderedInstanceRoomKeys(instance);
  if (orderedRoomKeys.length <= 1) {
    return "room:entry";
  }
  const orderedPlans = resolveEncounterPlans(populationHints)
    .sort((left, right) => (
      Math.max(1, toInt(left && left.waveIndex, 1)) - Math.max(1, toInt(right && right.waveIndex, 1))
    ) || normalizeText(left && left.key, "").localeCompare(normalizeText(right && right.key, "")));
  const planKey = normalizeText(encounterPlan && encounterPlan.key, "");
  const planIndex = Math.max(0, orderedPlans.findIndex((plan) => normalizeText(plan && plan.key, "") === planKey));
  const roomIndex = Math.min(
    orderedRoomKeys.length - 1,
    Math.floor((planIndex * orderedRoomKeys.length) / Math.max(1, orderedPlans.length)),
  );
  return orderedRoomKeys[roomIndex] || "room:entry";
}

function groupEncounterPlansByRoom(instance, populationHints) {
  const grouped = {};
  const orderedPlans = resolveEncounterPlans(populationHints)
    .sort((left, right) => (
      Math.max(1, toInt(left && left.waveIndex, 1)) - Math.max(1, toInt(right && right.waveIndex, 1))
    ) || normalizeText(left && left.key, "").localeCompare(normalizeText(right && right.key, "")));
  for (const plan of orderedPlans) {
    const roomKey = resolveEncounterRoomKey(instance, populationHints, plan);
    if (!grouped[roomKey]) {
      grouped[roomKey] = [];
    }
    grouped[roomKey].push(plan);
  }
  return grouped;
}

function getEncounterStateByKey(instance, planKey) {
  return normalizeObject(
    instance &&
    instance.spawnState &&
    instance.spawnState.encounterStatesByKey &&
    instance.spawnState.encounterStatesByKey[planKey],
  );
}

function areSortedNumberListsEqual(left, right) {
  const normalizedLeft = normalizeIDList(left);
  const normalizedRight = normalizeIDList(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  for (let index = 0; index < normalizedLeft.length; index += 1) {
    if (normalizedLeft[index] !== normalizedRight[index]) {
      return false;
    }
  }
  return true;
}

function upsertEncounterState(instanceID, planKey, patch = {}, options = {}) {
  const existing = dungeonRuntime.getInstance(instanceID);
  if (!existing) {
    return null;
  }
  const encounterStatesByKey = normalizeObject(
    existing.spawnState && existing.spawnState.encounterStatesByKey,
  );
  return dungeonRuntime.mergeSpawnState(instanceID, {
    encounterStatesByKey: {
      ...encounterStatesByKey,
      [planKey]: {
        ...normalizeObject(encounterStatesByKey[planKey]),
        ...(patch && typeof patch === "object" ? cloneValue(patch) : {}),
        key: planKey,
      },
    },
  }, options);
}

function resolveEncounterPrerequisiteKey(plans, encounterPlan) {
  const explicitKey = normalizeText(encounterPlan && encounterPlan.prerequisiteKey, "");
  if (explicitKey) {
    return explicitKey;
  }
  const priorPlans = normalizeArray(plans)
    .filter((plan) => (
      plan &&
      normalizeText(plan.key, "") &&
      normalizeText(plan.key, "") !== normalizeText(encounterPlan && encounterPlan.key, "") &&
      Math.max(1, toInt(plan.waveIndex, 1)) < Math.max(1, toInt(encounterPlan && encounterPlan.waveIndex, 1))
    ))
    .sort((left, right) => (
      Math.max(1, toInt(left && left.waveIndex, 1)) - Math.max(1, toInt(right && right.waveIndex, 1)) ||
      normalizeText(left && left.key, "").localeCompare(normalizeText(right && right.key, ""))
    ));
  return priorPlans.length > 0
    ? normalizeText(priorPlans[priorPlans.length - 1].key, "")
    : "";
}

function listAliveEncounterEntityIDs(scene, encounterState) {
  const seededEntityIDs = normalizeIDList(
    encounterState &&
    (
      encounterState.remainingEntityIDs ||
      encounterState.spawnedEntityIDs
    ),
  );
  if (!(scene && scene.dynamicEntities instanceof Map)) {
    return seededEntityIDs;
  }
  return seededEntityIDs.filter((entityID) => scene.dynamicEntities.has(entityID));
}

function syncEncounterStateProgress(scene, instance, plans, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let completedCount = 0;
  let updatedCount = 0;
  for (const plan of normalizeArray(plans)) {
    const planKey = normalizeText(plan && plan.key, "");
    if (!planKey) {
      continue;
    }
    const encounterState = getEncounterStateByKey(instance, planKey);
    const spawnedAtMs = Math.max(0, toInt(encounterState && encounterState.spawnedAtMs, 0));
    if (spawnedAtMs <= 0) {
      continue;
    }
    const completedAtMs = Math.max(0, toInt(encounterState && encounterState.completedAtMs, 0));
    const aliveEntityIDs = listAliveEncounterEntityIDs(scene, encounterState);
    const patch = {};
    if (!areSortedNumberListsEqual(encounterState && encounterState.remainingEntityIDs, aliveEntityIDs)) {
      patch.remainingEntityIDs = aliveEntityIDs;
    }
    if (aliveEntityIDs.length <= 0 && completedAtMs <= 0) {
      patch.completedAtMs = nowMs;
      completedCount += 1;
    }
    if (Object.keys(patch).length <= 0) {
      continue;
    }
    upsertEncounterState(instance.instanceID, planKey, patch, { nowMs });
    updatedCount += 1;
  }
  return {
    completedCount,
    updatedCount,
  };
}

function rehydrateMissingEncounterStates(scene, instance, populationHints, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let workingInstance = instance;
  let resetCount = 0;
  for (const plan of resolveEncounterPlans(populationHints)) {
    const planKey = normalizeText(plan && plan.key, "");
    if (!planKey) {
      continue;
    }
    const encounterState = getEncounterStateByKey(workingInstance, planKey);
    const spawnedAtMs = Math.max(0, toInt(encounterState && encounterState.spawnedAtMs, 0));
    const completedAtMs = Math.max(0, toInt(encounterState && encounterState.completedAtMs, 0));
    if (spawnedAtMs <= 0 || completedAtMs > 0) {
      continue;
    }
    const aliveEntityIDs = listAliveEncounterEntityIDs(scene, encounterState);
    if (aliveEntityIDs.length > 0) {
      if (!areSortedNumberListsEqual(encounterState && encounterState.remainingEntityIDs, aliveEntityIDs)) {
        workingInstance = upsertEncounterState(workingInstance.instanceID, planKey, {
          remainingEntityIDs: aliveEntityIDs,
        }, { nowMs });
      }
      continue;
    }
    workingInstance = upsertEncounterState(workingInstance.instanceID, planKey, {
      spawnedAtMs: 0,
      spawnCount: 0,
      spawnedEntityIDs: [],
      remainingEntityIDs: [],
      lastRehydratedAtMs: nowMs,
    }, { nowMs });
    resetCount += 1;
  }
  return {
    instance: workingInstance,
    resetCount,
  };
}

function resolveObjectiveLabel(objective, objectiveType) {
  return humanizeIdentifier(
    objective && objective.title,
    humanizeIdentifier(
      objectiveType && objectiveType.title,
      humanizeIdentifier(objective && objective.key, "Objective"),
    ),
  );
}

function resolveObjectiveTaskLabel(task, taskType) {
  return humanizeIdentifier(
    taskType && taskType.title,
    humanizeIdentifier(task && task.key, "Task"),
  );
}

function normalizeObjectiveMarkerHintEntries(entries) {
  const normalized = [];
  const seen = new Set();
  for (const entry of normalizeArray(entries)) {
    if (!(entry && typeof entry === "object")) {
      continue;
    }
    const role = normalizeLowerText(entry.role, "");
    const label = normalizeText(entry.label, "");
    if (!role || !label) {
      continue;
    }
    const analyzer = normalizeLowerText(entry.analyzer, "") || null;
    const icon = normalizeText(entry.icon, "") || null;
    const key = normalizeText(entry.key, "") ||
      label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const dedupeKey = `${role}:${label}:${analyzer || ""}:${icon || ""}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalized.push({
      role,
      label,
      objectiveKey: key,
      objectiveTypeID: null,
      objectiveTaskTypeID: null,
      icon,
      analyzer,
    });
  }
  return normalized;
}

function buildFallbackPopulationObjectiveMarkers(populationHints, template) {
  const family = normalizeLowerText(template && template.siteFamily, "unknown");
  const containers = normalizeArray(populationHints && populationHints.containers)
    .filter((entry) => entry && typeof entry === "object");
  const hazards = normalizeArray(populationHints && populationHints.hazards);
  const encounters = resolveEncounterPlans(populationHints);
  const resources =
    populationHints && populationHints.resources && typeof populationHints.resources === "object"
      ? populationHints.resources
      : {};
  const markers = [];
  switch (family) {
    case "data":
      markers.push(
        { role: "objective", label: "Hack research caches", analyzer: "data" },
        { role: "task", label: "Recover site intelligence", analyzer: "data" },
      );
      break;
    case "relic":
      markers.push(
        { role: "objective", label: "Recover archaeology caches", analyzer: "relic" },
        { role: "task", label: "Salvage relic materials", analyzer: "relic" },
      );
      break;
    case "ghost":
      markers.push(
        { role: "objective", label: "Hack covert research caches", analyzer: "data" },
        { role: "task", label: "Beat the response timer", analyzer: "data" },
      );
      break;
    case "combat":
      markers.push({ role: "objective", label: "Eliminate hostile defenders" });
      break;
    case "combat_hacking":
      markers.push(
        { role: "objective", label: "Hack the facility network", analyzer: "data" },
        { role: "task", label: "Defeat security reinforcements" },
      );
      break;
    case "gas":
      markers.push({ role: "objective", label: "Harvest gas clouds" });
      break;
    case "ore":
      markers.push({ role: "objective", label: "Mine resource deposits" });
      break;
    default:
      break;
  }
  if (
    encounters.length > 0 &&
    family !== "combat"
  ) {
    markers.push({ role: "task", label: "Neutralize site defenders" });
  }
  if (hazards.some((entry) => normalizeLowerText(entry && entry.kind || entry, "").includes("ghost_site"))) {
    markers.push({ role: "task", label: "Avoid cache detonation", analyzer: "data" });
  }
  if (containers.some((entry) => normalizeLowerText(entry && entry.analyzer, "") === "data")) {
    markers.push({ role: "task", label: "Open data containers", analyzer: "data" });
  }
  if (containers.some((entry) => normalizeLowerText(entry && entry.analyzer, "") === "relic")) {
    markers.push({ role: "task", label: "Open relic containers", analyzer: "relic" });
  }
  if (normalizeArray(resources.gasTypeIDs).length > 0 && family !== "gas") {
    markers.push({ role: "task", label: "Harvest gas resources" });
  }
  if (
    normalizeArray(resources.oreTypeIDs).length > 0 ||
    normalizeArray(resources.iceTypeIDs).length > 0
  ) {
    markers.push({ role: "task", label: "Extract mineable resources" });
  }
  return normalizeObjectiveMarkerHintEntries(markers);
}

function resolvePopulationObjectiveMarkers(populationHints, template) {
  const explicitMarkers = normalizeObjectiveMarkerHintEntries(
    populationHints && populationHints.objectiveMarkers,
  );
  if (explicitMarkers.length > 0) {
    return explicitMarkers;
  }
  return buildFallbackPopulationObjectiveMarkers(populationHints, template);
}

function buildContentOffset(seed, index, total, options = {}) {
  const baseDistance = Math.max(
    2500,
    toFiniteNumber(options.baseDistanceMeters, SITE_CONTENT_CONTAINER_RING_METERS),
  );
  const jitterMeters = Math.max(
    0,
    toFiniteNumber(options.jitterMeters, SITE_CONTENT_CONTAINER_JITTER_METERS),
  );
  const count = Math.max(1, toInt(total, 1));
  const angleBase = ((index % count) / count) * Math.PI * 2;
  const angleJitter = ((hashText(`${seed}:angle:${index}`) % 2001) - 1000) / 1000 * 0.18;
  const distance = baseDistance +
    ((((hashText(`${seed}:distance:${index}`) % 2001) - 1000) / 1000) * jitterMeters);
  const vertical = ((((hashText(`${seed}:vertical:${index}`) % 2001) - 1000) / 1000) * 1200);
  const angle = angleBase + angleJitter;
  return {
    x: Math.cos(angle) * distance,
    y: vertical,
    z: Math.sin(angle) * distance,
  };
}

function isManagedUniverseSiteInstance(instance) {
  return Boolean(
    instance &&
    instance.runtimeFlags &&
    instance.runtimeFlags.universeSeeded === true &&
    instance.runtimeFlags.generatedMining !== true &&
    (
      normalizeLowerText(instance.siteKind, "signature") === "signature" ||
      normalizeLowerText(instance.siteKind, "signature") === "anomaly"
    ),
  );
}

function isManagedMissionSiteInstance(instance) {
  return Boolean(
    instance &&
    instance.runtimeFlags &&
    instance.runtimeFlags.missionRuntime === true,
  );
}

function isManagedMaterializedSiteInstance(instance) {
  return isManagedUniverseSiteInstance(instance) || isManagedMissionSiteInstance(instance);
}

function resolveEntityLabel(instance, template) {
  const metadata = instance && instance.metadata && typeof instance.metadata === "object"
    ? instance.metadata
    : {};
  const spawnState = instance && instance.spawnState && typeof instance.spawnState === "object"
    ? instance.spawnState
    : {};
  return normalizeText(
    metadata.label,
    normalizeText(
      resolveLocalizedTemplateName(template),
      normalizeText(
      spawnState.label,
      `${resolveSiteFamilyLabel(instance && instance.siteFamily)} Site ${
        Math.max(0, toInt(template && template.sourceDungeonID, 0)) ||
        Math.max(0, toInt(template && template.dungeonNameID, 0)) ||
        Math.max(0, toInt(instance && instance.instanceID, 0))
      }`,
      ),
    ),
  );
}

function buildSiteEntity(instance) {
  if (!isManagedMaterializedSiteInstance(instance)) {
    return null;
  }
  const template = dungeonAuthority.getTemplateByID(instance.templateID);
  const siteKind = normalizeLowerText(instance && instance.siteKind, "signature");
  const entryObjectTypeID = Math.max(
    0,
    toInt(
      instance && instance.entryObjectTypeID,
      template && template.entryObjectTypeID,
    ),
  ) || (siteKind === "anomaly" ? COSMIC_ANOMALY_TYPE_ID : COSMIC_SIGNATURE_TYPE_ID);
  const typeRecord = resolveItemByTypeID(entryObjectTypeID) || null;
  const family = normalizeLowerText(instance && instance.siteFamily, "unknown");
  const label = resolveEntityLabel(instance, template);
  const position = clonePosition(instance && instance.position);
  const strengthAttributeID = resolveFallbackStrengthAttribute(family);
  const groupID = siteKind === "anomaly" ? COSMIC_ANOMALY_GROUP_ID : COSMIC_SIGNATURE_GROUP_ID;
  const populationHints = resolvePopulationHints(instance, template);
  const encounterPlans = resolveEncounterPlans(populationHints);

  if (isManagedMissionSiteInstance(instance)) {
    return {
      kind: "missionSite",
      itemID: Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0)) ||
        Math.max(0, toInt(instance && instance.instanceID, 0)),
      typeID: toInt(typeRecord && typeRecord.typeID, entryObjectTypeID),
      groupID: toInt(typeRecord && typeRecord.groupID, groupID) || groupID,
      categoryID: toInt(typeRecord && typeRecord.categoryID, 16) || 16,
      graphicID: toInt(typeRecord && typeRecord.graphicID, 0) || null,
      ownerID: 1,
      itemName: label,
      slimName: label,
      position,
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(1_000, toFiniteNumber(typeRecord && typeRecord.radius, 2_000)),
      staticVisibilityScope: "bubble",
      dungeonID: toInt(instance && instance.sourceDungeonID, 0) || null,
      dungeonNameID: toInt(instance && instance.dungeonNameID, 0) || null,
      archetypeID: toInt(instance && instance.archetypeID, 0) || null,
      factionID: toInt(instance && instance.factionID, 0) || null,
      entryObjectTypeID,
      dungeonEncounterPlanCount: encounterPlans.length,
      dungeonLootProfiles: normalizeArray(populationHints && populationHints.lootProfiles),
    };
  }

  return {
    kind: siteKind === "anomaly" ? "universeAnomalySite" : "universeSignatureSite",
    signalTrackerUniverseSeededSite: true,
    signalTrackerSiteKind: siteKind,
    signalTrackerSiteFamily: family,
    signalTrackerSiteTemplateID: normalizeText(instance && instance.templateID, "") || null,
    signalTrackerSiteLabel: label,
    signalTrackerSiteDifficulty: Math.max(1, toInt(instance && instance.difficulty, 1)),
    signalTrackerSiteGroupID: groupID,
    signalTrackerSiteTypeID: toInt(typeRecord && typeRecord.typeID, entryObjectTypeID),
    signalTrackerEntryObjectTypeID: entryObjectTypeID,
    signalTrackerStrengthAttributeID: strengthAttributeID > 0 ? strengthAttributeID : null,
    signalTrackerAllowedTypes: [],
    signalTrackerAnomalySite: siteKind === "anomaly",
    signalTrackerAnomalySiteFamily: siteKind === "anomaly" ? family : undefined,
    signalTrackerSignatureSite: siteKind === "signature",
    signalTrackerSignatureSiteFamily: siteKind === "signature" ? family : undefined,
    itemID: Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0)) ||
      Math.max(0, toInt(instance && instance.instanceID, 0)),
    typeID: toInt(typeRecord && typeRecord.typeID, entryObjectTypeID),
    groupID: toInt(typeRecord && typeRecord.groupID, groupID) || groupID,
    categoryID: toInt(typeRecord && typeRecord.categoryID, 16) || 16,
    graphicID: toInt(typeRecord && typeRecord.graphicID, 0) || null,
    ownerID: 1,
    itemName: label,
    slimName: label,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: Math.max(1_000, toFiniteNumber(typeRecord && typeRecord.radius, 2_000)),
    staticVisibilityScope: "bubble",
    dungeonID: toInt(instance && instance.sourceDungeonID, 0) || null,
    dungeonNameID: toInt(instance && instance.dungeonNameID, 0) || null,
    archetypeID: toInt(instance && instance.archetypeID, 0) || null,
    factionID: toInt(instance && instance.factionID, 0) || null,
    entryObjectTypeID,
    dungeonEncounterPlanCount: encounterPlans.length,
    dungeonLootProfiles: normalizeArray(populationHints && populationHints.lootProfiles),
  };
}

function buildStableUniverseSiteEntitySignature(entity) {
  if (!entity || typeof entity !== "object") {
    return "";
  }
  return JSON.stringify({
    kind: normalizeText(entity.kind, ""),
    signalTrackerUniverseSeededSite: entity.signalTrackerUniverseSeededSite === true,
    signalTrackerSiteKind: normalizeLowerText(entity.signalTrackerSiteKind, ""),
    signalTrackerSiteFamily: normalizeLowerText(entity.signalTrackerSiteFamily, ""),
    signalTrackerSiteTemplateID: normalizeText(entity.signalTrackerSiteTemplateID, ""),
    signalTrackerSiteLabel: normalizeText(entity.signalTrackerSiteLabel, ""),
    signalTrackerSiteDifficulty: Math.max(1, toInt(entity.signalTrackerSiteDifficulty, 1)),
    signalTrackerSiteGroupID: Math.max(0, toInt(entity.signalTrackerSiteGroupID, 0)),
    signalTrackerSiteTypeID: Math.max(0, toInt(entity.signalTrackerSiteTypeID, 0)),
    signalTrackerEntryObjectTypeID: Math.max(0, toInt(entity.signalTrackerEntryObjectTypeID, 0)),
    signalTrackerStrengthAttributeID: Math.max(0, toInt(entity.signalTrackerStrengthAttributeID, 0)) || null,
    signalTrackerAllowedTypes: normalizeArray(entity.signalTrackerAllowedTypes),
    signalTrackerAnomalySite: entity.signalTrackerAnomalySite === true,
    signalTrackerAnomalySiteFamily: normalizeLowerText(entity.signalTrackerAnomalySiteFamily, ""),
    signalTrackerSignatureSite: entity.signalTrackerSignatureSite === true,
    signalTrackerSignatureSiteFamily: normalizeLowerText(entity.signalTrackerSignatureSiteFamily, ""),
    itemID: Math.max(0, toInt(entity.itemID, 0)),
    typeID: Math.max(0, toInt(entity.typeID, 0)),
    groupID: Math.max(0, toInt(entity.groupID, 0)),
    categoryID: Math.max(0, toInt(entity.categoryID, 0)),
    graphicID: Math.max(0, toInt(entity.graphicID, 0)) || null,
    ownerID: Math.max(0, toInt(entity.ownerID, 0)),
    itemName: normalizeText(entity.itemName, ""),
    slimName: normalizeText(entity.slimName, ""),
    position: clonePosition(entity.position),
    velocity: clonePosition(entity.velocity),
    direction: clonePosition(entity.direction),
    radius: Math.max(0, toFiniteNumber(entity.radius, 0)),
    staticVisibilityScope: normalizeLowerText(entity.staticVisibilityScope, ""),
    dungeonID: Math.max(0, toInt(entity.dungeonID, 0)) || null,
    dungeonNameID: Math.max(0, toInt(entity.dungeonNameID, 0)) || null,
    archetypeID: Math.max(0, toInt(entity.archetypeID, 0)) || null,
    factionID: Math.max(0, toInt(entity.factionID, 0)) || null,
    entryObjectTypeID: Math.max(0, toInt(entity.entryObjectTypeID, 0)) || null,
    dungeonEncounterPlanCount: Math.max(0, toInt(entity.dungeonEncounterPlanCount, 0)),
    dungeonLootProfiles: normalizeArray(entity.dungeonLootProfiles),
  });
}

function listMaterializedUniverseSiteEntities(scene) {
  return (Array.isArray(scene && scene.staticEntities) ? scene.staticEntities : [])
    .filter((entity) => entity && entity.signalTrackerUniverseSeededSite === true);
}

function ensureSceneMaterializedSiteSet(scene) {
  if (!scene) {
    return new Set();
  }
  if (!(scene._dungeonUniverseMaterializedSiteIDs instanceof Set)) {
    scene._dungeonUniverseMaterializedSiteIDs = new Set();
  }
  return scene._dungeonUniverseMaterializedSiteIDs;
}

function ensureSceneMaterializedSiteInstanceMap(scene) {
  if (!scene) {
    return new Map();
  }
  if (!(scene._dungeonUniverseMaterializedInstanceIDsBySiteID instanceof Map)) {
    scene._dungeonUniverseMaterializedInstanceIDsBySiteID = new Map();
  }
  return scene._dungeonUniverseMaterializedInstanceIDsBySiteID;
}

function markSceneSiteMaterialized(scene, siteID, instanceID = null) {
  const numericSiteID = Math.max(0, toInt(siteID, 0));
  if (numericSiteID <= 0 || !scene) {
    return false;
  }
  ensureSceneMaterializedSiteSet(scene).add(numericSiteID);
  const numericInstanceID = Math.max(0, toInt(instanceID, 0));
  if (numericInstanceID > 0) {
    ensureSceneMaterializedSiteInstanceMap(scene).set(numericSiteID, numericInstanceID);
  }
  return true;
}

function unmarkSceneSiteMaterialized(scene, siteID) {
  const numericSiteID = Math.max(0, toInt(siteID, 0));
  if (numericSiteID <= 0 || !scene) {
    return false;
  }
  ensureSceneMaterializedSiteInstanceMap(scene).delete(numericSiteID);
  return ensureSceneMaterializedSiteSet(scene).delete(numericSiteID);
}

function isSceneSiteMaterialized(scene, siteID) {
  const numericSiteID = Math.max(0, toInt(siteID, 0));
  if (numericSiteID <= 0 || !scene) {
    return false;
  }
  return ensureSceneMaterializedSiteSet(scene).has(numericSiteID);
}

function resolveManagedUniverseSiteInstance(scene, instanceOrSite, options = {}) {
  const systemID = Math.max(0, toInt(options.systemID, toInt(scene && scene.systemID, 0)));
  if (systemID <= 0) {
    return null;
  }

  if (instanceOrSite && typeof instanceOrSite === "object") {
    const candidateInstanceID = Math.max(0, toInt(instanceOrSite.instanceID, 0));
    if (candidateInstanceID > 0) {
      const directInstance = dungeonRuntime.getInstance(candidateInstanceID);
      if (
        directInstance &&
        isManagedMaterializedSiteInstance(directInstance) &&
        Math.max(0, toInt(directInstance.solarSystemID, 0)) === systemID
      ) {
        return directInstance;
      }
    }
    if (isManagedMaterializedSiteInstance(instanceOrSite)) {
      const candidateSystemID = Math.max(0, toInt(instanceOrSite.solarSystemID, 0));
      if (!candidateSystemID || candidateSystemID === systemID) {
        return instanceOrSite;
      }
    }
  }

  const numericSiteID = Math.max(
    0,
    toInt(
      options.siteID,
      instanceOrSite && (
        instanceOrSite.siteID ||
        instanceOrSite.itemID ||
        (instanceOrSite.metadata && instanceOrSite.metadata.siteID)
      ),
    ),
  );
  if (numericSiteID <= 0) {
    return null;
  }

  const trackedInstanceID = Math.max(
    0,
    toInt(ensureSceneMaterializedSiteInstanceMap(scene).get(numericSiteID), 0),
  );
  if (trackedInstanceID > 0) {
    const trackedInstance = dungeonRuntime.getInstance(trackedInstanceID);
    if (
      trackedInstance &&
      isManagedMaterializedSiteInstance(trackedInstance) &&
      Math.max(0, toInt(trackedInstance && trackedInstance.solarSystemID, 0)) === systemID
    ) {
      return trackedInstance;
    }
    ensureSceneMaterializedSiteInstanceMap(scene).delete(numericSiteID);
  }

  return dungeonRuntime.listActiveInstancesBySystem(systemID, {
    full: true,
  }).find((instance) => (
    isManagedMaterializedSiteInstance(instance) &&
    Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0)) === numericSiteID
  )) || null;
}

function listMaterializedUniverseSiteContentEntities(scene, options = {}) {
  const numericSiteID = Math.max(0, toInt(options.siteID, 0));
  const numericInstanceID = Math.max(0, toInt(options.instanceID, 0));
  const staticEntities = Array.isArray(scene && scene.staticEntities) ? scene.staticEntities : [];
  const dynamicEntities = scene && scene.dynamicEntities instanceof Map
    ? [...scene.dynamicEntities.values()]
    : [];
  return [...staticEntities, ...dynamicEntities]
    .filter((entity) => entity && entity.dungeonMaterializedSiteContent === true)
    .filter((entity) => (
      (!numericSiteID || toInt(entity && entity.dungeonSiteID, 0) === numericSiteID) &&
      (!numericInstanceID || toInt(entity && entity.dungeonSiteInstanceID, 0) === numericInstanceID)
    ));
}

function listMaterializedUniverseSiteStaticContentEntities(scene, options = {}) {
  return listMaterializedUniverseSiteContentEntities(scene, options)
    .filter((entity) => (
      entity &&
      scene &&
      scene.staticEntitiesByID instanceof Map &&
      scene.staticEntitiesByID.has(toInt(entity && entity.itemID, 0))
    ));
}

function forceResyncSiteStaticContentForSession(scene, session, instanceOrSite, options = {}) {
  if (
    !scene ||
    !session ||
    !session._space ||
    typeof scene.syncStaticVisibilityForSession !== "function"
  ) {
    return false;
  }

  let instance = resolveManagedUniverseSiteInstance(scene, instanceOrSite, options);
  if (!instance) {
    return false;
  }
  instance = dungeonRuntime.ensureTemplateRuntimeState(
    Math.max(0, toInt(instance && instance.instanceID, 0)),
    {
      nowMs: options.nowMs,
    },
  ) || instance;

  const siteID = Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0));
  if (siteID <= 0) {
    return false;
  }

  const staticContentEntities = listMaterializedUniverseSiteStaticContentEntities(scene, {
    siteID,
    instanceID: Math.max(0, toInt(instance && instance.instanceID, 0)),
  });
  if (staticContentEntities.length <= 0) {
    return false;
  }

  const visibleStaticIDs =
    session._space.visibleBubbleScopedStaticEntityIDs instanceof Set
      ? new Set(session._space.visibleBubbleScopedStaticEntityIDs)
      : new Set();
  let missingCount = 0;
  for (const entity of staticContentEntities) {
    const entityID = Math.max(0, toInt(entity && entity.itemID, 0));
    if (entityID > 0 && !visibleStaticIDs.has(entityID)) {
      visibleStaticIDs.delete(entityID);
      missingCount += 1;
    }
  }
  if (missingCount <= 0) {
    return false;
  }
  session._space.visibleBubbleScopedStaticEntityIDs = visibleStaticIDs;
  scene.syncStaticVisibilityForSession(
    session,
    options.nowMs === undefined || options.nowMs === null
      ? undefined
      : options.nowMs,
    options,
  );
  return true;
}

function getContentEntityRefsByKey(instance) {
  return normalizeObject(
    instance &&
    instance.spawnState &&
    instance.spawnState.contentEntityRefsByKey,
  );
}

function upsertContentEntityRef(instanceID, contentKey, patch = {}, options = {}) {
  const normalizedContentKey = normalizeText(contentKey, "");
  if (!normalizedContentKey) {
    return null;
  }
  const existing = dungeonRuntime.getInstance(instanceID);
  if (!existing) {
    return null;
  }
  const contentEntityRefsByKey = getContentEntityRefsByKey(existing);
  return dungeonRuntime.mergeSpawnState(instanceID, {
    contentEntityRefsByKey: {
      ...contentEntityRefsByKey,
      [normalizedContentKey]: {
        ...normalizeObject(contentEntityRefsByKey[normalizedContentKey]),
        ...(patch && typeof patch === "object" ? cloneValue(patch) : {}),
        contentKey: normalizedContentKey,
      },
    },
  }, options);
}

function annotateMaterializedContainerEntity(entity, containerEntity) {
  if (!entity || !containerEntity) {
    return entity;
  }
  entity.dungeonMaterializedSiteContent = true;
  entity.dungeonMaterializedContainer = true;
  entity.dungeonSiteID = toInt(containerEntity && containerEntity.dungeonSiteID, 0);
  entity.dungeonSiteInstanceID = toInt(containerEntity && containerEntity.dungeonSiteInstanceID, 0);
  entity.dungeonSiteContentKey = normalizeText(containerEntity && containerEntity.dungeonSiteContentKey, "");
  entity.dungeonSiteContentRole = normalizeLowerText(containerEntity && containerEntity.dungeonSiteContentRole, "container");
  entity.dungeonSiteContentAnalyzer = normalizeLowerText(containerEntity && containerEntity.dungeonSiteContentAnalyzer, "") || null;
  entity.dungeonSiteContentBonus = containerEntity && containerEntity.dungeonSiteContentBonus === true;
  entity.dungeonSiteContentFailureExplodes = containerEntity && containerEntity.dungeonSiteContentFailureExplodes === true;
  entity.dungeonSiteContentPersistsAfterResponse = containerEntity && containerEntity.dungeonSiteContentPersistsAfterResponse === true;
  entity.dungeonSiteContentTrigger = normalizeLowerText(containerEntity && containerEntity.dungeonSiteContentTrigger, "") || null;
  entity.dungeonSiteContentLootProfile = normalizeText(containerEntity && containerEntity.dungeonSiteContentLootProfile, "") || null;
  entity.dungeonSiteContentLootTags = cloneValue(containerEntity && containerEntity.dungeonSiteContentLootTags) || [];
  entity.dungeonSiteContentHackingDifficulty = normalizeLowerText(containerEntity && containerEntity.dungeonSiteContentHackingDifficulty, "") || null;
  entity.dungeonLootEntryCount = listContainerItems(null, entity.itemID).length;
  return entity;
}

function destroyMaterializedContentEntity(scene, entity, options = {}) {
  if (!scene || !entity) {
    return {
      success: false,
      errorMsg: "ENTITY_NOT_FOUND",
    };
  }
  const spaceRuntime = getSpaceRuntime();
  if (entity.dungeonMaterializedContainer === true && scene.dynamicEntities instanceof Map && scene.dynamicEntities.has(Number(entity.itemID))) {
    return spaceRuntime.destroyDynamicInventoryEntity(scene.systemID, entity.itemID, {
      removeContents: true,
      ...options,
    });
  }
  if (entity.dungeonMaterializedContainer === true && findItemById(Number(entity.itemID))) {
    return removeInventoryItem(Number(entity.itemID), {
      removeContents: true,
    });
  }
  return scene.removeStaticEntity(toInt(entity && entity.itemID, 0), {
    broadcast: options.broadcast === true,
    excludedSession: options.excludedSession || null,
    nowMs: options.nowMs,
  });
}

function buildContainerEntities(instance, siteEntity, populationHints) {
  if (!populationHints || !Array.isArray(populationHints.containers)) {
    return [];
  }
  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  const containerSpecs = populationHints.containers
    .filter((container) => container && typeof container === "object")
    .flatMap((container) => {
      const count = Math.max(
        0,
        Math.min(
          SITE_CONTENT_MAX_CONTAINER_COUNT,
          toInt(container && container.count, 0),
        ),
      );
      return Array.from({ length: count }, (_, index) => ({
        role: normalizeLowerText(container && container.role, "container"),
        analyzer: normalizeLowerText(container && container.analyzer, "") || null,
        typeID: Math.max(0, toInt(container && container.typeID, 0)) || null,
        typeNameCandidates: normalizeArray(container && container.typeNameCandidates),
        label: normalizeText(container && container.label, "") || null,
        bonus: container && container.bonus === true,
        persistsAfterResponse: container && container.persistsAfterResponse === true,
        failureExplodes: container && container.failureExplodes === true,
        trigger: normalizeLowerText(container && container.trigger, "") || null,
        lootProfile: normalizeText(container && container.lootProfile, "") || null,
        lootTags: normalizeArray(container && container.lootTags)
          .map((tag) => normalizeLowerText(tag, ""))
          .filter(Boolean),
        hackingDifficulty: normalizeLowerText(container && container.hackingDifficulty, "") || null,
        ordinal: index + 1,
      }));
    })
    .slice(0, SITE_CONTENT_MAX_CONTAINER_COUNT);
  const total = containerSpecs.length;
  if (total <= 0) {
    return [];
  }

  return containerSpecs.map((container, index) => {
    const typeRecord = resolveContainerTypeRecord(container);
    const displayName = resolveContainerDisplayName(container, typeRecord, container.ordinal);
    const contentKey = normalizeText(
      `container:${container.role}:${container.ordinal}:${displayName}`,
      `container:${index + 1}`,
    ).toLowerCase();
    return {
      kind: "container",
      dungeonMaterializedSiteContent: true,
      dungeonMaterializedContainer: true,
      dungeonSiteID: siteID,
      dungeonSiteInstanceID: instanceID,
      dungeonSiteContentKey: contentKey,
      dungeonSiteContentRole: container.role,
      dungeonSiteContentAnalyzer: container.analyzer,
      dungeonSiteContentBonus: container.bonus === true,
      dungeonSiteContentFailureExplodes: container.failureExplodes === true,
      dungeonSiteContentPersistsAfterResponse: container.persistsAfterResponse === true,
      dungeonSiteContentTrigger: container.trigger || null,
      dungeonSiteContentLootProfile: container.lootProfile,
      dungeonSiteContentLootTags: container.lootTags,
      dungeonSiteContentHackingDifficulty: container.hackingDifficulty,
      itemID: SITE_CONTENT_CONTAINER_ID_BASE + (siteID * 100) + index + 1,
      typeID: toInt(typeRecord && typeRecord.typeID, 23) || 23,
      groupID: toInt(typeRecord && typeRecord.groupID, 12) || 12,
      categoryID: toInt(typeRecord && typeRecord.categoryID, 2) || 2,
      graphicID: toInt(typeRecord && typeRecord.graphicID, 0) || null,
      ownerID: 1,
      itemName: displayName,
      slimName: displayName,
      position: addVectors(
        clonePosition(siteEntity && siteEntity.position),
        buildContentOffset(`${siteID}:${container.role}`, index, total),
      ),
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(200, toFiniteNumber(typeRecord && typeRecord.radius, 14)),
      staticVisibilityScope: "bubble",
    };
  });
}

function buildEncounterRewardContainerEntity(instance, siteEntity, encounterPlan, encounterState, populationHints) {
  if (!instance || !siteEntity || !encounterPlan) {
    return null;
  }
  const rewardProfile = normalizeText(encounterPlan && encounterPlan.lootProfile, "");
  if (!rewardProfile) {
    return null;
  }
  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const rewardIndex = Math.max(1, toInt(encounterPlan && encounterPlan.waveIndex, 1));
  const totalPlans = Math.max(1, resolveEncounterPlans(populationHints).length);
  const label = rewardProfile === "combat_overseer_loot"
    ? "Overseer Cache"
    : `${normalizeText(encounterPlan && encounterPlan.label, "Encounter")} Reward Cache`;
  const typeRecord = resolveGenericContainerTypeRecord() || resolveItemByTypeID(23) || {};
  return {
    kind: "container",
    dungeonMaterializedSiteContent: true,
    dungeonMaterializedContainer: true,
    dungeonSiteID: siteID,
    dungeonSiteInstanceID: Math.max(0, toInt(instance && instance.instanceID, 0)),
    dungeonSiteContentKey: `encounter_reward:${normalizeText(encounterPlan && encounterPlan.key, `wave_${rewardIndex}`)}`.toLowerCase(),
    dungeonSiteContentRole: "encounter_reward",
    dungeonSiteContentAnalyzer: null,
    dungeonSiteContentBonus: true,
    dungeonSiteContentFailureExplodes: false,
    dungeonSiteContentPersistsAfterResponse: true,
    dungeonSiteContentTrigger: normalizeLowerText(encounterPlan && encounterPlan.trigger, "") || null,
    dungeonSiteContentLootProfile: rewardProfile,
    dungeonSiteContentLootTags: cloneValue(encounterPlan && encounterPlan.lootTags) || [],
    dungeonSiteContentHackingDifficulty: null,
    itemID: SITE_CONTENT_CONTAINER_ID_BASE + (siteID * 100) + 50 + rewardIndex,
    typeID: toInt(typeRecord && typeRecord.typeID, 23) || 23,
    groupID: toInt(typeRecord && typeRecord.groupID, 12) || 12,
    categoryID: toInt(typeRecord && typeRecord.categoryID, 2) || 2,
    graphicID: toInt(typeRecord && typeRecord.graphicID, 0) || null,
    ownerID: 1,
    itemName: label,
    slimName: label,
    position: addVectors(
      clonePosition(siteEntity && siteEntity.position),
      buildContentOffset(
        `${siteID}:encounter_reward:${normalizeText(encounterPlan && encounterPlan.key, rewardIndex)}`,
        rewardIndex - 1,
        totalPlans,
        {
          baseDistanceMeters: SITE_CONTENT_REWARD_OFFSET_METERS,
          jitterMeters: 4_500,
        },
      ),
    ),
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: Math.max(200, toFiniteNumber(typeRecord && typeRecord.radius, 14)),
    staticVisibilityScope: "bubble",
    dungeonEncounterCompletedAtMs: Math.max(0, toInt(encounterState && encounterState.completedAtMs, 0)) || null,
  };
}

function materializeEncounterRewardContainers(scene, instance, siteEntity, template, populationHints, options = {}) {
  if (!scene || !instance || !siteEntity) {
    return 0;
  }
  if (normalizeLowerText(instance && instance.siteKind, "") === "anomaly") {
    return 0;
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let createdCount = 0;
  for (const plan of resolveEncounterPlans(populationHints)) {
    if (!normalizeText(plan && plan.lootProfile, "")) {
      continue;
    }
    const encounterState = getEncounterStateByKey(instance, plan.key);
    if (Math.max(0, toInt(encounterState && encounterState.completedAtMs, 0)) <= 0) {
      continue;
    }
    if (Math.max(0, toInt(encounterState && encounterState.rewardMaterializedAtMs, 0)) > 0) {
      continue;
    }
    const rewardContainer = buildEncounterRewardContainerEntity(
      instance,
      siteEntity,
      plan,
      encounterState,
      populationHints,
    );
    if (!rewardContainer) {
      continue;
    }
    const created = materializeContainerEntity(
      scene,
      instance,
      siteEntity,
      template,
      populationHints,
      rewardContainer,
      { nowMs },
    );
    if (!created) {
      continue;
    }
    upsertEncounterState(instance.instanceID, plan.key, {
      rewardMaterializedAtMs: nowMs,
    }, { nowMs });
    createdCount += 1;
  }
  return createdCount;
}

function maybeCompleteClearedEncounterSite(instance, populationHints, options = {}) {
  if (!instance) {
    return false;
  }
  if (normalizeLowerText(instance && instance.siteKind, "") !== "anomaly") {
    return false;
  }
  if (normalizeLowerText(instance && instance.lifecycleState, "") !== "active") {
    return false;
  }
  const plans = resolveEncounterPlans(populationHints);
  if (plans.length <= 0) {
    return false;
  }
  const latestInstance = dungeonRuntime.getInstance(instance.instanceID) || instance;
  let latestCompletionAtMs = 0;
  for (const plan of plans) {
    const state = getEncounterStateByKey(latestInstance, plan.key);
    if (Math.max(0, toInt(state && state.spawnedAtMs, 0)) <= 0) {
      return false;
    }
    const remainingEntityIDs = normalizeIDList(state && state.remainingEntityIDs);
    if (remainingEntityIDs.length > 0) {
      return false;
    }
    const completedAtMs = Math.max(0, toInt(state && state.completedAtMs, 0));
    if (completedAtMs <= 0) {
      return false;
    }
    latestCompletionAtMs = Math.max(latestCompletionAtMs, completedAtMs);
  }
  const objectiveCompletedAtMs = Math.max(
    0,
    toInt(latestInstance && latestInstance.objectiveState && latestInstance.objectiveState.completedAtMs, 0),
  );
  const completionAtMs = Math.max(
    latestCompletionAtMs,
    objectiveCompletedAtMs,
    Math.max(0, toInt(options.nowMs, Date.now())),
  );
  dungeonRuntime.setLifecycleState(latestInstance.instanceID, "completed", {
    nowMs: Math.max(0, toInt(options.nowMs, Date.now())),
    completedAtMs: completionAtMs,
    expiresAtMs: completionAtMs + CLEARED_ANOMALY_ROTATION_DELAY_MS,
    lifecycleReason: "encounters_cleared",
  });
  return true;
}

function materializeContainerEntity(scene, instance, siteEntity, template, populationHints, containerEntity, options = {}) {
  if (!scene || !instance || !containerEntity) {
    return false;
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const contentKey = normalizeText(containerEntity && containerEntity.dungeonSiteContentKey, "");
  const latestInstance = dungeonRuntime.getInstance(instance.instanceID) || instance;
  const existingRef = normalizeObject(getContentEntityRefsByKey(latestInstance)[contentKey]);
  let itemID = Math.max(0, toInt(existingRef && existingRef.itemID, 0));
  let createdItem = false;

  if (!(itemID > 0 && findItemById(itemID))) {
    itemID = 0;
  }

  if (itemID <= 0) {
    const containerType = resolveItemByTypeID(toInt(containerEntity && containerEntity.typeID, 0)) ||
      resolveContainerTypeRecord(containerEntity);
    if (!containerType) {
      return false;
    }
    const createResult = grantItemsToOwnerLocation(
      SITE_CONTENT_OWNER_ID,
      scene.systemID,
      0,
      [{
        itemType: containerType,
        quantity: 1,
        options: {
          singleton: 1,
          itemName: normalizeText(containerEntity && containerEntity.itemName, resolveTypeRecordName(containerType, "Site Container")),
          createdAtMs: nowMs,
          spaceRadius: Math.max(100, toFiniteNumber(containerEntity && containerEntity.radius, 0)) || null,
          spaceState: {
            systemID: scene.systemID,
            position: clonePosition(containerEntity && containerEntity.position),
            velocity: { x: 0, y: 0, z: 0 },
            direction: { x: 1, y: 0, z: 0 },
            mode: "STOP",
          },
        },
      }],
    );
    if (!createResult || !createResult.success || !createResult.data || !Array.isArray(createResult.data.items)) {
      return false;
    }
    itemID = Math.max(0, toInt(createResult.data.items[0] && createResult.data.items[0].itemID, 0));
    createdItem = itemID > 0;
  }

  if (itemID <= 0) {
    return false;
  }

  const runtime = getSpaceRuntime();
  const lootSeeded = existingRef.lootSeeded === true;
  if (!lootSeeded) {
    const lootEntries = buildLootGrantEntriesForContainer(containerEntity, populationHints, {
      instance,
      siteEntity,
      template,
    });
    if (lootEntries.length > 0) {
      grantItemsToOwnerLocation(
        SITE_CONTENT_OWNER_ID,
        itemID,
        ITEM_FLAGS.CARGO_HOLD,
        lootEntries,
      );
    }
  }

  const spawnResult = runtime.spawnDynamicInventoryEntity(scene.systemID, itemID, {
    broadcast: options.broadcast === true,
    excludedSession: options.excludedSession || null,
  });
  if (!spawnResult || !spawnResult.success) {
    return false;
  }
  const liveEntity = scene.getEntityByID(itemID) || (spawnResult.data && spawnResult.data.entity) || null;
  if (!liveEntity) {
    return false;
  }
  annotateMaterializedContainerEntity(liveEntity, {
    ...containerEntity,
    itemID,
  });
  upsertContentEntityRef(instance.instanceID, contentKey, {
    itemID,
    lootSeeded: lootSeeded || listContainerItems(null, itemID).length > 0,
    lastMaterializedAtMs: nowMs,
    createdAtMs: createdItem ? nowMs : Math.max(0, toInt(existingRef && existingRef.createdAtMs, 0)) || null,
  }, { nowMs });
  return true;
}

function broadcastStaticSiteContentBatch(scene, entities, options = {}) {
  if (
    !scene ||
    !Array.isArray(entities) ||
    entities.length <= 0 ||
    options.broadcast !== true ||
    typeof scene.broadcastAddBalls !== "function"
  ) {
    return 0;
  }
  const filtered = entities.filter(Boolean);
  if (filtered.length <= 0) {
    return 0;
  }
  scene.broadcastAddBalls(filtered, options.excludedSession || null);
  return filtered.length;
}

function buildHazardEntities(instance, siteEntity, populationHints) {
  if (!populationHints || !Array.isArray(populationHints.hazards)) {
    return [];
  }
  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  const hazards = [...new Set(
    populationHints.hazards
      .map((entry) => {
        if (entry && typeof entry === "object") {
          return JSON.stringify({
            kind: normalizeLowerText(entry.kind, ""),
            label: normalizeText(entry.label, ""),
            visibleCountdownSeconds: Math.max(0, toInt(entry.visibleCountdownSeconds, 0)),
            hiddenTimerMinSeconds: Math.max(0, toInt(entry.hiddenTimerMinSeconds, 0)),
            hiddenTimerMaxSeconds: Math.max(0, toInt(entry.hiddenTimerMaxSeconds, 0)),
            failureTriggersExplosion: entry.failureTriggersExplosion === true,
          });
        }
        return JSON.stringify({
          kind: normalizeLowerText(entry, ""),
        });
      })
      .filter((entry) => entry !== JSON.stringify({ kind: "" })),
  )]
    .map((entry) => {
      try {
        return JSON.parse(entry);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, SITE_CONTENT_MAX_HAZARD_COUNT);
  const total = hazards.length;
  if (total <= 0) {
    return [];
  }

  return hazards.map((hazard, index) => {
    const hazardKind = normalizeLowerText(hazard && hazard.kind, "");
    const hazardLabel = normalizeText(hazard && hazard.label, "") || resolveHazardLabel(hazardKind);
    return {
      kind: "siteHazardBeacon",
      dungeonMaterializedSiteContent: true,
      dungeonMaterializedHazard: true,
      dungeonSiteID: siteID,
      dungeonSiteInstanceID: instanceID,
      dungeonSiteContentHazard: hazardKind,
      dungeonHazardVisibleCountdownSeconds: Math.max(0, toInt(hazard && hazard.visibleCountdownSeconds, 0)) || null,
      dungeonHazardHiddenTimerMinSeconds: Math.max(0, toInt(hazard && hazard.hiddenTimerMinSeconds, 0)) || null,
      dungeonHazardHiddenTimerMaxSeconds: Math.max(0, toInt(hazard && hazard.hiddenTimerMaxSeconds, 0)) || null,
      dungeonHazardFailureTriggersExplosion: hazard && hazard.failureTriggersExplosion === true,
      itemID: SITE_CONTENT_HAZARD_ID_BASE + (siteID * 100) + index + 1,
      typeID: toInt(siteEntity && siteEntity.typeID, COSMIC_SIGNATURE_TYPE_ID) || COSMIC_SIGNATURE_TYPE_ID,
      groupID: toInt(siteEntity && siteEntity.groupID, COSMIC_SIGNATURE_GROUP_ID) || COSMIC_SIGNATURE_GROUP_ID,
      categoryID: toInt(siteEntity && siteEntity.categoryID, 16) || 16,
      graphicID: toInt(siteEntity && siteEntity.graphicID, 0) || null,
      ownerID: 1,
      itemName: hazardLabel,
      slimName: hazardLabel,
      position: addVectors(
        clonePosition(siteEntity && siteEntity.position),
        buildContentOffset(
          `${siteID}:${hazardKind}`,
          index,
          total,
          {
            baseDistanceMeters: SITE_CONTENT_ENCOUNTER_OFFSET_METERS + 5_000,
            jitterMeters: 6_000,
          },
        ),
      ),
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(2_500, Math.round(toFiniteNumber(siteEntity && siteEntity.radius, 2_000) * 0.75)),
      staticVisibilityScope: "bubble",
    };
  });
}

function resolveSiteSceneProfile(template) {
  return normalizeObject(
    template &&
    template.siteSceneProfile &&
    typeof template.siteSceneProfile === "object"
      ? template.siteSceneProfile
      : null,
  );
}

function buildGateEntities(instance, siteEntity, template) {
  const sceneProfile = resolveSiteSceneProfile(template);
  const rawGateProfiles = normalizeArray(sceneProfile && sceneProfile.gateProfiles)
    .filter((entry) => entry && typeof entry === "object");
  if (rawGateProfiles.length <= 0) {
    return [];
  }
  const gateStatesByKey =
    instance &&
    instance.gateStatesByKey &&
    typeof instance.gateStatesByKey === "object"
      ? instance.gateStatesByKey
      : {};
  const dedupedGateProfiles = [];
  const seenEntryGateKeys = new Set();
  for (const gateProfile of rawGateProfiles) {
    const gateKey = normalizeText(gateProfile && gateProfile.gateKey, "");
    const gateState = normalizeObject(gateStatesByKey[gateKey]);
    const destinationRoomKey = normalizeText(
      gateProfile && gateProfile.destinationRoomKey,
      normalizeText(gateState && gateState.destinationRoomKey, ""),
    );
    const label = normalizeText(gateProfile && gateProfile.label, "");
    const allowedShipsList = Math.max(
      0,
      toInt(
        gateProfile && gateProfile.allowedShipsList,
        gateState && gateState.metadata && gateState.metadata.allowedShipsList,
      ),
    );
    if (destinationRoomKey === "room:entry" && !label) {
      const dedupeKey = `${destinationRoomKey}:${allowedShipsList}`;
      if (seenEntryGateKeys.has(dedupeKey)) {
        continue;
      }
      seenEntryGateKeys.add(dedupeKey);
    }
    dedupedGateProfiles.push(gateProfile);
  }
  const gateProfiles = dedupedGateProfiles.slice(0, SITE_CONTENT_MAX_GATE_COUNT);
  if (gateProfiles.length <= 0) {
    return [];
  }
  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  return gateProfiles.map((gateProfile, index) => {
    const explicitTypeID = Math.max(0, toInt(gateProfile && gateProfile.typeID, 0));
    const typeRecord = (
      explicitTypeID > 0
        ? resolveItemByTypeID(explicitTypeID)
        : resolveGenericTypeRecordByName(gateProfile && gateProfile.typeNameCandidates)
    ) || resolveItemByTypeID(17_831) || {};
    const gateKey = normalizeText(gateProfile && gateProfile.gateKey, `gate:${index + 1}`);
    const gateState = normalizeObject(gateStatesByKey[gateKey]);
    const label = normalizeText(
      gateProfile && gateProfile.label,
      resolveTypeRecordName(typeRecord, "Acceleration Gate"),
    ) || "Acceleration Gate";
    return {
      kind: "siteAccelerationGate",
      dungeonMaterializedSiteContent: true,
      dungeonMaterializedGate: true,
      dungeonSiteID: siteID,
      dungeonSiteInstanceID: instanceID,
      dungeonGateKey: gateKey,
      dungeonGateDestinationRoomKey: normalizeText(
        gateProfile && gateProfile.destinationRoomKey,
        normalizeText(gateState && gateState.destinationRoomKey, "") || null,
      ) || null,
      dungeonGateState: normalizeLowerText(gateState && gateState.state, "locked"),
      dungeonGateAllowedShipsList: Math.max(
        0,
        toInt(
          gateProfile && gateProfile.allowedShipsList,
          gateState && gateState.metadata && gateState.metadata.allowedShipsList,
        ),
      ) || null,
      itemID: SITE_CONTENT_GATE_ID_BASE + (siteID * 100) + index + 1,
      typeID: Math.max(0, toInt(typeRecord && typeRecord.typeID, explicitTypeID || 17_831)) || 17_831,
      groupID: Math.max(0, toInt(typeRecord && typeRecord.groupID, 366)) || 366,
      categoryID: Math.max(0, toInt(typeRecord && typeRecord.categoryID, 2)) || 2,
      graphicID: toInt(typeRecord && typeRecord.graphicID, 0) || null,
      ownerID: 1,
      itemName: label,
      slimName: label,
      position: addVectors(
        clonePosition(siteEntity && siteEntity.position),
        buildContentOffset(
          `${siteID}:gate:${gateKey}`,
          index,
          gateProfiles.length,
          {
            baseDistanceMeters: 22_000,
            jitterMeters: 7_000,
          },
        ),
      ),
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(2_500, toFiniteNumber(typeRecord && typeRecord.radius, 12_000)),
      staticVisibilityScope: "bubble",
    };
  });
}

function buildEnvironmentEntities(instance, siteEntity, template, populationHints) {
  const sceneProfile = resolveSiteSceneProfile(template);
  const environmentTemplates =
    template &&
    template.environmentTemplates &&
    typeof template.environmentTemplates === "object"
      ? template.environmentTemplates
      : null;
  const resolvedTemplateCatalog =
    environmentTemplates &&
    environmentTemplates.resolvedTemplateCatalog &&
    typeof environmentTemplates.resolvedTemplateCatalog === "object"
      ? environmentTemplates.resolvedTemplateCatalog
      : {};
  const entryObjectEnvironmentMapping =
    environmentTemplates &&
    environmentTemplates.entryObjectEnvironmentMapping &&
    typeof environmentTemplates.entryObjectEnvironmentMapping === "object"
      ? environmentTemplates.entryObjectEnvironmentMapping
      : null;

  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  const candidates = [];
  const pushDefinitionCandidates = (environmentTemplateID, definition, source) => {
    const anchorTypeIDs = Array.isArray(definition && definition.anchorTypeIDs)
      ? definition.anchorTypeIDs
      : [];
    const subEnvironmentTypeIDs = Array.isArray(definition && definition.subEnvironmentTypeIDs)
      ? definition.subEnvironmentTypeIDs
      : [];
    for (const typeID of [...anchorTypeIDs, ...subEnvironmentTypeIDs.slice(0, 12)]) {
      const normalizedTypeID = Math.max(0, toInt(typeID, 0));
      if (normalizedTypeID <= 0) {
        continue;
      }
      const typeRecord = resolveItemByTypeID(normalizedTypeID);
      if (!typeRecord || !resolveTypeRecordName(typeRecord, "")) {
        continue;
      }
      candidates.push({
        typeID: normalizedTypeID,
        typeRecord,
        environmentTemplateID: Math.max(0, toInt(environmentTemplateID, 0)) || null,
        source: anchorTypeIDs.includes(normalizedTypeID)
          ? `${source}:anchorType`
          : `${source}:subEnvironmentType`,
        explicitLabel: null,
      });
    }
  };
  for (const [environmentTemplateID, definition] of Object.entries(resolvedTemplateCatalog)) {
    pushDefinitionCandidates(environmentTemplateID, definition, "catalog");
  }
  const mappedTemplateRefs = [
    ...(entryObjectEnvironmentMapping && entryObjectEnvironmentMapping.baseEnvironment
      ? [entryObjectEnvironmentMapping.baseEnvironment]
      : []),
    ...Object.values(
      entryObjectEnvironmentMapping && entryObjectEnvironmentMapping.overridesByMaterialSetID
        ? entryObjectEnvironmentMapping.overridesByMaterialSetID
        : {},
    ),
  ];
  for (const templateRef of mappedTemplateRefs) {
    const environmentTemplateID = Math.max(0, toInt(templateRef && templateRef.templateID, 0)) || null;
    const explicitDefinition = normalizeObject(templateRef && templateRef.definition);
    const definition = Object.keys(explicitDefinition).length > 0
      ? explicitDefinition
      : normalizeObject(environmentTemplateID ? resolvedTemplateCatalog[String(environmentTemplateID)] : null);
    if (Object.keys(definition).length <= 0) {
      continue;
    }
    pushDefinitionCandidates(environmentTemplateID, definition, "entryObjectMapping");
  }

  const hintedEnvironmentProps = normalizeArray(populationHints && populationHints.environmentProps)
    .filter((entry) => entry && typeof entry === "object");
  const sceneProfileStructures = normalizeArray(sceneProfile && sceneProfile.structureProfiles)
    .filter((entry) => entry && typeof entry === "object");
  if (
    Object.keys(resolvedTemplateCatalog).length <= 0 &&
    mappedTemplateRefs.length <= 0 &&
    hintedEnvironmentProps.length <= 0 &&
    sceneProfileStructures.length <= 0
  ) {
    return [];
  }
  for (const structureProfile of sceneProfileStructures) {
    const explicitTypeID = Math.max(0, toInt(structureProfile && structureProfile.typeID, 0));
    const typeRecord = (
      explicitTypeID > 0
        ? resolveItemByTypeID(explicitTypeID)
        : resolveGenericTypeRecordByName(structureProfile && structureProfile.typeNameCandidates)
    );
    if (!typeRecord) {
      continue;
    }
    candidates.push({
      typeID: Math.max(0, toInt(typeRecord && typeRecord.typeID, explicitTypeID)) || explicitTypeID,
      typeRecord,
      environmentTemplateID: null,
      source: normalizeText(structureProfile && structureProfile.source, "sceneProfile"),
      explicitLabel: normalizeText(structureProfile && structureProfile.label, "") || null,
    });
  }
  for (const environmentProp of hintedEnvironmentProps) {
    const explicitTypeID = Math.max(0, toInt(environmentProp && environmentProp.typeID, 0));
    const typeRecord = (
      explicitTypeID > 0
        ? resolveItemByTypeID(explicitTypeID)
        : resolveGenericTypeRecordByName(environmentProp && environmentProp.typeNameCandidates)
    );
    if (!typeRecord) {
      continue;
    }
    candidates.push({
      typeID: Math.max(0, toInt(typeRecord && typeRecord.typeID, explicitTypeID)) || explicitTypeID,
      typeRecord,
      environmentTemplateID: null,
      source: "populationHint",
      explicitLabel: normalizeText(environmentProp && environmentProp.label, "") || null,
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.typeID}:${normalizeText(candidate.explicitLabel, "")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }
  const selected = deduped.slice(0, SITE_CONTENT_MAX_ENVIRONMENT_PROPS);
  if (selected.length <= 0) {
    return [];
  }

  return selected.map((candidate, index) => {
    const resolvedTypeID =
      toInt(candidate.typeRecord && candidate.typeRecord.typeID, candidate.typeID) || candidate.typeID;
    const healthState = resolveTypeHealthState(resolvedTypeID);
    return {
      kind: "siteEnvironmentProp",
      dungeonMaterializedSiteContent: true,
      dungeonMaterializedEnvironment: true,
      dungeonSiteID: siteID,
      dungeonSiteInstanceID: instanceID,
      dungeonEnvironmentTemplateID: candidate.environmentTemplateID,
      dungeonEnvironmentSource: candidate.source,
      itemID: SITE_CONTENT_ENVIRONMENT_ID_BASE + (siteID * 100) + index + 1,
      typeID: resolvedTypeID,
      groupID: toInt(candidate.typeRecord && candidate.typeRecord.groupID, 0) || 0,
      categoryID: toInt(candidate.typeRecord && candidate.typeRecord.categoryID, 0) || 0,
      graphicID: toInt(candidate.typeRecord && candidate.typeRecord.graphicID, 0) || null,
      ownerID: 1,
      itemName: normalizeText(candidate.explicitLabel, "") || resolveTypeRecordName(candidate.typeRecord, "Environment Feature"),
      slimName: normalizeText(candidate.explicitLabel, "") || resolveTypeRecordName(candidate.typeRecord, "Environment Feature"),
      ...buildSafeSitePropSlimOverrides(candidate.typeRecord),
      position: addVectors(
        clonePosition(siteEntity && siteEntity.position),
        buildContentOffset(
          `${siteID}:environment:${candidate.typeID}`,
          index,
          selected.length,
          {
            baseDistanceMeters: 18_000,
            jitterMeters: 9_000,
          },
        ),
      ),
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(500, toFiniteNumber(candidate.typeRecord && candidate.typeRecord.radius, 1_500)),
      shieldCapacity: healthState.shieldCapacity,
      armorHP: healthState.armorHP,
      structureHP: healthState.structureHP,
      conditionState: cloneValue(healthState.conditionState),
      staticVisibilityScope: "bubble",
    };
  });
}

function buildObjectiveEntities(instance, siteEntity, template, populationHints = null) {
  const objectiveMetadata =
    template &&
    template.objectiveMetadata &&
    typeof template.objectiveMetadata === "object"
      ? template.objectiveMetadata
      : null;
  const objectiveChain =
    objectiveMetadata &&
    objectiveMetadata.objectiveChain &&
    typeof objectiveMetadata.objectiveChain === "object"
      ? objectiveMetadata.objectiveChain
      : null;
  const objectiveTypesByID =
    objectiveMetadata &&
    objectiveMetadata.objectiveTypesByID &&
    typeof objectiveMetadata.objectiveTypesByID === "object"
      ? objectiveMetadata.objectiveTypesByID
      : {};
  const objectiveTaskTypesByID =
    objectiveMetadata &&
    objectiveMetadata.objectiveTaskTypesByID &&
    typeof objectiveMetadata.objectiveTaskTypesByID === "object"
      ? objectiveMetadata.objectiveTaskTypesByID
      : {};
  const objectives = Array.isArray(objectiveChain && objectiveChain.objectives)
    ? objectiveChain.objectives
    : [];
  const siteID = Math.max(0, toInt(siteEntity && siteEntity.itemID, 0));
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  const markers = [];
  if (objectives.length > 0) {
    const currentObjectiveKey = normalizeText(
      instance &&
      instance.objectiveState &&
      instance.objectiveState.currentObjectiveKey,
      "",
    );
    const selectedObjective = objectives.find((objective) => (
      currentObjectiveKey && normalizeText(objective && objective.key, "") === currentObjectiveKey
    )) ||
      objectives.find((objective) => objective && (objective.startActive === 1 || objective.startActive === true)) ||
      objectives[0] ||
      null;
    if (selectedObjective) {
      const selectedObjectiveType = normalizeObject(
        objectiveTypesByID[String(toInt(selectedObjective && selectedObjective.objectiveType, 0))],
      );
      markers.push({
        role: "objective",
        label: resolveObjectiveLabel(selectedObjective, selectedObjectiveType),
        objectiveKey: normalizeText(selectedObjective && selectedObjective.key, "") || null,
        objectiveTypeID: Math.max(0, toInt(selectedObjective && selectedObjective.objectiveType, 0)) || null,
        objectiveTaskTypeID: null,
        icon: null,
        analyzer: null,
      });

      for (const task of normalizeArray(selectedObjectiveType.tasks)) {
        if (!(task && (task.startActive === 1 || task.startActive === true))) {
          continue;
        }
        const taskTypeID = Math.max(0, toInt(task && task.taskType, 0)) || null;
        const taskType = normalizeObject(taskTypeID ? objectiveTaskTypesByID[String(taskTypeID)] : null);
        markers.push({
          role: "task",
          label: resolveObjectiveTaskLabel(task, taskType),
          objectiveKey: normalizeText(task && task.key, "") || null,
          objectiveTypeID: Math.max(0, toInt(selectedObjective && selectedObjective.objectiveType, 0)) || null,
          objectiveTaskTypeID: taskTypeID,
          icon: normalizeText(taskType && taskType.icon, "") || null,
          analyzer:
            normalizeLowerText(taskType && taskType.icon, "") === "hacking"
              ? "data"
              : null,
        });
      }
    }
  }
  markers.push(...resolvePopulationObjectiveMarkers(populationHints, template));

  const total = Math.min(SITE_CONTENT_MAX_OBJECTIVE_MARKERS, markers.length);
  if (total <= 0) {
    return [];
  }
  const genericContainerType = resolveGenericContainerTypeRecord();
  const fallbackTypeRecord = resolveItemByTypeID(toInt(siteEntity && siteEntity.typeID, COSMIC_SIGNATURE_TYPE_ID));
  return markers.slice(0, total).map((marker, index) => {
    const typeRecord =
      marker.analyzer && genericContainerType
        ? genericContainerType
        : (fallbackTypeRecord || genericContainerType || {});
    return {
      kind: "siteObjectiveMarker",
      dungeonMaterializedSiteContent: true,
      dungeonMaterializedObjective: true,
      dungeonSiteID: siteID,
      dungeonSiteInstanceID: instanceID,
      dungeonObjectiveRole: marker.role,
      dungeonObjectiveKey: marker.objectiveKey,
      dungeonObjectiveTypeID: marker.objectiveTypeID,
      dungeonObjectiveTaskTypeID: marker.objectiveTaskTypeID,
      dungeonObjectiveIcon: marker.icon,
      itemID: SITE_CONTENT_OBJECTIVE_ID_BASE + (siteID * 100) + index + 1,
      typeID: toInt(typeRecord && typeRecord.typeID, COSMIC_SIGNATURE_TYPE_ID) || COSMIC_SIGNATURE_TYPE_ID,
      groupID: toInt(typeRecord && typeRecord.groupID, COSMIC_SIGNATURE_GROUP_ID) || COSMIC_SIGNATURE_GROUP_ID,
      categoryID: toInt(typeRecord && typeRecord.categoryID, 16) || 16,
      graphicID: toInt(typeRecord && typeRecord.graphicID, 0) || null,
      ownerID: 1,
      itemName: marker.label,
      slimName: marker.label,
      position: addVectors(
        clonePosition(siteEntity && siteEntity.position),
        buildContentOffset(
          `${siteID}:objective:${marker.objectiveKey || index}`,
          index,
          total,
          {
            baseDistanceMeters: 8_500,
            jitterMeters: 2_500,
          },
        ),
      ),
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: Math.max(250, toFiniteNumber(typeRecord && typeRecord.radius, 800)),
      staticVisibilityScope: "bubble",
    };
  });
}

function armDeferredEncounterPlans(instance, populationHints, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let armedCount = 0;
  for (const plan of resolveEncounterPlans(populationHints)) {
    if (plan.trigger !== "visible_countdown") {
      continue;
    }
    const existingState = getEncounterStateByKey(instance, plan.key);
    if (Math.max(0, toInt(existingState && existingState.armedAtMs, 0)) > 0) {
      continue;
    }
    if (Math.max(0, toInt(existingState && existingState.spawnedAtMs, 0)) > 0) {
      continue;
    }
    upsertEncounterState(instance.instanceID, plan.key, {
      armedAtMs: nowMs,
      countdownSeconds: plan.countdownSeconds,
      trigger: plan.trigger,
      waveIndex: plan.waveIndex,
      prerequisiteKey: plan.prerequisiteKey,
      lootProfile: plan.lootProfile,
      lootTags: plan.lootTags,
    }, { nowMs });
    armedCount += 1;
  }
  return armedCount;
}

function spawnEncounterPlan(scene, instance, siteEntity, encounterPlan, options = {}) {
  if (!scene || !instance || !siteEntity || !encounterPlan || encounterPlan.supported !== true) {
    return 0;
  }
  const planKey = normalizeText(encounterPlan.key, "");
  if (!planKey) {
    return 0;
  }
  const existingState = getEncounterStateByKey(instance, planKey);
  if (Math.max(0, toInt(existingState && existingState.spawnedAtMs, 0)) > 0) {
    return 0;
  }

  if (!(scene._dungeonUniverseEncounterKeys instanceof Set)) {
    scene._dungeonUniverseEncounterKeys = new Set();
  }
  const encounterKey = `instance:${Math.max(0, toInt(instance && instance.instanceID, 0))}:${planKey}`;
  if (scene._dungeonUniverseEncounterKeys.has(encounterKey)) {
    return 0;
  }

  const npcSpawnService = getNpcSpawnService();
  if (!npcSpawnService || typeof npcSpawnService.spawnNpcBatchInSystem !== "function") {
    return 0;
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const spawnResult = npcSpawnService.spawnNpcBatchInSystem(scene.systemID, {
    profileQuery: normalizeText(encounterPlan.spawnQuery, "npc_hostiles"),
    amount: Math.max(
      1,
      Math.min(
        SITE_CONTENT_MAX_ENCOUNTER_NPCS,
        toInt(encounterPlan.amount, 3),
      ),
    ),
    transient: true,
    position: addVectors(
      clonePosition(siteEntity && siteEntity.position),
      buildContentOffset(
        `${encounterKey}:encounter`,
        Math.max(0, toInt(encounterPlan.waveIndex, 1)) - 1,
        Math.max(1, toInt(options.totalPlans, 1)),
        {
          baseDistanceMeters: SITE_CONTENT_ENCOUNTER_OFFSET_METERS,
          jitterMeters: 8_000,
        },
      ),
    ),
    anchorName: `${normalizeText(siteEntity && siteEntity.itemName, "Site")} ${normalizeText(encounterPlan.label, "Encounter")}`,
    spreadMeters: 8_000,
    formationSpacingMeters: 2_500,
    runtimeKind: "nativeCombat",
  });
  if (
    !spawnResult ||
    !spawnResult.success ||
    !spawnResult.data ||
    !Array.isArray(spawnResult.data.spawned) ||
    spawnResult.data.spawned.length <= 0
  ) {
    upsertEncounterState(instance.instanceID, planKey, {
      lastAttemptAtMs: nowMs,
    }, { nowMs });
    return 0;
  }

  scene._dungeonUniverseEncounterKeys.add(encounterKey);
  const spawnedEntityIDs = normalizeIDList(
    spawnResult.data.spawned
      .map((entry) => toInt(entry && entry.entity && entry.entity.itemID, 0))
      .filter((entry) => entry > 0),
  );
  const plans = resolveEncounterPlans(resolvePopulationHints(instance, dungeonAuthority.getTemplateByID(instance.templateID)));
  const currentRoomKey = resolveEncounterRoomKey(
    dungeonRuntime.getInstance(instance.instanceID) || instance,
    { encounters: plans },
    encounterPlan,
  );
  try {
    dungeonRuntime.activateRoom(instance.instanceID, currentRoomKey, {
      nowMs,
      stage: currentRoomKey === "room:entry" ? "entry" : "pocket",
    });
  } catch (error) {
    // Some site templates have no explicit room progression beyond the entry state.
  }
  const totalWaves = Math.max(
    1,
    plans.reduce((highest, plan) => Math.max(highest, toInt(plan && plan.waveIndex, 1)), 1),
  );
  if (
    instance &&
    instance.objectiveState &&
    ["seeded", "in_progress"].includes(normalizeLowerText(instance.objectiveState.state, ""))
  ) {
    const existingCounters =
      instance.objectiveState && instance.objectiveState.counters && typeof instance.objectiveState.counters === "object"
        ? instance.objectiveState.counters
        : {};
    const existingMetadata =
      instance.objectiveState && instance.objectiveState.metadata && typeof instance.objectiveState.metadata === "object"
        ? instance.objectiveState.metadata
        : {};
    dungeonRuntime.advanceObjective(instance.instanceID, {
      state: "in_progress",
      counters: {
        ...cloneValue(existingCounters),
        current_wave: Math.max(1, toInt(encounterPlan.waveIndex, 1)),
        total_waves: totalWaves,
      },
      metadata: {
        ...cloneValue(existingMetadata),
        currentRoomKey,
        currentWave: Math.max(1, toInt(encounterPlan.waveIndex, 1)),
        totalWaves,
      },
    }, { nowMs });
  }
  upsertEncounterState(instance.instanceID, planKey, {
    armedAtMs: Math.max(0, toInt(existingState && existingState.armedAtMs, 0)) || nowMs,
    spawnedAtMs: nowMs,
    spawnCount: spawnResult.data.spawned.length,
    spawnedEntityIDs,
    remainingEntityIDs: spawnedEntityIDs,
    trigger: normalizeText(options.trigger, encounterPlan.trigger),
    waveIndex: encounterPlan.waveIndex,
    prerequisiteKey: encounterPlan.prerequisiteKey || null,
    lootProfile: encounterPlan.lootProfile,
    lootTags: encounterPlan.lootTags,
    roomKey: currentRoomKey,
    label: encounterPlan.label,
    notes: encounterPlan.notes,
  }, { nowMs });
  return spawnResult.data.spawned.length;
}

function processEncounterPlansForTrigger(scene, instance, siteEntity, populationHints, trigger, options = {}) {
  const normalizedTrigger = normalizeLowerText(trigger, "");
  if (!normalizedTrigger) {
    return 0;
  }
  const plans = resolveEncounterPlans(populationHints);
  const triggeredPlans = plans
    .filter((plan) => plan.trigger === normalizedTrigger);
  if (triggeredPlans.length <= 0) {
    return 0;
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let encountersSpawned = 0;
  for (const plan of triggeredPlans) {
    if (normalizedTrigger === "visible_countdown") {
      const state = getEncounterStateByKey(instance, plan.key);
      const armedAtMs = Math.max(0, toInt(state && state.armedAtMs, 0));
      if (armedAtMs <= 0) {
        continue;
      }
      const countdownMs = Math.max(0, toInt(plan.countdownSeconds, 0)) * 1000;
      if (countdownMs > 0 && nowMs < armedAtMs + countdownMs) {
        continue;
      }
    }
    if (normalizedTrigger === "wave_cleared" || normalizedTrigger === "battleships_destroyed") {
      const prerequisiteKey = resolveEncounterPrerequisiteKey(plans, plan);
      if (!prerequisiteKey) {
        continue;
      }
      const prerequisiteState = getEncounterStateByKey(instance, prerequisiteKey);
      const prerequisiteSpawnedAtMs = Math.max(0, toInt(prerequisiteState && prerequisiteState.spawnedAtMs, 0));
      if (prerequisiteSpawnedAtMs <= 0) {
        continue;
      }
      const aliveEntityIDs = listAliveEncounterEntityIDs(scene, prerequisiteState);
      if (aliveEntityIDs.length > 0) {
        if (!areSortedNumberListsEqual(prerequisiteState && prerequisiteState.remainingEntityIDs, aliveEntityIDs)) {
          upsertEncounterState(instance.instanceID, prerequisiteKey, {
            remainingEntityIDs: aliveEntityIDs,
          }, { nowMs });
        }
        continue;
      }
      if (Math.max(0, toInt(prerequisiteState && prerequisiteState.completedAtMs, 0)) <= 0) {
        upsertEncounterState(instance.instanceID, prerequisiteKey, {
          remainingEntityIDs: [],
          completedAtMs: nowMs,
          completionTrigger: normalizedTrigger,
        }, { nowMs });
      }
    }
    encountersSpawned += spawnEncounterPlan(scene, instance, siteEntity, plan, {
      ...options,
      nowMs,
      trigger: normalizedTrigger,
      totalPlans: plans.length,
    });
  }
  return encountersSpawned;
}

function hasDueVisibleCountdownTrigger(instance, populationHints, options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  for (const plan of resolveEncounterPlans(populationHints)) {
    if (normalizeLowerText(plan && plan.trigger, "") !== "visible_countdown") {
      continue;
    }
    const state = getEncounterStateByKey(instance, plan.key);
    const armedAtMs = Math.max(0, toInt(state && state.armedAtMs, 0));
    const triggeredAtMs = Math.max(0, toInt(state && state.triggeredEffectsAtMs, 0));
    if (armedAtMs <= 0 || triggeredAtMs > 0) {
      continue;
    }
    const countdownMs = Math.max(0, toInt(plan && plan.countdownSeconds, 0)) * 1000;
    if (countdownMs <= 0 || nowMs >= armedAtMs + countdownMs) {
      return true;
    }
  }
  return false;
}

function maybeAdvanceEncounterDrivenProgression(instance, populationHints, options = {}) {
  if (!instance) {
    return {
      roomsCompleted: 0,
      gatesUnlocked: 0,
      roomsActivated: 0,
    };
  }
  const plans = resolveEncounterPlans(populationHints)
    .filter((plan) => plan.supported === true);
  if (plans.length <= 0) {
    return {
      roomsCompleted: 0,
      gatesUnlocked: 0,
      roomsActivated: 0,
    };
  }
  const latestInstance = dungeonRuntime.getInstance(instance.instanceID) || instance;
  const groupedPlans = groupEncounterPlansByRoom(latestInstance, populationHints);
  const orderedRoomKeys = listOrderedInstanceRoomKeys(latestInstance);
  const orderedGateKeys = listOrderedInstanceGateKeys(latestInstance);
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let roomsCompleted = 0;
  let gatesUnlocked = 0;
  let roomsActivated = 0;
  let settledPlanCount = 0;

  const settledPlansByKey = {};
  for (const plan of plans) {
    const encounterState = getEncounterStateByKey(latestInstance, plan.key);
    const spawnedAtMs = Math.max(0, toInt(encounterState && encounterState.spawnedAtMs, 0));
    const settled = spawnedAtMs > 0 && (
      Math.max(0, toInt(encounterState && encounterState.completedAtMs, 0)) > 0 ||
      normalizeIDList(encounterState && encounterState.remainingEntityIDs).length <= 0
    );
    settledPlansByKey[plan.key] = settled;
    if (settled) {
      settledPlanCount += 1;
    }
  }

  let workingInstance = latestInstance;
  orderedRoomKeys.forEach((roomKey, roomIndex) => {
    const roomPlans = normalizeArray(groupedPlans[roomKey]);
    if (roomPlans.length <= 0) {
      return;
    }
    const roomState = workingInstance.roomStatesByKey && workingInstance.roomStatesByKey[roomKey];
    const roomSettled = roomPlans.every((plan) => settledPlansByKey[plan.key] === true);
    if (!roomSettled) {
      return;
    }
    if (roomState && normalizeLowerText(roomState.state, "") !== "completed") {
      workingInstance = dungeonRuntime.completeRoom(workingInstance.instanceID, roomKey, {
        nowMs,
        stage: roomKey === "room:entry" ? "entry" : "pocket",
      });
      roomsCompleted += 1;
    }
    const nextRoomKey = orderedRoomKeys[roomIndex + 1] || null;
    if (!nextRoomKey) {
      return;
    }
    const nextRoomState = workingInstance.roomStatesByKey && workingInstance.roomStatesByKey[nextRoomKey];
    const gateKey = orderedGateKeys.find((candidateGateKey) => {
      const gateState = workingInstance.gateStatesByKey && workingInstance.gateStatesByKey[candidateGateKey];
      return normalizeText(gateState && gateState.destinationRoomKey, "") === nextRoomKey;
    }) || orderedGateKeys[roomIndex] || null;
    if (gateKey) {
      const gateState = workingInstance.gateStatesByKey && workingInstance.gateStatesByKey[gateKey];
      if (normalizeLowerText(gateState && gateState.state, "") === "locked") {
        workingInstance = dungeonRuntime.unlockGate(workingInstance.instanceID, gateKey, {
          nowMs,
          destinationRoomKey: nextRoomKey,
        });
        gatesUnlocked += 1;
      }
    }
    if (nextRoomState && normalizeLowerText(nextRoomState.state, "") === "pending") {
      workingInstance = dungeonRuntime.activateRoom(workingInstance.instanceID, nextRoomKey, {
        nowMs,
        stage: roomIndex + 1 >= orderedRoomKeys.length - 1 ? "final_pocket" : "pocket",
      });
      roomsActivated += 1;
    }
  });

  const refreshedInstance = dungeonRuntime.getInstance(instance.instanceID) || workingInstance;
  if (refreshedInstance && refreshedInstance.objectiveState) {
    const existingCounters =
      refreshedInstance.objectiveState.counters && typeof refreshedInstance.objectiveState.counters === "object"
        ? refreshedInstance.objectiveState.counters
        : {};
    const existingMetadata =
      refreshedInstance.objectiveState.metadata && typeof refreshedInstance.objectiveState.metadata === "object"
        ? refreshedInstance.objectiveState.metadata
        : {};
    const nextPatch = {
      state: settledPlanCount >= plans.length ? "completed" : "in_progress",
      counters: {
        ...cloneValue(existingCounters),
        current_wave: Math.max(0, settledPlanCount),
        total_waves: Math.max(1, plans.length),
        rooms_completed: Object.values(refreshedInstance.roomStatesByKey || {})
          .filter((roomState) => normalizeLowerText(roomState && roomState.state, "") === "completed")
          .length,
      },
      metadata: {
        ...cloneValue(existingMetadata),
        currentWave: Math.max(0, settledPlanCount),
        totalWaves: Math.max(1, plans.length),
      },
    };
    const currentComparableObjectiveState = {
      state: normalizeLowerText(refreshedInstance.objectiveState.state, "pending"),
      counters: cloneValue(existingCounters),
      metadata: {
        ...cloneValue(existingMetadata),
      },
      completedAtMs: Math.max(
        0,
        toInt(refreshedInstance.objectiveState.completedAtMs, 0),
      ),
    };
    delete currentComparableObjectiveState.metadata.lastAdvancedAtMs;
    delete currentComparableObjectiveState.metadata.lastProgressionAtMs;
    const nextComparableObjectiveState = {
      state: normalizeLowerText(nextPatch.state, "pending"),
      counters: cloneValue(nextPatch.counters),
      metadata: {
        ...cloneValue(nextPatch.metadata),
      },
      completedAtMs: Math.max(
        0,
        toInt(refreshedInstance.objectiveState.completedAtMs, 0),
      ),
    };
    if (settledPlanCount >= plans.length) {
      const existingCompletedAtMs = Math.max(
        0,
        toInt(refreshedInstance.objectiveState.completedAtMs, 0),
      );
      const nextCompletedAtMs = existingCompletedAtMs > 0 ? existingCompletedAtMs : nowMs;
      nextComparableObjectiveState.completedAtMs = nextCompletedAtMs;
      nextPatch.completedAtMs = nextCompletedAtMs;
    }
    if (
      !isDeepStrictEqual(
        currentComparableObjectiveState,
        nextComparableObjectiveState,
      )
    ) {
      nextPatch.metadata.lastProgressionAtMs = nowMs;
      dungeonRuntime.advanceObjective(refreshedInstance.instanceID, nextPatch, {
        nowMs,
      });
    }
  }
  return {
    roomsCompleted,
    gatesUnlocked,
    roomsActivated,
  };
}

function applyTriggeredSiteEffects(scene, instance, siteEntity, populationHints, trigger, options = {}) {
  const normalizedTrigger = normalizeLowerText(trigger, "");
  if (!scene || !instance || !normalizedTrigger) {
    return {
      removedContainers: 0,
      triggeredHazards: 0,
    };
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const contentEntities = listMaterializedUniverseSiteContentEntities(scene, {
    instanceID: Math.max(0, toInt(instance && instance.instanceID, 0)),
  });
  let removedContainers = 0;
  let triggeredHazards = 0;

  if (normalizedTrigger === "hack_failure") {
    for (const entity of contentEntities) {
      if (!entity || entity.dungeonMaterializedContainer !== true) {
        continue;
      }
      if (entity.dungeonSiteContentFailureExplodes !== true) {
        continue;
      }
      const removed = destroyMaterializedContentEntity(scene, entity, {
        broadcast: false,
        nowMs,
      });
      if (removed && removed.success) {
        removedContainers += 1;
      }
    }
  }

  if (normalizedTrigger === "visible_countdown") {
    for (const entity of contentEntities) {
      if (!entity || entity.dungeonMaterializedContainer !== true) {
        continue;
      }
      if (entity.dungeonSiteContentPersistsAfterResponse === true) {
        continue;
      }
      const removed = destroyMaterializedContentEntity(scene, entity, {
        broadcast: false,
        nowMs,
      });
      if (removed && removed.success) {
        removedContainers += 1;
      }
    }
  }

  for (const entity of contentEntities) {
    if (!entity || entity.dungeonMaterializedHazard !== true) {
      continue;
    }
    const shouldTrigger = (
      (normalizedTrigger === "hack_failure" && entity.dungeonHazardFailureTriggersExplosion === true) ||
      (normalizedTrigger === "visible_countdown" && Number(entity.dungeonHazardVisibleCountdownSeconds || 0) > 0)
    );
    if (!shouldTrigger) {
      continue;
    }
    if (normalizeLowerText(entity.dungeonHazardState, "") === "triggered") {
      continue;
    }
    entity.dungeonHazardState = "triggered";
    entity.dungeonHazardTriggeredAtMs = nowMs;
    triggeredHazards += 1;
  }

  if (removedContainers > 0 || triggeredHazards > 0) {
    dungeonRuntime.mergeHazardState(instance.instanceID, {
      lastTrigger: normalizedTrigger,
      lastTriggeredAtMs: nowMs,
      removedContainers,
      triggeredHazards,
      responseTriggered:
        normalizedTrigger === "visible_countdown" || normalizedTrigger === "hack_failure",
    }, { nowMs });
  }

  return {
    removedContainers,
    triggeredHazards,
  };
}

function tickSceneSiteBehaviors(scene, options = {}) {
  if (!scene) {
    return {
      armedCount: 0,
      encountersSpawned: 0,
      encounterCompletions: 0,
      gatesUnlocked: 0,
      rewardContainersSpawned: 0,
    };
  }
  const materializedSiteIDs = [...ensureSceneMaterializedSiteSet(scene)];
  if (materializedSiteIDs.length <= 0) {
    return {
      armedCount: 0,
      encountersSpawned: 0,
      encounterCompletions: 0,
      gatesUnlocked: 0,
      rewardContainersSpawned: 0,
    };
  }
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  let armedCount = 0;
  let encountersSpawned = 0;
  let encounterCompletions = 0;
  let gatesUnlocked = 0;
  let rewardContainersSpawned = 0;
  const instances = materializedSiteIDs
    .map((siteID) => resolveManagedUniverseSiteInstance(scene, null, { siteID }))
    .filter((instance) => isManagedMaterializedSiteInstance(instance));

  for (const instance of instances) {
    const template = dungeonAuthority.getTemplateByID(instance.templateID);
    const populationHints = resolvePopulationHints(instance, template);
    const plans = resolveEncounterPlans(populationHints);
    if (plans.length <= 0) {
      continue;
    }
    const siteID = Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0));
    const siteEntity = (
      scene.staticEntitiesByID &&
      scene.staticEntitiesByID.get(siteID)
    ) || buildSiteEntity(instance);
    if (!siteEntity) {
      continue;
    }
    if (!isSceneSiteMaterialized(scene, siteID)) {
      continue;
    }
    const progressResult = syncEncounterStateProgress(scene, instance, plans, { nowMs });
    encounterCompletions += Math.max(0, toInt(progressResult && progressResult.completedCount, 0));
    armedCount += armDeferredEncounterPlans(instance, populationHints, { nowMs });
    const visibleCountdownDue = hasDueVisibleCountdownTrigger(instance, populationHints, { nowMs });
    const visibleCountdownEncounters = processEncounterPlansForTrigger(
      scene,
      instance,
      siteEntity,
      populationHints,
      "visible_countdown",
      { nowMs },
    );
    encountersSpawned += visibleCountdownEncounters;
    if (visibleCountdownDue) {
      applyTriggeredSiteEffects(
        scene,
        instance,
        siteEntity,
        populationHints,
        "visible_countdown",
        { nowMs },
      );
      for (const plan of resolveEncounterPlans(populationHints)) {
        if (normalizeLowerText(plan && plan.trigger, "") !== "visible_countdown") {
          continue;
        }
        upsertEncounterState(instance.instanceID, plan.key, {
          triggeredEffectsAtMs: nowMs,
        }, { nowMs });
      }
    }
    const latestInstance = dungeonRuntime.getInstance(instance.instanceID) || instance;
    syncEncounterStateProgress(scene, latestInstance, plans, { nowMs });
    encountersSpawned += processEncounterPlansForTrigger(
      scene,
      latestInstance,
      siteEntity,
      populationHints,
      "wave_cleared",
      { nowMs },
    );
    const afterWaveClear = dungeonRuntime.getInstance(instance.instanceID) || latestInstance;
    syncEncounterStateProgress(scene, afterWaveClear, plans, { nowMs });
    encountersSpawned += processEncounterPlansForTrigger(
      scene,
      afterWaveClear,
      siteEntity,
      populationHints,
      "battleships_destroyed",
      { nowMs },
    );
    const refreshedForRewards = dungeonRuntime.getInstance(instance.instanceID) || afterWaveClear;
    syncEncounterStateProgress(scene, refreshedForRewards, plans, { nowMs });
    rewardContainersSpawned += materializeEncounterRewardContainers(
      scene,
      refreshedForRewards,
      siteEntity,
      template,
      populationHints,
      { nowMs },
    );
    const refreshedForProgression = dungeonRuntime.getInstance(instance.instanceID) || refreshedForRewards;
    const progressionResult = maybeAdvanceEncounterDrivenProgression(
      refreshedForProgression,
      populationHints,
      { nowMs },
    );
    maybeCompleteClearedEncounterSite(
      dungeonRuntime.getInstance(instance.instanceID) || refreshedForRewards,
      populationHints,
      { nowMs },
    );
    gatesUnlocked += Math.max(0, toInt(progressionResult && progressionResult.gatesUnlocked, 0));
  }

  return {
    armedCount,
    encountersSpawned,
    encounterCompletions,
    gatesUnlocked,
    rewardContainersSpawned,
  };
}

function triggerSiteEncounter(scene, instanceOrID, trigger, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_REQUIRED",
    };
  }
  const instance = typeof instanceOrID === "object"
    ? instanceOrID
    : dungeonRuntime.getInstance(Math.max(0, toInt(instanceOrID, 0)));
  if (!instance) {
    return {
      success: false,
      errorMsg: "INSTANCE_NOT_FOUND",
    };
  }
  const template = dungeonAuthority.getTemplateByID(instance.templateID);
  const populationHints = resolvePopulationHints(instance, template);
  const siteID = Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0));
  const siteEntity = (
    scene.staticEntitiesByID &&
    scene.staticEntitiesByID.get(siteID)
  ) || buildSiteEntity(instance);
  const triggeredEffects = applyTriggeredSiteEffects(
    scene,
    instance,
    siteEntity,
    populationHints,
    trigger,
    options,
  );
  const encountersSpawned = processEncounterPlansForTrigger(
    scene,
    instance,
    siteEntity,
    populationHints,
    trigger,
    options,
  );
  return {
    success: true,
    data: {
      encountersSpawned,
      removedContainers: Math.max(0, toInt(triggeredEffects && triggeredEffects.removedContainers, 0)),
      triggeredHazards: Math.max(0, toInt(triggeredEffects && triggeredEffects.triggeredHazards, 0)),
    },
  };
}

function materializeSiteContents(scene, instance, siteEntity, template, options = {}) {
  if (!scene || !siteEntity || !instance) {
    return {
      containersSpawned: 0,
      hazardsSpawned: 0,
      environmentPropsSpawned: 0,
      gatesSpawned: 0,
      objectivesSpawned: 0,
      encountersSpawned: 0,
    };
  }
  let workingInstance = dungeonRuntime.ensureTemplateRuntimeState(
    Math.max(0, toInt(instance && instance.instanceID, 0)),
    {
      nowMs: options.nowMs,
    },
  ) || instance;
  const populationHints = resolvePopulationHints(workingInstance, template);
  const rehydrated = rehydrateMissingEncounterStates(scene, workingInstance, populationHints, {
    nowMs: options.nowMs,
  });
  workingInstance = rehydrated.instance || workingInstance;
  const contentEntities = buildContainerEntities(workingInstance, siteEntity, populationHints);
  const staticBroadcastEntities = [];
  let containersSpawned = 0;
  for (const entity of contentEntities) {
    const created = materializeContainerEntity(
      scene,
      workingInstance,
      siteEntity,
      template,
      populationHints,
      entity,
      {
        nowMs: options.nowMs,
        broadcast: options.broadcast === true,
        excludedSession: options.excludedSession || null,
      },
    );
    if (created) {
      containersSpawned += 1;
    }
  }
  const hazardEntities = buildHazardEntities(workingInstance, siteEntity, populationHints);
  let hazardsSpawned = 0;
  for (const entity of hazardEntities) {
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      continue;
    }
    scene.addStaticEntity(entity);
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      hazardsSpawned += 1;
      staticBroadcastEntities.push(entity);
    }
  }
  const gateEntities = buildGateEntities(workingInstance, siteEntity, template);
  let gatesSpawned = 0;
  for (const entity of gateEntities) {
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      continue;
    }
    scene.addStaticEntity(entity);
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      gatesSpawned += 1;
      staticBroadcastEntities.push(entity);
    }
  }
  const environmentEntities = buildEnvironmentEntities(workingInstance, siteEntity, template, populationHints);
  let environmentPropsSpawned = 0;
  for (const entity of environmentEntities) {
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      continue;
    }
    scene.addStaticEntity(entity);
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      environmentPropsSpawned += 1;
      staticBroadcastEntities.push(entity);
    }
  }
  const objectiveEntities = buildObjectiveEntities(workingInstance, siteEntity, template, populationHints);
  let objectivesSpawned = 0;
  for (const entity of objectiveEntities) {
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      continue;
    }
    scene.addStaticEntity(entity);
    if (scene.staticEntitiesByID && scene.staticEntitiesByID.has(Number(entity.itemID))) {
      objectivesSpawned += 1;
      staticBroadcastEntities.push(entity);
    }
  }

  broadcastStaticSiteContentBatch(scene, staticBroadcastEntities, options);

  let encountersSpawned = 0;
  armDeferredEncounterPlans(workingInstance, populationHints, {
    nowMs: options.nowMs,
  });
  if (options.spawnEncounters !== false) {
    encountersSpawned += processEncounterPlansForTrigger(
      scene,
      workingInstance,
      siteEntity,
      populationHints,
      "on_load",
      {
        nowMs: options.nowMs,
      },
    );
    const refreshedInstance =
      dungeonRuntime.getInstance(Math.max(0, toInt(workingInstance && workingInstance.instanceID, 0))) ||
      workingInstance;
    syncEncounterStateProgress(scene, refreshedInstance, resolveEncounterPlans(populationHints), {
      nowMs: options.nowMs,
    });
    encountersSpawned += processEncounterPlansForTrigger(
      scene,
      refreshedInstance,
      siteEntity,
      populationHints,
      "wave_cleared",
      {
        nowMs: options.nowMs,
      },
    );
    const afterWaveClear =
      dungeonRuntime.getInstance(Math.max(0, toInt(workingInstance && workingInstance.instanceID, 0))) ||
      refreshedInstance;
    syncEncounterStateProgress(scene, afterWaveClear, resolveEncounterPlans(populationHints), {
      nowMs: options.nowMs,
    });
    encountersSpawned += processEncounterPlansForTrigger(
      scene,
      afterWaveClear,
      siteEntity,
      populationHints,
      "battleships_destroyed",
      {
        nowMs: options.nowMs,
      },
    );
  }

  return {
    containersSpawned,
    hazardsSpawned,
    environmentPropsSpawned,
    gatesSpawned,
    objectivesSpawned,
    encountersSpawned,
  };
}

function ensureSiteContentsMaterialized(scene, instanceOrSite, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const instance = resolveManagedUniverseSiteInstance(scene, instanceOrSite, options);
  if (!instance) {
    return {
      success: false,
      errorMsg: "INSTANCE_NOT_FOUND",
    };
  }

  const siteID = Math.max(0, toInt(instance && instance.metadata && instance.metadata.siteID, 0));
  if (siteID <= 0) {
    return {
      success: false,
      errorMsg: "SITE_NOT_FOUND",
    };
  }

  let siteEntity = (
    scene.staticEntitiesByID &&
    scene.staticEntitiesByID.get(siteID)
  ) || null;
  if (!siteEntity) {
    upsertSceneEntity(scene, instance, {
      broadcast: options.broadcast === true,
      excludedSession: options.excludedSession || null,
      nowMs: options.nowMs,
    });
    siteEntity = (
      scene.staticEntitiesByID &&
      scene.staticEntitiesByID.get(siteID)
    ) || buildSiteEntity(instance);
  }
  if (!siteEntity) {
    return {
      success: false,
      errorMsg: "SITE_ENTITY_NOT_FOUND",
    };
  }

  const alreadyMaterialized = isSceneSiteMaterialized(scene, siteID);

  const template = dungeonAuthority.getTemplateByID(instance.templateID);
  const contentSummary = materializeSiteContents(scene, instance, siteEntity, template, {
    spawnEncounters: options.spawnEncounters !== false,
    nowMs: options.nowMs,
    broadcast: options.broadcast === true,
    excludedSession: options.excludedSession || null,
  });
  markSceneSiteMaterialized(scene, siteID, instance.instanceID);
  if (options.session) {
    forceResyncSiteStaticContentForSession(scene, options.session, instance, {
      nowMs: options.nowMs,
      stampOverride: options.stampOverride,
    });
  }
  return {
    success: true,
    data: {
      instanceID: Math.max(0, toInt(instance.instanceID, 0)),
      siteID,
      alreadyMaterialized,
      contentSummary,
    },
  };
}

function upsertSceneEntity(scene, instance, options = {}) {
  const entity = buildSiteEntity(instance);
  if (!scene || !entity) {
    return false;
  }
  const existing = scene.staticEntitiesByID && scene.staticEntitiesByID.get(Number(entity.itemID));
  if (!existing) {
    if (!scene.addStaticEntity(entity)) {
      return false;
    }
    if (options.broadcast === true) {
      scene.broadcastAddBalls([entity], options.excludedSession || null);
    }
    return true;
  }

  const nextSignature = buildStableUniverseSiteEntitySignature(entity);
  const previousSignature = buildStableUniverseSiteEntitySignature(existing);
  if (previousSignature === nextSignature) {
    return false;
  }

  scene.removeStaticEntity(entity.itemID, {
    broadcast: options.broadcast === true,
    excludedSession: options.excludedSession || null,
    nowMs: options.nowMs,
  });
  if (!scene.addStaticEntity(entity)) {
    return false;
  }
  if (options.broadcast === true) {
    scene.broadcastAddBalls([entity], options.excludedSession || null);
  }
  return true;
}

function removeSceneEntity(scene, siteID, options = {}) {
  if (!scene) {
    return false;
  }
  const removeResult = scene.removeStaticEntity(siteID, {
    broadcast: options.broadcast === true,
    excludedSession: options.excludedSession || null,
    nowMs: options.nowMs,
  });
  return Boolean(removeResult && removeResult.success === true);
}

function removeSceneSiteContent(scene, siteID, options = {}) {
  if (!scene) {
    return 0;
  }
  const numericSiteID = Math.max(0, toInt(siteID, 0));
  if (numericSiteID <= 0) {
    return 0;
  }
  const contentEntities = listMaterializedUniverseSiteContentEntities(scene, {
    siteID: numericSiteID,
  });
  let removedCount = 0;
  for (const entity of contentEntities) {
    const removeResult = destroyMaterializedContentEntity(scene, entity, {
      broadcast: options.broadcast === true,
      excludedSession: options.excludedSession || null,
      nowMs: options.nowMs,
    });
    if (removeResult && removeResult.success === true) {
      removedCount += 1;
    }
  }
  unmarkSceneSiteMaterialized(scene, numericSiteID);
  return removedCount;
}

function notifyTrackerDelta(systemID, siteKind, options = {}) {
  const scanMgrService = getScanMgrService();
  if (siteKind === "anomaly") {
    scanMgrService.notifyAnomalyDeltaForSystem(systemID, options);
    return;
  }
  scanMgrService.notifySignatureDeltaForSystem(systemID, options);
}

function handleRuntimeChange(change) {
  const previous = change && change.before ? change.before : null;
  const next = change && change.after ? change.after : null;
  const runtime = getSpaceRuntime();
  const previousSystemID = Math.max(0, toInt(change && change.previousSolarSystemID, 0));
  const nextSystemID = Math.max(0, toInt(change && change.solarSystemID, 0));

  if (previousSystemID > 0 && (!next || nextSystemID !== previousSystemID) && isManagedMaterializedSiteInstance(previous)) {
    const previousScene = runtime.scenes.get(previousSystemID) || null;
    if (previousScene) {
      removeSceneSiteContent(
        previousScene,
        Math.max(0, toInt(previous && previous.metadata && previous.metadata.siteID, 0)),
        {
          broadcast: true,
        },
      );
      const removed = isManagedUniverseSiteInstance(previous)
        ? removeSceneEntity(
            previousScene,
            Math.max(0, toInt(previous && previous.metadata && previous.metadata.siteID, 0)),
            {
              broadcast: true,
            },
          )
        : true;
      if (removed && isManagedUniverseSiteInstance(previous)) {
        notifyTrackerDelta(previousSystemID, normalizeLowerText(previous && previous.siteKind, "signature"), {
          scene: previousScene,
          refresh: false,
        });
      }
    }
  }

  if (nextSystemID > 0 && isManagedMaterializedSiteInstance(next)) {
    const nextScene = runtime.scenes.get(nextSystemID) || null;
    if (nextScene) {
      const nextSiteID = Math.max(0, toInt(next && next.metadata && next.metadata.siteID, 0));
      const changed = upsertSceneEntity(nextScene, next, {
        broadcast: true,
      });
      if (changed && isSceneSiteMaterialized(nextScene, nextSiteID)) {
        removeSceneSiteContent(nextScene, nextSiteID, {
          broadcast: true,
        });
      }
      if (changed && isManagedUniverseSiteInstance(next)) {
        notifyTrackerDelta(nextSystemID, normalizeLowerText(next && next.siteKind, "signature"), {
          scene: nextScene,
          refresh: false,
        });
      }
    }
  }
}

function startRuntimeSync() {
  if (runtimeSyncStarted) {
    return true;
  }
  registeredListener = handleRuntimeChange;
  dungeonRuntime.registerInstanceChangeListener(registeredListener);
  if (!siteBehaviorTicker) {
    siteBehaviorTicker = setInterval(() => {
      const runtime = getSpaceRuntime();
      for (const scene of runtime && runtime.scenes instanceof Map ? runtime.scenes.values() : []) {
        if (ensureSceneMaterializedSiteSet(scene).size <= 0) {
          continue;
        }
        tickSceneSiteBehaviors(scene, {
          nowMs: Date.now(),
        });
      }
    }, SITE_CONTENT_BEHAVIOR_TICK_INTERVAL_MS);
    if (typeof siteBehaviorTicker.unref === "function") {
      siteBehaviorTicker.unref();
    }
  }
  runtimeSyncStarted = true;
  return true;
}

function stopRuntimeSync() {
  if (!runtimeSyncStarted || !registeredListener) {
    return false;
  }
  dungeonRuntime.unregisterInstanceChangeListener(registeredListener);
  if (siteBehaviorTicker) {
    clearInterval(siteBehaviorTicker);
    siteBehaviorTicker = null;
  }
  runtimeSyncStarted = false;
  registeredListener = null;
  return true;
}

function handleSceneCreated(scene) {
  if (!scene || scene._universeDungeonSitesInitialized === true) {
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  }

  scene._universeDungeonSitesInitialized = true;
  const spawned = [];
  const contentSummary = {
    containersSpawned: 0,
    hazardsSpawned: 0,
    environmentPropsSpawned: 0,
    gatesSpawned: 0,
    objectivesSpawned: 0,
    encountersSpawned: 0,
  };
  const instances = dungeonRuntime.listActiveInstancesBySystem(toInt(scene && scene.systemID, 0), {
    full: true,
  })
    .filter((instance) => isManagedMaterializedSiteInstance(instance));
  for (const instance of instances) {
    const entity = buildSiteEntity(instance);
    if (!entity) {
      continue;
    }
    if (scene.addStaticEntity(entity)) {
      spawned.push(entity);
    }
  }

  return {
    success: true,
    data: {
      spawned,
      contentSummary,
    },
  };
}

class DungeonUniverseSiteService extends BaseService {
  constructor() {
    super("dungeonUniverseSite");
  }
}

DungeonUniverseSiteService.buildSiteEntity = buildSiteEntity;
DungeonUniverseSiteService.ensureSiteContentsMaterialized = ensureSiteContentsMaterialized;
DungeonUniverseSiteService.handleSceneCreated = handleSceneCreated;
DungeonUniverseSiteService.listMaterializedUniverseSiteContentEntities =
  listMaterializedUniverseSiteContentEntities;
DungeonUniverseSiteService.listMaterializedUniverseSiteEntities = listMaterializedUniverseSiteEntities;
DungeonUniverseSiteService.startRuntimeSync = startRuntimeSync;
DungeonUniverseSiteService.stopRuntimeSync = stopRuntimeSync;
DungeonUniverseSiteService.tickSceneSiteBehaviors = tickSceneSiteBehaviors;
DungeonUniverseSiteService.triggerSiteEncounter = triggerSiteEncounter;
DungeonUniverseSiteService._testing = {
  applyTriggeredSiteEffects,
  buildGateEntities,
  buildEnvironmentEntities,
  buildContainerEntities,
  buildHazardEntities,
  buildObjectiveEntities,
  ensureSiteContentsMaterialized,
  forceResyncSiteStaticContentForSession,
  tickSceneSiteBehaviors,
  triggerSiteEncounter,
  handleRuntimeChange,
  isManagedUniverseSiteInstance,
  isSceneSiteMaterialized,
  materializeSiteContents,
  resolveManagedUniverseSiteInstance,
  resolveEncounterPlans,
  resolveLocalizedTemplateName,
  resolveFallbackStrengthAttribute,
  resolvePopulationHints,
  buildStableUniverseSiteEntitySignature,
  maybeCompleteClearedEncounterSite,
};

module.exports = DungeonUniverseSiteService;
