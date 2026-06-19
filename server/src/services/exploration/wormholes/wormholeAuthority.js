const path = require("path");

const explorationAuthority = require(path.join(
  __dirname,
  "../explorationAuthority",
));

let cache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function classifyKnownSpaceClass(securityStatus) {
  const numericSecurity = Number(securityStatus);
  if (!Number.isFinite(numericSecurity)) {
    return 0;
  }
  if (numericSecurity >= 0.45) {
    return 7;
  }
  if (numericSecurity >= 0) {
    return 8;
  }
  return 9;
}

function normalizePayload(payload = {}) {
  return {
    version: toInt(payload.version, 0),
    generatedAt: String(payload.generatedAt || "").trim(),
    counts: payload.counts && typeof payload.counts === "object" ? payload.counts : {},
    k162Type: payload.k162Type && typeof payload.k162Type === "object" ? payload.k162Type : null,
    codeTypes: Array.isArray(payload.codeTypes) ? payload.codeTypes : [],
    wanderingProfiles: Array.isArray(payload.wanderingProfiles) ? payload.wanderingProfiles : [],
    systems: Array.isArray(payload.systems) ? payload.systems : [],
    systemsByClass:
      payload.systemsByClass && typeof payload.systemsByClass === "object"
        ? payload.systemsByClass
        : {},
  };
}

function buildCache() {
  const payload = normalizePayload(explorationAuthority.getWormholeAuthorityPayload());
  const systemsByID = new Map();
  const codeTypesByCode = new Map();
  const typeRecordsByTypeID = new Map();
  const candidateSystemIDsByClass = new Map();
  const wanderingProfilesBySourceClass = new Map();
  const wanderingProfiles = (Array.isArray(payload.wanderingProfiles)
    ? payload.wanderingProfiles
    : []
  ).map((profile) => ({
    ...profile,
    profileKey: String(profile.profileKey || "").trim(),
    code: String(profile.code || "").trim().toUpperCase(),
    typeID: toInt(profile.typeID, 0),
    sourceClassID: toInt(profile.sourceClassID, 0),
    destinationClassID: toInt(profile.destinationClassID, 0),
    lifetimeMinutes: toInt(profile.lifetimeMinutes, 0),
    maxStableMass: toInt(profile.maxStableMass, 0),
    massRegeneration: toInt(profile.massRegeneration, 0),
    maxJumpMass: toInt(profile.maxJumpMass, 0),
    distributionID: toInt(profile.distributionID, 0),
    radius: Number(profile.radius) || 3000,
    graphicID: toInt(profile.graphicID, 0),
    estimatedUniverseCount: Math.max(1, toInt(profile.estimatedUniverseCount, 1)),
    sourceLabel: String(profile.sourceLabel || "").trim(),
    totalCountText: String(profile.totalCountText || "").trim(),
  })).filter((profile) => profile.profileKey && profile.sourceClassID > 0 && profile.destinationClassID > 0);

  for (const system of payload.systems) {
    const normalizedSystem = {
      ...system,
      solarSystemID: toInt(system.solarSystemID, 0),
      regionID: toInt(system.regionID, 0),
      constellationID: toInt(system.constellationID, 0),
      wormholeClassID: toInt(system.wormholeClassID, 0),
      nebulaID: toInt(system.nebulaID, 0),
      environmentFamily: String(system.environmentFamily || "").trim() || null,
      environmentTypeID: toInt(system.environmentTypeID, 0),
      environmentName: String(system.environmentName || "").trim() || null,
      environmentPosition:
        system.environmentPosition && typeof system.environmentPosition === "object"
          ? {
              x: Number(system.environmentPosition.x) || 0,
              y: Number(system.environmentPosition.y) || 0,
              z: Number(system.environmentPosition.z) || 0,
            }
          : null,
      environmentEffectTypeID: toInt(system.environmentEffectTypeID, 0),
      environmentEffectTypeName: String(system.environmentEffectTypeName || "").trim() || null,
      securityStatus: Number(system.securityStatus) || 0,
      staticSlots: Array.isArray(system.staticSlots)
        ? system.staticSlots.map((slot) => ({
            ...slot,
            slotIndex: toInt(slot.slotIndex, 0),
            typeID: toInt(slot.typeID, 0),
            targetClassID: toInt(slot.targetClassID, 0),
            lifetimeMinutes: toInt(slot.lifetimeMinutes, 0),
            maxStableMass: toInt(slot.maxStableMass, 0),
            massRegeneration: toInt(slot.massRegeneration, 0),
            maxJumpMass: toInt(slot.maxJumpMass, 0),
            distributionID: toInt(slot.distributionID, 0),
            radius: Number(slot.radius) || 3000,
            graphicID: toInt(slot.graphicID, 0),
          }))
        : [],
    };
    systemsByID.set(normalizedSystem.solarSystemID, normalizedSystem);
  }

  for (const typeRecord of payload.codeTypes) {
    const normalized = {
      ...typeRecord,
      typeID: toInt(typeRecord.typeID, 0),
      targetClassID: toInt(typeRecord.targetClassID, 0),
      lifetimeMinutes: toInt(typeRecord.lifetimeMinutes, 0),
      maxStableMass: toInt(typeRecord.maxStableMass, 0),
      massRegeneration: toInt(typeRecord.massRegeneration, 0),
      maxJumpMass: toInt(typeRecord.maxJumpMass, 0),
      distributionID: toInt(typeRecord.distributionID, 0),
      radius: Number(typeRecord.radius) || 3000,
      graphicID: toInt(typeRecord.graphicID, 0),
    };
    codeTypesByCode.set(String(normalized.code || "").trim().toUpperCase(), normalized);
    typeRecordsByTypeID.set(normalized.typeID, normalized);
  }

  for (const [classKey, systemIDs] of Object.entries(payload.systemsByClass || {})) {
    candidateSystemIDsByClass.set(
      toInt(classKey, 0),
      (Array.isArray(systemIDs) ? systemIDs : [])
        .map((systemID) => toInt(systemID, 0))
        .filter((systemID) => systemID > 0),
    );
  }

  for (const profile of wanderingProfiles) {
    const sourceClassID = toInt(profile.sourceClassID, 0);
    if (sourceClassID <= 0) {
      continue;
    }
    const existing = wanderingProfilesBySourceClass.get(sourceClassID) || [];
    existing.push(profile);
    wanderingProfilesBySourceClass.set(sourceClassID, existing);
  }

  return {
    payload,
    systemsByID,
    codeTypesByCode,
    typeRecordsByTypeID,
    candidateSystemIDsByClass,
    wanderingProfiles,
    wanderingProfilesBySourceClass,
    k162Type: payload.k162Type
      ? {
          ...payload.k162Type,
          typeID: toInt(payload.k162Type.typeID, 0),
          graphicID: toInt(payload.k162Type.graphicID, 0),
          radius: Number(payload.k162Type.radius) || 3000,
        }
      : null,
  };
}

