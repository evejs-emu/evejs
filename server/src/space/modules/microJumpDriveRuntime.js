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
const ATTRIBUTE_MAX_GROUP_ACTIVE = getAttributeIDByNames("maxGroupActive") || 763;
const ATTRIBUTE_REACTIVATION_DELAY =
  getAttributeIDByNames("moduleReactivationDelay", "reactivationDelay") || 669;
const ATTRIBUTE_MJD_JUMP_RANGE = getAttributeIDByNames("mjdJumpRange") || 2066;
const STANDARD_MICRO_JUMP_DRIVE_GROUP_ID = 1189;
const CAPITAL_MICRO_JUMP_DRIVE_GROUP_ID = 4769;
const DEFAULT_STANDARD_MJD_JUMP_DISTANCE_METERS = 100_000;
const DEFAULT_CAPITAL_MJD_JUMP_DISTANCE_METERS = 250_000;

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

function normalizeEffectName(effectRecord) {
  return String(effectRecord && effectRecord.name || "").trim();
}

function resolveMicroJumpDistanceMeters(moduleItem, moduleAttributes) {
  const explicitJumpDistance = Math.max(
    0,
    roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_MJD_JUMP_RANGE], 0), 3),
  );
  if (explicitJumpDistance > 0) {
    return explicitJumpDistance;
  }

  const moduleGroupID = toInt(moduleItem && moduleItem.groupID, 0);
  if (moduleGroupID === CAPITAL_MICRO_JUMP_DRIVE_GROUP_ID) {
    return DEFAULT_CAPITAL_MJD_JUMP_DISTANCE_METERS;
  }
  if (moduleGroupID === STANDARD_MICRO_JUMP_DRIVE_GROUP_ID) {
    return DEFAULT_STANDARD_MJD_JUMP_DISTANCE_METERS;
  }
  return DEFAULT_STANDARD_MJD_JUMP_DISTANCE_METERS;
}

function resolveMicroJumpDriveActivation({
  moduleItem,
  effectRecord,
  chargeItem = null,
  shipItem,
  skillMap = null,
  fittedItems = null,
  activeModuleContexts = null,
} = {}) {
  if (normalizeEffectName(effectRecord) !== "microJumpDrive") {
    return { matched: false };
  }

  if (!moduleItem || !shipItem) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
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

  const rawDurationMs = toFiniteNumber(
    moduleAttributes[ATTRIBUTE_DURATION],
    moduleAttributes[ATTRIBUTE_SPEED],
  );
  const durationAttributeID =
    toFiniteNumber(moduleAttributes[ATTRIBUTE_DURATION], 0) > 0
      ? ATTRIBUTE_DURATION
      : ATTRIBUTE_SPEED;
  const jumpDistanceMeters = resolveMicroJumpDistanceMeters(
    moduleItem,
    moduleAttributes,
  );
  if (jumpDistanceMeters <= 0) {
    return {
      matched: true,
      success: false,
      errorMsg: "UNSUPPORTED_MODULE",
    };
  }

  return {
    matched: true,
    success: true,
    data: {
      runtimeAttrs: {
        capNeed: Math.max(
          0,
          roundNumber(toFiniteNumber(moduleAttributes[ATTRIBUTE_CAPACITOR_NEED], 0), 6),
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
      effectStatePatch: {
        microJumpDriveEffect: true,
        microJumpDistanceMeters: jumpDistanceMeters,
        microJumpJumpFxGuid: "effects.MicroJumpDriveJump",
        forceFreshAcquireSpecialFxReplay: true,
        suppressStopSpecialFx: true,
      },
    },
  };
}

function executeMicroJumpDriveCycle({
  scene,
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

  const direction = callbacks.getCurrentAlignmentDirection
    ? callbacks.getCurrentAlignmentDirection(entity, entity.direction)
    : (entity.direction || { x: 1, y: 0, z: 0 });
  const destination = callbacks.addVectors
    ? callbacks.addVectors(
        entity.position,
        callbacks.scaleVector(direction, Math.max(0, toFiniteNumber(effectState.microJumpDistanceMeters, 0))),
      )
    : {
        x: toFiniteNumber(entity && entity.position && entity.position.x, 0),
        y: toFiniteNumber(entity && entity.position && entity.position.y, 0),
        z: toFiniteNumber(entity && entity.position && entity.position.z, 0),
      };

  if (callbacks.breakEntityStructureTether) {
    callbacks.breakEntityStructureTether(scene, entity, {
      nowMs,
      reason: "MICRO_JUMP_DRIVE",
    });
  }

  const teleportResult = scene.teleportDynamicEntityToPoint(entity, destination, {
    direction,
  });
  if (!teleportResult || teleportResult.success !== true) {
    return {
      success: false,
      stopReason: "movement",
      errorMsg: teleportResult && teleportResult.errorMsg
        ? teleportResult.errorMsg
        : "DYNAMIC_ENTITY_NOT_FOUND",
    };
  }

  if (effectState.microJumpJumpFxGuid) {
    scene.broadcastSpecialFx(
      entity.itemID,
      effectState.microJumpJumpFxGuid,
      {
        moduleID: effectState.moduleID,
        moduleTypeID: effectState.typeID,
        start: true,
        active: false,
        duration: 1,
        graphicInfo: [
          toFiniteNumber(destination.x, 0),
          toFiniteNumber(destination.y, 0),
          toFiniteNumber(destination.z, 0),
        ],
        useCurrentVisibleStamp: true,
      },
      entity,
    );
  }

  return {
    success: true,
    data: {
      stopReason: "cycle",
      destination,
    },
  };
}

module.exports = {
  resolveMicroJumpDriveActivation,
  executeMicroJumpDriveCycle,
};
