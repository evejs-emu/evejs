const path = require("path");

const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  getTypeAttributeMap,
  getTypeEffectRecords,
} = require(path.join(__dirname, "../fitting/liveFittingState"));

const ABILITY_SLOT_IDS = Object.freeze([0, 1, 2]);
const TARGET_MODE_UNTARGETED = "untargeted";
const TARGET_MODE_ITEMTARGETED = "itemTargeted";
const TARGET_MODE_POINTTARGETED = "pointTargeted";

const authorityCache = {
  payload: null,
  abilitiesByID: null,
  fighterTypesByID: null,
};
const abilitySlotsByTypeID = new Map();

const EFFECT_FAMILY_ALIASES = Object.freeze({
  fighterabilityattackmissile: ["fighterabilityattackmissile", "fighterabilityattackm"],
  fighterabilityattackturret: ["fighterabilityattackturret", "fighterabilityattackt"],
  fighterabilitymissiles: ["fighterabilitymissiles"],
  fighterabilityafterburner: ["fighterabilityafterburner"],
  fighterabilitymicrojumpdrive: ["fighterabilitymicrojumpdrive"],
  fighterabilitymicrowarpdrive: ["fighterabilitymicrowarpdrive"],
  fighterabilityenergyneutralizer: ["fighterabilityenergyneutralizer"],
  fighterabilitystasiswebifier: ["fighterabilitystasiswebifier"],
  fighterabilitywarpdisruption: ["fighterabilitywarpdisruption"],
  fighterabilityecm: ["fighterabilityecm"],
  fighterabilityevasivemaneuvers: ["fighterabilityevasivemaneuvers"],
  fighterabilitytackle: ["fighterabilitytackle"],
  fighterabilitylaunchbomb: ["fighterabilitylaunchbomb"],
  fighterabilitykamikaze: ["fighterabilitykamikaze"],
  fightertargetpaint: ["fightertargetpaint", "fighterabilitytargetpaint"],
  fighterdamagemultiply: ["fighterdamagemultiply", "fighterabilitydamagemultiply"],
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toOptionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toOptionalInt(value) {
  const numeric = toOptionalFiniteNumber(value);
  return numeric === null ? null : Math.trunc(numeric);
}

function normalizeEffectName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTargetMode(value) {
  const targetMode = String(value || "").trim();
  switch (targetMode) {
    case TARGET_MODE_UNTARGETED:
    case TARGET_MODE_ITEMTARGETED:
    case TARGET_MODE_POINTTARGETED:
      return targetMode;
    default:
      return TARGET_MODE_ITEMTARGETED;
  }
}

function getAuthorityPayload() {
  if (authorityCache.payload) {
    return authorityCache.payload;
  }

  const payload = readStaticTable(TABLE.FIGHTER_ABILITIES);
  authorityCache.payload = payload && typeof payload === "object" ? payload : {};
  return authorityCache.payload;
}

function getAbilityAuthorityMap() {
  if (authorityCache.abilitiesByID instanceof Map) {
    return authorityCache.abilitiesByID;
  }

  const abilityMap = new Map();
  const raw = getAuthorityPayload().abilitiesByID;
  if (raw && typeof raw === "object") {
    for (const [abilityID, abilityRecord] of Object.entries(raw)) {
      const numericAbilityID = toInt(abilityID, 0);
      if (numericAbilityID <= 0 || !abilityRecord || typeof abilityRecord !== "object") {
        continue;
      }
      abilityMap.set(numericAbilityID, abilityRecord);
    }
  }
  authorityCache.abilitiesByID = abilityMap;
  return authorityCache.abilitiesByID;
}

function getFighterTypeAuthorityMap() {
  if (authorityCache.fighterTypesByID instanceof Map) {
    return authorityCache.fighterTypesByID;
  }

  const fighterTypeMap = new Map();
  const raw = getAuthorityPayload().fighterTypesByID;
  if (raw && typeof raw === "object") {
    for (const [typeID, typeRecord] of Object.entries(raw)) {
      const numericTypeID = toInt(typeID, 0);
      if (numericTypeID <= 0 || !typeRecord || typeof typeRecord !== "object") {
        continue;
      }
      fighterTypeMap.set(numericTypeID, typeRecord);
    }
  }
  authorityCache.fighterTypesByID = fighterTypeMap;
  return authorityCache.fighterTypesByID;
}

function getAbilityAuthorityRecord(abilityID) {
  const numericAbilityID = toInt(abilityID, 0);
  if (numericAbilityID <= 0) {
    return null;
  }
  return getAbilityAuthorityMap().get(numericAbilityID) || null;
}

function getFighterTypeAuthorityRecord(typeID) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return null;
  }
  return getFighterTypeAuthorityMap().get(numericTypeID) || null;
}

