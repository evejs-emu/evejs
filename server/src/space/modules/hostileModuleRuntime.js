const path = require("path");

const {
  getAttributeIDByNames,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  buildLiveModuleAttributeMap,
} = require(path.join(__dirname, "./liveModuleAttributes"));

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_MAX_TARGET_RANGE = getAttributeIDByNames("maxTargetRange") || 76;
const ATTRIBUTE_SCAN_RESOLUTION = getAttributeIDByNames("scanResolution") || 564;
const ATTRIBUTE_FALLOFF_EFFECTIVENESS =
  getAttributeIDByNames("falloffEffectiveness") || 2044;
const ATTRIBUTE_MAX_GROUP_ACTIVE = getAttributeIDByNames("maxGroupActive") || 763;
const ATTRIBUTE_REACTIVATION_DELAY =
  getAttributeIDByNames("moduleReactivationDelay", "reactivationDelay") || 669;
const ATTRIBUTE_SPEED_FACTOR = getAttributeIDByNames("speedFactor") || 20;
const ATTRIBUTE_SIGNATURE_RADIUS_BONUS =
  getAttributeIDByNames("signatureRadiusBonus") || 554;
const ATTRIBUTE_MAX_TARGET_RANGE_BONUS =
  getAttributeIDByNames("maxTargetRangeBonus") || 309;
const ATTRIBUTE_SCAN_RESOLUTION_BONUS =
  getAttributeIDByNames("scanResolutionBonus") || 566;
const ATTRIBUTE_MAX_RANGE_BONUS = getAttributeIDByNames("maxRangeBonus") || 351;
const ATTRIBUTE_FALLOFF_BONUS = getAttributeIDByNames("falloffBonus") || 349;
const ATTRIBUTE_TRACKING_SPEED_BONUS =
  getAttributeIDByNames("trackingSpeedBonus") || 767;
const ATTRIBUTE_MISSILE_VELOCITY_BONUS =
  getAttributeIDByNames("missileVelocityBonus") || 547;
const ATTRIBUTE_EXPLOSION_DELAY_BONUS =
  getAttributeIDByNames("explosionDelayBonus") || 596;
const ATTRIBUTE_AOE_VELOCITY_BONUS =
  getAttributeIDByNames("aoeVelocityBonus") || 847;
const ATTRIBUTE_AOE_CLOUD_SIZE_BONUS =
  getAttributeIDByNames("aoeCloudSizeBonus") || 848;
const ATTRIBUTE_WARP_SCRAMBLE_STATUS =
  getAttributeIDByNames("warpScrambleStatus") || 104;
const ATTRIBUTE_WARP_SCRAMBLE_STRENGTH =
  getAttributeIDByNames("warpScrambleStrength") || 105;
const ATTRIBUTE_ENERGY_NEUTRALIZER_AMOUNT =
  getAttributeIDByNames("energyNeutralizerAmount") || 97;
const ATTRIBUTE_POWER_TRANSFER_AMOUNT =
  getAttributeIDByNames("powerTransferAmount") || 90;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_EXPLOSION_DELAY = getAttributeIDByNames("explosionDelay") || 281;
const ATTRIBUTE_AOE_VELOCITY = getAttributeIDByNames("aoeVelocity") || 653;
const ATTRIBUTE_AOE_CLOUD_SIZE = getAttributeIDByNames("aoeCloudSize") || 654;
const ATTRIBUTE_SIGNATURE_RADIUS = getAttributeIDByNames("signatureRadius") || 552;
const ATTRIBUTE_TRACKING_SPEED = getAttributeIDByNames("trackingSpeed") || 160;
const ATTRIBUTE_WEAPON_FALLOFF = getAttributeIDByNames("falloff") || 158;
const ATTRIBUTE_ENERGY_WARFARE_RESISTANCE =
  getAttributeIDByNames("energyWarfareResistance") || 2045;
const ATTRIBUTE_WEAPON_DISRUPTION_RESISTANCE =
  getAttributeIDByNames("weaponDisruptionResistance") || 2113;
const ATTRIBUTE_TARGET_PAINTER_RESISTANCE =
  getAttributeIDByNames("targetPainterResistance") || 2114;
const ATTRIBUTE_STASIS_WEBIFIER_RESISTANCE =
  getAttributeIDByNames("stasisWebifierResistance") || 2115;
const ATTRIBUTE_SENSOR_DAMPENER_RESISTANCE =
  getAttributeIDByNames("sensorDampenerResistance") || 2112;
const ATTRIBUTE_ENERGY_NEUTRALIZER_SIGNATURE_RESOLUTION =
  getAttributeIDByNames("energyNeutralizerSignatureResolution") || 2451;
const ATTRIBUTE_NOS_OVERRIDE = getAttributeIDByNames("nosOverride") || 1945;

const DOGMA_OP_MOD_ADD = 2;
const DOGMA_OP_POST_PERCENT = 6;
const PERSISTENT_SPECIAL_FX_WINDOW_MS = 12 * 60 * 60 * 1000;

const HOSTILE_FAMILY_WEB = "stasisWebifier";
const HOSTILE_FAMILY_PAINT = "targetPainter";
const HOSTILE_FAMILY_SCRAM = "warpScrambler";
const HOSTILE_FAMILY_DISRUPT = "warpDisruptor";
const HOSTILE_FAMILY_NEUT = "energyNeutralizer";
const HOSTILE_FAMILY_NOS = "energyNosferatu";
const HOSTILE_FAMILY_SENSOR_DAMP = "sensorDampener";
const HOSTILE_FAMILY_TRACKING_DISRUPT = "trackingDisruptor";
const HOSTILE_FAMILY_GUIDANCE_DISRUPT = "guidanceDisruptor";

