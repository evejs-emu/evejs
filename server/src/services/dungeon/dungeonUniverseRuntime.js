const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const database = require(path.join(__dirname, "../../newDatabase"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const dungeonAuthority = require(path.join(__dirname, "./dungeonAuthority"));
const dungeonRuntime = require(path.join(__dirname, "./dungeonRuntime"));
const dungeonSiteAdapter = require(path.join(__dirname, "./dungeonSiteAdapter"));
const dungeonRuntimeState = require(path.join(__dirname, "./dungeonRuntimeState"));
const {
  buildAnchorRelativeSignaturePlacement,
} = require(path.join(__dirname, "../exploration/signatures/signaturePlacement"));
const trigDrifterSpawnAuthority = require(path.join(
  __dirname,
  "../../space/npc/trigDrifter/trigDrifterSpawnAuthority",
));
const miningResourceSiteService = require(path.join(
  __dirname,
  "../mining/miningResourceSiteService",
));
const {
  MINING_RUNTIME_TABLE,
} = require(path.join(__dirname, "../mining/miningRuntimeState"));

const GENERATED_MINING_RECONCILE_INTERVAL_MS = 60_000;
const UNIVERSE_SLOT_TICK_INTERVAL_MS = 1_000;
const GENERATED_MINING_DEFAULT_SITE_LIFETIME_MINUTES = 1440;
const UNIVERSE_SITE_ID_SYSTEM_STRIDE = 1_000;
const UNIVERSE_SITE_ID_BASES = Object.freeze({
  combat: 5_300_000_000_000,
  combat_anomaly: 5_350_000_000_000,
  data: 5_400_000_000_000,
  drifter_observatory: 5_450_000_000_000,
  drifter_unidentified_wormhole: 5_475_000_000_000,
  drifter_space_sentinel_hive: 5_476_000_000_000,
  drifter_space_barbican_hive: 5_477_000_000_000,
  drifter_space_vidette_hive: 5_478_000_000_000,
  drifter_space_conflux_hive: 5_479_000_000_000,
  drifter_space_redoubt_hive: 5_480_000_000_000,
  drifter_space_reckoning_labyrinth: 5_481_000_000_000,
  drifter_space_reckoning_nexus: 5_482_000_000_000,
  drifter_occupied_tabbetzur_field_rescue: 5_483_000_000_000,
  drifter_occupied_tabbetzur_deathless_research_outpost: 5_484_000_000_000,
  drifter_vigilance_point: 5_485_000_000_000,
  drifter_observatory_infiltration: 5_486_000_000_000,
  drifter_deepflow_rift_pochven: 5_487_000_000_000,
  drifter_deepflow_rift_knownspace: 5_488_000_000_000,
  relic: 5_500_000_000_000,
  ghost: 5_600_000_000_000,
  combat_hacking: 5_700_000_000_000,
  ore: 5_800_000_000_000,
  gas: 5_900_000_000_000,
});
const COSMIC_SIGNATURE_TYPE_ID = 19_728;
const COSMIC_SIGNATURE_GROUP_ID = 502;
const COSMIC_ANOMALY_TYPE_ID = 28_356;
const COSMIC_ANOMALY_GROUP_ID = 885;
const BACKGROUND_RECONCILE_BATCH_SIZE = 96;
const BACKGROUND_RECONCILE_DELAY_MS = 25;

let universeReconcileTicker = null;
let backgroundReconcileJob = null;
let backgroundReconcileTimer = null;
let systemsByBandCache = null;
const eligibleSystemsByProfileCache = new Map();
const spawnProfileTemplateFilterCache = new Map();
const templateCandidatesBySpawnFamilyCache = new Map();
const bandTemplateCandidatesCache = new Map();

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

function normalizeTextArray(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((entry) => normalizeLowerText(entry, ""))
    .filter(Boolean))];
}

function normalizeIntegerArray(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((entry) => toInt(entry, 0))
    .filter((entry) => entry > 0))]
    .sort((left, right) => left - right);
}

function normalizeSecurityBand(value) {
  const normalized = normalizeLowerText(value, "nullsec");
  switch (normalized) {
    case "highsec":
    case "lowsec":
    case "nullsec":
    case "wormhole":
      return normalized;
    default:
      return "nullsec";
  }
}

function normalizeRatio(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function normalizeSystemIDs(systemIDs = null) {
  if (!Array.isArray(systemIDs) || systemIDs.length <= 0) {
    return worldData.getSolarSystems()
      .map((system) => toInt(system && system.solarSystemID, 0))
      .filter((entry) => entry > 0)
      .sort((left, right) => left - right);
  }

  return [...new Set(systemIDs
    .map((entry) => toInt(entry, 0))
    .filter((entry) => entry > 0))].sort((left, right) => left - right);
}

function listSystemIDsByBand(band) {
  if (!systemsByBandCache) {
    systemsByBandCache = {
      highsec: [],
      lowsec: [],
      nullsec: [],
      wormhole: [],
    };
    for (const systemID of normalizeSystemIDs()) {
      systemsByBandCache[getSecurityBand(systemID)].push(systemID);
    }
  }
  return [...(systemsByBandCache[normalizeSecurityBand(band)] || [])];
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function hashValue(value) {
  let state = toInt(value, 0) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state ^= state >>> 16;
  return state >>> 0;
}

function hashText(value) {
  const normalized = normalizeText(value, "");
  let state = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    state = hashValue(state + normalized.charCodeAt(index));
  }
  return state >>> 0;
}

function clonePosition(position, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(position && position.x, fallback.x),
    y: toFiniteNumber(position && position.y, fallback.y),
    z: toFiniteNumber(position && position.z, fallback.z),
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
  const x = toFiniteNumber(vector && vector.x, 0);
  const y = toFiniteNumber(vector && vector.y, 0);
  const z = toFiniteNumber(vector && vector.z, 0);
  const magnitude = Math.sqrt((x * x) + (y * y) + (z * z));
  if (magnitude <= 0) {
    return { ...fallback };
  }
  return {
    x: x / magnitude,
    y: y / magnitude,
    z: z / magnitude,
  };
}

function scaleVector(vector, scalar) {
  const numericScalar = toFiniteNumber(scalar, 0);
  return {
    x: toFiniteNumber(vector && vector.x, 0) * numericScalar,
    y: toFiniteNumber(vector && vector.y, 0) * numericScalar,
    z: toFiniteNumber(vector && vector.z, 0) * numericScalar,
  };
}

function getSecurityBand(systemID) {
  const numericSystemID = toInt(systemID, 0);
  if (numericSystemID >= 31_000_000 && numericSystemID <= 31_999_999) {
    return "wormhole";
  }
  const systemRecord = worldData.getSolarSystemByID(numericSystemID) || null;
  const securityStatus = toFiniteNumber(
    systemRecord && (systemRecord.securityStatus ?? systemRecord.security),
    0,
  );
  if (securityStatus >= 0.45) {
    return "highsec";
  }
  if (securityStatus >= 0) {
    return "lowsec";
  }
  return "nullsec";
}

function resolveSiteLifetimeMs(siteLifetimeMinutes) {
  return Math.max(60_000, Math.max(1, toInt(siteLifetimeMinutes, 1440)) * 60_000);
}

function getSpawnProfileTemplateFilters(family) {
  const cacheKey = normalizeLowerText(family, "unknown");
  if (spawnProfileTemplateFilterCache.has(cacheKey)) {
    return spawnProfileTemplateFilterCache.get(cacheKey);
  }
  const profile = dungeonAuthority.getSpawnProfile(family);
  const filters =
    profile && profile.templateFilters && typeof profile.templateFilters === "object"
      ? profile.templateFilters
      : {};
  const normalizedFilters = Object.freeze({
    siteFamilies: normalizeTextArray(filters.siteFamilies),
    siteKinds: normalizeTextArray(filters.siteKinds),
    nameIncludesAny: normalizeTextArray(filters.nameIncludesAny),
    nameExcludesAny: normalizeTextArray(filters.nameExcludesAny),
  });
  spawnProfileTemplateFilterCache.set(cacheKey, normalizedFilters);
  return normalizedFilters;
}

function buildBandCounts(systemIDs = null) {
  const counts = {
    highsec: 0,
    lowsec: 0,
    nullsec: 0,
    wormhole: 0,
  };
  for (const systemID of normalizeSystemIDs(systemIDs)) {
    counts[getSecurityBand(systemID)] += 1;
  }
  return counts;
}

function buildBandProfileCacheKey(family, band, bandProfile) {
  const profile = dungeonAuthority.getSpawnProfile(family) || {};
  return JSON.stringify({
    family: normalizeLowerText(family, ""),
    band: normalizeSecurityBand(band),
    slotsPerSystem: Math.max(0, toInt(bandProfile && bandProfile.slotsPerSystem, 0)),
    systemStride: Math.max(1, toInt(bandProfile && bandProfile.systemStride, 1)),
    systemOffset: Math.max(0, toInt(bandProfile && bandProfile.systemOffset, 0)),
    targetSystems: Math.max(0, toInt(bandProfile && bandProfile.targetSystems, 0)),
    targetSystemRatio: normalizeRatio(bandProfile && bandProfile.targetSystemRatio, 0),
    systemAuthorityKeys: normalizeTextArray([
      ...(Array.isArray(profile.systemAuthorityKeys) ? profile.systemAuthorityKeys : []),
      ...(Array.isArray(bandProfile && bandProfile.systemAuthorityKeys)
        ? bandProfile.systemAuthorityKeys
        : []),
    ]),
    systemIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.systemIDs) ? profile.systemIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.systemIDs) ? bandProfile.systemIDs : []),
    ]),
    regionIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.regionIDs) ? profile.regionIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.regionIDs) ? bandProfile.regionIDs : []),
    ]),
    constellationIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.constellationIDs) ? profile.constellationIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.constellationIDs)
        ? bandProfile.constellationIDs
        : []),
    ]),
    wormholeClassIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.wormholeClassIDs) ? profile.wormholeClassIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.wormholeClassIDs)
        ? bandProfile.wormholeClassIDs
        : []),
    ]),
    excludeSystemIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeSystemIDs) ? profile.excludeSystemIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeSystemIDs)
        ? bandProfile.excludeSystemIDs
        : []),
    ]),
    excludeRegionIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeRegionIDs) ? profile.excludeRegionIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeRegionIDs)
        ? bandProfile.excludeRegionIDs
        : []),
    ]),
    excludeConstellationIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeConstellationIDs) ? profile.excludeConstellationIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeConstellationIDs)
        ? bandProfile.excludeConstellationIDs
        : []),
    ]),
    excludeWormholeClassIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeWormholeClassIDs) ? profile.excludeWormholeClassIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeWormholeClassIDs)
        ? bandProfile.excludeWormholeClassIDs
        : []),
    ]),
  });
}