function getEffectAliases(effectFamily) {
  const normalizedFamily = normalizeEffectName(effectFamily);
  return EFFECT_FAMILY_ALIASES[normalizedFamily] || [normalizedFamily];
}

function matchEffectRecordForFamily(effectRecords, effectFamily) {
  const aliases = getEffectAliases(effectFamily);
  if (aliases.length === 0) {
    return null;
  }

  for (const effectRecord of effectRecords) {
    const normalizedEffectName = normalizeEffectName(effectRecord && effectRecord.name);
    if (!normalizedEffectName) {
      continue;
    }
    if (
      aliases.includes(normalizedEffectName) ||
      aliases.some((alias) => normalizedEffectName.startsWith(alias))
    ) {
      return effectRecord;
    }
  }

  return null;
}

function buildAbilitySlotMeta(typeID, slotRecord) {
  if (!slotRecord || typeof slotRecord !== "object") {
    return null;
  }

  const slotID = toInt(slotRecord.slotID, -1);
  const abilityID = toInt(slotRecord.abilityID, 0);
  if (!ABILITY_SLOT_IDS.includes(slotID) || abilityID <= 0) {
    return null;
  }

  const abilityRecord = getAbilityAuthorityRecord(abilityID);
  if (!abilityRecord) {
    return null;
  }

  const attributeMap = getTypeAttributeMap(typeID);
  const effectRecords = getTypeEffectRecords(typeID);
  const effectRecord = matchEffectRecordForFamily(
    effectRecords,
    abilityRecord.effectFamily,
  );
  const durationAttributeID = toInt(
    effectRecord && effectRecord.durationAttributeID,
    toInt(abilityRecord.durationAttributeID, 0),
  );
  const rangeAttributeID = toInt(
    effectRecord && effectRecord.rangeAttributeID,
    toInt(abilityRecord.rangeAttributeID, 0),
  );
  const falloffAttributeID = toInt(
    effectRecord && effectRecord.falloffAttributeID,
    toInt(abilityRecord.falloffAttributeID, 0),
  );
  const trackingSpeedAttributeID = toInt(
    effectRecord && effectRecord.trackingSpeedAttributeID,
    toInt(abilityRecord.trackingSpeedAttributeID, 0),
  );
  const cooldownSeconds = toOptionalFiniteNumber(slotRecord.cooldownSeconds);
  const chargeCount = slotRecord.charges
    ? toOptionalInt(slotRecord.charges.chargeCount)
    : null;
  const rearmTimeSeconds = slotRecord.charges
    ? toOptionalFiniteNumber(slotRecord.charges.rearmTimeSeconds)
    : null;
  const durationMs = durationAttributeID > 0
    ? Math.max(
      1,
      Math.round(toFiniteNumber(attributeMap[durationAttributeID], 1)),
    )
    : null;

  return Object.freeze({
    slotID,
    abilityID,
    effectFamily: String(abilityRecord.effectFamily || ""),
    effectID: toInt(
      effectRecord && effectRecord.effectID,
      toInt(abilityRecord.dogmaEffectID, 0),
    ),
    effectName: String(
      (effectRecord && effectRecord.name) ||
      abilityRecord.dogmaEffectName ||
      "",
    ),
    effectGuid: String(
      (effectRecord && effectRecord.guid) ||
      abilityRecord.dogmaEffectGuid ||
      "",
    ),
    effectCategoryID: toInt(effectRecord && effectRecord.effectCategoryID, 0),
    isOffensive: Boolean(
      (effectRecord && effectRecord.isOffensive) ||
      abilityRecord.isOffensive,
    ),
    targetMode: normalizeTargetMode(abilityRecord.targetMode),
    durationMs,
    durationAttributeID: durationAttributeID > 0 ? durationAttributeID : null,
    cooldownMs:
      cooldownSeconds === null || !Number.isFinite(cooldownSeconds)
        ? null
        : Math.max(1, Math.round(cooldownSeconds * 1000)),
    rangeMeters: Math.max(
      0,
      rangeAttributeID > 0
        ? toFiniteNumber(attributeMap[rangeAttributeID], 0)
        : 0,
    ),
    rangeAttributeID: rangeAttributeID > 0 ? rangeAttributeID : null,
    falloffMeters: Math.max(
      0,
      falloffAttributeID > 0
        ? toFiniteNumber(attributeMap[falloffAttributeID], 0)
        : 0,
    ),
    falloffAttributeID: falloffAttributeID > 0 ? falloffAttributeID : null,
    trackingSpeed: Math.max(
      0,
      trackingSpeedAttributeID > 0
        ? toFiniteNumber(attributeMap[trackingSpeedAttributeID], 0)
        : 0,
    ),
    trackingSpeedAttributeID:
      trackingSpeedAttributeID > 0 ? trackingSpeedAttributeID : null,
    chargeCount,
    rearmTimeMs:
      rearmTimeSeconds === null || !Number.isFinite(rearmTimeSeconds)
        ? null
        : Math.max(1, Math.round(rearmTimeSeconds * 1000)),
    displayNameID: toInt(abilityRecord.displayNameID, 0),
    tooltipTextID: toInt(abilityRecord.tooltipTextID, 0) || null,
    iconID: toInt(abilityRecord.iconID, 0) || null,
    turretGraphicID: toInt(abilityRecord.turretGraphicID, 0) || null,
    disallowInHighSec: Boolean(abilityRecord.disallowInHighSec),
    disallowInLowSec: Boolean(abilityRecord.disallowInLowSec),
    hasAuthoritativeAuthority: true,
  });
}