const BASE_HOSTILE_DEFINITIONS = Object.freeze({
  web: Object.freeze({
    family: HOSTILE_FAMILY_WEB,
    jammingType: "webify",
    strengthAttributeID: ATTRIBUTE_SPEED_FACTOR,
    modifierAttributeID: ATTRIBUTE_MAX_VELOCITY,
    modifierOperation: DOGMA_OP_POST_PERCENT,
    resistanceAttributeID: ATTRIBUTE_STASIS_WEBIFIER_RESISTANCE,
    stackingPenalized: true,
    usesFalloff: true,
    affectsTargetDerivedState: true,
  }),
  paint: Object.freeze({
    family: HOSTILE_FAMILY_PAINT,
    jammingType: "ewTargetPaint",
    strengthAttributeID: ATTRIBUTE_SIGNATURE_RADIUS_BONUS,
    modifierAttributeID: ATTRIBUTE_SIGNATURE_RADIUS,
    modifierOperation: DOGMA_OP_POST_PERCENT,
    resistanceAttributeID: ATTRIBUTE_TARGET_PAINTER_RESISTANCE,
    stackingPenalized: true,
    usesFalloff: true,
    affectsTargetDerivedState: true,
  }),
  sensorDamp: Object.freeze({
    family: HOSTILE_FAMILY_SENSOR_DAMP,
    jammingType: "ewRemoteSensorDamp",
    resistanceAttributeID: ATTRIBUTE_SENSOR_DAMPENER_RESISTANCE,
    stackingPenalized: true,
    usesFalloff: true,
    affectsTargetDerivedState: true,
    moduleModifierSpecs: Object.freeze([
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_MAX_TARGET_RANGE_BONUS,
        modifiedAttributeID: ATTRIBUTE_MAX_TARGET_RANGE,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_SCAN_RESOLUTION_BONUS,
        modifiedAttributeID: ATTRIBUTE_SCAN_RESOLUTION,
        operation: DOGMA_OP_POST_PERCENT,
      }),
    ]),
  }),
  scram: Object.freeze({
    family: HOSTILE_FAMILY_SCRAM,
    jammingType: "warpScramblerMWD",
    strengthAttributeID: ATTRIBUTE_WARP_SCRAMBLE_STRENGTH,
    modifierAttributeID: ATTRIBUTE_WARP_SCRAMBLE_STATUS,
    modifierOperation: DOGMA_OP_MOD_ADD,
    stackingPenalized: false,
    usesFalloff: true,
    affectsTargetDerivedState: true,
    blocksMicrowarpdrive: true,
    blocksMicroJumpDrive: true,
  }),
  disrupt: Object.freeze({
    family: HOSTILE_FAMILY_DISRUPT,
    jammingType: "warpScrambler",
    strengthAttributeID: ATTRIBUTE_WARP_SCRAMBLE_STRENGTH,
    modifierAttributeID: ATTRIBUTE_WARP_SCRAMBLE_STATUS,
    modifierOperation: DOGMA_OP_MOD_ADD,
    stackingPenalized: false,
    usesFalloff: true,
    affectsTargetDerivedState: true,
  }),
  neut: Object.freeze({
    family: HOSTILE_FAMILY_NEUT,
    jammingType: "ewEnergyNeut",
    strengthAttributeID: ATTRIBUTE_ENERGY_NEUTRALIZER_AMOUNT,
    resistanceAttributeID: ATTRIBUTE_ENERGY_WARFARE_RESISTANCE,
    signatureResolutionAttributeID: ATTRIBUTE_ENERGY_NEUTRALIZER_SIGNATURE_RESOLUTION,
    stackingPenalized: false,
    usesFalloff: true,
    affectsTargetDerivedState: false,
  }),
  nos: Object.freeze({
    family: HOSTILE_FAMILY_NOS,
    jammingType: "ewEnergyVampire",
    strengthAttributeID: ATTRIBUTE_POWER_TRANSFER_AMOUNT,
    resistanceAttributeID: ATTRIBUTE_ENERGY_WARFARE_RESISTANCE,
    signatureResolutionAttributeID: ATTRIBUTE_ENERGY_NEUTRALIZER_SIGNATURE_RESOLUTION,
    nosOverrideAttributeID: ATTRIBUTE_NOS_OVERRIDE,
    stackingPenalized: false,
    usesFalloff: true,
    affectsTargetDerivedState: false,
  }),
  trackingDisrupt: Object.freeze({
    family: HOSTILE_FAMILY_TRACKING_DISRUPT,
    jammingType: "ewTrackingDisrupt",
    strengthAttributeID: ATTRIBUTE_TRACKING_SPEED_BONUS,
    resistanceAttributeID: ATTRIBUTE_WEAPON_DISRUPTION_RESISTANCE,
    stackingPenalized: true,
    usesFalloff: true,
    affectsTargetDerivedState: false,
    moduleModifierSpecs: Object.freeze([
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_MAX_RANGE_BONUS,
        modifiedAttributeID: ATTRIBUTE_MAX_RANGE,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_FALLOFF_BONUS,
        modifiedAttributeID: ATTRIBUTE_WEAPON_FALLOFF,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_TRACKING_SPEED_BONUS,
        modifiedAttributeID: ATTRIBUTE_TRACKING_SPEED,
        operation: DOGMA_OP_POST_PERCENT,
      }),
    ]),
  }),
  guidanceDisrupt: Object.freeze({
    family: HOSTILE_FAMILY_GUIDANCE_DISRUPT,
    jammingType: "ewGuidanceDisrupt",
    strengthAttributeID: ATTRIBUTE_MISSILE_VELOCITY_BONUS,
    resistanceAttributeID: ATTRIBUTE_WEAPON_DISRUPTION_RESISTANCE,
    stackingPenalized: true,
    usesFalloff: true,
    affectsTargetDerivedState: false,
    chargeModifierSpecs: Object.freeze([
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_MISSILE_VELOCITY_BONUS,
        modifiedAttributeID: ATTRIBUTE_MAX_VELOCITY,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_EXPLOSION_DELAY_BONUS,
        modifiedAttributeID: ATTRIBUTE_EXPLOSION_DELAY,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_AOE_VELOCITY_BONUS,
        modifiedAttributeID: ATTRIBUTE_AOE_VELOCITY,
        operation: DOGMA_OP_POST_PERCENT,
      }),
      Object.freeze({
        sourceAttributeID: ATTRIBUTE_AOE_CLOUD_SIZE_BONUS,
        modifiedAttributeID: ATTRIBUTE_AOE_CLOUD_SIZE,
        operation: DOGMA_OP_POST_PERCENT,
      }),
    ]),
  }),
});