function resolveBandTargetSystemCount(totalSystems, bandProfile) {
  const cappedTotal = Math.max(0, toInt(totalSystems, 0));
  if (cappedTotal <= 0) {
    return 0;
  }
  const explicitCount = Math.max(0, toInt(bandProfile && bandProfile.targetSystems, 0));
  if (explicitCount > 0) {
    return Math.min(cappedTotal, explicitCount);
  }
  const ratio = normalizeRatio(bandProfile && bandProfile.targetSystemRatio, 0);
  if (ratio > 0) {
    return Math.min(cappedTotal, Math.max(1, Math.round(cappedTotal * ratio)));
  }
  return 0;
}

function buildScopedSystemSelector(family, bandProfile) {
  const profile = dungeonAuthority.getSpawnProfile(family) || {};
  return {
    systemAuthorityKeys: normalizeTextArray([
      ...(Array.isArray(profile.systemAuthorityKeys) ? profile.systemAuthorityKeys : []),
      ...(Array.isArray(bandProfile && bandProfile.systemAuthorityKeys)
        ? bandProfile.systemAuthorityKeys
        : []),
    ]),
    systemIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.systemIDs) ? profile.systemIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.systemIDs) ? bandProfile.systemIDs : []),
    ]),
    regionIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.regionIDs) ? profile.regionIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.regionIDs) ? bandProfile.regionIDs : []),
    ]),
    constellationIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.constellationIDs) ? profile.constellationIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.constellationIDs)
        ? bandProfile.constellationIDs
        : []),
    ]),
    wormholeClassIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.wormholeClassIDs) ? profile.wormholeClassIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.wormholeClassIDs)
        ? bandProfile.wormholeClassIDs
        : []),
    ]),
    excludeSystemIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeSystemIDs) ? profile.excludeSystemIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeSystemIDs)
        ? bandProfile.excludeSystemIDs
        : []),
    ]),
    excludeRegionIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeRegionIDs) ? profile.excludeRegionIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeRegionIDs)
        ? bandProfile.excludeRegionIDs
        : []),
    ]),
    excludeConstellationIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeConstellationIDs) ? profile.excludeConstellationIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeConstellationIDs)
        ? bandProfile.excludeConstellationIDs
        : []),
    ]),
    excludeWormholeClassIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeWormholeClassIDs) ? profile.excludeWormholeClassIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeWormholeClassIDs)
        ? bandProfile.excludeWormholeClassIDs
        : []),
    ]),
  };
}

function filterSystemIDsByScopedSelector(systemIDs, selector = {}) {
  const candidateSystemIDs = normalizeSystemIDs(systemIDs);
  const authoritySystemIDs = normalizeIntegerArray(
    normalizeTextArray(selector.systemAuthorityKeys)
      .flatMap((key) => trigDrifterSpawnAuthority.getSystemList(key)),
  );
  const explicitSystemIDs = normalizeIntegerArray(selector.systemIDs);
  const regionIDs = new Set(normalizeIntegerArray(selector.regionIDs));
  const constellationIDs = new Set(normalizeIntegerArray(selector.constellationIDs));
  const wormholeClassIDs = new Set(normalizeIntegerArray(selector.wormholeClassIDs));
  const excludeSystemIDs = new Set(normalizeIntegerArray(selector.excludeSystemIDs));
  const excludeRegionIDs = new Set(normalizeIntegerArray(selector.excludeRegionIDs));
  const excludeConstellationIDs = new Set(normalizeIntegerArray(selector.excludeConstellationIDs));
  const excludeWormholeClassIDs = new Set(normalizeIntegerArray(selector.excludeWormholeClassIDs));
  const scopedSystemIDs = new Set([
    ...authoritySystemIDs,
    ...explicitSystemIDs,
  ]);
  const hasScopedSelectors =
    scopedSystemIDs.size > 0 ||
    regionIDs.size > 0 ||
    constellationIDs.size > 0 ||
    wormholeClassIDs.size > 0;
  const hasExcludeSelectors =
    excludeSystemIDs.size > 0 ||
    excludeRegionIDs.size > 0 ||
    excludeConstellationIDs.size > 0 ||
    excludeWormholeClassIDs.size > 0;

  const filtered = candidateSystemIDs.filter((systemID) => {
    if (excludeSystemIDs.has(systemID)) {
      return false;
    }
    const systemRecord = worldData.getSolarSystemByID(systemID) || null;
    const regionID = toInt(systemRecord && systemRecord.regionID, 0);
    if (excludeRegionIDs.has(regionID)) {
      return false;
    }
    const constellationID = toInt(systemRecord && systemRecord.constellationID, 0);
    if (excludeConstellationIDs.has(constellationID)) {
      return false;
    }
    const wormholeClassID = toInt(systemRecord && systemRecord.wormholeClassID, 0);
    if (excludeWormholeClassIDs.has(wormholeClassID)) {
      return false;
    }
    if (!hasScopedSelectors) {
      return true;
    }
    if (scopedSystemIDs.has(systemID)) {
      return true;
    }
    if (regionIDs.has(regionID)) {
      return true;
    }
    if (constellationIDs.has(constellationID)) {
      return true;
    }
    return wormholeClassIDs.has(wormholeClassID);
  });

  return hasScopedSelectors || hasExcludeSelectors
    ? filtered
    : candidateSystemIDs;
}

function listEligibleSystemIDsForBandProfile(family, band, bandProfile, systemIDs = null) {
  const normalizedBand = normalizeSecurityBand(band);
  const slotsPerSystem = Math.max(0, toInt(bandProfile && bandProfile.slotsPerSystem, 0));
  if (slotsPerSystem <= 0) {
    return [];
  }
  const fullBandSystemIDs = filterSystemIDsByScopedSelector(
    listSystemIDsByBand(normalizedBand),
    buildScopedSystemSelector(family, bandProfile),
  );
  const cacheKey = buildBandProfileCacheKey(family, normalizedBand, bandProfile);
  let eligible = eligibleSystemsByProfileCache.get(cacheKey);
  if (!eligible) {
    const targetCount = resolveBandTargetSystemCount(fullBandSystemIDs.length, bandProfile);
    if (targetCount > 0) {
      eligible = fullBandSystemIDs
        .map((systemID) => ({
          systemID,
          score: hashValue(
            (toInt(systemID, 0) * 8191) +
            hashText(family) +
            (hashText(normalizedBand) * 17),
          ),
        }))
        .sort((left, right) => (
          left.score - right.score
        ) || (
          left.systemID - right.systemID
        ))
        .slice(0, targetCount)
        .map((entry) => entry.systemID)
        .sort((left, right) => left - right);
    } else {
      const stride = Math.max(1, toInt(bandProfile && bandProfile.systemStride, 1));
      const offset = Math.max(0, toInt(bandProfile && bandProfile.systemOffset, 0)) % stride;
      eligible = fullBandSystemIDs.filter((systemID) => {
        if (stride <= 1) {
          return true;
        }
        return (hashValue(toInt(systemID, 0) + hashText(family)) % stride) === offset;
      });
    }
    eligibleSystemsByProfileCache.set(cacheKey, eligible);
  }
  if (!Array.isArray(systemIDs) || systemIDs.length <= 0) {
    return [...eligible];
  }
  const targeted = new Set(normalizeSystemIDs(systemIDs));
  return eligible.filter((systemID) => targeted.has(systemID));
}

function pickMiningGenerationConfig() {
  const picked = {};
  for (const [key, value] of Object.entries(config || {})) {
    if (
      key === "miningGeneratedIceSitesEnabled" ||
      key.startsWith("miningIceSites") ||
      key.startsWith("miningIceTargetSystems") ||
      key === "miningIceChunksPerSite" ||
      key === "miningGeneratedIceSiteLifetimeMinutes"
    ) {
      picked[key] = cloneValue(value);
    }
  }
  return picked;
}

function getGeneratedMiningSlotsPerSystem(kind, securityBand) {
  const normalizedKind = normalizeLowerText(kind, "ice");
  const band = normalizeSecurityBand(securityBand);
  switch (`${normalizedKind}:${band}`) {
    case "ice:highsec":
      return Math.max(0, toInt(config && config.miningIceSitesHighSecPerSystem, 1));
    case "ice:lowsec":
      return Math.max(0, toInt(config && config.miningIceSitesLowSecPerSystem, 1));
    case "ice:nullsec":
      return Math.max(0, toInt(config && config.miningIceSitesNullSecPerSystem, 1));
    case "ice:wormhole":
      return Math.max(0, toInt(config && config.miningIceSitesWormholePerSystem, 0));
    default:
      return 0;
  }
}

function getGeneratedMiningTargetSystems(kind, securityBand) {
  const normalizedKind = normalizeLowerText(kind, "ice");
  const band = normalizeSecurityBand(securityBand);
  switch (`${normalizedKind}:${band}`) {
    case "ice:highsec":
      return Math.max(0, toInt(config && config.miningIceTargetSystemsHighSec, 36));
    case "ice:lowsec":
      return Math.max(0, toInt(config && config.miningIceTargetSystemsLowSec, 18));
    case "ice:nullsec":
      return Math.max(0, toInt(config && config.miningIceTargetSystemsNullSec, 84));
    case "ice:wormhole":
      return Math.max(0, toInt(config && config.miningIceTargetSystemsWormhole, 0));
    default:
      return 0;
  }
}

function buildGeneratedMiningBandProfile(kind, securityBand) {
  return {
    slotsPerSystem: getGeneratedMiningSlotsPerSystem(kind, securityBand),
    systemStride: 1,
    systemOffset: 0,
    targetSystems: getGeneratedMiningTargetSystems(kind, securityBand),
    targetSystemRatio: 0,
  };
}

function resolveGeneratedMiningSiteLifetimeMs() {
  return resolveSiteLifetimeMs(
    Math.max(
      1,
      toInt(
        config && config.miningGeneratedIceSiteLifetimeMinutes,
        GENERATED_MINING_DEFAULT_SITE_LIFETIME_MINUTES,
      ),
    ),
  );
}