function ensureCache() {
  if (!cache) {
    cache = buildCache();
  }
  return cache;
}

function clearCache() {
  cache = null;
}

function getSystemAuthority(systemID) {
  return ensureCache().systemsByID.get(toInt(systemID, 0)) || null;
}

function getSystemClassID(systemID, fallbackSecurityStatus = null) {
  const system = getSystemAuthority(systemID);
  if (system) {
    return toInt(system.wormholeClassID, 0);
  }
  return classifyKnownSpaceClass(fallbackSecurityStatus);
}

function getSystemNebulaID(systemID) {
  const system = getSystemAuthority(systemID);
  return system ? toInt(system.nebulaID, 0) : 0;
}

function getSystemEnvironment(systemID) {
  const system = getSystemAuthority(systemID);
  if (!system) {
    return null;
  }
  return {
    environmentFamily: String(system.environmentFamily || "").trim() || null,
    environmentTypeID: toInt(system.environmentTypeID, 0),
    environmentName: String(system.environmentName || "").trim() || null,
    environmentPosition:
      system.environmentPosition && typeof system.environmentPosition === "object"
        ? {
            x: Number(system.environmentPosition.x) || 0,
            y: Number(system.environmentPosition.y) || 0,
            z: Number(system.environmentPosition.z) || 0,
          }
        : null,
    environmentEffectTypeID: toInt(system.environmentEffectTypeID, 0),
    environmentEffectTypeName: String(system.environmentEffectTypeName || "").trim() || null,
  };
}

function listStaticSlotsForSystem(systemID) {
  const system = getSystemAuthority(systemID);
  return system && Array.isArray(system.staticSlots) ? [...system.staticSlots] : [];
}

function listCandidateSystemIDsForClass(classID) {
  return [
    ...(ensureCache().candidateSystemIDsByClass.get(toInt(classID, 0)) || []),
  ];
}

function getCodeTypeRecord(codeOrTypeID) {
  if (typeof codeOrTypeID === "number" || /^\d+$/.test(String(codeOrTypeID || ""))) {
    return ensureCache().typeRecordsByTypeID.get(toInt(codeOrTypeID, 0)) || null;
  }
  return ensureCache().codeTypesByCode.get(
    String(codeOrTypeID || "").trim().toUpperCase(),
  ) || null;
}

function getK162TypeRecord() {
  return ensureCache().k162Type;
}

function listCodeTypes() {
  return [...ensureCache().codeTypesByCode.values()];
}

function listWanderingProfiles() {
  return [...ensureCache().wanderingProfiles];
}

function listWanderingProfilesForSourceClass(classID) {
  return [
    ...(ensureCache().wanderingProfilesBySourceClass.get(toInt(classID, 0)) || []),
  ];
}

function listSystems() {
  return [...ensureCache().systemsByID.values()];
}

module.exports = {
  classifyKnownSpaceClass,
  clearCache,
  getCodeTypeRecord,
  getK162TypeRecord,
  getSystemAuthority,
  getSystemClassID,
  getSystemEnvironment,
  getSystemNebulaID,
  listCodeTypes,
  listCandidateSystemIDsForClass,
  listStaticSlotsForSystem,
  listWanderingProfiles,
  listWanderingProfilesForSourceClass,
  listSystems,
};