const HOSTILE_EFFECT_DEFINITIONS_BY_NAME = Object.freeze({
  remotewebifierfalloff: BASE_HOSTILE_DEFINITIONS.web,
  remotewebifierentity: BASE_HOSTILE_DEFINITIONS.web,
  modifytargetspeed2: BASE_HOSTILE_DEFINITIONS.web,
  npcbehaviorwebifier: BASE_HOSTILE_DEFINITIONS.web,
  structuredecreasetargetspeed: BASE_HOSTILE_DEFINITIONS.web,
  structuremoduleeffectstasiswebifier: BASE_HOSTILE_DEFINITIONS.web,

  remotetargetpaintfalloff: BASE_HOSTILE_DEFINITIONS.paint,
  remotetargetpaintentity: BASE_HOSTILE_DEFINITIONS.paint,
  behaviortargetpainter: BASE_HOSTILE_DEFINITIONS.paint,
  structureewtargetpaint: BASE_HOSTILE_DEFINITIONS.paint,
  structuremoduleeffecttargetpainter: BASE_HOSTILE_DEFINITIONS.paint,

  targetmaxtargetrangeandscanresolutionbonushostile: BASE_HOSTILE_DEFINITIONS.sensorDamp,
  remotesensordampfalloff: BASE_HOSTILE_DEFINITIONS.sensorDamp,
  remotesensordampentity: BASE_HOSTILE_DEFINITIONS.sensorDamp,
  sensorboosttargetedhostile: BASE_HOSTILE_DEFINITIONS.sensorDamp,
  entitysensordampen: BASE_HOSTILE_DEFINITIONS.sensorDamp,
  behaviorsensordampener: BASE_HOSTILE_DEFINITIONS.sensorDamp,
  structuretargetmaxtargetrangeandscanresolutionbonushostile: BASE_HOSTILE_DEFINITIONS.sensorDamp,
  structuremoduleeffectremotesensordampener: BASE_HOSTILE_DEFINITIONS.sensorDamp,

  warpscrambleblockmwdwithnpceffect: BASE_HOSTILE_DEFINITIONS.scram,
  warpscrambletargetmwdblockactivationforentity: BASE_HOSTILE_DEFINITIONS.scram,
  warpscrambleforentity: BASE_HOSTILE_DEFINITIONS.scram,
  structurewarpscrambleblockmwdwithnpceffect: BASE_HOSTILE_DEFINITIONS.scram,
  behaviorwarpscramble: BASE_HOSTILE_DEFINITIONS.scram,

  warpdisrupt: BASE_HOSTILE_DEFINITIONS.disrupt,

  energyneutralizerfalloff: BASE_HOSTILE_DEFINITIONS.neut,
  npcbehaviorenergyneutralizer: BASE_HOSTILE_DEFINITIONS.neut,
  structureenergyneutralizerfalloff: BASE_HOSTILE_DEFINITIONS.neut,
  entitycapacitatordrain: BASE_HOSTILE_DEFINITIONS.neut,
  entityenergyneutralizerfalloff: BASE_HOSTILE_DEFINITIONS.neut,

  energynosferatufalloff: BASE_HOSTILE_DEFINITIONS.nos,
  npcbehaviorenergynosferatu: BASE_HOSTILE_DEFINITIONS.nos,

  npcbehaviortrackingdisruptor: BASE_HOSTILE_DEFINITIONS.trackingDisrupt,
  npcentitytrackingdisruptor: BASE_HOSTILE_DEFINITIONS.trackingDisrupt,
  shipmoduletrackingdisruptor: BASE_HOSTILE_DEFINITIONS.trackingDisrupt,
  structuremoduleeffectweapondisruption: BASE_HOSTILE_DEFINITIONS.trackingDisrupt,

  npcbehaviorguidancedisruptor: BASE_HOSTILE_DEFINITIONS.guidanceDisrupt,
  guidancedisrupt: BASE_HOSTILE_DEFINITIONS.guidanceDisrupt,
  shipmoduleguidancedisruptor: BASE_HOSTILE_DEFINITIONS.guidanceDisrupt,
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, digits = 6) {
  return Number(toFiniteNumber(value, 0).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, toFiniteNumber(value, min)));
}

function normalizeEffectName(effectRecord) {
  return String(effectRecord && effectRecord.name || "").trim().toLowerCase();
}

function resolveHostileDefinition(effectRecord) {
  return HOSTILE_EFFECT_DEFINITIONS_BY_NAME[normalizeEffectName(effectRecord)] || null;
}

function resolvePersistentRepeat(durationMs) {
  const cycleMs = Math.max(1, toFiniteNumber(durationMs, 1000));
  return Math.max(1, Math.ceil(PERSISTENT_SPECIAL_FX_WINDOW_MS / cycleMs));
}

function getPreferredAttributeValue(attributeMap, preferredAttributeIDs = [], fallback = 0) {
  for (const attributeID of preferredAttributeIDs) {
    const numericAttributeID = toInt(attributeID, 0);
    if (numericAttributeID <= 0) {
      continue;
    }
    const value = toFiniteNumber(attributeMap && attributeMap[numericAttributeID], NaN);
    if (Number.isFinite(value)) {
      return {
        value,
        attributeID: numericAttributeID,
      };
    }
  }
  return {
    value: toFiniteNumber(fallback, 0),
    attributeID: 0,
  };
}

function buildHostileModifierEntries(attributeMap, modifierSpecs = [], stackingPenalized = false) {
  const entries = [];
  for (const modifierSpec of Array.isArray(modifierSpecs) ? modifierSpecs : []) {
    const sourceAttributeID = toInt(modifierSpec && modifierSpec.sourceAttributeID, 0);
    const modifiedAttributeID = toInt(modifierSpec && modifierSpec.modifiedAttributeID, 0);
    const operation = toInt(modifierSpec && modifierSpec.operation, -1);
    if (sourceAttributeID <= 0 || modifiedAttributeID <= 0 || operation < 0) {
      continue;
    }
    const value = toFiniteNumber(attributeMap && attributeMap[sourceAttributeID], NaN);
    if (!Number.isFinite(value) || Math.abs(value) <= 1e-9) {
      continue;
    }
    entries.push(Object.freeze({
      modifiedAttributeID,
      operation,
      value: roundNumber(value, 6),
      stackingPenalized: stackingPenalized === true,
    }));
  }
  return Object.freeze(entries);
}

function buildTargetHostileStateKey(sourceBallID, moduleID, targetBallID) {
  return [
    toInt(sourceBallID, 0),
    toInt(moduleID, 0),
    toInt(targetBallID, 0),
  ].join(":");
}

function ensureTargetHostileState(targetEntity, create = false) {
  if (!targetEntity || typeof targetEntity !== "object") {
    return null;
  }
  if (!targetEntity.hostileModuleState && create) {
    targetEntity.hostileModuleState = {
      incomingEffects: new Map(),
      modifierEntries: Object.freeze([]),
      weaponModuleModifierEntries: Object.freeze([]),
      weaponChargeModifierEntries: Object.freeze([]),
      aggregateSignature: "",
      warpScrambleStatus: 0,
      microwarpdriveBlocked: false,
      microJumpDriveBlocked: false,
    };
  }
  return targetEntity.hostileModuleState && targetEntity.hostileModuleState.incomingEffects instanceof Map
    ? targetEntity.hostileModuleState
    : null;
}