function buildBroadUniverseDescriptor(systemIDs = null) {
  const authorityPayload = dungeonAuthority.getPayload();
  const families = dungeonAuthority.listUniverseSpawnFamilies();
  const bandCounts = buildBandCounts(systemIDs);
  const systemCount = Object.values(bandCounts).reduce((sum, count) => sum + count, 0);
  let estimatedSiteCount = 0;
  const familyPolicies = {};

  for (const family of families) {
    const profile = dungeonAuthority.getSpawnProfile(family);
    if (!profile || profile.enabled === false || profile.persistent === false) {
      continue;
    }
    const slots = {};
    const strides = {};
    const targetSystems = {};
    for (const band of ["highsec", "lowsec", "nullsec", "wormhole"]) {
      const bandProfile = profile.bands && profile.bands[band];
      const slotsPerSystem = Math.max(0, toInt(bandProfile && bandProfile.slotsPerSystem, 0));
      slots[band] = slotsPerSystem;
      strides[band] = Math.max(1, toInt(bandProfile && bandProfile.systemStride, 1));
      targetSystems[band] = listEligibleSystemIDsForBandProfile(family, band, bandProfile, systemIDs).length;
      estimatedSiteCount += slotsPerSystem * targetSystems[band];
    }
    familyPolicies[family] = {
      siteLifetimeMinutes: Math.max(1, toInt(profile.siteLifetimeMinutes, 1440)),
      siteLifetimeMs: resolveSiteLifetimeMs(profile.siteLifetimeMinutes),
      siteOrigin: normalizeLowerText(profile.siteOrigin, "universe_dungeon"),
      slots,
      strides,
      targetSystems,
    };
  }

  const descriptor = {
    scope: Array.isArray(systemIDs) && systemIDs.length > 0 ? "subset" : "full",
    systemCount,
    bandCounts,
    authorityVersion: Math.max(0, toInt(authorityPayload && authorityPayload.version, 0)),
    authorityTemplateCount: Math.max(
      0,
      toInt(authorityPayload && authorityPayload.counts && authorityPayload.counts.templateCount, 0),
    ),
    familyPolicies,
    estimatedSiteCount,
  };
  return {
    descriptor,
    descriptorKey: JSON.stringify(descriptor),
  };
}

function buildMiningUniverseDescriptor(systemIDs = null) {
  const bandCounts = buildBandCounts(systemIDs);
  const targetSystems = {};
  for (const band of ["highsec", "lowsec", "nullsec", "wormhole"]) {
    targetSystems[band] = listEligibleSystemIDsForBandProfile(
      "generatedmining:ice",
      band,
      buildGeneratedMiningBandProfile("ice", band),
      systemIDs,
    ).length;
  }
  const descriptor = {
    scope: Array.isArray(systemIDs) && systemIDs.length > 0 ? "subset" : "full",
    systemCount: Object.values(bandCounts).reduce((sum, count) => sum + count, 0),
    bandCounts,
    generationConfig: pickMiningGenerationConfig(),
    targetSystems,
  };
  return {
    descriptor,
    descriptorKey: JSON.stringify(descriptor),
  };
}

function buildUniverseDescriptor() {
  const broad = buildBroadUniverseDescriptor();
  const mining = buildMiningUniverseDescriptor();
  const descriptor = {
    version: 2,
    broadDescriptorKey: broad.descriptorKey,
    miningDescriptorKey: mining.descriptorKey,
  };
  return {
    descriptor: {
      ...descriptor,
      broad: broad.descriptor,
      mining: mining.descriptor,
    },
    descriptorKey: JSON.stringify(descriptor),
    broadDescriptorKey: broad.descriptorKey,
    miningDescriptorKey: mining.descriptorKey,
  };
}

function getUniverseReconcileStatus(nowMs = Date.now()) {
  const meta = dungeonRuntimeState.getUniverseReconcileMeta();
  const descriptor = buildUniverseDescriptor();
  return {
    nowMs: Math.max(0, toInt(nowMs, Date.now())),
    meta,
    descriptor,
    broadUpToDate:
      normalizeText(meta && meta.broadDescriptorKey, "") === descriptor.broadDescriptorKey,
    miningUpToDate:
      normalizeText(meta && meta.miningDescriptorKey, "") === descriptor.miningDescriptorKey,
    fullUpToDate:
      normalizeText(meta && meta.descriptorKey, "") === descriptor.descriptorKey,
  };
}

function writeUniverseReconcileMeta(summary = {}, options = {}) {
  const descriptor = options.descriptor || buildUniverseDescriptor(options.nowMs);
  return dungeonRuntimeState.writeUniverseReconcileMeta({
    version: 1,
    descriptorKey: descriptor.descriptorKey,
    broadDescriptorKey: descriptor.broadDescriptorKey,
    miningDescriptorKey: descriptor.miningDescriptorKey,
    lastStartedAtMs: Math.max(0, toInt(options.startedAtMs, Date.now())),
    lastCompletedAtMs: Math.max(0, toInt(options.completedAtMs, Date.now())),
    lastScope: normalizeText(options.scope, "full"),
    lastReason: normalizeText(options.reason, ""),
    summary: cloneValue(summary),
  });
}

function extractStaticPosition(record) {
  const position = record && record.position && typeof record.position === "object"
    ? record.position
    : record;
  return {
    x: toFiniteNumber(position && position.x, 0),
    y: toFiniteNumber(position && position.y, 0),
    z: toFiniteNumber(position && position.z, 0),
  };
}

function buildUniverseAnchorCandidates(systemID, family) {
  const normalizedFamily = normalizeLowerText(family, "combat");
  const belts = worldData.getAsteroidBeltsForSystem(systemID)
    .map((belt) => ({
      itemID: toInt(belt && belt.itemID, 0),
      position: extractStaticPosition(belt),
    }))
    .filter((entry) => entry.itemID > 0);
  const celestials = worldData.getCelestialsForSystem(systemID)
    .filter((celestial) => toInt(celestial && celestial.groupID, 0) !== 6)
    .map((celestial) => ({
      itemID: toInt(celestial && celestial.itemID, 0),
      position: extractStaticPosition(celestial),
    }))
    .filter((entry) => entry.itemID > 0);
  const stations = worldData.getStationsForSystem(systemID)
    .map((station) => ({
      itemID: toInt(station && station.stationID, 0),
      position: extractStaticPosition(station),
    }))
    .filter((entry) => entry.itemID > 0);
  const stargates = worldData.getStargatesForSystem(systemID)
    .map((stargate) => ({
      itemID: toInt(stargate && stargate.itemID, 0),
      position: extractStaticPosition(stargate),
    }))
    .filter((entry) => entry.itemID > 0);

  const ordered = normalizedFamily === "ore" || normalizedFamily === "gas"
    ? [...belts, ...celestials, ...stations, ...stargates]
    : [...celestials, ...belts, ...stations, ...stargates];
  if (ordered.length > 0) {
    return ordered;
  }

  const systemRecord = worldData.getSolarSystemByID(systemID) || null;
  const fallbackRadius = Math.max(
    1_000_000_000,
    Math.round(toFiniteNumber(systemRecord && systemRecord.radius, 0) * 0.25),
  );
  return [{
    itemID: systemID,
    position: { x: fallbackRadius, y: 0, z: 0 },
  }];
}

function buildUniverseSitePosition(systemID, family, slotIndex, rotationIndex = 0) {
  return buildUniverseSitePlacement(systemID, family, slotIndex, rotationIndex).position;
}

function buildUniverseSitePlacement(systemID, family, slotIndex, rotationIndex = 0) {
  const anchorCandidates = buildUniverseAnchorCandidates(systemID, family);
  const placement = buildAnchorRelativeSignaturePlacement(
    anchorCandidates,
    `universe-site:${normalizeLowerText(family, "unknown")}:${toInt(systemID, 0)}:${Math.max(0, toInt(slotIndex, 0))}:${Math.max(0, toInt(rotationIndex, 0))}`,
    {
      fallbackAnchorItemID: toInt(systemID, 0),
      baseDistanceAu: 4,
      distanceJitterAu: 0.35,
      verticalJitterAu: 0.14,
    },
  );
  return {
    ...placement,
    anchorDistanceMeters: toFiniteNumber(placement && placement.distanceMeters, 0),
    anchorDistanceAu: toFiniteNumber(placement && placement.distanceAu, 0),
  };
}

function buildGeneratedMiningSiteKey(definition) {
  return [
    "generatedmining",
    normalizeText(definition && definition.family, "unknown").toLowerCase(),
    toInt(definition && definition.solarSystemID, 0),
    toInt(definition && definition.localSiteIndex, 0),
  ].join(":");
}

function buildGeneratedMiningDefinitionHash(definition, templateID, placement = null) {
  const sitePosition = placement && placement.position
    ? placement.position
    : definition && definition.position;
  return JSON.stringify({
    templateID: normalizeText(templateID, ""),
    family: normalizeText(definition && definition.family, "unknown").toLowerCase(),
    solarSystemID: toInt(definition && definition.solarSystemID, 0),
    localSiteIndex: toInt(definition && definition.localSiteIndex, 0),
    rawSiteIndex: toInt(definition && definition.rawSiteIndex, 0),
    rotationIndex: Math.max(0, toInt(definition && definition.rotationIndex, 0)),
    resourceTypeIDs: Array.isArray(definition && definition.resourceTypeIDs)
      ? [...definition.resourceTypeIDs]
      : [],
    members: (Array.isArray(definition && definition.members) ? definition.members : [])
      .map((member) => [
        toInt(member && member.entityID, 0),
        toInt(member && member.yieldTypeID, 0),
        Math.max(0, toInt(member && member.originalQuantity, 0)),
      ]),
    anchorItemID: toInt(placement && placement.anchorItemID, 0),
    anchorDistanceMeters: Math.round(toFiniteNumber(placement && placement.anchorDistanceMeters, 0)),
    position: [
      Math.round(toFiniteNumber(sitePosition && sitePosition.x, 0)),
      Math.round(toFiniteNumber(sitePosition && sitePosition.y, 0)),
      Math.round(toFiniteNumber(sitePosition && sitePosition.z, 0)),
    ],
  });
}

function buildGeneratedMiningSpawnState(definition) {
  const members = (Array.isArray(definition && definition.members) ? definition.members : [])
    .map((member) => cloneValue(member));
  return {
    siteID: toInt(definition && definition.siteID, 0),
    rawSiteIndex: toInt(definition && definition.rawSiteIndex, 0),
    localSiteIndex: toInt(definition && definition.localSiteIndex, 0),
    label: normalizeText(definition && definition.label, "Mining Site"),
    memberCount: members.length,
    activeMemberCount: members.filter((member) => toInt(member && member.remainingQuantity, 0) > 0).length,
    totalOriginalQuantity: members.reduce(
      (sum, member) => sum + Math.max(0, toInt(member && member.originalQuantity, 0)),
      0,
    ),
    totalRemainingQuantity: members.reduce(
      (sum, member) => sum + Math.max(0, toInt(member && member.remainingQuantity, 0)),
      0,
    ),
    resourceTypeIDs: Array.isArray(definition && definition.resourceTypeIDs)
      ? [...definition.resourceTypeIDs]
      : [],
    resourceNames: Array.isArray(definition && definition.resourceNames)
      ? [...definition.resourceNames]
      : [],
    members,
  };
}