function getFighterAbilitySlots(typeID) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return [];
  }

  if (abilitySlotsByTypeID.has(numericTypeID)) {
    return abilitySlotsByTypeID.get(numericTypeID);
  }

  const typeAuthority = getFighterTypeAuthorityRecord(numericTypeID);
  const slotMap = ABILITY_SLOT_IDS.map((slotID) => {
    const slotRecord =
      typeAuthority &&
      Array.isArray(typeAuthority.abilitySlots)
        ? typeAuthority.abilitySlots.find(
          (candidate) => toInt(candidate && candidate.slotID, -1) === slotID,
        ) || null
        : null;
    return buildAbilitySlotMeta(numericTypeID, slotRecord);
  });

  abilitySlotsByTypeID.set(numericTypeID, slotMap);
  return slotMap;
}

function getFighterAbilityMetaForSlot(typeID, slotID) {
  const numericSlotID = toInt(slotID, -1);
  if (!ABILITY_SLOT_IDS.includes(numericSlotID)) {
    return null;
  }

  return getFighterAbilitySlots(typeID)[numericSlotID] || null;
}

function getFighterAbilityMetaForAbilityID(abilityID) {
  return getAbilityAuthorityRecord(abilityID);
}

module.exports = {
  ABILITY_SLOT_IDS,
  TARGET_MODE_UNTARGETED,
  TARGET_MODE_ITEMTARGETED,
  TARGET_MODE_POINTTARGETED,
  getFighterAbilitySlots,
  getFighterAbilityMetaForSlot,
  getFighterAbilityMetaForAbilityID,
};