function getEntityPassiveAttributeValue(entity, attributeID, fallback = 0) {
  const attributes =
    entity &&
    entity.passiveDerivedState &&
    entity.passiveDerivedState.attributes &&
    typeof entity.passiveDerivedState.attributes === "object"
      ? entity.passiveDerivedState.attributes
      : null;
  const numericAttributeID = toInt(attributeID, 0);
  if (attributes && Number.isFinite(Number(attributes[numericAttributeID]))) {
    return Number(attributes[numericAttributeID]);
  }
  return toFiniteNumber(fallback, 0);
}

function resolveTargetResistanceMultiplier(targetEntity, resistanceAttributeID) {
  if (toInt(resistanceAttributeID, 0) <= 0) {
    return 1;
  }
  const resistancePercent = clamp(
    getEntityPassiveAttributeValue(targetEntity, resistanceAttributeID, 0),
    0,
    100,
  );
  return roundNumber(1 - (resistancePercent / 100), 6);
}

function resolveHostileRangeMultiplier(effectState, sourceEntity, targetEntity, callbacks = {}) {
  const surfaceDistance = Math.max(
    0,
    toFiniteNumber(
      callbacks.getEntitySurfaceDistance &&
        callbacks.getEntitySurfaceDistance(sourceEntity, targetEntity),
      0,
    ),
  );
  const optimalRangeMeters = Math.max(
    0,
    toFiniteNumber(effectState && effectState.hostileMaxRangeMeters, 0),
  );
  const falloffMeters = Math.max(
    0,
    toFiniteNumber(effectState && effectState.hostileFalloffMeters, 0),
  );

  if (surfaceDistance <= optimalRangeMeters + 1) {
    return {
      success: true,
      multiplier: 1,
      surfaceDistance,
    };
  }
  if (falloffMeters <= 0) {
    return {
      success: false,
      errorMsg: "TARGET_OUT_OF_RANGE",
      stopReason: "target",
      surfaceDistance,
    };
  }

  const distanceIntoFalloff = surfaceDistance - optimalRangeMeters;
  if (distanceIntoFalloff > falloffMeters + 1) {
    return {
      success: false,
      errorMsg: "TARGET_OUT_OF_RANGE",
      stopReason: "target",
      surfaceDistance,
    };
  }

  const normalizedDistance = distanceIntoFalloff / Math.max(falloffMeters, 1);
  return {
    success: true,
    multiplier: roundNumber(0.5 ** (normalizedDistance ** 2), 6),
    surfaceDistance,
  };
}

function resolveEnergyWarfareMultiplier(effectState, targetEntity, rangeMultiplier) {
  const resistanceMultiplier = resolveTargetResistanceMultiplier(
    targetEntity,
    effectState && effectState.hostileResistanceAttributeID,
  );
  const signatureResolution = Math.max(
    0,
    toFiniteNumber(effectState && effectState.hostileEnergySignatureResolution, 0),
  );
  const targetSignatureRadius = Math.max(
    0,
    toFiniteNumber(targetEntity && targetEntity.signatureRadius, 0),
  );
  const signatureMultiplier =
    signatureResolution > 0 && targetSignatureRadius > 0
      ? Math.min(1, targetSignatureRadius / signatureResolution)
      : 1;
  return roundNumber(
    Math.max(rangeMultiplier, 0) *
      Math.max(resistanceMultiplier, 0) *
      Math.max(signatureMultiplier, 0),
    6,
  );
}

function buildHostileTargetRecord(sourceEntity, effectState, targetEntity, nowMs, rangeMultiplier) {
  return Object.freeze({
    key: buildTargetHostileStateKey(
      sourceEntity && sourceEntity.itemID,
      effectState && effectState.moduleID,
      targetEntity && targetEntity.itemID,
    ),
    sourceBallID: toInt(sourceEntity && sourceEntity.itemID, 0),
    moduleID: toInt(effectState && effectState.moduleID, 0),
    targetBallID: toInt(targetEntity && targetEntity.itemID, 0),
    family: String(effectState && effectState.hostileFamily || ""),
    jammingType: String(effectState && effectState.hostileJammingType || ""),
    startedAtMs: Math.max(0, toFiniteNumber(nowMs, Date.now())),
    expiresAtMs: Math.max(
      0,
      toFiniteNumber(nowMs, Date.now()) +
        Math.max(1, toFiniteNumber(effectState && effectState.durationMs, 1000)),
    ),
    rangeMultiplier: roundNumber(rangeMultiplier, 6),
    modifierAttributeID: toInt(effectState && effectState.hostileModifierAttributeID, 0),
    modifierOperation: toInt(effectState && effectState.hostileModifierOperation, -1),
    modifierValue: roundNumber(toFiniteNumber(effectState && effectState.hostileStrengthValue, 0), 6),
    moduleModifierEntries: Object.freeze(
      (Array.isArray(effectState && effectState.hostileModuleModifierEntries)
        ? effectState.hostileModuleModifierEntries
        : []
      ).map((entry) => Object.freeze({ ...entry })),
    ),
    chargeModifierEntries: Object.freeze(
      (Array.isArray(effectState && effectState.hostileChargeModifierEntries)
        ? effectState.hostileChargeModifierEntries
        : []
      ).map((entry) => Object.freeze({ ...entry })),
    ),
    resistanceAttributeID: toInt(effectState && effectState.hostileResistanceAttributeID, 0),
    energySignatureResolution: Math.max(
      0,
      roundNumber(toFiniteNumber(effectState && effectState.hostileEnergySignatureResolution, 0), 6),
    ),
    scrambleStrength: roundNumber(
      toFiniteNumber(effectState && effectState.hostileWarpScrambleStrength, 0),
      6,
    ),
    stackingPenalized: effectState && effectState.hostileStackingPenalized === true,
    affectsTargetDerivedState: effectState && effectState.hostileAffectsTargetDerivedState === true,
    blocksMicrowarpdrive: effectState && effectState.hostileBlocksMicrowarpdrive === true,
    blocksMicroJumpDrive: effectState && effectState.hostileBlocksMicroJumpDrive === true,
    nosOverride: effectState && effectState.hostileNosOverride === true,
  });
}