function resolveGeneratedMiningTemplate(definition) {
  const family = normalizeText(definition && definition.family, "unknown").toLowerCase();
  const resourceHintField =
    family === "gas"
      ? "gasTypeIDs"
      : (
        family === "ice"
          ? "iceTypeIDs"
          : "oreTypeIDs"
      );
  const hints = {
    [resourceHintField]: Array.isArray(definition && definition.resourceTypeIDs)
      ? definition.resourceTypeIDs
      : [],
  };
  return dungeonSiteAdapter.resolveTemplateForSite({
    solarSystemID: toInt(definition && definition.solarSystemID, 0),
    siteKind: "anomaly",
    family,
    label: normalizeText(definition && definition.label, "Mining Site"),
  }, hints);
}

function enrichGeneratedMiningDefinition(definition, nowMs, options = {}) {
  const template = resolveGeneratedMiningTemplate(definition);
  if (!template) {
    return null;
  }

  const templateID = normalizeText(template.templateID, "");
  const slotIndex = Math.max(
    0,
    toInt(
      definition && definition.localSiteIndex,
      options && options.slotIndex,
    ),
  );
  const rotationIndex = Math.max(
    0,
    toInt(
      options && options.rotationIndex,
      definition && definition.rotationIndex,
    ),
  );
  const startedAtMs = Math.max(0, toInt(options && options.startedAtMs, nowMs));
  const lifetimeMs = Math.max(
    60_000,
    toInt(
      options && options.lifetimeMs,
      resolveGeneratedMiningSiteLifetimeMs(),
    ),
  );
  const placement = buildUniverseSitePlacement(
    toInt(definition && definition.solarSystemID, 0),
    normalizeText(definition && definition.family, "ice").toLowerCase(),
    slotIndex,
    rotationIndex,
  );
  const position = placement.position;
  return {
    templateID,
    solarSystemID: toInt(definition && definition.solarSystemID, 0),
    siteKey: buildGeneratedMiningSiteKey(definition),
    lifecycleState: "active",
    instanceScope: "shared",
    siteFamily: normalizeText(definition && definition.family, "unknown").toLowerCase(),
    siteKind: "anomaly",
    siteOrigin: "generatedMining",
    position,
    nowMs: startedAtMs,
    activatedAtMs: startedAtMs,
    expiresAtMs: startedAtMs + lifetimeMs,
    spawnState: {
      ...buildGeneratedMiningSpawnState(definition),
      slotIndex,
      rotationIndex,
      securityBand: normalizeText(definition && definition.securityBand, getSecurityBand(definition && definition.solarSystemID)),
      lifetimeMs,
      anchorItemID: toInt(placement && placement.anchorItemID, 0) || null,
      anchorDistanceMeters: Math.round(toFiniteNumber(placement && placement.anchorDistanceMeters, 0)),
      anchorDistanceAu: Number(toFiniteNumber(placement && placement.anchorDistanceAu, 0).toFixed(3)),
    },
    roomStatesByKey: {
      "room:entry": {
        roomKey: "room:entry",
        state: "active",
        stage: "entry",
        pocketID: null,
        nodeGraphID: null,
        activatedAtMs: startedAtMs,
        completedAtMs: 0,
        lastUpdatedAtMs: startedAtMs,
        spawnedEntityIDs: [],
        counters: {},
        metadata: {
          seededFromTemplate: false,
          lightweight: true,
        },
      },
    },
    gateStatesByKey: {},
    objectiveState: {
      state: "pending",
      currentNodeID: null,
      currentObjectiveID: null,
      completedObjectiveIDs: [],
      completedNodeIDs: [],
      counters: {},
      metadata: {
        lightweight: true,
      },
    },
    environmentState: {
      seededAtMs: startedAtMs,
      lightweight: true,
    },
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
      lazyMaterialized: true,
      generatedMining: true,
    },
    metadata: {
      providerID: "generatedMining",
      definitionHash: buildGeneratedMiningDefinitionHash(definition, templateID, placement),
      siteID: toInt(definition && definition.siteID, 0),
      rawSiteIndex: toInt(definition && definition.rawSiteIndex, 0),
      localSiteIndex: slotIndex,
      slotIndex,
      rotationIndex,
      label: normalizeText(definition && definition.label, "Mining Site"),
      securityBand: normalizeText(definition && definition.securityBand, getSecurityBand(definition && definition.solarSystemID)),
      universeSeededAtMs: startedAtMs,
      anchorItemID: toInt(placement && placement.anchorItemID, 0) || null,
      anchorDistanceMeters: Math.round(toFiniteNumber(placement && placement.anchorDistanceMeters, 0)),
      anchorDistanceAu: Number(toFiniteNumber(placement && placement.anchorDistanceAu, 0).toFixed(3)),
    },
  };
}

function listDesiredGeneratedMiningDefinitions(systemIDs = null, nowMs = Date.now()) {
  const targetedSystemIDs = normalizeSystemIDs(systemIDs);
  const eligibleSystemIDs = ["highsec", "lowsec", "nullsec", "wormhole"]
    .flatMap((band) => listEligibleSystemIDsForBandProfile(
      "generatedmining:ice",
      band,
      buildGeneratedMiningBandProfile("ice", band),
      targetedSystemIDs,
    ));
  return eligibleSystemIDs
    .flatMap((systemID) => miningResourceSiteService.buildGeneratedResourceSiteDefinitionsForSystem(systemID))
    .map((definition) => enrichGeneratedMiningDefinition(definition, nowMs))
    .filter(Boolean);
}

function buildGeneratedMiningDefinitionFromInstance(instance) {
  if (
    !instance ||
    normalizeLowerText(instance && instance.siteOrigin, "") !== "generatedmining"
  ) {
    return null;
  }
  const metadata = instance && instance.metadata && typeof instance.metadata === "object"
    ? instance.metadata
    : {};
  const spawnState = instance && instance.spawnState && typeof instance.spawnState === "object"
    ? instance.spawnState
    : {};
  const family = normalizeText(instance && instance.siteFamily, "ice").toLowerCase();
  const rawSiteIndex = Math.max(
    0,
    toInt(
      metadata.rawSiteIndex,
      spawnState.rawSiteIndex,
    ),
  );
  const localSiteIndex = Math.max(
    0,
    toInt(
      metadata.localSiteIndex,
      spawnState.localSiteIndex,
    ),
  );
  const definition = {
    solarSystemID: Math.max(0, toInt(instance && instance.solarSystemID, 0)),
    family,
    siteFamily: family,
    siteKind: "anomaly",
    localSiteIndex,
    rawSiteIndex,
    rotationIndex: Math.max(
      0,
      toInt(
        metadata.rotationIndex,
        spawnState.rotationIndex,
      ),
    ),
    siteID: Math.max(
      0,
      toInt(
        metadata.siteID,
        spawnState.siteID,
      ),
    ),
    label: normalizeText(
      metadata.label,
      normalizeText(spawnState.label, "Mining Site"),
    ),
    securityBand: normalizeText(
      metadata.securityBand,
      normalizeText(
        spawnState.securityBand,
        getSecurityBand(instance && instance.solarSystemID),
      ),
    ),
    memberCount: Math.max(
      0,
      toInt(spawnState.memberCount, Array.isArray(spawnState.members) ? spawnState.members.length : 0),
    ),
    activeMemberCount: Math.max(
      0,
      toInt(
        spawnState.activeMemberCount,
        Array.isArray(spawnState.members)
          ? spawnState.members.filter((member) => toInt(member && member.remainingQuantity, 0) > 0).length
          : 0,
      ),
    ),
    totalOriginalQuantity: Math.max(0, toInt(spawnState.totalOriginalQuantity, 0)),
    totalRemainingQuantity: Math.max(0, toInt(spawnState.totalRemainingQuantity, 0)),
    resourceTypeIDs: Array.isArray(spawnState.resourceTypeIDs)
      ? [...spawnState.resourceTypeIDs]
      : [],
    resourceNames: Array.isArray(spawnState.resourceNames)
      ? [...spawnState.resourceNames]
      : [],
    members: Array.isArray(spawnState.members)
      ? cloneValue(spawnState.members)
      : [],
    position:
      instance && instance.position && typeof instance.position === "object"
        ? clonePosition(instance.position)
        : null,
  };
  return {
    ...definition,
    spawnState: buildGeneratedMiningSpawnState(definition),
  };
}

function listActiveGeneratedMiningDefinitionsFromRuntime(systemIDs = null) {
  return listUniverseSeededGeneratedMiningInstances(systemIDs)
    .map((instance) => buildGeneratedMiningDefinitionFromInstance(instance))
    .filter(Boolean);
}

function buildGeneratedMiningPersistedState(member, family, nowMs) {
  return {
    version: 1,
    entityID: toInt(member && member.entityID, 0),
    visualTypeID: Math.max(1, toInt(member && member.visualTypeID, 0)),
    beltID: 0,
    fieldStyleID: null,
    yieldTypeID: Math.max(0, toInt(member && member.yieldTypeID, 0)),
    yieldKind: normalizeText(
      member && member.yieldKind,
      family,
    ).toLowerCase(),
    unitVolume: Math.max(0.000001, toFiniteNumber(member && member.unitVolume, 1)),
    originalQuantity: Math.max(0, toInt(member && member.originalQuantity, 0)),
    remainingQuantity: Math.max(0, toInt(member && member.remainingQuantity, 0)),
    originalRadius: Math.max(1, toFiniteNumber(member && member.originalRadius, 1)),
    updatedAtMs: Math.max(0, toInt(nowMs, Date.now())),
  };
}