function buildAggregateSignature(entries, warpScrambleStatus, microwarpdriveBlocked, microJumpDriveBlocked) {
  return JSON.stringify({
    entries: (Array.isArray(entries) ? entries : []).map((entry) => ({
      attribute: toInt(entry && entry.modifiedAttributeID, 0),
      operation: toInt(entry && entry.operation, 0),
      value: roundNumber(entry && entry.value, 6),
      stackingPenalized: entry && entry.stackingPenalized === true,
    })),
    warpScrambleStatus: roundNumber(warpScrambleStatus, 6),
    microwarpdriveBlocked: microwarpdriveBlocked === true,
    microJumpDriveBlocked: microJumpDriveBlocked === true,
  });
}

function recomputeTargetAggregateState(targetEntity) {
  const targetState = ensureTargetHostileState(targetEntity, false);
  if (!targetState) {
    return {
      changed: false,
      modifierEntries: [],
      weaponModuleModifierEntries: [],
      weaponChargeModifierEntries: [],
      warpScrambleStatus: 0,
      microwarpdriveBlocked: false,
      microJumpDriveBlocked: false,
    };
  }

  const modifierEntries = [];
  const weaponModuleModifierEntries = [];
  const weaponChargeModifierEntries = [];
  let warpScrambleStatus = 0;
  let microwarpdriveBlocked = false;
  let microJumpDriveBlocked = false;

  for (const record of targetState.incomingEffects.values()) {
    if (!record) {
      continue;
    }

    if (
      record.family === HOSTILE_FAMILY_WEB ||
      record.family === HOSTILE_FAMILY_PAINT
    ) {
      const resistanceMultiplier = resolveTargetResistanceMultiplier(
        targetEntity,
        record.resistanceAttributeID,
      );
      const value = roundNumber(
        record.modifierValue *
          Math.max(record.rangeMultiplier, 0) *
          Math.max(resistanceMultiplier, 0),
        6,
      );
      if (Math.abs(value) > 1e-6) {
        modifierEntries.push({
          modifiedAttributeID: record.modifierAttributeID,
          operation: record.modifierOperation,
          value,
          stackingPenalized: record.stackingPenalized === true,
        });
      }
      continue;
    }

    if (record.family === HOSTILE_FAMILY_SENSOR_DAMP) {
      const resistanceMultiplier = resolveTargetResistanceMultiplier(
        targetEntity,
        record.resistanceAttributeID,
      );
      const scaledMultiplier =
        Math.max(record.rangeMultiplier, 0) *
        Math.max(resistanceMultiplier, 0);
      for (const entry of record.moduleModifierEntries || []) {
        const value = roundNumber(
          toFiniteNumber(entry && entry.value, 0) * scaledMultiplier,
          6,
        );
        if (Math.abs(value) <= 1e-6) {
          continue;
        }
        modifierEntries.push({
          modifiedAttributeID: toInt(entry && entry.modifiedAttributeID, 0),
          operation: toInt(entry && entry.operation, -1),
          value,
          stackingPenalized: entry && entry.stackingPenalized === true,
        });
      }
      continue;
    }

    if (
      record.family === HOSTILE_FAMILY_SCRAM ||
      record.family === HOSTILE_FAMILY_DISRUPT
    ) {
      const value = roundNumber(
        record.scrambleStrength * Math.max(record.rangeMultiplier, 0),
        6,
      );
      if (Math.abs(value) > 1e-6) {
        modifierEntries.push({
          modifiedAttributeID: ATTRIBUTE_WARP_SCRAMBLE_STATUS,
          operation: DOGMA_OP_MOD_ADD,
          value,
          stackingPenalized: false,
        });
        warpScrambleStatus += value;
      }
      microwarpdriveBlocked = microwarpdriveBlocked || record.blocksMicrowarpdrive === true;
      microJumpDriveBlocked = microJumpDriveBlocked || record.blocksMicroJumpDrive === true;
      continue;
    }

    if (
      record.family === HOSTILE_FAMILY_TRACKING_DISRUPT ||
      record.family === HOSTILE_FAMILY_GUIDANCE_DISRUPT
    ) {
      const resistanceMultiplier = resolveTargetResistanceMultiplier(
        targetEntity,
        record.resistanceAttributeID,
      );
      const scaledMultiplier =
        Math.max(record.rangeMultiplier, 0) *
        Math.max(resistanceMultiplier, 0);
      for (const entry of record.moduleModifierEntries || []) {
        const value = roundNumber(
          toFiniteNumber(entry && entry.value, 0) * scaledMultiplier,
          6,
        );
        if (Math.abs(value) <= 1e-6) {
          continue;
        }
        weaponModuleModifierEntries.push({
          modifiedAttributeID: toInt(entry && entry.modifiedAttributeID, 0),
          operation: toInt(entry && entry.operation, -1),
          value,
          stackingPenalized: entry && entry.stackingPenalized === true,
        });
      }
      for (const entry of record.chargeModifierEntries || []) {
        const value = roundNumber(
          toFiniteNumber(entry && entry.value, 0) * scaledMultiplier,
          6,
        );
        if (Math.abs(value) <= 1e-6) {
          continue;
        }
        weaponChargeModifierEntries.push({
          modifiedAttributeID: toInt(entry && entry.modifiedAttributeID, 0),
          operation: toInt(entry && entry.operation, -1),
          value,
          stackingPenalized: entry && entry.stackingPenalized === true,
        });
      }
    }
  }

  const nextSignature = buildAggregateSignature(
    modifierEntries,
    warpScrambleStatus,
    microwarpdriveBlocked,
    microJumpDriveBlocked,
  );
  const changed = nextSignature !== String(targetState.aggregateSignature || "");
  targetState.modifierEntries = Object.freeze(
    modifierEntries.map((entry) => Object.freeze({ ...entry })),
  );
  targetState.weaponModuleModifierEntries = Object.freeze(
    weaponModuleModifierEntries.map((entry) => Object.freeze({ ...entry })),
  );
  targetState.weaponChargeModifierEntries = Object.freeze(
    weaponChargeModifierEntries.map((entry) => Object.freeze({ ...entry })),
  );
  targetState.aggregateSignature = nextSignature;
  targetState.warpScrambleStatus = roundNumber(warpScrambleStatus, 6);
  targetState.microwarpdriveBlocked = microwarpdriveBlocked;
  targetState.microJumpDriveBlocked = microJumpDriveBlocked;
  return {
    changed,
    modifierEntries: targetState.modifierEntries,
    weaponModuleModifierEntries: targetState.weaponModuleModifierEntries,
    weaponChargeModifierEntries: targetState.weaponChargeModifierEntries,
    warpScrambleStatus: targetState.warpScrambleStatus,
    microwarpdriveBlocked,
    microJumpDriveBlocked,
  };
}

function collectModifierEntriesForTarget(targetEntity) {
  const targetState = ensureTargetHostileState(targetEntity, false);
  if (!targetState || !Array.isArray(targetState.modifierEntries)) {
    return [];
  }
  return [...targetState.modifierEntries];
}

function collectWeaponModifierEntriesForTarget(targetEntity) {
  const targetState = ensureTargetHostileState(targetEntity, false);
  if (!targetState) {
    return {
      moduleEntries: [],
      chargeEntries: [],
    };
  }
  return {
    moduleEntries: Array.isArray(targetState.weaponModuleModifierEntries)
      ? [...targetState.weaponModuleModifierEntries]
      : [],
    chargeEntries: Array.isArray(targetState.weaponChargeModifierEntries)
      ? [...targetState.weaponChargeModifierEntries]
      : [],
  };
}

function upsertTargetHostileRecord(targetEntity, record) {
  const targetState = ensureTargetHostileState(targetEntity, true);
  const previousRecord = targetState.incomingEffects.get(record.key) || null;
  targetState.incomingEffects.set(record.key, record);
  return {
    changed:
      !previousRecord ||
      previousRecord.rangeMultiplier !== record.rangeMultiplier ||
      previousRecord.startedAtMs !== record.startedAtMs ||
      previousRecord.expiresAtMs !== record.expiresAtMs,
    previousRecord,
    record,
  };
}

function removeTargetHostileRecord(targetEntity, sourceEntity, effectState) {
  const targetState = ensureTargetHostileState(targetEntity, false);
  if (!targetState) {
    return null;
  }
  const key = buildTargetHostileStateKey(
    sourceEntity && sourceEntity.itemID,
    effectState && effectState.moduleID,
    targetEntity && targetEntity.itemID,
  );
  const existing = targetState.incomingEffects.get(key) || null;
  if (!existing) {
    return null;
  }
  targetState.incomingEffects.delete(key);
  return existing;
}

function resolveHostileModuleActivation({
  scene,
  entity,
  moduleItem,
  effectRecord,
  chargeItem = null,
  shipItem,
  skillMap = null,
  fittedItems = null,
  activeModuleContexts = null,
  options = {},
  callbacks = {},
} = {}) {
  const definition = resolveHostileDefinition(effectRecord);
  if (!definition) {
    return { matched: false };
  }

  if (!scene || !entity || !moduleItem || !shipItem) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  const normalizedTargetID = toInt(options.targetID, 0);
  if (normalizedTargetID <= 0) {
    return {
      matched: true,
      success: false,
      errorMsg: "TARGET_REQUIRED",
    };
  }

  const targetEntity =
    callbacks.getEntityByID && typeof callbacks.getEntityByID === "function"
      ? callbacks.getEntityByID(normalizedTargetID)
      : scene.getEntityByID(normalizedTargetID);
  if (!targetEntity || targetEntity.kind !== "ship") {
    return {
      matched: true,
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
    };
  }

  if (
    !callbacks.isEntityLockedTarget ||
    callbacks.isEntityLockedTarget(entity, normalizedTargetID) !== true
  ) {
    return {
      matched: true,
      success: false,
      errorMsg: "TARGET_NOT_LOCKED",
    };
  }

  const moduleAttributes = buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    chargeItem,
    skillMap,
    fittedItems,
    activeModuleContexts,
  );
  if (!moduleAttributes) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  const durationResolution = getPreferredAttributeValue(
    moduleAttributes,
    [
      effectRecord && effectRecord.durationAttributeID,
      ATTRIBUTE_DURATION,
      ATTRIBUTE_SPEED,
    ],
    1000,
  );
  const rangeResolution = getPreferredAttributeValue(
    moduleAttributes,
    [
      effectRecord && effectRecord.rangeAttributeID,
      ATTRIBUTE_MAX_RANGE,
    ],
    0,
  );
  const falloffResolution = getPreferredAttributeValue(
    moduleAttributes,
    [
      effectRecord && effectRecord.falloffAttributeID,
      ATTRIBUTE_FALLOFF_EFFECTIVENESS,
    ],
    0,
  );
  const dischargeResolution = getPreferredAttributeValue(
    moduleAttributes,
    [
      effectRecord && effectRecord.dischargeAttributeID,
      ATTRIBUTE_CAPACITOR_NEED,
    ],
    0,
  );
  const rawDurationMs = durationResolution.value;
  const durationAttributeID =
    durationResolution.attributeID > 0 ? durationResolution.attributeID : ATTRIBUTE_SPEED;
  const moduleModifierEntries = buildHostileModifierEntries(
    moduleAttributes,
    definition.moduleModifierSpecs,
    definition.stackingPenalized === true,
  );
  const chargeModifierEntries = buildHostileModifierEntries(
    moduleAttributes,
    definition.chargeModifierSpecs,
    definition.stackingPenalized === true,
  );

  const effectStatePatch = {
    hostileModuleEffect: true,
    hostileFamily: definition.family,
    hostileJammingType: String(definition.jammingType || ""),
    hostileMaxRangeMeters: Math.max(
      0,
      roundNumber(rangeResolution.value, 3),
    ),
    hostileFalloffMeters: Math.max(
      0,
      roundNumber(falloffResolution.value, 3),
    ),
    hostileStrengthValue: roundNumber(
      toFiniteNumber(
        definition.strengthAttributeID > 0
          ? moduleAttributes[definition.strengthAttributeID]
          : 0,
        0,
      ),
      6,
    ),
    hostileModifierAttributeID: Math.max(0, toInt(definition.modifierAttributeID, 0)),
    hostileModifierOperation: toInt(definition.modifierOperation, -1),
    hostileModuleModifierEntries: moduleModifierEntries,
    hostileChargeModifierEntries: chargeModifierEntries,
    hostileResistanceAttributeID: Math.max(0, toInt(definition.resistanceAttributeID, 0)),
    hostileWarpScrambleStrength: roundNumber(
      toFiniteNumber(moduleAttributes[ATTRIBUTE_WARP_SCRAMBLE_STRENGTH], 0),
      6,
    ),
    hostileEnergySignatureResolution: Math.max(
      0,
      roundNumber(
        toFiniteNumber(moduleAttributes[ATTRIBUTE_ENERGY_NEUTRALIZER_SIGNATURE_RESOLUTION], 0),
        6,
      ),
    ),
    hostileNosOverride: toFiniteNumber(
      moduleAttributes[ATTRIBUTE_NOS_OVERRIDE],
      0,
    ) > 0,
    hostileStackingPenalized: definition.stackingPenalized === true,
    hostileAffectsTargetDerivedState: definition.affectsTargetDerivedState === true,
    hostileBlocksMicrowarpdrive: definition.blocksMicrowarpdrive === true,
    hostileBlocksMicroJumpDrive: definition.blocksMicroJumpDrive === true,
    forceFreshAcquireSpecialFxReplay: true,
    repeat: resolvePersistentRepeat(rawDurationMs),
  };

  const rangeResult = resolveHostileRangeMultiplier(
    effectStatePatch,
    entity,
    targetEntity,
    callbacks,
  );
  if (!rangeResult.success) {
    return {
      matched: true,
      success: false,
      errorMsg: rangeResult.errorMsg || "TARGET_OUT_OF_RANGE",
    };
  }

  return {
    matched: true,
    success: true,
    data: {
      targetEntity,
      rangeMultiplier: rangeResult.multiplier,
      runtimeAttrs: {
        capNeed: Math.max(
          0,
          roundNumber(dischargeResolution.value, 6),
        ),
        durationMs: Math.max(1, roundNumber(rawDurationMs, 3)),
        durationAttributeID,
        reactivationDelayMs: Math.max(
          0,
          roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_REACTIVATION_DELAY], 0), 3),
        ),
        maxGroupActive: Math.max(0, toInt(moduleAttributes[ATTRIBUTE_MAX_GROUP_ACTIVE], 0)),
        weaponFamily: null,
        attributeOverrides: {
          ...moduleAttributes,
        },
      },
      effectStatePatch,
    },
  };
}