function reconcileGeneratedMiningRuntimeState(definitions, systemIDs, nowMs) {
  const targetedSystemIDs = normalizeSystemIDs(systemIDs);
  const desiredBySystem = new Map();
  for (const systemID of targetedSystemIDs) {
    desiredBySystem.set(systemID, new Map());
  }

  for (const definition of Array.isArray(definitions) ? definitions : []) {
    const systemID = toInt(definition && definition.solarSystemID, 0);
    if (!desiredBySystem.has(systemID)) {
      desiredBySystem.set(systemID, new Map());
    }
    const desiredByEntityID = desiredBySystem.get(systemID);
    const spawnState = definition && definition.spawnState && typeof definition.spawnState === "object"
      ? definition.spawnState
      : {};
    for (const member of Array.isArray(spawnState.members) ? spawnState.members : []) {
      const entityID = toInt(member && member.entityID, 0);
      if (entityID > 0) {
        desiredByEntityID.set(entityID, buildGeneratedMiningPersistedState(
          member,
          definition && definition.siteFamily,
          nowMs,
        ));
      }
    }
  }

  let createdRows = 0;
  let updatedRows = 0;
  let removedRows = 0;
  for (const [systemID, desiredByEntityID] of desiredBySystem.entries()) {
    const basePath = `/systems/${String(systemID)}/entities`;
    const readResult = database.read(MINING_RUNTIME_TABLE, basePath);
    const existingByEntityID = (
      readResult &&
      readResult.success &&
      readResult.data &&
      typeof readResult.data === "object"
    )
      ? readResult.data
      : {};

    for (const [entityIDKey, persistedState] of Object.entries(existingByEntityID)) {
      const descriptor = miningResourceSiteService.resolveGeneratedMiningEntityDescriptor(
        persistedState && persistedState.entityID != null
          ? persistedState.entityID
          : entityIDKey,
      );
      if (!descriptor || descriptor.systemID !== systemID) {
        continue;
      }
      if (!desiredByEntityID.has(toInt(entityIDKey, 0))) {
        const removeResult = database.remove(
          MINING_RUNTIME_TABLE,
          `${basePath}/${String(entityIDKey)}`,
        );
        if (removeResult && removeResult.success === true) {
          removedRows += 1;
        }
      }
    }

    for (const [entityID, desiredState] of desiredByEntityID.entries()) {
      const existingState = existingByEntityID[String(entityID)];
      if (!existingState) {
        const writeResult = database.write(
          MINING_RUNTIME_TABLE,
          `${basePath}/${String(entityID)}`,
          cloneValue(desiredState),
        );
        if (writeResult && writeResult.success === true) {
          createdRows += 1;
        }
        continue;
      }

      const existingComparable = {
        ...cloneValue(existingState),
        updatedAtMs: 0,
      };
      const desiredComparable = {
        ...cloneValue(desiredState),
        updatedAtMs: 0,
      };
      if (JSON.stringify(existingComparable) !== JSON.stringify(desiredComparable)) {
        const writeResult = database.write(
          MINING_RUNTIME_TABLE,
          `${basePath}/${String(entityID)}`,
          cloneValue(desiredState),
        );
        if (writeResult && writeResult.success === true) {
          updatedRows += 1;
        }
      }
    }
  }

  return {
    createdRows,
    updatedRows,
    removedRows,
  };
}

function getUniverseSiteProviderID(siteKind) {
  return normalizeLowerText(siteKind, "signature") === "anomaly"
    ? "sceneAnomalySite"
    : "sceneSignatureSite";
}

function buildUniverseSiteID(family, systemID, slotIndex) {
  const base = UNIVERSE_SITE_ID_BASES[normalizeLowerText(family, "")];
  if (!base) {
    return 0;
  }
  return base + (toInt(systemID, 0) * UNIVERSE_SITE_ID_SYSTEM_STRIDE) + (Math.max(0, toInt(slotIndex, 0)) + 1);
}