function applyHostileModuleState({
  scene,
  sourceEntity,
  targetEntity,
  effectState,
  nowMs,
} = {}) {
  if (!scene || !sourceEntity || !targetEntity || !effectState) {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  const record = buildHostileTargetRecord(
    sourceEntity,
    effectState,
    targetEntity,
    nowMs,
    1,
  );
  const targetState = ensureTargetHostileState(targetEntity, true);
  const previousRecord = targetState.incomingEffects.get(record.key) || null;
  targetState.incomingEffects.set(record.key, record);
  const aggregateResult = recomputeTargetAggregateState(targetEntity);
  return {
    success: true,
    data: {
      targetEntity,
      previousRecord,
      record,
      aggregateChanged: aggregateResult.changed,
    },
  };
}

function refreshHostileModuleState({
  scene,
  sourceEntity,
  targetEntity,
  effectState,
  nowMs,
  callbacks = {},
} = {}) {
  if (!scene || !sourceEntity || !targetEntity || !effectState) {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
      stopReason: "module",
    };
  }

  const rangeResult = resolveHostileRangeMultiplier(
    effectState,
    sourceEntity,
    targetEntity,
    callbacks,
  );
  if (!rangeResult.success) {
    return rangeResult;
  }

  const record = buildHostileTargetRecord(
    sourceEntity,
    effectState,
    targetEntity,
    nowMs,
    rangeResult.multiplier,
  );
  const upsertResult = upsertTargetHostileRecord(targetEntity, record);
  const aggregateResult = recomputeTargetAggregateState(targetEntity);
  return {
    success: true,
    data: {
      targetEntity,
      record,
      recordChanged: upsertResult.changed,
      aggregateChanged: aggregateResult.changed,
      multiplier: rangeResult.multiplier,
    },
  };
}

function removeHostileModuleState({
  targetEntity,
  sourceEntity,
  effectState,
} = {}) {
  if (!targetEntity || !sourceEntity || !effectState) {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }
  const removedRecord = removeTargetHostileRecord(targetEntity, sourceEntity, effectState);
  const aggregateResult = recomputeTargetAggregateState(targetEntity);
  return {
    success: true,
    data: {
      removedRecord,
      targetEntity,
      aggregateChanged: aggregateResult.changed,
      becameMicrowarpdriveBlocked: aggregateResult.microwarpdriveBlocked,
      becameMicroJumpDriveBlocked: aggregateResult.microJumpDriveBlocked,
    },
  };
}

function resolveNosTransferAllowed(sourceEntity, targetEntity, effectState, callbacks = {}) {
  if (effectState && effectState.hostileNosOverride === true) {
    return true;
  }
  const sourceCapAmount = callbacks.getEntityCapacitorAmount
    ? callbacks.getEntityCapacitorAmount(sourceEntity)
    : 0;
  const targetCapAmount = callbacks.getEntityCapacitorAmount
    ? callbacks.getEntityCapacitorAmount(targetEntity)
    : 0;
  return sourceCapAmount + 1e-6 < targetCapAmount;
}

function executeHostileModuleCycle({
  scene,
  session,
  entity,
  effectState,
  nowMs,
  callbacks = {},
} = {}) {
  if (!scene || !entity || !effectState) {
    return {
      success: false,
      stopReason: "module",
    };
  }

  const targetEntity =
    callbacks.getEntityByID && typeof callbacks.getEntityByID === "function"
      ? callbacks.getEntityByID(toInt(effectState.targetID, 0))
      : scene.getEntityByID(toInt(effectState.targetID, 0));
  if (!targetEntity || targetEntity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
      stopReason: "target",
    };
  }

  if (
    !callbacks.isEntityLockedTarget ||
    callbacks.isEntityLockedTarget(entity, effectState.targetID) !== true
  ) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_LOCKED",
      stopReason: "target",
    };
  }

  const refreshResult = refreshHostileModuleState({
    scene,
    sourceEntity: entity,
    targetEntity,
    effectState,
    nowMs,
    callbacks,
  });
  if (!refreshResult.success) {
    return refreshResult;
  }

  if (effectState.hostileFamily === HOSTILE_FAMILY_NEUT) {
    const warfareMultiplier = resolveEnergyWarfareMultiplier(
      effectState,
      targetEntity,
      refreshResult.data.multiplier,
    );
    const requestedAmount = Math.max(
      0,
      toFiniteNumber(effectState.hostileStrengthValue, 0),
    ) * Math.max(warfareMultiplier, 0);
    const targetCapCapacity = Math.max(
      0,
      toFiniteNumber(targetEntity && targetEntity.capacitorCapacity, 0),
    );
    const previousTargetChargeAmount = callbacks.getEntityCapacitorAmount
      ? callbacks.getEntityCapacitorAmount(targetEntity)
      : 0;
    const appliedAmount = Math.min(previousTargetChargeAmount, requestedAmount);
    if (targetCapCapacity > 0 && appliedAmount > 0 && callbacks.setEntityCapacitorRatio) {
      callbacks.setEntityCapacitorRatio(
        targetEntity,
        (previousTargetChargeAmount - appliedAmount) / targetCapCapacity,
      );
      if (callbacks.persistEntityCapacitorRatio) {
        callbacks.persistEntityCapacitorRatio(targetEntity);
      }
      if (targetEntity.session && callbacks.notifyCapacitorChangeToSession) {
        callbacks.notifyCapacitorChangeToSession(
          targetEntity.session,
          targetEntity,
          nowMs,
          previousTargetChargeAmount,
        );
      }
    }
    return {
      success: true,
      data: {
        targetEntity,
        multiplier: warfareMultiplier,
        appliedAmount: roundNumber(appliedAmount, 6),
        aggregateChanged: refreshResult.data.aggregateChanged,
      },
    };
  }

  if (effectState.hostileFamily === HOSTILE_FAMILY_NOS) {
    const warfareMultiplier = resolveEnergyWarfareMultiplier(
      effectState,
      targetEntity,
      refreshResult.data.multiplier,
    );
    if (!resolveNosTransferAllowed(entity, targetEntity, effectState, callbacks)) {
      return {
        success: true,
        data: {
          targetEntity,
          multiplier: warfareMultiplier,
          appliedAmount: 0,
          aggregateChanged: refreshResult.data.aggregateChanged,
        },
      };
    }

    const targetCapCapacity = Math.max(
      0,
      toFiniteNumber(targetEntity && targetEntity.capacitorCapacity, 0),
    );
    const sourceCapCapacity = Math.max(
      0,
      toFiniteNumber(entity && entity.capacitorCapacity, 0),
    );
    const previousTargetChargeAmount = callbacks.getEntityCapacitorAmount
      ? callbacks.getEntityCapacitorAmount(targetEntity)
      : 0;
    const previousSourceChargeAmount = callbacks.getEntityCapacitorAmount
      ? callbacks.getEntityCapacitorAmount(entity)
      : 0;
    const requestedAmount = Math.max(
      0,
      toFiniteNumber(effectState.hostileStrengthValue, 0),
    ) * Math.max(warfareMultiplier, 0);
    const transferableAmount = Math.max(
      0,
      Math.min(
        requestedAmount,
        previousTargetChargeAmount,
        Math.max(0, sourceCapCapacity - previousSourceChargeAmount),
      ),
    );

    if (
      transferableAmount > 0 &&
      callbacks.setEntityCapacitorRatio
    ) {
      if (targetCapCapacity > 0) {
        callbacks.setEntityCapacitorRatio(
          targetEntity,
          (previousTargetChargeAmount - transferableAmount) / targetCapCapacity,
        );
        if (callbacks.persistEntityCapacitorRatio) {
          callbacks.persistEntityCapacitorRatio(targetEntity);
        }
        if (targetEntity.session && callbacks.notifyCapacitorChangeToSession) {
          callbacks.notifyCapacitorChangeToSession(
            targetEntity.session,
            targetEntity,
            nowMs,
            previousTargetChargeAmount,
          );
        }
      }
      if (sourceCapCapacity > 0) {
        callbacks.setEntityCapacitorRatio(
          entity,
          (previousSourceChargeAmount + transferableAmount) / sourceCapCapacity,
        );
        if (callbacks.persistEntityCapacitorRatio) {
          callbacks.persistEntityCapacitorRatio(entity);
        }
        if (session && callbacks.notifyCapacitorChangeToSession) {
          callbacks.notifyCapacitorChangeToSession(
            session,
            entity,
            nowMs,
            previousSourceChargeAmount,
          );
        }
      }
    }

    return {
      success: true,
      data: {
        targetEntity,
        multiplier: warfareMultiplier,
        appliedAmount: roundNumber(transferableAmount, 6),
        aggregateChanged: refreshResult.data.aggregateChanged,
      },
    };
  }

  return {
    success: true,
    data: {
      targetEntity,
      multiplier: refreshResult.data.multiplier,
      aggregateChanged: refreshResult.data.aggregateChanged,
    },
  };
}

function getEntityWarpScrambleStatus(entity) {
  const passiveValue = getEntityPassiveAttributeValue(entity, ATTRIBUTE_WARP_SCRAMBLE_STATUS, NaN);
  if (Number.isFinite(passiveValue)) {
    return roundNumber(passiveValue, 6);
  }
  const targetState = ensureTargetHostileState(entity, false);
  return targetState ? roundNumber(targetState.warpScrambleStatus, 6) : 0;
}

function isEntityWarpScrambled(entity) {
  return getEntityWarpScrambleStatus(entity) > 0;
}

function isMicrowarpdriveBlocked(entity) {
  const targetState = ensureTargetHostileState(entity, false);
  return Boolean(targetState && targetState.microwarpdriveBlocked === true);
}

function isMicroJumpDriveBlocked(entity) {
  const targetState = ensureTargetHostileState(entity, false);
  return Boolean(targetState && targetState.microJumpDriveBlocked === true);
}

module.exports = {
  HOSTILE_FAMILY_WEB,
  HOSTILE_FAMILY_PAINT,
  HOSTILE_FAMILY_SCRAM,
  HOSTILE_FAMILY_DISRUPT,
  HOSTILE_FAMILY_NEUT,
  HOSTILE_FAMILY_NOS,
  HOSTILE_FAMILY_TRACKING_DISRUPT,
  HOSTILE_FAMILY_GUIDANCE_DISRUPT,
  resolveHostileDefinition,
  resolveHostileModuleActivation,
  refreshHostileModuleState,
  applyHostileModuleState,
  removeHostileModuleState,
  executeHostileModuleCycle,
  recomputeTargetAggregateState,
  collectModifierEntriesForTarget,
  collectWeaponModifierEntriesForTarget,
  getEntityWarpScrambleStatus,
  isEntityWarpScrambled,
  isMicrowarpdriveBlocked,
  isMicroJumpDriveBlocked,
};