function resolveSiteFamilyLabel(family) {
  switch (normalizeLowerText(family, "unknown")) {
    case "combat":
      return "Combat";
    case "combat_anomaly":
      return "Combat Anomaly";
    case "drifter_observatory":
      return "Jove Observatory";
    case "drifter_unidentified_wormhole":
      return "Unidentified Wormhole";
    case "drifter_space_sentinel_hive":
    case "drifter_space_barbican_hive":
    case "drifter_space_vidette_hive":
    case "drifter_space_conflux_hive":
    case "drifter_space_redoubt_hive":
      return "Drifter Hive";
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

function resolveUniverseSiteLabel(template, family, slotIndex) {
  const normalizedFamily = normalizeLowerText(family, "unknown");
  const resolvedName = normalizeText(template && template.resolvedName, "");
  if (
    resolvedName &&
    (
      normalizedFamily.startsWith("drifter_")
    )
  ) {
    return resolvedName;
  }
  const familyLabel = resolveSiteFamilyLabel(family);
  const templateMarker =
    Math.max(0, toInt(template && template.sourceDungeonID, 0)) ||
    Math.max(0, toInt(template && template.dungeonNameID, 0)) ||
    (Math.max(0, toInt(slotIndex, 0)) + 1);
  return `${familyLabel} Site ${templateMarker}`;
}

function normalizeDifficultyRange(range) {
  const values = Array.isArray(range) ? range : [];
  const minimum = toInt(values[0], 0);
  const maximum = toInt(values[1], minimum);
  return [
    Math.min(minimum, maximum),
    Math.max(minimum, maximum),
  ];
}

function listTemplateCandidatesForSpawnFamily(family) {
  const cacheKey = normalizeLowerText(family, "unknown");
  if (templateCandidatesBySpawnFamilyCache.has(cacheKey)) {
    return templateCandidatesBySpawnFamilyCache.get(cacheKey);
  }
  const filters = getSpawnProfileTemplateFilters(cacheKey);
  const siteFamilies = filters.siteFamilies.length > 0
    ? filters.siteFamilies
    : [cacheKey];
  const candidatesByTemplateID = new Map();
  for (const siteFamily of siteFamilies) {
    for (const template of dungeonAuthority.listTemplatesByFamily(siteFamily)) {
      if (!template || !template.templateID) {
        continue;
      }
      if (templateMatchesSpawnFamily(template, cacheKey, { difficultyRange: [0, 99] })) {
        candidatesByTemplateID.set(template.templateID, template);
      }
    }
  }
  const candidates = Object.freeze([...candidatesByTemplateID.values()]);
  templateCandidatesBySpawnFamilyCache.set(cacheKey, candidates);
  return candidates;
}

function templateMatchesSpawnFamily(template, family, bandProfile) {
  if (!template || typeof template !== "object") {
    return false;
  }
  const filters = getSpawnProfileTemplateFilters(family);
  const [minimum, maximum] = normalizeDifficultyRange(bandProfile && bandProfile.difficultyRange);
  const difficulty = toInt(template && template.difficulty, 0);
  if (difficulty < minimum || difficulty > maximum) {
    return false;
  }
  const siteFamily = normalizeLowerText(template && template.siteFamily, "unknown");
  const siteKind = normalizeLowerText(template && template.siteKind, "signature");
  const resolvedName = normalizeLowerText(template && template.resolvedName, "");
  if (filters.siteFamilies.length > 0 && !filters.siteFamilies.includes(siteFamily)) {
    return false;
  }
  if (filters.siteKinds.length > 0 && !filters.siteKinds.includes(siteKind)) {
    return false;
  }
  if (filters.nameIncludesAny.length > 0 && !filters.nameIncludesAny.some((entry) => resolvedName.includes(entry))) {
    return false;
  }
  if (filters.nameExcludesAny.length > 0 && filters.nameExcludesAny.some((entry) => resolvedName.includes(entry))) {
    return false;
  }
  return true;
}

function listFamilyTemplatesForBand(family, band, bandProfile) {
  const cacheKey = JSON.stringify({
    family: normalizeLowerText(family, "unknown"),
    band: normalizeSecurityBand(band),
    difficultyRange: normalizeDifficultyRange(bandProfile && bandProfile.difficultyRange),
  });
  if (bandTemplateCandidatesCache.has(cacheKey)) {
    return bandTemplateCandidatesCache.get(cacheKey);
  }
  const allCandidates = listTemplateCandidatesForSpawnFamily(family);
  const candidates = allCandidates
    .filter((template) => {
      return templateMatchesSpawnFamily(template, family, bandProfile);
    })
    .sort((left, right) => (
      toInt(left && left.sourceDungeonID, Number.MAX_SAFE_INTEGER) -
      toInt(right && right.sourceDungeonID, Number.MAX_SAFE_INTEGER)
    ) || String(left && left.templateID || "").localeCompare(String(right && right.templateID || "")));
  if (candidates.length > 0) {
    const cachedCandidates = Object.freeze(candidates);
    bandTemplateCandidatesCache.set(cacheKey, cachedCandidates);
    return cachedCandidates;
  }
  const fallbackCandidates = Object.freeze(allCandidates
    .sort((left, right) => (
      toInt(left && left.sourceDungeonID, Number.MAX_SAFE_INTEGER) -
      toInt(right && right.sourceDungeonID, Number.MAX_SAFE_INTEGER)
    ) || String(left && left.templateID || "").localeCompare(String(right && right.templateID || ""))));
  bandTemplateCandidatesCache.set(cacheKey, fallbackCandidates);
  return fallbackCandidates;
}

function systemMatchesSpawnBandProfile(systemID, family, bandProfile) {
  const slotsPerSystem = Math.max(0, toInt(bandProfile && bandProfile.slotsPerSystem, 0));
  if (slotsPerSystem <= 0) {
    return false;
  }
  const band = getSecurityBand(systemID);
  return listEligibleSystemIDsForBandProfile(family, band, bandProfile)
    .includes(Math.max(0, toInt(systemID, 0)));
}

function buildLightweightRoomStates(nowMs) {
  return {
    "room:entry": {
      roomKey: "room:entry",
      state: "active",
      stage: "entry",
      pocketID: null,
      nodeGraphID: null,
      activatedAtMs: nowMs,
      completedAtMs: 0,
      lastUpdatedAtMs: nowMs,
      spawnedEntityIDs: [],
      counters: {},
      metadata: {
        lightweight: true,
      },
    },
  };
}

function pickUniverseTemplateForSlot(family, systemID, slotIndex, rotationIndex, band, bandProfile) {
  const candidates = listFamilyTemplatesForBand(family, band, bandProfile);
  if (candidates.length <= 0) {
    return null;
  }
  const templateIndex = hashValue(
    (toInt(systemID, 0) * 4099) +
    (slotIndex * 131) +
    (Math.max(0, toInt(rotationIndex, 0)) * 17) +
    hashText(family),
  ) % candidates.length;
  return candidates[templateIndex] || candidates[0] || null;
}

function buildUniverseSiteDefinition(template, family, systemID, slotIndex, options = {}) {
  const spawnFamilyKey = normalizeLowerText(options.spawnFamilyKey, family);
  const siteID = buildUniverseSiteID(spawnFamilyKey, systemID, slotIndex);
  if (siteID <= 0) {
    return null;
  }
  const rotationIndex = Math.max(0, toInt(options.rotationIndex, 0));
  const startedAtMs = Math.max(0, toInt(options.startedAtMs, Date.now()));
  const lifetimeMs = Math.max(60_000, toInt(options.lifetimeMs, resolveSiteLifetimeMs(1440)));
  const band = normalizeLowerText(options.band, getSecurityBand(systemID));
  const siteKind = normalizeLowerText(template && template.siteKind, "signature");
  const providerID = getUniverseSiteProviderID(siteKind);
  const placement = buildUniverseSitePlacement(systemID, spawnFamilyKey, slotIndex, rotationIndex);
  const position = placement.position;
  const templateSiteFamily = normalizeLowerText(template && template.siteFamily, normalizeLowerText(family, "unknown"));
  const entryObjectTypeID = Math.max(
    0,
    toInt(
      template && template.entryObjectTypeID,
      siteKind === "anomaly" ? COSMIC_ANOMALY_TYPE_ID : COSMIC_SIGNATURE_TYPE_ID,
    ),
  ) || (siteKind === "anomaly" ? COSMIC_ANOMALY_TYPE_ID : COSMIC_SIGNATURE_TYPE_ID);
  const groupID = siteKind === "anomaly" ? COSMIC_ANOMALY_GROUP_ID : COSMIC_SIGNATURE_GROUP_ID;
  const label = resolveUniverseSiteLabel(template, spawnFamilyKey, slotIndex);
  const expiresAtMs = startedAtMs + lifetimeMs;
  const siteKey = dungeonSiteAdapter.buildSiteKey(providerID, systemID, siteID);
  const metadata = {
    providerID,
    definitionHash: JSON.stringify({
      family: templateSiteFamily,
      spawnFamilyKey,
      siteID,
      slotIndex,
      rotationIndex,
      templateID: template.templateID,
      siteKind,
      position: [
        Math.round(toFiniteNumber(position && position.x, 0)),
        Math.round(toFiniteNumber(position && position.y, 0)),
        Math.round(toFiniteNumber(position && position.z, 0)),
      ],
      anchorItemID: toInt(placement && placement.anchorItemID, 0),
      anchorDistanceMeters: Math.round(toFiniteNumber(placement && placement.anchorDistanceMeters, 0)),
      templateContentHash: hashText(JSON.stringify({
        populationHints: cloneValue(template && template.populationHints || null),
        environmentTemplates: cloneValue(template && template.environmentTemplates || null),
        objectiveMetadata: cloneValue(template && template.objectiveMetadata || null),
        siteSceneProfile: cloneValue(template && template.siteSceneProfile || null),
      })),
    }),
    siteID,
    slotIndex: Math.max(0, toInt(slotIndex, 0)),
    rotationIndex,
    spawnFamilyKey,
    securityBand: band,
    label,
    universeSeededAtMs: startedAtMs,
    anchorItemID: toInt(placement && placement.anchorItemID, 0) || null,
    anchorDistanceMeters: Math.round(toFiniteNumber(placement && placement.anchorDistanceMeters, 0)),
    anchorDistanceAu: Number(toFiniteNumber(placement && placement.anchorDistanceAu, 0).toFixed(3)),
  };

  return {
    templateID: template.templateID,
    solarSystemID: toInt(systemID, 0),
    siteKey,
    lifecycleState: "active",
    instanceScope: "shared",
    siteFamily: templateSiteFamily,
    siteKind,
    siteOrigin: normalizeLowerText(
      dungeonAuthority.getSpawnProfile(spawnFamilyKey) &&
      dungeonAuthority.getSpawnProfile(spawnFamilyKey).siteOrigin,
      "universe_dungeon",
    ),
    position,
    nowMs: startedAtMs,
    activatedAtMs: startedAtMs,
    expiresAtMs,
    roomStatesByKey: buildLightweightRoomStates(startedAtMs),
    gateStatesByKey: {},
    objectiveState: {
      state: "pending",
      currentNodeID: null,
      currentObjectiveID: null,
      completedObjectiveIDs: [],
      completedNodeIDs: [],
      counters: {},
      metadata: {
        lightweight: true,
      },
    },
    environmentState: {
      seededAtMs: startedAtMs,
      templateRef: template.templateID,
      lightweight: true,
    },
    spawnState: {
      siteID,
      slotIndex: Math.max(0, toInt(slotIndex, 0)),
      rotationIndex,
      spawnFamilyKey,
      label,
      groupID,
      entryObjectTypeID,
      securityBand: band,
      lifetimeMs,
      anchorItemID: toInt(placement && placement.anchorItemID, 0) || null,
      anchorDistanceMeters: Math.round(toFiniteNumber(placement && placement.anchorDistanceMeters, 0)),
      anchorDistanceAu: Number(toFiniteNumber(placement && placement.anchorDistanceAu, 0).toFixed(3)),
      populationHints: cloneValue(template && template.populationHints || null),
    },
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
      lazyMaterialized: true,
    },
    metadata,
  };
}

function listDesiredUniverseDungeonSiteDefinitions(systemIDs = null, nowMs = Date.now(), options = {}) {
  const definitions = [];
  const familyFilter = new Set((Array.isArray(options.families) ? options.families : [])
    .map((entry) => normalizeLowerText(entry, ""))
    .filter(Boolean));
  const families = dungeonAuthority.listUniverseSpawnFamilies()
    .filter((family) => familyFilter.size <= 0 || familyFilter.has(normalizeLowerText(family, "")));
  const allSystemIDs = normalizeSystemIDs(systemIDs);
  const familySummaries = {};

  for (const family of families) {
    const profile = dungeonAuthority.getSpawnProfile(family);
    if (!profile || profile.enabled === false || profile.persistent === false) {
      continue;
    }
    const lifetimeMs = resolveSiteLifetimeMs(profile.siteLifetimeMinutes);
    familySummaries[family] = {
      desiredSiteCount: 0,
      systemsTouched: 0,
      templateCount: listTemplateCandidatesForSpawnFamily(family).length,
    };

    for (const band of ["highsec", "lowsec", "nullsec", "wormhole"]) {
      const bandProfile = profile.bands && profile.bands[band];
      if (!bandProfile) {
        continue;
      }
      const eligibleSystemIDs = listEligibleSystemIDsForBandProfile(
        family,
        band,
        bandProfile,
        allSystemIDs,
      );
      for (const systemID of eligibleSystemIDs) {
      let systemDefinitionCount = 0;
      for (let slotIndex = 0; slotIndex < Math.max(0, toInt(bandProfile.slotsPerSystem, 0)); slotIndex += 1) {
        const rotationIndex = 0;
        const template = pickUniverseTemplateForSlot(
          family,
          systemID,
          slotIndex,
          rotationIndex,
          band,
          bandProfile,
        );
        if (!template) {
          continue;
        }
        const definition = buildUniverseSiteDefinition(template, family, systemID, slotIndex, {
          rotationIndex,
          startedAtMs: Math.max(0, toInt(nowMs, Date.now())),
          lifetimeMs,
          band,
        });
        if (!definition) {
          continue;
        }
        definitions.push(definition);
        familySummaries[family].desiredSiteCount += 1;
        systemDefinitionCount += 1;
      }
      if (systemDefinitionCount > 0) {
        familySummaries[family].systemsTouched += 1;
      }
      }
    }
  }

  return {
    definitions,
    families: familySummaries,
  };
}

function buildGeneratedMiningRotationDefinitionFromInstance(instance, nowMs = Date.now()) {
  if (
    !instance ||
    normalizeLowerText(instance && instance.siteOrigin, "") !== "generatedmining"
  ) {
    return null;
  }
  const family = normalizeLowerText(instance.siteFamily, "ice");
  const systemID = Math.max(0, toInt(instance.solarSystemID, 0));
  const slotIndex = Math.max(
    0,
    toInt(
      instance.metadata && instance.metadata.slotIndex,
      instance.spawnState && instance.spawnState.slotIndex,
    ),
  );
  const currentRotationIndex = Math.max(
    0,
    toInt(
      instance.metadata && instance.metadata.rotationIndex,
      instance.spawnState && instance.spawnState.rotationIndex,
    ),
  );
  const nextRotationIndex = currentRotationIndex + 1;
  const definition = miningResourceSiteService.buildGeneratedResourceSiteDefinition(
    systemID,
    family,
    slotIndex,
    {
      rotationIndex: nextRotationIndex,
    },
  );
  if (!definition) {
    return null;
  }
  return enrichGeneratedMiningDefinition(definition, nowMs, {
    slotIndex,
    rotationIndex: nextRotationIndex,
    startedAtMs: Math.max(0, toInt(nowMs, Date.now())),
    lifetimeMs: resolveGeneratedMiningSiteLifetimeMs(),
  });
}

function buildRotationDefinitionFromInstance(instance, nowMs = Date.now()) {
  if (
    !instance ||
    !(instance.runtimeFlags && instance.runtimeFlags.universePersistent === true)
  ) {
    return null;
  }
  if (normalizeLowerText(instance && instance.siteOrigin, "") === "generatedmining") {
    return buildGeneratedMiningRotationDefinitionFromInstance(instance, nowMs);
  }
  const family = normalizeLowerText(instance.siteFamily, "");
  const spawnFamilyKey = normalizeLowerText(
    instance &&
    instance.metadata &&
    instance.metadata.spawnFamilyKey,
    normalizeLowerText(
      instance &&
      instance.spawnState &&
      instance.spawnState.spawnFamilyKey,
      family,
    ),
  );
  const systemID = Math.max(0, toInt(instance.solarSystemID, 0));
  const profile = dungeonAuthority.getSpawnProfile(spawnFamilyKey);
  if (!spawnFamilyKey || systemID <= 0 || !profile || profile.enabled === false || profile.persistent === false) {
    return null;
  }
  const band = getSecurityBand(systemID);
  const bandProfile = profile.bands && profile.bands[band];
  if (!bandProfile || !systemMatchesSpawnBandProfile(systemID, spawnFamilyKey, bandProfile)) {
    return null;
  }
  const slotIndex = Math.max(
    0,
    toInt(
      instance.metadata && instance.metadata.slotIndex,
      instance.spawnState && instance.spawnState.slotIndex,
    ),
  );
  const currentRotationIndex = Math.max(
    0,
    toInt(
      instance.metadata && instance.metadata.rotationIndex,
      instance.spawnState && instance.spawnState.rotationIndex,
    ),
  );
  const nextRotationIndex = currentRotationIndex + 1;
  const template = pickUniverseTemplateForSlot(
    spawnFamilyKey,
    systemID,
    slotIndex,
    nextRotationIndex,
    band,
    bandProfile,
  );
  if (!template) {
    return null;
  }
  return buildUniverseSiteDefinition(template, spawnFamilyKey, systemID, slotIndex, {
    spawnFamilyKey,
    rotationIndex: nextRotationIndex,
    startedAtMs: Math.max(0, toInt(nowMs, Date.now())),
    lifetimeMs: resolveSiteLifetimeMs(profile.siteLifetimeMinutes),
    band,
  });
}

function advanceUniversePersistentSites(options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const lifecycleReason = normalizeText(options.lifecycleReason, "expired");
  const emitExpiryEvents =
    options.emitExpiryEvents !== false &&
    lifecycleReason !== "startup-resume";
  const expired = dungeonRuntime.tickRuntime({
    nowMs,
    lifecycleReason,
    emitChanges: emitExpiryEvents,
  });
  const candidates = dungeonRuntime.listUniversePersistentTerminalInstances({ full: true });

  if (
    Math.max(0, toInt(expired && expired.expiredCount, 0)) <= 0 &&
    candidates.length <= 0
  ) {
    return {
      expiredCount: 0,
      rotatedCount: 0,
      removedCount: 0,
    };
  }

  const rotations = [];
  const affectedGeneratedMiningSystemIDs = new Set();
  for (const instance of candidates) {
    const isGeneratedMining =
      normalizeLowerText(instance && instance.siteOrigin, "") === "generatedmining";
    if (isGeneratedMining) {
      affectedGeneratedMiningSystemIDs.add(Math.max(0, toInt(instance && instance.solarSystemID, 0)));
    }
    const nextDefinition = buildRotationDefinitionFromInstance(instance, nowMs);
    if (!nextDefinition) {
      continue;
    }
    rotations.push({
      existingInstance: instance,
      nextDefinition,
    });
    if (normalizeLowerText(nextDefinition && nextDefinition.siteOrigin, "") === "generatedmining") {
      affectedGeneratedMiningSystemIDs.add(Math.max(0, toInt(nextDefinition && nextDefinition.solarSystemID, 0)));
    }
  }

  const rotationSummary = rotations.length > 0
    ? dungeonRuntime.rotateUniversePersistentInstances(rotations, { nowMs })
    : {
      rotatedCount: 0,
      removedCount: 0,
    };

  if (affectedGeneratedMiningSystemIDs.size > 0) {
    reconcileGeneratedMiningRuntimeState(
      listActiveGeneratedMiningDefinitionsFromRuntime([...affectedGeneratedMiningSystemIDs]),
      [...affectedGeneratedMiningSystemIDs],
      nowMs,
    );
  }

  return {
    expiredCount: Math.max(0, toInt(expired && expired.expiredCount, 0)),
    rotatedCount: Math.max(0, toInt(rotationSummary && rotationSummary.rotatedCount, 0)),
    removedCount: Math.max(0, toInt(rotationSummary && rotationSummary.removedCount, 0)),
  };
}

function listUniverseSeededGeneratedMiningInstances(systemIDs = null) {
  const targetedSystemIDs = new Set(normalizeSystemIDs(systemIDs));
  return [
    ...dungeonRuntime.listInstancesByLifecycle("seeded", { full: true }),
    ...dungeonRuntime.listInstancesByLifecycle("active", { full: true }),
    ...dungeonRuntime.listInstancesByLifecycle("paused", { full: true }),
  ].filter((instance) => (
    instance &&
    String(instance.siteOrigin || "").trim().toLowerCase() === "generatedmining" &&
    instance.runtimeFlags &&
    instance.runtimeFlags.universeSeeded === true &&
    (
      targetedSystemIDs.size <= 0 ||
      targetedSystemIDs.has(toInt(instance && instance.solarSystemID, 0))
    )
  ));
}

function listUniverseSeededPersistentSiteInstances(systemIDs = null) {
  const targetedSystemIDs = new Set(normalizeSystemIDs(systemIDs));
  const byInstanceID = new Map();
  for (const instance of [
    ...dungeonRuntime.listInstancesByLifecycle("seeded", { full: true }),
    ...dungeonRuntime.listInstancesByLifecycle("active", { full: true }),
    ...dungeonRuntime.listInstancesByLifecycle("paused", { full: true }),
  ]) {
    if (!instance || !(instance.runtimeFlags && instance.runtimeFlags.universeSeeded === true)) {
      continue;
    }
    if (String(instance.siteOrigin || "").trim().toLowerCase() === "generatedmining") {
      continue;
    }
    if (
      targetedSystemIDs.size > 0 &&
      !targetedSystemIDs.has(toInt(instance && instance.solarSystemID, 0))
    ) {
      continue;
    }
    byInstanceID.set(instance.instanceID, instance);
  }
  return [...byInstanceID.values()].sort((left, right) => left.instanceID - right.instanceID);
}

function summarizeActiveUniverseSeededCounts(systemIDs = null) {
  const generatedMiningCount = listUniverseSeededGeneratedMiningInstances(systemIDs).length;
  const persistentCount = listUniverseSeededPersistentSiteInstances(systemIDs).length;
  return {
    generatedMiningCount,
    persistentCount,
    totalCount: generatedMiningCount + persistentCount,
  };
}

function reconcileUniversePersistentSites(options = {}) {
  const progressLabel = normalizeText(options.progressLabel, "full universe");
  const logProgress = options.logProgress !== false;
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const systemIDs = normalizeSystemIDs(options.systemIDs);
  const includeMining = options.includeMining !== false;
  const includeBroad = options.includeBroad !== false;
  const startedAtMs = Date.now();
  if (logProgress) {
    log.info(
      `[DungeonUniverse] ${progressLabel}: starting reconcile for ${systemIDs.length} systems ` +
      `(mining=${includeMining}, broad=${includeBroad})`,
    );
  }

  const miningStartMs = Date.now();
  const miningDefinitions = includeMining
    ? listDesiredGeneratedMiningDefinitions(systemIDs, nowMs)
    : [];
  if (logProgress) {
    log.info(
      `[DungeonUniverse] ${progressLabel}: built ${miningDefinitions.length} generated mining definitions in ${Date.now() - miningStartMs}ms`,
    );
  }

  const broadStartMs = Date.now();
  const broadResult = includeBroad
    ? listDesiredUniverseDungeonSiteDefinitions(systemIDs, nowMs)
    : { definitions: [], families: {} };
  if (logProgress) {
    log.info(
      `[DungeonUniverse] ${progressLabel}: built ${broadResult.definitions.length} broad persistent definitions in ${Date.now() - broadStartMs}ms`,
    );
  }
  const allDefinitions = [
    ...miningDefinitions,
    ...broadResult.definitions,
  ];

  const instanceStartMs = Date.now();
  const instanceSummary = dungeonRuntime.reconcileUniverseSeededInstances(allDefinitions, {
    systemIDs,
    nowMs,
  });
  if (logProgress) {
    log.info(
      `[DungeonUniverse] ${progressLabel}: reconciled ${allDefinitions.length} dungeon instances in ${Date.now() - instanceStartMs}ms`,
    );
  }

  const miningStateStartMs = Date.now();
  const persistedMiningState = reconcileGeneratedMiningRuntimeState(
    miningDefinitions,
    systemIDs,
    nowMs,
  );
  if (logProgress) {
    log.info(
      `[DungeonUniverse] ${progressLabel}: reconciled mining runtime rows in ${Date.now() - miningStateStartMs}ms`,
    );
  }

  const summary = {
    systemCount: systemIDs.length,
    desiredSiteCount: allDefinitions.length,
    createdInstances: instanceSummary.createdCount,
    retainedInstances: instanceSummary.retainedCount,
    replacedInstances: instanceSummary.replacedCount,
    removedInstances: instanceSummary.removedCount,
    miningStateRowsCreated: persistedMiningState.createdRows,
    miningStateRowsRemoved: persistedMiningState.removedRows,
    mining: {
      desiredSiteCount: miningDefinitions.length,
    },
    families: broadResult.families,
    elapsedMs: Date.now() - startedAtMs,
  };

  if (logProgress) {
    log.info(
      `[DungeonUniverse] ${progressLabel}: done in ${summary.elapsedMs}ms ` +
        `(${summary.desiredSiteCount} desired sites across ${summary.systemCount} systems, ` +
        `created ${summary.createdInstances}, retained ${summary.retainedInstances}, ` +
        `replaced ${summary.replacedInstances}, removed ${summary.removedInstances}, ` +
        `mining rows +${summary.miningStateRowsCreated}/-${summary.miningStateRowsRemoved})`,
    );
  }

  if (
    (!Array.isArray(options.systemIDs) || options.systemIDs.length <= 0) &&
    options.recordMeta !== false
  ) {
    writeUniverseReconcileMeta(summary, {
      descriptor: options.descriptor || buildUniverseDescriptor(nowMs),
      startedAtMs,
      completedAtMs: Date.now(),
      scope: "full",
      reason: normalizeText(options.reason, "manual"),
      nowMs,
    });
  }

  return summary;
}

function clearBackgroundReconcileTimer() {
  if (backgroundReconcileTimer) {
    clearTimeout(backgroundReconcileTimer);
    backgroundReconcileTimer = null;
  }
}

function scheduleNextBackgroundReconcileSlice() {
  clearBackgroundReconcileTimer();
  if (!backgroundReconcileJob || backgroundReconcileJob.completed === true) {
    return;
  }
  const delayMs = backgroundReconcileJob.sliceCount <= 0
    ? Math.max(BACKGROUND_RECONCILE_DELAY_MS, toInt(backgroundReconcileJob.initialDelayMs, BACKGROUND_RECONCILE_DELAY_MS))
    : BACKGROUND_RECONCILE_DELAY_MS;
  backgroundReconcileTimer = setTimeout(() => {
    backgroundReconcileTimer = null;
    runBackgroundUniverseReconcileSlice();
  }, delayMs);
  if (typeof backgroundReconcileTimer.unref === "function") {
    backgroundReconcileTimer.unref();
  }
}

function completeBackgroundUniverseReconcileJob() {
  if (!backgroundReconcileJob) {
    return null;
  }
  const completed = {
    ...backgroundReconcileJob,
    completed: true,
    completedAtMs: Date.now(),
  };
  const summary = {
    systemCount: completed.systemIDs.length,
    desiredSiteCount: completed.desiredSiteCount,
    desiredMiningSiteCount: completed.desiredMiningSiteCount,
    desiredPersistentSiteCount: completed.desiredPersistentSiteCount,
    createdInstances: completed.createdInstances,
    retainedInstances: completed.retainedInstances,
    replacedInstances: completed.replacedInstances,
    removedInstances: completed.removedInstances,
    miningStateRowsCreated: completed.miningStateRowsCreated,
    miningStateRowsRemoved: completed.miningStateRowsRemoved,
    elapsedMs: completed.completedAtMs - completed.startedAtMs,
  };
  writeUniverseReconcileMeta(summary, {
    descriptor: completed.descriptor,
    startedAtMs: completed.startedAtMs,
    completedAtMs: completed.completedAtMs,
    scope: "full",
    reason: completed.reason,
    nowMs: completed.nowMs,
  });
  log.info(
    `[DungeonUniverse] background full reconcile complete in ${summary.elapsedMs}ms ` +
      `(${summary.desiredSiteCount} desired sites, created ${summary.createdInstances}, ` +
      `retained ${summary.retainedInstances}, replaced ${summary.replacedInstances}, removed ${summary.removedInstances})`,
  );
  backgroundReconcileJob = null;
  clearBackgroundReconcileTimer();
  return summary;
}

function runBackgroundUniverseReconcileSlice() {
  const job = backgroundReconcileJob;
  if (!job || job.completed === true) {
    return null;
  }

  const sliceSystemIDs = job.systemIDs.slice(job.systemIndex, job.systemIndex + job.batchSize);
  if (sliceSystemIDs.length <= 0) {
    job.familyIndex += 1;
    job.systemIndex = 0;
    if (job.familyIndex >= job.familyQueue.length) {
      return completeBackgroundUniverseReconcileJob();
    }
    log.info(
      `[DungeonUniverse] background full reconcile: switching to ${job.familyQueue[job.familyIndex]} ` +
      `(${job.familyIndex + 1}/${job.familyQueue.length})`,
    );
    return scheduleNextBackgroundReconcileSlice();
  }

  const family = job.familyQueue[job.familyIndex];
  const sliceStartMs = Date.now();
  if (family === "generatedmining") {
    const miningDefinitions = listDesiredGeneratedMiningDefinitions(sliceSystemIDs, job.nowMs);
    const instanceSummary = dungeonRuntime.reconcileUniverseSeededInstances(miningDefinitions, {
      systemIDs: sliceSystemIDs,
      nowMs: job.nowMs,
      siteOriginFilter: ["generatedmining"],
    });
    const persistedMiningState = reconcileGeneratedMiningRuntimeState(
      miningDefinitions,
      sliceSystemIDs,
      job.nowMs,
    );
    job.desiredSiteCount += miningDefinitions.length;
    job.desiredMiningSiteCount += miningDefinitions.length;
    job.createdInstances += instanceSummary.createdCount;
    job.retainedInstances += instanceSummary.retainedCount;
    job.replacedInstances += instanceSummary.replacedCount;
    job.removedInstances += instanceSummary.removedCount;
    job.miningStateRowsCreated += persistedMiningState.createdRows;
    job.miningStateRowsRemoved += persistedMiningState.removedRows;
  } else {
    const broadResult = listDesiredUniverseDungeonSiteDefinitions(
      sliceSystemIDs,
      job.nowMs,
      { families: [family] },
    );
    const instanceSummary = dungeonRuntime.reconcileUniverseSeededInstances(broadResult.definitions, {
      systemIDs: sliceSystemIDs,
      nowMs: job.nowMs,
      spawnFamilyFilter: [family],
    });
    job.desiredSiteCount += broadResult.definitions.length;
    job.desiredPersistentSiteCount += broadResult.definitions.length;
    job.createdInstances += instanceSummary.createdCount;
    job.retainedInstances += instanceSummary.retainedCount;
    job.replacedInstances += instanceSummary.replacedCount;
    job.removedInstances += instanceSummary.removedCount;
  }

  job.systemIndex += sliceSystemIDs.length;
  job.sliceCount += 1;
  if (
    job.systemIndex >= job.systemIDs.length ||
    job.sliceCount === 1 ||
    (job.sliceCount % 10) === 0
  ) {
    log.info(
      `[DungeonUniverse] background full reconcile: ${family} slice ${job.sliceCount} ` +
        `processed ${Math.min(job.systemIndex, job.systemIDs.length)}/${job.systemIDs.length} systems ` +
        `in ${Date.now() - sliceStartMs}ms`,
    );
  }

  scheduleNextBackgroundReconcileSlice();
  return {
    family,
    sliceSystemCount: sliceSystemIDs.length,
    elapsedMs: Date.now() - sliceStartMs,
  };
}

function scheduleBackgroundUniverseReconcile(options = {}) {
  const status = options.status || getUniverseReconcileStatus(options.nowMs);
  if (status.fullUpToDate) {
    return {
      scheduled: false,
      reason: "up_to_date",
      status,
    };
  }
  if (backgroundReconcileJob && backgroundReconcileJob.completed !== true) {
    return {
      scheduled: false,
      reason: "already_running",
      status,
      job: cloneValue(backgroundReconcileJob),
    };
  }

  const families = dungeonAuthority.listUniverseSpawnFamilies();
  const systemIDs = normalizeSystemIDs();
  backgroundReconcileJob = {
    startedAtMs: Date.now(),
    nowMs: Math.max(0, toInt(options.nowMs, Date.now())),
    reason: normalizeText(options.reason, "stale"),
    descriptor: status.descriptor,
    systemIDs,
    familyQueue: ["generatedmining", ...families],
    familyIndex: 0,
    systemIndex: 0,
    batchSize: Math.max(1, toInt(options.batchSize, BACKGROUND_RECONCILE_BATCH_SIZE)),
    initialDelayMs: Math.max(BACKGROUND_RECONCILE_DELAY_MS, toInt(options.initialDelayMs, 2_000)),
    sliceCount: 0,
    desiredSiteCount: 0,
    desiredMiningSiteCount: 0,
    desiredPersistentSiteCount: 0,
    createdInstances: 0,
    retainedInstances: 0,
    replacedInstances: 0,
    removedInstances: 0,
    miningStateRowsCreated: 0,
    miningStateRowsRemoved: 0,
    completed: false,
  };
  log.info(
    `[DungeonUniverse] queued background full reconcile for ${systemIDs.length} systems ` +
      `because cached universe site state is stale (${backgroundReconcileJob.reason})`,
  );
  scheduleNextBackgroundReconcileSlice();
  return {
    scheduled: true,
    reason: backgroundReconcileJob.reason,
    status,
    job: cloneValue(backgroundReconcileJob),
  };
}

function getBackgroundUniverseReconcileJob() {
  return backgroundReconcileJob ? cloneValue(backgroundReconcileJob) : null;
}

function prepareStartupUniversePersistentSites(options = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const startupSystemIDs = normalizeSystemIDs(options.startupSystemIDs || options.systemIDs || []);
  const status = getUniverseReconcileStatus(nowMs);
  const startupSummary = startupSystemIDs.length > 0
    ? {
      systemCount: startupSystemIDs.length,
      desiredSiteCount: 0,
      createdInstances: 0,
      retainedInstances: 0,
      replacedInstances: 0,
      removedInstances: 0,
      miningStateRowsCreated: 0,
      miningStateRowsRemoved: 0,
      skipped: true,
      reason: status.fullUpToDate === true
        ? "cached_universe_current"
        : "manual_seed_required",
    }
    : null;
  return {
    status,
    startupSummary,
    background: {
      scheduled: false,
      reason: status.fullUpToDate ? "up_to_date" : "manual_seed_required",
      needsFullReconcile: status.fullUpToDate !== true,
    },
  };
}

function startTicker(options = {}) {
  if (universeReconcileTicker) {
    return universeReconcileTicker;
  }
  const intervalMs = Math.max(
    250,
    toInt(options.intervalMs, UNIVERSE_SLOT_TICK_INTERVAL_MS),
  );
  universeReconcileTicker = setInterval(() => {
    try {
      const summary = advanceUniversePersistentSites({
        nowMs: Date.now(),
        lifecycleReason: "expired",
      });
      if (summary.rotatedCount > 0) {
        log.info(
          `[DungeonUniverse] rotated ${summary.rotatedCount} persistent site slots ` +
          `after ${summary.expiredCount} expiries`,
        );
      }
    } catch (error) {
      log.warn(`[DungeonUniverse] Persistent site rotation failed: ${error.message}`);
    }
  }, intervalMs);
  if (typeof universeReconcileTicker.unref === "function") {
    universeReconcileTicker.unref();
  }
  return universeReconcileTicker;
}

function stopTicker() {
  if (universeReconcileTicker) {
    clearInterval(universeReconcileTicker);
    universeReconcileTicker = null;
  }
  clearBackgroundReconcileTimer();
  backgroundReconcileJob = null;
}

module.exports = {
  summarizeActiveUniverseSeededCounts,
  getBackgroundUniverseReconcileJob,
  getUniverseReconcileStatus,
  listDesiredGeneratedMiningDefinitions,
  listDesiredUniverseDungeonSiteDefinitions,
  listUniverseSeededGeneratedMiningInstances,
  listUniverseSeededPersistentSiteInstances,
  advanceUniversePersistentSites,
  prepareStartupUniversePersistentSites,
  reconcileUniversePersistentSites,
  scheduleBackgroundUniverseReconcile,
  startTicker,
  stopTicker,
  _testing: {
    summarizeActiveUniverseSeededCounts,
    buildBroadUniverseDescriptor,
    buildMiningUniverseDescriptor,
    buildUniverseDescriptor,
    buildGeneratedMiningDefinitionHash,
    buildGeneratedMiningPersistedState,
    buildGeneratedMiningSiteKey,
    buildGeneratedMiningSpawnState,
    buildUniverseAnchorCandidates,
    buildUniverseSiteDefinition,
    buildUniverseSitePlacement,
    buildUniverseSiteID,
    buildUniverseSitePosition,
    buildRotationDefinitionFromInstance,
    enrichGeneratedMiningDefinition,
    advanceUniversePersistentSites,
    getBackgroundUniverseReconcileJob,
    getUniverseReconcileStatus,
    getSecurityBand,
    normalizeSystemIDs,
    prepareStartupUniversePersistentSites,
    reconcileGeneratedMiningRuntimeState,
    runBackgroundUniverseReconcileSlice,
    scheduleBackgroundUniverseReconcile,
    listEligibleSystemIDsForBandProfile,
    resolveBandTargetSystemCount,
    systemMatchesSpawnBandProfile,
  },
};
