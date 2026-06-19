const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  findSessionByCharacterID,
} = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  ITEM_FLAGS,
  findItemById,
  listContainerItems,
  mergeItemStacks,
  moveItemToLocation,
  normalizeShipConditionState,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  buildList,
  buildDict,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  ABILITY_SLOT_IDS,
  TARGET_MODE_UNTARGETED,
  TARGET_MODE_ITEMTARGETED,
  TARGET_MODE_POINTTARGETED,
  getFighterAbilityMetaForSlot,
} = require(path.join(__dirname, "./fighterAbilities"));
const {
  FIGHTER_CATEGORY_ID,
  FIGHTER_TUBE_FLAGS,
  buildInventorySquadronSize,
  isFighterItemRecord,
  isFighterTubeFlag,
} = require(path.join(__dirname, "./fighterInventory"));
const {
  resolveFighterAbilitySnapshot,
} = require(path.join(__dirname, "./fighterDogma"));
const {
  applyDamageToEntity,
  normalizeDamageVector,
  sumDamageVector,
  hasDamageableHealth,
} = require(path.join(__dirname, "../../space/combat/damage"));
const {
  resolveMissileAppliedDamage,
} = require(path.join(__dirname, "../../space/combat/missiles/missileSolver"));
const crimewatchState = require(path.join(__dirname, "../security/crimewatchState"));
const jammerModuleRuntime = require(path.join(
  __dirname,
  "../../space/modules/jammerModuleRuntime",
));

const destiny = require(path.join(__dirname, "../../space/destiny"));

const MOVEMENT_COMMAND_ORBIT = "ORBIT";
const MOVEMENT_COMMAND_FOLLOW = "FOLLOW";
const MOVEMENT_COMMAND_STOP = "STOP";
const MOVEMENT_COMMAND_GOTO_POINT = "GOTO_POINT";

const TUBE_STATE_EMPTY = "EMPTY";
const TUBE_STATE_READY = "READY";
const TUBE_STATE_INSPACE = "INSPACE";
const TUBE_STATE_LANDING = "LANDING";

const DEFAULT_FIGHTER_ORBIT_DISTANCE_METERS = 1500;
const FIGHTER_RECOVERY_DISTANCE_METERS = 5000;
const DEFAULT_FIGHTER_LAUNCH_OFFSET_METERS = 150;
const GROUP_CAPSULE_ID = 29;
const OUTLAW_SECURITY_STATUS = -5;
const FIGHTER_MOBILITY_EFFECT_FAMILIES = new Set([
  "fighterabilityafterburner",
  "fighterabilitymicrowarpdrive",
  "fighterabilitymicrojumpdrive",
  "fighterabilityevasivemaneuvers",
]);

function getCharacterStateService() {
  return require(path.join(__dirname, "../character/characterState"));
}

function resolveActiveShipRecord(characterID) {
  const characterState = getCharacterStateService();
  return characterState && typeof characterState.getActiveShipRecord === "function"
    ? characterState.getActiveShipRecord(characterID)
    : null;
}

function syncInventoryItemForCharacterSession(session, item, previousData, options = {}) {
  const characterState = getCharacterStateService();
  if (!characterState || typeof characterState.syncInventoryItemForSession !== "function") {
    return false;
  }
  return characterState.syncInventoryItemForSession(
    session,
    item,
    previousData,
    options,
  );
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toNumber(value, fallback));
}

function round6(value) {
  return Number(toNumber(value, 0).toFixed(6));
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toNumber(source && source.x, fallback.x),
    y: toNumber(source && source.y, fallback.y),
    z: toNumber(source && source.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toNumber(left && left.x, 0) + toNumber(right && right.x, 0),
    y: toNumber(left && left.y, 0) + toNumber(right && right.y, 0),
    z: toNumber(left && left.z, 0) + toNumber(right && right.z, 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: toNumber(left && left.x, 0) - toNumber(right && right.x, 0),
    y: toNumber(left && left.y, 0) - toNumber(right && right.y, 0),
    z: toNumber(left && left.z, 0) - toNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toNumber(vector && vector.x, 0) * toNumber(scalar, 0),
    y: toNumber(vector && vector.y, 0) * toNumber(scalar, 0),
    z: toNumber(vector && vector.z, 0) * toNumber(scalar, 0),
  };
}

function magnitude(vector) {
  const resolved = cloneVector(vector);
  return Math.sqrt(
    (resolved.x * resolved.x) +
    (resolved.y * resolved.y) +
    (resolved.z * resolved.z),
  );
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = magnitude(resolved);
  if (length <= 0) {
    return cloneVector(fallback);
  }
  return scaleVector(resolved, 1 / length);
}

function distance(left, right) {
  return magnitude(subtractVectors(left, right));
}

function surfaceDistance(leftEntity, rightEntity) {
  return Math.max(
    0,
    distance(
      leftEntity && leftEntity.position,
      rightEntity && rightEntity.position,
    ) -
      Math.max(0, toNumber(leftEntity && leftEntity.radius, 0)) -
      Math.max(0, toNumber(rightEntity && rightEntity.radius, 0)),
  );
}

function buildPerpendicular(vector) {
  const normalized = normalizeVector(vector, { x: 1, y: 0, z: 0 });
  if (Math.abs(normalized.x) < 0.5 && Math.abs(normalized.y) < 0.5) {
    return normalizeVector({ x: 0, y: 1, z: 0 });
  }
  return normalizeVector({ x: -normalized.y, y: normalized.x, z: 0 });
}

function listify(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }
  if (rawValue && rawValue.type === "list" && Array.isArray(rawValue.items)) {
    return rawValue.items;
  }
  return rawValue === null || rawValue === undefined ? [] : [rawValue];
}

function normalizeFighterIDList(rawValue) {
  return listify(rawValue)
    .map((value) => toInt(value, 0))
    .filter((value, index, values) => value > 0 && values.indexOf(value) === index);
}

function normalizeTubeFlagList(rawValue) {
  return listify(rawValue)
    .map((value) => toInt(value, 0))
    .filter((value, index, values) => (
      isFighterTubeFlag(value) &&
      values.indexOf(value) === index
    ));
}

function buildPerFighterResultEntries(rawFighterIDs, errors = []) {
  const fighterIDs = normalizeFighterIDList(rawFighterIDs);
  const errorsByFighterID = new Map();
  for (const entry of Array.isArray(errors) ? errors : []) {
    if (!Array.isArray(entry) || entry.length < 1) {
      continue;
    }
    const fighterID = toInt(entry[0], 0);
    if (fighterID <= 0 || errorsByFighterID.has(fighterID)) {
      continue;
    }
    errorsByFighterID.set(
      fighterID,
      entry.length > 1 ? entry[1] ?? null : null,
    );
  }
  return fighterIDs.map((fighterID) => [
    fighterID,
    errorsByFighterID.has(fighterID)
      ? errorsByFighterID.get(fighterID)
      : null,
  ]);
}

function getRuntime() {
  return require(path.join(__dirname, "../../space/runtime"));
}

function cloneAbilityState(state = null) {
  if (!state || typeof state !== "object") {
    return null;
  }

  const cloned = {};
  for (const key of [
    "activeSinceMs",
    "durationMs",
    "activeUntilMs",
    "cooldownStartMs",
    "cooldownEndMs",
    "remainingChargeCount",
    "targetID",
  ]) {
    const value = state[key];
    if (value === undefined || value === null) {
      continue;
    }
    cloned[key] = value;
  }
  if (state.targetPoint && typeof state.targetPoint === "object") {
    cloned.targetPoint = cloneVector(state.targetPoint);
  }

  return Object.keys(cloned).length > 0 ? cloned : null;
}

function cloneAbilityStates(rawStates) {
  if (!rawStates || typeof rawStates !== "object") {
    return {};
  }

  const cloned = {};
  for (const slotID of ABILITY_SLOT_IDS) {
    const state = cloneAbilityState(rawStates[slotID]);
    if (state) {
      cloned[slotID] = state;
    }
  }
  return cloned;
}

function getEntityAbilityStates(entity) {
  if (!entity || typeof entity !== "object") {
    return {};
  }

  if (!entity.fighterAbilityStates || typeof entity.fighterAbilityStates !== "object") {
    entity.fighterAbilityStates = {};
  }
  return entity.fighterAbilityStates;
}

function getEntityAbilityState(entity, slotID) {
  const numericSlotID = toInt(slotID, -1);
  return getEntityAbilityStates(entity)[numericSlotID] || null;
}

function setEntityAbilityState(entity, slotID, nextState) {
  const numericSlotID = toInt(slotID, -1);
  if (!ABILITY_SLOT_IDS.includes(numericSlotID)) {
    return null;
  }

  const abilityStates = getEntityAbilityStates(entity);
  const normalizedState = cloneAbilityState(nextState);
  if (normalizedState) {
    abilityStates[numericSlotID] = normalizedState;
  } else {
    delete abilityStates[numericSlotID];
  }
  return abilityStates[numericSlotID] || null;
}

function clearEntityAbilityStates(entity) {
  if (entity && typeof entity === "object") {
    entity.fighterAbilityStates = {};
  }
}

function normalizeEffectFamily(value) {
  return String(value || "").trim().toLowerCase();
}

function isMobilityAbilitySnapshot(abilityMeta) {
  return FIGHTER_MOBILITY_EFFECT_FAMILIES.has(
    normalizeEffectFamily(
      abilityMeta && (
        abilityMeta.normalizedEffectFamily ||
        abilityMeta.effectFamily
      ),
    ),
  );
}

function isJammerAbilitySnapshot(abilityMeta) {
  return normalizeEffectFamily(
    abilityMeta && (
      abilityMeta.normalizedEffectFamily ||
      abilityMeta.effectFamily
    ),
  ) === "fighterabilityecm";
}

function resolveFighterPassiveMaxVelocity(entity) {
  const cached = toNumber(entity && entity.baseMaxVelocity, NaN);
  if (Number.isFinite(cached) && cached > 0) {
    return cached;
  }

  const resolved = Math.max(
    1,
    toNumber(
      getTypeAttributeValue(toInt(entity && entity.typeID, 0), "maxVelocity"),
      entity && entity.maxVelocity,
    ),
  );
  if (entity && typeof entity === "object") {
    entity.baseMaxVelocity = resolved;
  }
  return resolved;
}

function resolveFighterPassiveSignatureRadius(entity) {
  const cached = toNumber(entity && entity.baseSignatureRadius, NaN);
  if (Number.isFinite(cached) && cached > 0) {
    return cached;
  }

  const resolved = Math.max(
    1,
    toNumber(
      getTypeAttributeValue(toInt(entity && entity.typeID, 0), "signatureRadius"),
      entity && entity.signatureRadius,
    ),
  );
  if (entity && typeof entity === "object") {
    entity.baseSignatureRadius = resolved;
  }
  return resolved;
}

function emitFighterMaxVelocityUpdate(scene, fighterEntity, nowMs) {
  if (!scene || !isFighterEntity(fighterEntity)) {
    return false;
  }

  const movementStamp =
    typeof scene.getMovementStamp === "function"
      ? scene.getMovementStamp(nowMs)
      : 0;
  scene.broadcastMovementUpdates([{
    stamp: movementStamp,
    payload: destiny.buildSetMaxSpeedPayload(
      fighterEntity.itemID,
      fighterEntity.maxVelocity,
    ),
  }]);
  return true;
}

function syncFighterMobilityAbilityState(
  scene,
  fighterEntity,
  controllerEntity = null,
  nowMs = scene && typeof scene.getCurrentSimTimeMs === "function"
    ? scene.getCurrentSimTimeMs()
    : Date.now(),
) {
  if (!isFighterEntity(fighterEntity)) {
    return false;
  }

  const rawAbilityStates =
    fighterEntity && fighterEntity.fighterAbilityStates &&
    typeof fighterEntity.fighterAbilityStates === "object"
      ? fighterEntity.fighterAbilityStates
      : null;
  const hasAbilityState = rawAbilityStates && Object.keys(rawAbilityStates).length > 0;
  const wasMobilityModified = fighterEntity.fighterMobilityRuntimeActive === true;
  if (!hasAbilityState && !wasMobilityModified) {
    return false;
  }

  const passiveMaxVelocity = resolveFighterPassiveMaxVelocity(fighterEntity);
  const passiveSignatureRadius = resolveFighterPassiveSignatureRadius(fighterEntity);
  let nextMaxVelocity = passiveMaxVelocity;
  let nextSignatureRadius = passiveSignatureRadius;
  let hasActiveMobilityEffect = false;

  if (controllerEntity && hasAbilityState) {
    for (const slotID of ABILITY_SLOT_IDS) {
      const abilityState = getEntityAbilityState(fighterEntity, slotID);
      if (!abilityState || toNumber(abilityState.activeUntilMs, 0) <= nowMs) {
        continue;
      }

      const abilityMeta = resolveFighterAbilitySnapshot(
        fighterEntity,
        controllerEntity,
        slotID,
      ) || getFighterAbilityMetaForSlot(fighterEntity.typeID, slotID);
      if (!isMobilityAbilitySnapshot(abilityMeta)) {
        continue;
      }

      hasActiveMobilityEffect = true;
      const speedMultiplier =
        1 + (Math.max(-99.999, toNumber(abilityMeta && abilityMeta.speedBonusPercent, 0)) / 100);
      const signatureMultiplier =
        1 + (toNumber(abilityMeta && abilityMeta.signatureRadiusBonusPercent, 0) / 100);
      nextMaxVelocity = Math.max(1, nextMaxVelocity * Math.max(0.00001, speedMultiplier));
      nextSignatureRadius = Math.max(1, nextSignatureRadius * Math.max(0.00001, signatureMultiplier));
    }
  }

  nextMaxVelocity = round6(nextMaxVelocity);
  nextSignatureRadius = round6(nextSignatureRadius);

  const maxVelocityChanged = Math.abs(
    toNumber(fighterEntity.maxVelocity, passiveMaxVelocity) - nextMaxVelocity,
  ) > 1e-6;
  const signatureRadiusChanged = Math.abs(
    toNumber(fighterEntity.signatureRadius, passiveSignatureRadius) - nextSignatureRadius,
  ) > 1e-6;
  fighterEntity.maxVelocity = nextMaxVelocity;
  fighterEntity.signatureRadius = nextSignatureRadius;
  fighterEntity.fighterMobilityRuntimeActive = hasActiveMobilityEffect;

  if (maxVelocityChanged) {
    emitFighterMaxVelocityUpdate(scene, fighterEntity, nowMs);
  }

  return maxVelocityChanged || signatureRadiusChanged;
}

function getEffectiveAbilityDurationMs(abilityMeta) {
  return Math.max(1, toInt(abilityMeta && abilityMeta.durationMs, 1));
}

function getEffectiveAbilityCooldownMs(abilityMeta) {
  const cooldownMs = abilityMeta && abilityMeta.cooldownMs;
  if (cooldownMs === null || cooldownMs === undefined) {
    return null;
  }
  const numericCooldownMs = toNumber(cooldownMs, NaN);
  return Number.isFinite(numericCooldownMs) && numericCooldownMs > 0
    ? Math.max(1, Math.round(numericCooldownMs))
    : null;
}

function getEffectiveAbilityChargeCount(abilityMeta) {
  const chargeCount = abilityMeta && abilityMeta.chargeCount;
  if (chargeCount === null || chargeCount === undefined) {
    return null;
  }
  const numericChargeCount = toInt(chargeCount, -1);
  return numericChargeCount >= 0 ? numericChargeCount : null;
}

function getEffectiveAbilityRearmTimeMs(abilityMeta) {
  const rearmTimeMs = abilityMeta && abilityMeta.rearmTimeMs;
  if (rearmTimeMs === null || rearmTimeMs === undefined) {
    return null;
  }
  const numericRearmTimeMs = toNumber(rearmTimeMs, NaN);
  return Number.isFinite(numericRearmTimeMs) && numericRearmTimeMs > 0
    ? Math.max(1, Math.round(numericRearmTimeMs))
    : null;
}

function usesContinuousAbilityCycle(abilityMeta) {
  return (
    abilityMeta &&
    abilityMeta.isOffensive === true &&
    getEffectiveAbilityChargeCount(abilityMeta) === null &&
    getEffectiveAbilityCooldownMs(abilityMeta) === null
  );
}

function getAbilityStateChargeCount(abilityState, abilityMeta) {
  const rawExplicitCount =
    abilityState && Object.prototype.hasOwnProperty.call(abilityState, "remainingChargeCount")
      ? abilityState.remainingChargeCount
      : undefined;
  const explicitCount =
    rawExplicitCount === null || rawExplicitCount === undefined
      ? NaN
      : Number(rawExplicitCount);
  if (Number.isFinite(explicitCount) && explicitCount >= 0) {
    return Math.max(0, Math.trunc(explicitCount));
  }
  const abilityChargeCount = getEffectiveAbilityChargeCount(abilityMeta);
  return abilityChargeCount === null ? null : abilityChargeCount;
}

function clearAbilityActiveWindow(nextState) {
  if (!nextState || typeof nextState !== "object") {
    return nextState;
  }
  delete nextState.activeSinceMs;
  delete nextState.durationMs;
  delete nextState.activeUntilMs;
  delete nextState.targetID;
  delete nextState.targetPoint;
  return nextState;
}

function refreshAbilityCharges(entity, slotID, abilityMeta, nowMs) {
  const maxChargeCount = getEffectiveAbilityChargeCount(abilityMeta);
  const rearmTimeMs = getEffectiveAbilityRearmTimeMs(abilityMeta);
  let abilityState = getEntityAbilityState(entity, slotID);
  if (
    !abilityState ||
    maxChargeCount === null ||
    rearmTimeMs === null ||
    rearmTimeMs <= 0
  ) {
    return abilityState;
  }

  const currentChargeCount = getAbilityStateChargeCount(abilityState, abilityMeta);
  if (currentChargeCount === null || currentChargeCount >= maxChargeCount) {
    if (
      currentChargeCount !== null &&
      currentChargeCount >= maxChargeCount &&
      toNumber(abilityState.cooldownEndMs, 0) > 0
    ) {
      const nextState = {
        ...abilityState,
        remainingChargeCount: maxChargeCount,
      };
      delete nextState.cooldownStartMs;
      delete nextState.cooldownEndMs;
      setEntityAbilityState(entity, slotID, nextState);
      abilityState = getEntityAbilityState(entity, slotID);
    }
    return abilityState;
  }

  let cooldownEndMs = toNumber(abilityState.cooldownEndMs, 0);
  if (cooldownEndMs <= 0 || cooldownEndMs > nowMs) {
    return abilityState;
  }

  const elapsedSinceReadyMs = Math.max(0, nowMs - cooldownEndMs);
  const restoredCharges = Math.floor(elapsedSinceReadyMs / rearmTimeMs) + 1;
  const nextChargeCount = Math.min(maxChargeCount, currentChargeCount + restoredCharges);
  const nextState = {
    ...abilityState,
    remainingChargeCount: nextChargeCount,
  };
  if (nextChargeCount >= maxChargeCount) {
    delete nextState.cooldownStartMs;
    delete nextState.cooldownEndMs;
  } else {
    const restoredWindowEndMs = cooldownEndMs + (restoredCharges * rearmTimeMs);
    nextState.cooldownStartMs = restoredWindowEndMs;
    nextState.cooldownEndMs = restoredWindowEndMs + rearmTimeMs;
  }
  setEntityAbilityState(entity, slotID, nextState);
  return getEntityAbilityState(entity, slotID);
}

function translateAbilityTimeForSession(scene, session, rawTimeMs) {
  const normalizedTimeMs = toNumber(rawTimeMs, 0);
  if (
    scene &&
    session &&
    typeof scene.getCurrentSessionFileTime === "function"
  ) {
    return scene.getCurrentSessionFileTime(session, normalizedTimeMs);
  }
  return normalizedTimeMs;
}

function buildCooldownPayload(scene, session, abilityState) {
  if (!abilityState || typeof abilityState !== "object") {
    return null;
  }

  const cooldownStartMs = toNumber(abilityState.cooldownStartMs, 0);
  const cooldownEndMs = toNumber(abilityState.cooldownEndMs, 0);
  if (cooldownStartMs <= 0 || cooldownEndMs <= cooldownStartMs) {
    return null;
  }

  return buildList([
    translateAbilityTimeForSession(scene, session, cooldownStartMs),
    translateAbilityTimeForSession(scene, session, cooldownEndMs),
  ]);
}

function buildFighterAbilitySlotStatesPayload(
  fighterEntity = null,
  session = null,
  scene = null,
  nowMs = scene && typeof scene.getCurrentSimTimeMs === "function"
    ? scene.getCurrentSimTimeMs()
    : Date.now(),
) {
  const chargeEntries = [];
  const cooldownEntries = [];
  const numericNowMs = toNumber(nowMs, Date.now());

  for (const slotID of ABILITY_SLOT_IDS) {
    const abilityState = getEntityAbilityState(fighterEntity, slotID);
    const abilityMeta = getFighterAbilityMetaForSlot(
      fighterEntity && fighterEntity.typeID,
      slotID,
    );
    const remainingChargeCount = getAbilityStateChargeCount(
      abilityState,
      abilityMeta,
    );
    if (remainingChargeCount !== null) {
      chargeEntries.push([slotID, remainingChargeCount]);
    }

    if (
      abilityState &&
      toNumber(abilityState.cooldownEndMs, 0) > numericNowMs
    ) {
      const cooldownPayload = buildCooldownPayload(scene, session, abilityState);
      if (cooldownPayload) {
        cooldownEntries.push([slotID, cooldownPayload]);
      }
    }
  }

  return buildList([
    buildDict(chargeEntries),
    buildDict(cooldownEntries),
  ]);
}

function buildFighterError(message) {
  return {
    args: ["CustomNotify", { notify: String(message || "") }],
  };
}

function buildFighterUserError(message, values = {}) {
  return {
    args: [String(message || ""), values && typeof values === "object" ? values : {}],
  };
}

function getSceneSecurityClass(scene) {
  const security = Math.max(
    0,
    Math.min(1, toNumber(scene && scene.system && scene.system.security, 0)),
  );
  if (security <= 0) {
    return 0;
  }
  if (security < 0.45) {
    return 1;
  }
  return 2;
}

function getCombatOwnerCharacterID(entity) {
  return toInt(
    entity &&
      (
        (entity.session && entity.session.characterID) ??
        entity.pilotCharacterID ??
        entity.characterID ??
        entity.ownerID
      ),
    0,
  );
}

function buildAbilityViolatesSafetyError(fighterEntity, abilityMeta) {
  return buildFighterUserError("CannotActivateAbilityViolatesSafety", {
    fighterTypeID: toInt(fighterEntity && fighterEntity.typeID, 0),
    abilityNameID: toInt(abilityMeta && abilityMeta.displayNameID, 0),
  });
}

function getRequiredSafetyLevelForFighterAttack(scene, fighterEntity, targetEntity) {
  const securityClass = getSceneSecurityClass(scene);
  if (securityClass <= 0 || !targetEntity) {
    return crimewatchState.SAFETY_LEVEL_FULL;
  }

  const attackerOwnerID = getCombatOwnerCharacterID(fighterEntity);
  const targetOwnerID = getCombatOwnerCharacterID(targetEntity);
  if (
    attackerOwnerID > 0 &&
    targetOwnerID > 0 &&
    attackerOwnerID === targetOwnerID
  ) {
    return crimewatchState.SAFETY_LEVEL_FULL;
  }

  if (targetOwnerID > 0) {
    const nowMs =
      scene && typeof scene.getCurrentSimTimeMs === "function"
        ? scene.getCurrentSimTimeMs()
        : Date.now();
    const targetCrimewatch =
      crimewatchState &&
      typeof crimewatchState.getCharacterCrimewatchState === "function"
        ? crimewatchState.getCharacterCrimewatchState(targetOwnerID, nowMs)
        : null;
    if (
      targetCrimewatch &&
      (
        targetCrimewatch.criminal === true ||
        targetCrimewatch.suspect === true
      )
    ) {
      return crimewatchState.SAFETY_LEVEL_FULL;
    }
  }

  if (toNumber(targetEntity && targetEntity.securityStatus, 0) <= OUTLAW_SECURITY_STATUS) {
    return crimewatchState.SAFETY_LEVEL_FULL;
  }

  if (securityClass === 2) {
    return crimewatchState.SAFETY_LEVEL_NONE;
  }

  if (toInt(targetEntity && targetEntity.groupID, 0) === GROUP_CAPSULE_ID) {
    return crimewatchState.SAFETY_LEVEL_NONE;
  }

  return crimewatchState.SAFETY_LEVEL_PARTIAL;
}

function buildAbilitySafetyRestrictionError(scene, fighterEntity, abilityMeta, targetEntity) {
  if (!abilityMeta || abilityMeta.isOffensive !== true || !targetEntity) {
    return null;
  }

  const attackerOwnerID = getCombatOwnerCharacterID(fighterEntity);
  const currentSafetyLevel =
    attackerOwnerID > 0 &&
    crimewatchState &&
    typeof crimewatchState.getSafetyLevel === "function"
      ? crimewatchState.getSafetyLevel(attackerOwnerID)
      : crimewatchState.SAFETY_LEVEL_FULL;
  const requiredSafetyLevel = getRequiredSafetyLevelForFighterAttack(
    scene,
    fighterEntity,
    targetEntity,
  );
  if (requiredSafetyLevel < currentSafetyLevel) {
    return buildAbilityViolatesSafetyError(fighterEntity, abilityMeta);
  }
  return null;
}

function buildAbilityRequiresTargetError(fighterEntity, abilityMeta) {
  return buildFighterUserError("CannotActivateAbilityRequiresTarget", {
    fighterTypeID: toInt(fighterEntity && fighterEntity.typeID, 0),
    abilityNameID: toInt(abilityMeta && abilityMeta.displayNameID, 0),
  });
}

function buildAbilitySecurityRestrictionError(scene, abilityMeta) {
  const securityClass = getSceneSecurityClass(scene);
  if (securityClass === 2 && abilityMeta && abilityMeta.disallowInHighSec) {
    return buildFighterUserError("CantInHighSecSpace", {});
  }
  if (securityClass === 1 && abilityMeta && abilityMeta.disallowInLowSec) {
    return buildFighterUserError("CantInEmpireSpace", {});
  }
  return null;
}

function resolveSquadronSize(itemOrEntity) {
  if (!itemOrEntity || typeof itemOrEntity !== "object") {
    return 0;
  }
  if (toInt(itemOrEntity.squadronSize, 0) > 0) {
    return toInt(itemOrEntity.squadronSize, 0);
  }
  return buildInventorySquadronSize(itemOrEntity);
}

function isFighterEntity(entity) {
  return Boolean(entity && entity.kind === "fighter");
}

function serializeFighterSpaceState(entity) {
  return {
    systemID: toInt(entity && entity.systemID, 0),
    position: cloneVector(entity && entity.position),
    velocity: cloneVector(entity && entity.velocity),
    direction: cloneVector(entity && entity.direction, { x: 1, y: 0, z: 0 }),
    targetPoint: cloneVector(entity && entity.targetPoint, entity && entity.position),
    speedFraction: Math.max(0, Math.min(1, toNumber(entity && entity.speedFraction, 0))),
    mode: String(entity && entity.mode || "STOP"),
    targetEntityID: toInt(entity && entity.targetEntityID, 0) || null,
    followRange: Math.max(0, toNumber(entity && entity.followRange, 0)),
    orbitDistance: Math.max(0, toNumber(entity && entity.orbitDistance, 0)),
    orbitNormal: cloneVector(entity && entity.orbitNormal, buildPerpendicular(entity && entity.direction)),
    orbitSign: toNumber(entity && entity.orbitSign, 1) < 0 ? -1 : 1,
    pendingWarp: null,
    warpState: null,
  };
}

function serializeFighterRuntimeState(entity) {
  const tubeFlagID = toInt(entity && entity.tubeFlagID, 0);
  const controllerID = toInt(entity && entity.controllerID, 0);
  const controllerOwnerID = toInt(entity && entity.controllerOwnerID, 0);
  const abilityStates = cloneAbilityStates(entity && entity.fighterAbilityStates);
  if (
    tubeFlagID <= 0 &&
    controllerID <= 0 &&
    controllerOwnerID <= 0 &&
    Object.keys(abilityStates).length === 0
  ) {
    return null;
  }

  const serialized = {
    tubeFlagID: tubeFlagID > 0 ? tubeFlagID : null,
    controllerID: controllerID > 0 ? controllerID : null,
    controllerOwnerID: controllerOwnerID > 0 ? controllerOwnerID : null,
  };
  if (Object.keys(abilityStates).length > 0) {
    serialized.abilityStates = abilityStates;
  }
  return serialized;
}

function hydrateFighterEntityFromItem(entity, itemRecord = null) {
  if (!entity) {
    return entity;
  }

  const item = itemRecord || findItemById(entity.itemID) || null;
  if (!item || !isFighterItemRecord(item)) {
    return entity;
  }

  const typeID = toInt(item.typeID, toInt(entity.typeID, 0));
  const mass = Math.max(1, toNumber(getTypeAttributeValue(typeID, "mass"), entity.mass || 1));
  const inertia = Math.max(
    0.05,
    toNumber(getTypeAttributeValue(typeID, "agility"), entity.inertia || 0.1),
  );
  const maxVelocity = Math.max(
    1,
    toNumber(getTypeAttributeValue(typeID, "maxVelocity"), entity.maxVelocity || 1),
  );
  const signatureRadius = Math.max(
    1,
    toNumber(getTypeAttributeValue(typeID, "signatureRadius"), entity.signatureRadius || 1),
  );
  const fighterState =
    item && item.fighterState && typeof item.fighterState === "object"
      ? item.fighterState
      : null;

  entity.kind = "fighter";
  entity.typeID = typeID;
  entity.groupID = toInt(item.groupID, toInt(entity.groupID, 0));
  entity.categoryID = FIGHTER_CATEGORY_ID;
  entity.ownerID = toInt(item.ownerID, toInt(entity.ownerID, 0));
  entity.itemName = String(item.itemName || entity.itemName || "Fighter");
  entity.mass = mass;
  entity.inertia = inertia;
  entity.baseMaxVelocity = maxVelocity;
  entity.baseSignatureRadius = signatureRadius;
  entity.maxVelocity = maxVelocity;
  entity.signatureRadius = signatureRadius;
  entity.alignTime = inertia * Math.log(4);
  entity.maxAccelerationTime = inertia;
  entity.agilitySeconds = Math.max((mass * inertia) / 1000000, 0.05);
  entity.launcherID = toInt(item.launcherID, toInt(entity.launcherID, 0)) || null;
  entity.controllerID = toInt(
    fighterState && fighterState.controllerID,
    entity.launcherID || entity.controllerID || 0,
  ) || null;
  entity.controllerOwnerID = toInt(
    fighterState && fighterState.controllerOwnerID,
    entity.ownerID,
  );
  entity.tubeFlagID = toInt(
    fighterState && fighterState.tubeFlagID,
    entity.tubeFlagID,
  ) || null;
  entity.fighterAbilityStates = cloneAbilityStates(
    fighterState && fighterState.abilityStates,
  );
  entity.squadronSize = resolveSquadronSize(item);
  entity.maxSquadronSize = Math.max(
    entity.squadronSize,
    toInt(getTypeAttributeValue(typeID, "fighterSquadronMaxSize"), 0),
  );
  entity.persistSpaceState = true;
  if (!(entity.lockedTargets instanceof Map)) {
    entity.lockedTargets = new Map();
  }
  if (!(entity.pendingTargetLocks instanceof Map)) {
    entity.pendingTargetLocks = new Map();
  }
  if (!(entity.targetedBy instanceof Set)) {
    entity.targetedBy = new Set();
  }
  if (!(entity.activeModuleEffects instanceof Map)) {
    entity.activeModuleEffects = new Map();
  }
  if (!(entity.moduleReactivationLocks instanceof Map)) {
    entity.moduleReactivationLocks = new Map();
  }
  if (!entity.mode) {
    entity.mode = "STOP";
  }
  if (!entity.direction) {
    entity.direction = { x: 1, y: 0, z: 0 };
  }
  if (!entity.position) {
    entity.position = { x: 0, y: 0, z: 0 };
  }
  if (!entity.velocity) {
    entity.velocity = { x: 0, y: 0, z: 0 };
  }
  if (!entity.targetPoint) {
    entity.targetPoint = cloneVector(entity.position);
  }
  return entity;
}

function persistFighterEntityState(entity) {
  if (!isFighterEntity(entity)) {
    return false;
  }

  const squadronSize = Math.max(0, resolveSquadronSize(entity));
  const singleton = squadronSize <= 1 ? 1 : 0;
  const quantity = singleton === 1 ? 1 : squadronSize;

  const result = updateInventoryItem(entity.itemID, (currentItem) => ({
    ...currentItem,
    locationID: toInt(entity.systemID, toInt(currentItem.locationID, 0)),
    flagID: 0,
    singleton,
    quantity,
    stacksize: quantity,
    launcherID: toInt(entity.launcherID ?? entity.controllerID, 0) || null,
    spaceState: serializeFighterSpaceState(entity),
    fighterState: serializeFighterRuntimeState(entity),
    conditionState: normalizeShipConditionState(entity.conditionState),
  }));

  if (!result.success) {
    log.warn(
      `[FighterRuntime] Failed to persist fighter ${entity.itemID}: ${result.errorMsg}`,
    );
  }
  return result.success;
}

function clearFighterCommandState(entity) {
  if (!entity) {
    return;
  }

  entity.fighterCommand = null;
  entity.fighterRecallTubeFlagID = null;
}

function getShipStateForSession(session) {
  const characterID = toInt(session && (session.characterID || session.charid), 0);
  if (characterID <= 0) {
    return null;
  }

  const shipRecord = resolveActiveShipRecord(characterID);
  const systemID = toInt(
    session && session._space && session._space.systemID,
    toInt(shipRecord && shipRecord.spaceState && shipRecord.spaceState.systemID, 0),
  );
  if (!shipRecord || systemID <= 0) {
    return null;
  }

  const runtime = getRuntime();
  const scene = runtime.ensureScene(systemID);
  const shipEntity = scene ? scene.getEntityByID(shipRecord.itemID) : null;
  if (!scene || !shipEntity) {
    return null;
  }

  return {
    characterID,
    shipRecord,
    shipEntity,
    scene,
  };
}

function getSceneFighterEntities(scene) {
  if (!scene || !(scene.dynamicEntities instanceof Map) || scene.dynamicEntities.size === 0) {
    return [];
  }

  if (scene.fighterEntityIDs instanceof Set && scene.fighterEntityIDs.size > 0) {
    return [...scene.fighterEntityIDs]
      .map((entityID) => scene.dynamicEntities.get(entityID) || null)
      .filter(Boolean);
  }

  return [...scene.dynamicEntities.values()].filter(isFighterEntity);
}

function listControlledFighterEntities(scene, shipID) {
  const numericShipID = toInt(shipID, 0);
  return getSceneFighterEntities(scene)
    .filter((entity) => toInt(entity.controllerID, 0) === numericShipID);
}

function buildFightersInSpaceRowsForShip(scene, shipID) {
  return listControlledFighterEntities(scene, shipID)
    .filter((entity) => isFighterTubeFlag(entity.tubeFlagID))
    .sort((left, right) => (
      toInt(left && left.tubeFlagID, 0) - toInt(right && right.tubeFlagID, 0)
    ))
    .map((entity) => [
      toInt(entity.tubeFlagID, 0),
      toInt(entity.itemID, 0),
      toInt(entity.typeID, 0),
      resolveSquadronSize(entity),
    ]);
}

function buildAbilityStateEntriesForShip(scene, shipID, session = null) {
  const nowMs =
    scene && typeof scene.getCurrentSimTimeMs === "function"
      ? scene.getCurrentSimTimeMs()
      : Date.now();
  return listControlledFighterEntities(scene, shipID)
    .map((entity) => [
      toInt(entity.itemID, 0),
      buildFighterAbilitySlotStatesPayload(entity, session, scene, nowMs),
    ])
    .filter((entry) => entry[0] > 0);
}

function syncInventoryChangesToSession(session, changes = []) {
  if (!session) {
    return;
  }

  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }

    syncInventoryItemForCharacterSession(
      session,
      change.item,
      change.previousData || {},
      { emitCfgLocation: true },
    );
  }
}

function getShipTubeItem(shipRecord, tubeFlagID) {
  if (!shipRecord || !isFighterTubeFlag(tubeFlagID)) {
    return null;
  }

  const contents = listContainerItems(
    toInt(shipRecord.ownerID, 0),
    shipRecord.itemID,
    tubeFlagID,
  )
    .filter(Boolean)
    .sort((left, right) => toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0));

  return contents[0] || null;
}

function getOwnerSession(shipRecord, fallbackSession = null) {
  const ownerSession = findSessionByCharacterID(toInt(shipRecord && shipRecord.ownerID, 0));
  return ownerSession || fallbackSession || null;
}

function sendNotification(session, name, payload) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  session.sendNotification(name, "clientID", payload);
  return true;
}

function queueNotification(session, name, payload) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }

  setImmediate(() => {
    if (!session || typeof session.sendNotification !== "function") {
      return;
    }
    session.sendNotification(name, "clientID", payload);
  });
  return true;
}

function notifyTubeContent(session, tubeFlagID, fighterItemOrEntity) {
  return sendNotification(session, "OnFighterTubeContentUpdate", [
    toInt(tubeFlagID, 0),
    toInt(fighterItemOrEntity && fighterItemOrEntity.itemID, 0),
    toInt(fighterItemOrEntity && fighterItemOrEntity.typeID, 0),
    resolveSquadronSize(fighterItemOrEntity),
  ]);
}

function notifyTubeEmpty(session, tubeFlagID) {
  return sendNotification(session, "OnFighterTubeContentEmpty", [
    toInt(tubeFlagID, 0),
  ]);
}

function notifyTubeState(session, tubeFlagID, stateID, userError = null) {
  return sendNotification(session, "OnFighterTubeTaskStatus", [
    toInt(tubeFlagID, 0),
    String(stateID || ""),
    null,
    null,
    userError,
  ]);
}

function notifyFighterAdded(session, scene, fighterEntity) {
  if (!isFighterEntity(fighterEntity)) {
    return false;
  }

  return sendNotification(session, "OnFighterAddedToController", [
    toInt(fighterEntity.itemID, 0),
    toInt(fighterEntity.typeID, 0),
    toInt(fighterEntity.tubeFlagID, 0),
    resolveSquadronSize(fighterEntity),
    buildFighterAbilitySlotStatesPayload(fighterEntity, session, scene),
  ]);
}

function notifyFighterRemoved(session, fighterID, tubeFlagID) {
  return sendNotification(session, "OnFighterRemovedFromController", [
    toInt(fighterID, 0),
    toInt(tubeFlagID, 0),
  ]);
}

function notifyAbilityActivated(session, scene, fighterEntity, slotID, abilityState) {
  if (!isFighterEntity(fighterEntity)) {
    return false;
  }

  const payload = [
    toInt(fighterEntity.itemID, 0),
    toInt(slotID, 0),
    abilityState && Number.isFinite(Number(abilityState.remainingChargeCount))
      ? toInt(abilityState.remainingChargeCount, 0)
      : null,
    translateAbilityTimeForSession(
      scene,
      session,
      abilityState && abilityState.activeSinceMs,
    ),
    Math.max(1, toInt(abilityState && abilityState.durationMs, 1)),
    buildCooldownPayload(scene, session, abilityState),
  ];
  return sendNotification(session, "OnFighterAbilitySlotActivated", payload);
}

function queueAbilityActivated(session, scene, fighterEntity, slotID, abilityState) {
  if (!isFighterEntity(fighterEntity)) {
    return false;
  }

  const payload = [
    toInt(fighterEntity.itemID, 0),
    toInt(slotID, 0),
    abilityState && Number.isFinite(Number(abilityState.remainingChargeCount))
      ? toInt(abilityState.remainingChargeCount, 0)
      : null,
    translateAbilityTimeForSession(
      scene,
      session,
      abilityState && abilityState.activeSinceMs,
    ),
    Math.max(1, toInt(abilityState && abilityState.durationMs, 1)),
    buildCooldownPayload(scene, session, abilityState),
  ];
  return queueNotification(session, "OnFighterAbilitySlotActivated", payload);
}

function notifyAbilityDeactivated(session, fighterID, slotID, failureReason = null) {
  return sendNotification(session, "OnFighterAbilitySlotDeactivated", [
    toInt(fighterID, 0),
    toInt(slotID, 0),
    failureReason,
  ]);
}

function queueAbilityDeactivated(session, fighterID, slotID, failureReason = null) {
  return queueNotification(session, "OnFighterAbilitySlotDeactivated", [
    toInt(fighterID, 0),
    toInt(slotID, 0),
    failureReason,
  ]);
}

function notifySquadronSizeChanged(session, fighterID, squadronSize) {
  return sendNotification(session, "OnInSpaceSquadronSizeChanged", [
    toInt(fighterID, 0),
    Math.max(0, toInt(squadronSize, 0)),
  ]);
}

function emitFighterAbilityActivationFx(scene, fighterEntity, slotID, abilityMeta, abilityState) {
  if (
    !scene ||
    !isFighterEntity(fighterEntity) ||
    !abilityMeta ||
    abilityMeta.isOffensive === true ||
    !abilityMeta.effectGuid
  ) {
    return false;
  }

  const pseudoModuleItem = buildFighterPseudoModuleItem(fighterEntity, slotID);
  scene.broadcastSpecialFx(
    fighterEntity.itemID,
    abilityMeta.effectGuid,
    {
      moduleID: pseudoModuleItem.itemID,
      moduleTypeID: pseudoModuleItem.typeID,
      targetID: toInt(abilityState && abilityState.targetID, 0) || null,
      isOffensive: false,
      start: true,
      active: true,
      duration: getEffectiveAbilityDurationMs(abilityMeta),
      repeat: 1,
      useCurrentVisibleStamp: true,
    },
    fighterEntity,
  );
  return true;
}

function buildFighterPseudoModuleItem(fighterEntity, slotID = 0) {
  return {
    itemID: toInt(fighterEntity && fighterEntity.itemID, 0),
    typeID: toInt(fighterEntity && fighterEntity.typeID, 0),
    groupID: toInt(fighterEntity && fighterEntity.groupID, 0),
    flagID: Math.max(0, toInt(slotID, 0)),
    locationID: toInt(fighterEntity && fighterEntity.itemID, 0),
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    itemName: String(fighterEntity && fighterEntity.itemName || "Fighter"),
    moduleState: {
      isOnline: true,
      isActive: true,
    },
  };
}

function resolveFighterControllerSession(fighterEntity, controllerEntity = null) {
  if (
    controllerEntity &&
    controllerEntity.session &&
    typeof controllerEntity.session.sendNotification === "function"
  ) {
    return controllerEntity.session;
  }

  const controllerCharacterID = toInt(
    controllerEntity &&
      (
        controllerEntity.session &&
        controllerEntity.session.characterID
      ) ||
      controllerEntity &&
      (
        controllerEntity.pilotCharacterID ??
        controllerEntity.characterID
      ) ||
      fighterEntity &&
      (
        fighterEntity.controllerOwnerID ??
        fighterEntity.ownerID
      ),
    0,
  );
  if (controllerCharacterID <= 0) {
    return null;
  }
  return findSessionByCharacterID(controllerCharacterID) || null;
}

function buildFighterCombatSourceEntity(fighterEntity, controllerEntity = null) {
  if (!fighterEntity) {
    return null;
  }

  const controllerSession = resolveFighterControllerSession(
    fighterEntity,
    controllerEntity,
  );
  const controllerCharacterID = toInt(
    controllerEntity &&
      (
        controllerEntity.session &&
        controllerEntity.session.characterID
      ) ||
      controllerEntity &&
      (
        controllerEntity.pilotCharacterID ??
        controllerEntity.characterID
      ) ||
      fighterEntity.controllerOwnerID ||
      fighterEntity.ownerID,
    0,
  );
  return {
    ...fighterEntity,
    session: controllerSession,
    characterID: controllerCharacterID || toInt(fighterEntity.characterID, 0) || null,
    pilotCharacterID:
      controllerCharacterID || toInt(fighterEntity.pilotCharacterID, 0) || null,
  };
}

function getFighterOrbitDistance(typeID) {
  return Math.max(
    DEFAULT_FIGHTER_ORBIT_DISTANCE_METERS,
    toNumber(
      getTypeAttributeValue(typeID, "fighterSquadronOrbitRange"),
      DEFAULT_FIGHTER_ORBIT_DISTANCE_METERS,
    ),
  );
}

function syncFighterOffensiveMovement(scene, fighterEntity, targetEntity, abilitySnapshot) {
  if (!scene || !fighterEntity || !targetEntity || !abilitySnapshot) {
    return false;
  }

  const preferredOrbitDistance = getFighterOrbitDistance(fighterEntity.typeID);
  const desiredAttackRange = Math.max(
    preferredOrbitDistance,
    toNumber(abilitySnapshot.rangeMeters, 0),
  );
  const chaseRange = Math.max(
    desiredAttackRange,
    desiredAttackRange + Math.max(0, toNumber(abilitySnapshot.falloffMeters, 0)),
  );
  const currentSurfaceDistance = surfaceDistance(fighterEntity, targetEntity);

  if (currentSurfaceDistance > chaseRange + 1) {
    scene.followShipEntity(
      fighterEntity,
      targetEntity.itemID,
      desiredAttackRange,
      { broadcast: true },
    );
    return false;
  }

  scene.orbitShipEntity(
    fighterEntity,
    targetEntity.itemID,
    preferredOrbitDistance,
    { broadcast: true },
  );
  return currentSurfaceDistance <= chaseRange + 1;
}

function buildCombinedFighterDamageResult(passes, rawDamage, fighterEntity, destroyed) {
  const combinedPerLayer = new Map([
    ["shield", 0],
    ["armor", 0],
    ["structure", 0],
  ]);

  for (const pass of passes) {
    const resultData = pass && pass.resultData ? pass.resultData : null;
    for (const layerEntry of Array.isArray(resultData && resultData.perLayer)
      ? resultData.perLayer
      : []) {
      const layerName = String(layerEntry && layerEntry.layer || "");
      if (!combinedPerLayer.has(layerName)) {
        continue;
      }
      combinedPerLayer.set(
        layerName,
        combinedPerLayer.get(layerName) + toNumber(layerEntry && layerEntry.appliedEffective, 0),
      );
    }
  }

  return {
    success: true,
    data: {
      rawDamage: normalizeDamageVector(rawDamage),
      perLayer: [...combinedPerLayer.entries()].map(([layer, appliedEffective]) => ({
        layer,
        appliedEffective,
      })),
      beforeConditionState:
        passes.length > 0
          ? {
              ...(passes[0].beforeConditionState || {}),
            }
          : normalizeShipConditionState(fighterEntity && fighterEntity.conditionState),
      afterConditionState: normalizeShipConditionState(
        fighterEntity && fighterEntity.conditionState,
      ),
      destroyed: destroyed === true,
    },
  };
}

function applyDamageToFighterSquadron(scene, fighterEntity, rawDamage, whenMs = null) {
  void scene;
  void whenMs;

  if (!isFighterEntity(fighterEntity)) {
    return null;
  }

  let remainingDamage = normalizeDamageVector(rawDamage);
  if (sumDamageVector(remainingDamage) <= 0) {
    return {
      damageResult: {
        success: true,
        data: {
          rawDamage: remainingDamage,
          perLayer: [],
          beforeConditionState: normalizeShipConditionState(fighterEntity.conditionState),
          afterConditionState: normalizeShipConditionState(fighterEntity.conditionState),
          destroyed: false,
        },
      },
      beforeSquadronSize: resolveSquadronSize(fighterEntity),
      afterSquadronSize: resolveSquadronSize(fighterEntity),
      squadronSizeChanged: false,
    };
  }

  const beforeSquadronSize = resolveSquadronSize(fighterEntity);
  let currentSquadronSize = beforeSquadronSize;
  const passes = [];

  while (currentSquadronSize > 0 && sumDamageVector(remainingDamage) > 0) {
    const beforeConditionState = normalizeShipConditionState(
      fighterEntity.conditionState,
    );
    const passResult = applyDamageToEntity(fighterEntity, remainingDamage);
    if (!passResult || passResult.success !== true || !passResult.data) {
      return {
        damageResult: passResult,
        beforeSquadronSize,
        afterSquadronSize: currentSquadronSize,
        squadronSizeChanged: false,
      };
    }

    passes.push({
      beforeConditionState,
      resultData: passResult.data,
    });
    remainingDamage = normalizeDamageVector(passResult.data.remainingRaw);

    if (passResult.data.destroyed !== true) {
      break;
    }

    currentSquadronSize -= 1;
    if (currentSquadronSize <= 0) {
      break;
    }

    fighterEntity.conditionState = normalizeShipConditionState(null);
  }

  fighterEntity.squadronSize = Math.max(0, currentSquadronSize);

  return {
    damageResult: buildCombinedFighterDamageResult(
      passes,
      rawDamage,
      fighterEntity,
      currentSquadronSize <= 0,
    ),
    beforeSquadronSize,
    afterSquadronSize: currentSquadronSize,
    squadronSizeChanged: currentSquadronSize !== beforeSquadronSize,
  };
}

function handleFighterPostDamage(scene, fighterEntity, damageResult, options = {}) {
  if (!scene || !isFighterEntity(fighterEntity) || !damageResult || damageResult.success !== true) {
    return false;
  }

  persistFighterEntityState(fighterEntity);
  const beforeSquadronSize = Math.max(0, toInt(options.beforeSquadronSize, resolveSquadronSize(fighterEntity)));
  const afterSquadronSize = resolveSquadronSize(fighterEntity);
  if (afterSquadronSize === beforeSquadronSize || afterSquadronSize <= 0) {
    return false;
  }

  const ownerSession = resolveFighterControllerSession(fighterEntity, options.controllerEntity || null);
  notifySquadronSizeChanged(ownerSession, fighterEntity.itemID, afterSquadronSize);
  scene.broadcastSlimItemChanges([fighterEntity]);
  return true;
}

function handleFighterDestroyed(scene, fighterEntity) {
  if (!scene || !isFighterEntity(fighterEntity)) {
    return false;
  }

  const controllerID = toInt(fighterEntity.controllerID, 0);
  const controllerEntity = controllerID > 0 ? scene.getEntityByID(controllerID) : null;
  const ownerSession = resolveFighterControllerSession(fighterEntity, controllerEntity);
  if (!ownerSession || toInt(fighterEntity.tubeFlagID, 0) <= 0) {
    return false;
  }

  notifyFighterRemoved(ownerSession, fighterEntity.itemID, fighterEntity.tubeFlagID);
  return true;
}

function executeFighterOffensiveCycle(scene, fighterEntity, controllerEntity, slotID, abilityState, nowMs) {
  const runtime = getRuntime();
  const droneInterop =
    runtime && runtime.droneInterop && typeof runtime.droneInterop === "object"
      ? runtime.droneInterop
      : null;
  if (!scene || !isFighterEntity(fighterEntity) || !controllerEntity || !droneInterop) {
    return { continueActive: false, deactivate: true };
  }

  const snapshot = resolveFighterAbilitySnapshot(
    fighterEntity,
    controllerEntity,
    slotID,
  );
  if (!snapshot || !snapshot.offensiveKind) {
    return { continueActive: false, deactivate: true };
  }

  const targetID = toInt(abilityState && abilityState.targetID, 0);
  const targetEntity = targetID > 0 ? scene.getEntityByID(targetID) : null;
  if (!targetEntity || !hasDamageableHealth(targetEntity)) {
    return { continueActive: false, deactivate: true };
  }

  syncFighterOffensiveMovement(scene, fighterEntity, targetEntity, snapshot);
  const rangeGate = Math.max(
    0,
    toNumber(snapshot.rangeMeters, 0) + Math.max(0, toNumber(snapshot.falloffMeters, 0)),
  );
  if (rangeGate > 0 && surfaceDistance(fighterEntity, targetEntity) > rangeGate + 1) {
    return { continueActive: true, deactivate: false };
  }

  const pseudoModuleItem = buildFighterPseudoModuleItem(fighterEntity, slotID);
  const combatSourceEntity = buildFighterCombatSourceEntity(
    fighterEntity,
    controllerEntity,
  ) || fighterEntity;
  let shotDamage = null;
  let hitQuality = 0;
  let appliedDamageAmount = 0;
  let damageResult = null;
  let destroyResult = null;

  if (snapshot.effectGuid) {
    scene.broadcastSpecialFx(
      fighterEntity.itemID,
      snapshot.effectGuid,
      {
        moduleID: pseudoModuleItem.itemID,
        moduleTypeID: pseudoModuleItem.typeID,
        targetID: targetEntity.itemID,
        isOffensive: true,
        start: true,
        active: false,
        duration: getEffectiveAbilityDurationMs(snapshot),
        repeat: 1,
        useCurrentVisibleStamp: true,
      },
      fighterEntity,
    );
  }

  if (snapshot.offensiveKind === "turret") {
    const shotResult = droneInterop.resolveTurretShot({
      attackerEntity: fighterEntity,
      targetEntity,
      weaponSnapshot: {
        rawShotDamage: snapshot.rawShotDamage,
        trackingSpeed: snapshot.trackingSpeed,
        optimalSigRadius: snapshot.optimalSigRadius,
        optimalRange: snapshot.rangeMeters,
        falloff: snapshot.falloffMeters,
      },
    });
    shotDamage = shotResult && shotResult.shotDamage ? shotResult.shotDamage : null;
    hitQuality = droneInterop.getCombatMessageHitQuality(shotResult);
    if (shotResult && shotResult.hit === true) {
      const weaponDamageResult = droneInterop.applyWeaponDamageToTarget(
        scene,
        fighterEntity,
        targetEntity,
        shotResult.shotDamage,
        nowMs,
      );
      damageResult = weaponDamageResult && weaponDamageResult.damageResult
        ? weaponDamageResult.damageResult
        : null;
      destroyResult = weaponDamageResult && weaponDamageResult.destroyResult
        ? weaponDamageResult.destroyResult
        : null;
    }
  } else if (snapshot.offensiveKind === "missile") {
    const missileDamageResult = resolveMissileAppliedDamage({
      rawShotDamage: snapshot.rawShotDamage,
      explosionRadius: snapshot.explosionRadius,
      explosionVelocity: snapshot.explosionVelocity,
      damageReductionFactor: snapshot.damageReductionFactor,
      damageReductionSensitivity: snapshot.damageReductionSensitivity,
    }, targetEntity);
    shotDamage = missileDamageResult && missileDamageResult.appliedDamage
      ? missileDamageResult.appliedDamage
      : null;
    hitQuality = sumDamageVector(shotDamage) > 0 ? 4 : 0;
    if (sumDamageVector(shotDamage) > 0) {
      const weaponDamageResult = droneInterop.applyWeaponDamageToTarget(
        scene,
        fighterEntity,
        targetEntity,
        shotDamage,
        nowMs,
      );
      damageResult = weaponDamageResult && weaponDamageResult.damageResult
        ? weaponDamageResult.damageResult
        : null;
      destroyResult = weaponDamageResult && weaponDamageResult.destroyResult
        ? weaponDamageResult.destroyResult
        : null;
    }
  }

  appliedDamageAmount = droneInterop.getAppliedDamageAmount(damageResult);
  if (appliedDamageAmount > 0) {
    droneInterop.noteKillmailDamage(
      combatSourceEntity,
      targetEntity,
      appliedDamageAmount,
      {
        whenMs: nowMs,
        weaponSnapshot: {
          ...snapshot,
          moduleTypeID: pseudoModuleItem.typeID,
        },
        moduleItem: pseudoModuleItem,
        chargeItem: null,
      },
    );
  }
  if (destroyResult && destroyResult.success === true) {
    droneInterop.recordKillmailFromDestruction(targetEntity, destroyResult, {
      attackerEntity: combatSourceEntity,
      whenMs: nowMs,
      weaponSnapshot: {
        ...snapshot,
        moduleTypeID: pseudoModuleItem.typeID,
      },
      moduleItem: pseudoModuleItem,
      chargeItem: null,
    });
  }

  droneInterop.notifyWeaponDamageMessages(
    combatSourceEntity,
    targetEntity,
    pseudoModuleItem,
    shotDamage,
    appliedDamageAmount,
    hitQuality,
  );

  return {
    continueActive: usesContinuousAbilityCycle(snapshot),
    deactivate: false,
  };
}

function buildFighterJammerRuntimeCallbacks(scene) {
  return {
    getEntityByID(entityID) {
      return scene && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(entityID)
        : null;
    },
    isEntityLockedTarget() {
      return true;
    },
    getEntitySurfaceDistance(sourceEntity, targetEntity) {
      return surfaceDistance(sourceEntity, targetEntity);
    },
    clearOutgoingTargetLocksExcept(targetEntity, allowedTargetIDs, options = {}) {
      return scene && typeof scene.clearOutgoingTargetLocksExcept === "function"
        ? scene.clearOutgoingTargetLocksExcept(targetEntity, allowedTargetIDs, options)
        : {
          clearedTargetIDs: [],
          cancelledPendingIDs: [],
        };
    },
    random() {
      return scene && typeof scene.__jammerRandom === "function"
        ? Number(scene.__jammerRandom()) || 0
        : Math.random();
    },
  };
}

function executeFighterUtilityCycle(scene, fighterEntity, controllerEntity, slotID, abilityState, nowMs) {
  if (!scene || !isFighterEntity(fighterEntity)) {
    return { continueActive: false, deactivate: true };
  }
  const runtime = getRuntime();

  const snapshot = resolveFighterAbilitySnapshot(
    fighterEntity,
    controllerEntity,
    slotID,
  ) || getFighterAbilityMetaForSlot(fighterEntity.typeID, slotID);
  if (!snapshot) {
    return { continueActive: false, deactivate: true };
  }

  if (
    normalizeEffectFamily(snapshot.normalizedEffectFamily || snapshot.effectFamily) ===
      "fighterabilitymicrojumpdrive" &&
    abilityState &&
    abilityState.targetPoint
  ) {
    const targetPoint = cloneVector(abilityState.targetPoint, fighterEntity.position);
    const jumpDirection = normalizeVector(
      subtractVectors(targetPoint, fighterEntity.position),
      fighterEntity.direction,
    );
    scene.teleportDynamicEntityToPoint(fighterEntity, targetPoint, {
      direction: jumpDirection,
      refreshOwnerSession: true,
    });
    fighterEntity.direction = jumpDirection;
    fighterEntity.targetPoint = cloneVector(targetPoint);
    persistFighterEntityState(fighterEntity);
  }

  if (
    normalizeEffectFamily(snapshot.normalizedEffectFamily || snapshot.effectFamily) ===
      "fighterabilityecm"
  ) {
    const targetID = toInt(abilityState && abilityState.targetID, 0);
    const targetEntity = targetID > 0 ? scene.getEntityByID(targetID) : null;
    if (!targetEntity || targetEntity.kind !== "ship" || !hasDamageableHealth(targetEntity)) {
      return { continueActive: false, deactivate: true };
    }

    syncFighterOffensiveMovement(scene, fighterEntity, targetEntity, {
      rangeMeters: snapshot.jammerOptimalRangeMeters || snapshot.rangeMeters || 0,
      falloffMeters: snapshot.jammerFalloffMeters || snapshot.falloffMeters || 0,
    });
    const rangeGate = Math.max(
      0,
      toNumber(snapshot.jammerOptimalRangeMeters || snapshot.rangeMeters, 0) +
        Math.max(0, toNumber(snapshot.jammerFalloffMeters || snapshot.falloffMeters, 0)),
    );
    if (rangeGate > 0 && surfaceDistance(fighterEntity, targetEntity) > rangeGate + 1) {
      return { continueActive: true, deactivate: false };
    }

    const pseudoModuleItem = buildFighterPseudoModuleItem(fighterEntity, slotID);
    if (snapshot.effectGuid) {
      scene.broadcastSpecialFx(
        fighterEntity.itemID,
        snapshot.effectGuid,
        {
          moduleID: pseudoModuleItem.itemID,
          moduleTypeID: pseudoModuleItem.typeID,
          targetID: targetEntity.itemID,
          isOffensive: true,
          start: true,
          active: false,
          duration: Math.max(1, toNumber(snapshot.durationMs, 1_000)),
          repeat: 1,
          useCurrentVisibleStamp: true,
        },
        fighterEntity,
      );
    }
    const effectState = {
      moduleID: pseudoModuleItem.itemID,
      targetID: targetEntity.itemID,
      hostileJammingType: jammerModuleRuntime.ECM_JAMMING_TYPE,
      jammerModuleEffect: true,
      jammerStrengthBySensorType: snapshot.jammerStrengthBySensorType || {},
      jammerMaxRangeMeters: Math.max(
        0,
        toNumber(snapshot.jammerOptimalRangeMeters, toNumber(snapshot.rangeMeters, 0)),
      ),
      jammerFalloffMeters: Math.max(
        0,
        toNumber(snapshot.jammerFalloffMeters, toNumber(snapshot.falloffMeters, 0)),
      ),
      durationMs: Math.max(1, toNumber(snapshot.durationMs, 1000)),
      jamDurationMs: Math.max(
        1,
        toNumber(snapshot.jammerDurationMs, toNumber(snapshot.durationMs, 1000)),
      ),
      nextCycleAtMs: Math.max(0, toNumber(nowMs, Date.now())) + Math.max(
        1,
        toNumber(snapshot.durationMs, 1000),
      ),
    };
    const cycleResult = jammerModuleRuntime.executeJammerModuleCycle({
      scene,
      entity: fighterEntity,
      effectState,
      nowMs,
      callbacks: buildFighterJammerRuntimeCallbacks(scene),
    });
    if (
      cycleResult.success &&
      runtime &&
      typeof runtime.applyJammerCyclePresentation === "function"
    ) {
      runtime.applyJammerCyclePresentation(
        scene,
        fighterEntity,
        effectState,
        nowMs,
        cycleResult,
      );
    }
    return {
      continueActive: false,
      deactivate: true,
    };
  }

  return {
    continueActive: false,
    deactivate: true,
  };
}

function buildFighterLaunchSpaceState(shipEntity, launchIndex = 0) {
  const shipDirection = normalizeVector(shipEntity && shipEntity.direction, { x: 1, y: 0, z: 0 });
  const lateralDirection = buildPerpendicular(shipDirection);
  const launchDistance =
    Math.max(toNumber(shipEntity && shipEntity.radius, 0), 1) +
    DEFAULT_FIGHTER_LAUNCH_OFFSET_METERS;
  const lateralOffset = (launchIndex % FIGHTER_TUBE_FLAGS.length) * 60;
  const signedSide = launchIndex % 2 === 0 ? 1 : -1;
  const position = addVectors(
    addVectors(
      cloneVector(shipEntity && shipEntity.position),
      scaleVector(shipDirection, launchDistance),
    ),
    scaleVector(lateralDirection, lateralOffset * signedSide),
  );

  return {
    systemID: toInt(shipEntity && shipEntity.systemID, 0),
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: shipDirection,
    targetPoint: cloneVector(position),
    speedFraction: 0,
    mode: "STOP",
    targetEntityID: null,
    followRange: 0,
    orbitDistance: 0,
    orbitNormal: buildPerpendicular(shipDirection),
    orbitSign: 1,
    pendingWarp: null,
    warpState: null,
  };
}

function rollbackFighterToTube(itemID, shipRecord, tubeFlagID) {
  return updateInventoryItem(itemID, (currentItem) => ({
    ...currentItem,
    locationID: toInt(shipRecord && shipRecord.itemID, 0),
    flagID: toInt(tubeFlagID, ITEM_FLAGS.FIGHTER_BAY),
    launcherID: null,
    spaceState: null,
    fighterState: null,
  }));
}

function launchFightersFromTubes(session, rawTubeFlagIDs) {
  const shipState = getShipStateForSession(session);
  const errors = [];
  if (!shipState) {
    return { success: false, errors };
  }

  const { characterID, shipRecord, shipEntity, scene } = shipState;
  const ownerSession = getOwnerSession(shipRecord, session);
  let launchIndex = 0;

  for (const tubeFlagID of normalizeTubeFlagList(rawTubeFlagIDs)) {
    const fighterItem = getShipTubeItem(shipRecord, tubeFlagID);
    if (!fighterItem || !isFighterItemRecord(fighterItem)) {
      errors.push([tubeFlagID, buildFighterError("No fighter squadron is loaded in that launch tube.")]);
      continue;
    }
    if (
      listControlledFighterEntities(scene, shipRecord.itemID).some(
        (entity) => toInt(entity.tubeFlagID, 0) === tubeFlagID,
      )
    ) {
      errors.push([tubeFlagID, buildFighterError("That launch tube already has an in-space squadron.")]);
      continue;
    }

    const moveResult = moveItemToLocation(
      fighterItem.itemID,
      scene.systemID,
      0,
    );
    if (!moveResult.success) {
      errors.push([tubeFlagID, buildFighterError("Unable to launch fighters from that tube.")]);
      continue;
    }

    syncInventoryChangesToSession(ownerSession, moveResult.data && moveResult.data.changes);
    const updateResult = updateInventoryItem(fighterItem.itemID, (currentItem) => ({
      ...currentItem,
      launcherID: shipRecord.itemID,
      spaceState: buildFighterLaunchSpaceState(shipEntity, launchIndex),
      fighterState: {
        tubeFlagID,
        controllerID: shipRecord.itemID,
        controllerOwnerID: characterID,
      },
    }));
    if (!updateResult.success) {
      rollbackFighterToTube(fighterItem.itemID, shipRecord, tubeFlagID);
      errors.push([tubeFlagID, buildFighterError("Unable to finalize fighter launch state.")]);
      continue;
    }

    const spawnResult = getRuntime().spawnDynamicInventoryEntity(scene.systemID, fighterItem.itemID, {
      broadcast: true,
      excludedSession: null,
    });
    if (!spawnResult.success || !spawnResult.data || !spawnResult.data.entity) {
      rollbackFighterToTube(fighterItem.itemID, shipRecord, tubeFlagID);
      errors.push([tubeFlagID, buildFighterError("Unable to materialize the launched fighter squadron in space.")]);
      continue;
    }

    const fighterEntity = hydrateFighterEntityFromItem(
      spawnResult.data.entity,
      updateResult.data,
    );
    fighterEntity.launcherID = shipRecord.itemID;
    fighterEntity.controllerID = shipRecord.itemID;
    fighterEntity.controllerOwnerID = characterID;
    fighterEntity.tubeFlagID = tubeFlagID;
    fighterEntity.squadronSize = resolveSquadronSize(updateResult.data);
    clearFighterCommandState(fighterEntity);
    scene.orbitShipEntity(
      fighterEntity,
      shipRecord.itemID,
      DEFAULT_FIGHTER_ORBIT_DISTANCE_METERS,
      { broadcast: true },
    );
    persistFighterEntityState(fighterEntity);

    notifyTubeEmpty(ownerSession, tubeFlagID);
    notifyFighterAdded(ownerSession, scene, fighterEntity);
    notifyTubeState(ownerSession, tubeFlagID, TUBE_STATE_INSPACE);
    launchIndex += 1;
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

function landFighterToTube(scene, shipRecord, fighterEntity, fallbackSession = null) {
  if (!scene || !shipRecord || !isFighterEntity(fighterEntity)) {
    return { success: false, errorMsg: "INVALID_FIGHTER_RECOVERY" };
  }

  const tubeFlagID = toInt(
    fighterEntity.tubeFlagID,
    toInt(fighterEntity.fighterRecallTubeFlagID, 0),
  );
  if (!isFighterTubeFlag(tubeFlagID)) {
    return { success: false, errorMsg: "INVALID_TUBE" };
  }
  const occupiedTubeItem = getShipTubeItem(shipRecord, tubeFlagID);
  if (occupiedTubeItem && toInt(occupiedTubeItem.itemID, 0) !== toInt(fighterEntity.itemID, 0)) {
    return { success: false, errorMsg: "TUBE_OCCUPIED" };
  }

  const ownerSession = getOwnerSession(shipRecord, fallbackSession);
  notifyTubeState(ownerSession, tubeFlagID, TUBE_STATE_LANDING);
  const removeResult = scene.removeDynamicEntity(fighterEntity.itemID, {
    broadcast: true,
  });
  if (!removeResult || !removeResult.success) {
    return removeResult || { success: false, errorMsg: "REMOVE_FAILED" };
  }

  const bayUpdateResult = updateInventoryItem(fighterEntity.itemID, (currentItem) => ({
    ...currentItem,
    locationID: shipRecord.itemID,
    flagID: tubeFlagID,
    launcherID: null,
    spaceState: null,
    fighterState: null,
  }));
  if (!bayUpdateResult.success) {
    return bayUpdateResult;
  }

  notifyFighterRemoved(ownerSession, fighterEntity.itemID, tubeFlagID);
  syncInventoryChangesToSession(ownerSession, [{
    item: bayUpdateResult.data,
    previousData: bayUpdateResult.previousData || {},
  }]);
  notifyTubeContent(ownerSession, tubeFlagID, bayUpdateResult.data);
  notifyTubeState(ownerSession, tubeFlagID, TUBE_STATE_READY);
  return {
    success: true,
    data: {
      tubeFlagID,
      fighterID: fighterEntity.itemID,
    },
  };
}

function recallFightersToTubes(session, rawFighterIDs) {
  const shipState = getShipStateForSession(session);
  const fighterIDs = normalizeFighterIDList(rawFighterIDs);
  const errors = [];
  if (!shipState) {
    return {
      success: false,
      errors,
      entries: buildPerFighterResultEntries(fighterIDs, errors),
    };
  }

  const { shipRecord, scene } = shipState;
  for (const fighterID of fighterIDs) {
    const fighterEntity = scene.getEntityByID(fighterID);
    if (!isFighterEntity(fighterEntity) || toInt(fighterEntity.controllerID, 0) !== toInt(shipRecord.itemID, 0)) {
      errors.push([fighterID, buildFighterError("That fighter squadron is not currently controlled by this ship.")]);
      continue;
    }

    const tubeFlagID = toInt(fighterEntity.tubeFlagID, 0);
    if (!isFighterTubeFlag(tubeFlagID)) {
      errors.push([fighterID, buildFighterError("That fighter squadron has no valid originating launch tube.")]);
      continue;
    }
    const occupiedTubeItem = getShipTubeItem(shipRecord, tubeFlagID);
    if (occupiedTubeItem && toInt(occupiedTubeItem.itemID, 0) !== fighterID) {
      errors.push([fighterID, buildFighterError("That launch tube is already occupied.")]);
      continue;
    }

    fighterEntity.fighterCommand = "RECALL_TUBE";
    fighterEntity.fighterRecallTubeFlagID = tubeFlagID;
    scene.followShipEntity(
      fighterEntity,
      shipRecord.itemID,
      FIGHTER_RECOVERY_DISTANCE_METERS,
      { broadcast: true },
    );
    persistFighterEntityState(fighterEntity);
  }

  return {
    success: errors.length === 0,
    errors,
    entries: buildPerFighterResultEntries(fighterIDs, errors),
  };
}

function buildAbilityError(message) {
  return buildFighterError(message);
}

function resolveAbilityTargetEntity(scene, rawTargetID) {
  const targetID = toInt(rawTargetID, 0);
  if (targetID <= 0 || !scene) {
    return null;
  }
  return scene.getEntityByID(targetID) || null;
}

function validateAbilityActivation(scene, fighterEntity, abilityMeta, rawTarget) {
  if (!scene || !isFighterEntity(fighterEntity) || !abilityMeta) {
    return {
      success: false,
      error: buildAbilityError("That fighter ability cannot be activated right now."),
    };
  }

  const securityRestrictionError = buildAbilitySecurityRestrictionError(scene, abilityMeta);
  if (securityRestrictionError) {
    return {
      success: false,
      error: securityRestrictionError,
    };
  }

  switch (abilityMeta.targetMode) {
    case TARGET_MODE_UNTARGETED:
      return { success: true, targetID: null };
    case TARGET_MODE_ITEMTARGETED: {
      if (rawTarget === null || rawTarget === undefined || rawTarget === 0) {
        return {
          success: false,
          error: buildAbilityRequiresTargetError(fighterEntity, abilityMeta),
        };
      }
      const targetEntity = resolveAbilityTargetEntity(scene, rawTarget);
      if (!targetEntity) {
        return {
          success: false,
          error: buildAbilityError("That fighter ability requires a valid target."),
        };
      }
      const safetyRestrictionError = buildAbilitySafetyRestrictionError(
        scene,
        fighterEntity,
        abilityMeta,
        targetEntity,
      );
      if (safetyRestrictionError) {
        return {
          success: false,
          error: safetyRestrictionError,
        };
      }
      if (
        abilityMeta.rangeMeters > 0 &&
        surfaceDistance(fighterEntity, targetEntity) > abilityMeta.rangeMeters
      ) {
        return {
          success: false,
          error: buildAbilityError("That target is outside fighter ability range."),
        };
      }
      return {
        success: true,
        targetID: toInt(targetEntity.itemID, 0),
      };
    }
    case TARGET_MODE_POINTTARGETED:
      if (!rawTarget || typeof rawTarget !== "object") {
        return {
          success: false,
          error: buildAbilityError("That fighter ability requires a target point."),
        };
      }
      {
        const targetPoint = cloneVector(rawTarget);
        if (
          abilityMeta.rangeMeters > 0 &&
          distance(fighterEntity.position, targetPoint) > abilityMeta.rangeMeters + 1
        ) {
          return {
            success: false,
            error: buildAbilityError("That target point is outside fighter ability range."),
          };
        }
        return {
          success: true,
          targetID: null,
          targetPoint,
        };
      }
    default:
      return {
        success: false,
        error: buildAbilityError("That fighter ability uses an unsupported target mode."),
      };
  }
}

function activateAbilitySlots(session, rawFighterIDs, rawAbilitySlotID, rawTarget = null) {
  const shipState = getShipStateForSession(session);
  const fighterIDs = normalizeFighterIDList(rawFighterIDs);
  const errors = [];
  if (!shipState) {
    return {
      success: false,
      errors,
      entries: buildPerFighterResultEntries(fighterIDs, errors),
    };
  }

  const { shipRecord, shipEntity, scene } = shipState;
  const ownerSession = getOwnerSession(shipRecord, session);
  const abilitySlotID = toInt(rawAbilitySlotID, -1);
  const nowMs = scene.getCurrentSimTimeMs();

  if (!ABILITY_SLOT_IDS.includes(abilitySlotID)) {
    for (const fighterID of fighterIDs) {
      errors.push([fighterID, buildAbilityError("That fighter ability slot is invalid.")]);
    }
    return {
      success: false,
      errors,
      entries: buildPerFighterResultEntries(fighterIDs, errors),
    };
  }

  for (const fighterID of fighterIDs) {
    const fighterEntity = scene.getEntityByID(fighterID);
    if (!isFighterEntity(fighterEntity) || toInt(fighterEntity.controllerID, 0) !== toInt(shipRecord.itemID, 0)) {
      errors.push([fighterID, buildAbilityError("That fighter squadron is not currently controlled by this ship.")]);
      continue;
    }

    const abilityMeta =
      resolveFighterAbilitySnapshot(
        fighterEntity,
        shipEntity,
        abilitySlotID,
      ) ||
      getFighterAbilityMetaForSlot(fighterEntity.typeID, abilitySlotID);
    if (!abilityMeta) {
      errors.push([fighterID, buildAbilityError("That fighter has no ability in the requested slot.")]);
      continue;
    }

    let existingState = refreshAbilityCharges(
      fighterEntity,
      abilitySlotID,
      abilityMeta,
      nowMs,
    );
    if (existingState && toNumber(existingState.activeUntilMs, 0) > nowMs) {
      errors.push([fighterID, buildAbilityError("That fighter ability is already active.")]);
      continue;
    }

    const abilityChargeCount = getEffectiveAbilityChargeCount(abilityMeta);
    const remainingChargeCount = getAbilityStateChargeCount(
      existingState,
      abilityMeta,
    );
    const cooldownIsActive =
      existingState &&
      toNumber(existingState.cooldownStartMs, 0) <= nowMs &&
      toNumber(existingState.cooldownEndMs, 0) > nowMs;
    if (
      abilityChargeCount === null &&
      cooldownIsActive
    ) {
      errors.push([fighterID, buildAbilityError("That fighter ability is still on cooldown.")]);
      continue;
    }
    if (
      abilityChargeCount !== null &&
      remainingChargeCount !== null &&
      remainingChargeCount <= 0
    ) {
      errors.push([fighterID, buildAbilityError("That fighter ability is still on cooldown.")]);
      continue;
    }

    const validation = validateAbilityActivation(scene, fighterEntity, abilityMeta, rawTarget);
    if (!validation.success) {
      errors.push([fighterID, validation.error]);
      continue;
    }

    const durationMs = getEffectiveAbilityDurationMs(abilityMeta);
    const cooldownMs = getEffectiveAbilityCooldownMs(abilityMeta);
    const rearmTimeMs = getEffectiveAbilityRearmTimeMs(abilityMeta);
    const nextState = {
      ...(existingState || {}),
      activeSinceMs: nowMs,
      durationMs,
      activeUntilMs: nowMs + durationMs,
      targetID: validation.targetID,
    };
    if (validation.targetPoint) {
      nextState.targetPoint = cloneVector(validation.targetPoint);
    } else {
      delete nextState.targetPoint;
    }
    if (abilityChargeCount !== null) {
      nextState.remainingChargeCount = Math.max(
        0,
        (remainingChargeCount === null ? abilityChargeCount : remainingChargeCount) - 1,
      );
      if (rearmTimeMs !== null) {
        nextState.cooldownStartMs = nowMs + durationMs;
        nextState.cooldownEndMs = nowMs + durationMs + rearmTimeMs;
      } else {
        delete nextState.cooldownStartMs;
        delete nextState.cooldownEndMs;
      }
    } else if (cooldownMs !== null) {
      nextState.cooldownStartMs = nowMs + durationMs;
      nextState.cooldownEndMs = nowMs + durationMs + cooldownMs;
    } else {
      delete nextState.cooldownStartMs;
      delete nextState.cooldownEndMs;
    }
    setEntityAbilityState(fighterEntity, abilitySlotID, nextState);
    const activeAbilityState = getEntityAbilityState(fighterEntity, abilitySlotID);
    emitFighterAbilityActivationFx(
      scene,
      fighterEntity,
      abilitySlotID,
      abilityMeta,
      activeAbilityState,
    );
    if (isMobilityAbilitySnapshot(abilityMeta)) {
      syncFighterMobilityAbilityState(
        scene,
        fighterEntity,
        shipEntity,
        nowMs,
      );
    }
    persistFighterEntityState(fighterEntity);
    queueAbilityActivated(
      ownerSession,
      scene,
      fighterEntity,
      abilitySlotID,
      activeAbilityState,
    );
  }

  return {
    success: errors.length === 0,
    errors,
    entries: buildPerFighterResultEntries(fighterIDs, errors),
  };
}

function deactivateAbilitySlots(session, rawFighterIDs, rawAbilitySlotID) {
  const shipState = getShipStateForSession(session);
  const fighterIDs = normalizeFighterIDList(rawFighterIDs);
  const errors = [];
  if (!shipState) {
    return {
      success: false,
      errors,
      entries: buildPerFighterResultEntries(fighterIDs, errors),
    };
  }

  const { shipRecord, shipEntity, scene } = shipState;
  const ownerSession = getOwnerSession(shipRecord, session);
  const abilitySlotID = toInt(rawAbilitySlotID, -1);
  const nowMs = scene.getCurrentSimTimeMs();

  if (!ABILITY_SLOT_IDS.includes(abilitySlotID)) {
    for (const fighterID of fighterIDs) {
      errors.push([fighterID, buildAbilityError("That fighter ability slot is invalid.")]);
    }
    return {
      success: false,
      errors,
      entries: buildPerFighterResultEntries(fighterIDs, errors),
    };
  }

  for (const fighterID of fighterIDs) {
    const fighterEntity = scene.getEntityByID(fighterID);
    if (!isFighterEntity(fighterEntity) || toInt(fighterEntity.controllerID, 0) !== toInt(shipRecord.itemID, 0)) {
      errors.push([fighterID, buildAbilityError("That fighter squadron is not currently controlled by this ship.")]);
      continue;
    }

    const abilityMeta =
      resolveFighterAbilitySnapshot(
        fighterEntity,
        shipEntity,
        abilitySlotID,
      ) ||
      getFighterAbilityMetaForSlot(fighterEntity.typeID, abilitySlotID);
    let existingState = refreshAbilityCharges(
      fighterEntity,
      abilitySlotID,
      abilityMeta,
      nowMs,
    );
    if (!existingState || toNumber(existingState.activeUntilMs, 0) <= nowMs) {
      errors.push([fighterID, buildAbilityError("That fighter ability is not currently active.")]);
      continue;
    }

    const nextState = {
      ...existingState,
      cooldownStartMs: getEffectiveAbilityCooldownMs(abilityMeta) !== null
        ? nowMs
        : existingState.cooldownStartMs,
      cooldownEndMs: getEffectiveAbilityCooldownMs(abilityMeta) !== null
        ? nowMs + getEffectiveAbilityCooldownMs(abilityMeta)
        : existingState.cooldownEndMs,
    };
    clearAbilityActiveWindow(nextState);
    if (toNumber(nextState.cooldownEndMs, 0) <= nowMs) {
      delete nextState.cooldownStartMs;
      delete nextState.cooldownEndMs;
    }
    setEntityAbilityState(fighterEntity, abilitySlotID, nextState);
    if (isMobilityAbilitySnapshot(abilityMeta)) {
      syncFighterMobilityAbilityState(
        scene,
        fighterEntity,
        shipEntity,
        nowMs,
      );
    }
    persistFighterEntityState(fighterEntity);
    queueAbilityDeactivated(ownerSession, fighterEntity.itemID, abilitySlotID, null);
  }

  return {
    success: errors.length === 0,
    errors,
    entries: buildPerFighterResultEntries(fighterIDs, errors),
  };
}

function issueFighterGotoPoint(scene, fighterEntity, point) {
  const normalizedPoint = cloneVector(point, fighterEntity && fighterEntity.position);
  const direction = normalizeVector(
    subtractVectors(normalizedPoint, fighterEntity.position),
    fighterEntity.direction,
  );
  const now = scene.getCurrentSimTimeMs();

  fighterEntity.mode = "GOTO";
  fighterEntity.targetEntityID = null;
  fighterEntity.followRange = 0;
  fighterEntity.orbitDistance = 0;
  fighterEntity.pendingWarp = null;
  fighterEntity.warpState = null;
  fighterEntity.targetPoint = normalizedPoint;
  fighterEntity.direction = direction;
  fighterEntity.speedFraction = fighterEntity.speedFraction > 0 ? fighterEntity.speedFraction : 1;
  persistFighterEntityState(fighterEntity);
  scene.dispatchConfiguredSubwarpMovement(
    fighterEntity,
    (stamp) => ([
      {
        stamp,
        payload: destiny.buildGotoPointPayload(fighterEntity.itemID, normalizedPoint),
      },
      {
        stamp,
        payload: destiny.buildSetSpeedFractionPayload(
          fighterEntity.itemID,
          fighterEntity.speedFraction,
        ),
      },
    ]),
    now,
    {},
  );
  scene.scheduleWatcherMovementAnchor(fighterEntity, now, "fighterGotoPoint");
  return true;
}

function executeMovementCommandOnFighters(session, rawFighterIDs, command, ...args) {
  const shipState = getShipStateForSession(session);
  if (!shipState) {
    return false;
  }

  const { shipRecord, scene } = shipState;
  const fighterIDs = normalizeFighterIDList(rawFighterIDs);
  const normalizedCommand = String(command || "").trim().toUpperCase();
  let movedAny = false;

  for (const fighterID of fighterIDs) {
    const fighterEntity = scene.getEntityByID(fighterID);
    if (!isFighterEntity(fighterEntity) || toInt(fighterEntity.controllerID, 0) !== toInt(shipRecord.itemID, 0)) {
      continue;
    }

    clearFighterCommandState(fighterEntity);
    switch (normalizedCommand) {
      case MOVEMENT_COMMAND_ORBIT: {
        const targetID = toInt(args[0], 0);
        const orbitDistance = Math.max(
          0,
          toNumber(args[1], DEFAULT_FIGHTER_ORBIT_DISTANCE_METERS),
        );
        if (!scene.getEntityByID(targetID)) {
          break;
        }
        scene.orbitShipEntity(fighterEntity, targetID, orbitDistance, {
          broadcast: true,
        });
        persistFighterEntityState(fighterEntity);
        movedAny = true;
        break;
      }
      case MOVEMENT_COMMAND_FOLLOW: {
        const targetID = toInt(args[0], 0);
        const followRange = Math.max(0, toNumber(args[1], 0));
        if (!scene.getEntityByID(targetID)) {
          break;
        }
        scene.followShipEntity(fighterEntity, targetID, followRange, {
          broadcast: true,
        });
        persistFighterEntityState(fighterEntity);
        movedAny = true;
        break;
      }
      case MOVEMENT_COMMAND_STOP:
        scene.stopShipEntity(fighterEntity, {
          allowSessionOwned: true,
        });
        persistFighterEntityState(fighterEntity);
        movedAny = true;
        break;
      case MOVEMENT_COMMAND_GOTO_POINT:
        if (args[0] && typeof args[0] === "object") {
          movedAny = issueFighterGotoPoint(scene, fighterEntity, args[0]) || movedAny;
        }
        break;
      default:
        break;
    }
  }

  return movedAny;
}

function commandAbandonFighter(session, rawFighterID) {
  const shipState = getShipStateForSession(session);
  if (!shipState) {
    return false;
  }

  const { shipRecord, scene } = shipState;
  let abandonedAny = false;
  const ownerSession = getOwnerSession(shipRecord, session);

  for (const fighterID of normalizeFighterIDList(rawFighterID)) {
    const fighterEntity = scene.getEntityByID(fighterID);
    if (!isFighterEntity(fighterEntity) || toInt(fighterEntity.controllerID, 0) !== toInt(shipRecord.itemID, 0)) {
      continue;
    }
    abandonedAny = abandonFighterInSpace(scene, fighterEntity, {
      ownerSession,
      controllerEntity: scene.getEntityByID(shipRecord.itemID) || null,
      nowMs: scene.getCurrentSimTimeMs(),
    }) || abandonedAny;
  }

  return abandonedAny;
}

function abandonFighterInSpace(scene, fighterEntity, options = {}) {
  if (!scene || !isFighterEntity(fighterEntity)) {
    return false;
  }

  const ownerSession =
    Object.prototype.hasOwnProperty.call(options, "ownerSession")
      ? options.ownerSession
      : resolveFighterControllerSession(
        fighterEntity,
        options.controllerEntity || null,
      );
  const tubeFlagID = toInt(fighterEntity.tubeFlagID, 0);
  if (typeof scene.stopShipEntity === "function" && options.stopMovement !== false) {
    scene.stopShipEntity(fighterEntity, {
      allowSessionOwned: true,
      broadcast: options.broadcastMovement !== false,
    });
  }
  fighterEntity.launcherID = null;
  fighterEntity.controllerID = null;
  fighterEntity.controllerOwnerID = 0;
  fighterEntity.tubeFlagID = null;
  clearEntityAbilityStates(fighterEntity);
  clearFighterCommandState(fighterEntity);
  syncFighterMobilityAbilityState(
    scene,
    fighterEntity,
    null,
    toNumber(
      options.nowMs,
      scene.getCurrentSimTimeMs && scene.getCurrentSimTimeMs(),
    ),
  );
  persistFighterEntityState(fighterEntity);
  if (options.notify !== false) {
    notifyFighterRemoved(ownerSession, fighterEntity.itemID, tubeFlagID);
    if (isFighterTubeFlag(tubeFlagID)) {
      notifyTubeState(ownerSession, tubeFlagID, TUBE_STATE_EMPTY);
    }
  }
  return true;
}

function handleControllerLost(scene, controllerEntity, options = {}) {
  if (!scene || !controllerEntity) {
    return {
      success: false,
      releasedCount: 0,
      recoveredCount: 0,
    };
  }

  const controllerID = toInt(controllerEntity.itemID, 0);
  if (controllerID <= 0) {
    return {
      success: false,
      releasedCount: 0,
      recoveredCount: 0,
    };
  }

  const ownerSession =
    Object.prototype.hasOwnProperty.call(options, "ownerSession")
      ? options.ownerSession
      : resolveFighterControllerSession(null, controllerEntity);
  const shipRecord =
    options.shipRecord ||
    findItemById(controllerID) ||
    null;
  let releasedCount = 0;
  let recoveredCount = 0;

  for (const fighterEntity of listControlledFighterEntities(scene, controllerID)) {
    if (
      options.attemptTubeRecovery === true &&
      shipRecord &&
      isFighterTubeFlag(fighterEntity.tubeFlagID) &&
      distance(fighterEntity.position, controllerEntity.position) <= FIGHTER_RECOVERY_DISTANCE_METERS
    ) {
      const landResult = landFighterToTube(scene, shipRecord, fighterEntity, ownerSession);
      if (landResult && landResult.success === true) {
        releasedCount += 1;
        recoveredCount += 1;
        continue;
      }
    }

    if (abandonFighterInSpace(scene, fighterEntity, {
      ...options,
      ownerSession,
      controllerEntity,
    })) {
      releasedCount += 1;
    }
  }

  return {
    success: true,
    releasedCount,
    recoveredCount,
  };
}

function scoopAbandonedFighterFromSpace(session, rawFighterID, rawToFlagID) {
  const shipState = getShipStateForSession(session);
  if (!shipState) {
    return false;
  }

  const { shipRecord, shipEntity, scene } = shipState;
  const fighterID = toInt(rawFighterID, 0);
  const toFlagID = toInt(rawToFlagID, ITEM_FLAGS.FIGHTER_BAY);
  const fighterEntity = scene.getEntityByID(fighterID);
  if (!isFighterEntity(fighterEntity)) {
    return false;
  }
  if (toInt(fighterEntity.controllerID, 0) > 0) {
    return false;
  }
  if (
    toFlagID !== ITEM_FLAGS.FIGHTER_BAY &&
    !isFighterTubeFlag(toFlagID)
  ) {
    return false;
  }
  if (
    isFighterTubeFlag(toFlagID) &&
    getShipTubeItem(shipRecord, toFlagID)
  ) {
    return false;
  }
  if (distance(fighterEntity.position, shipEntity.position) > FIGHTER_RECOVERY_DISTANCE_METERS) {
    return false;
  }

  const ownerSession = getOwnerSession(shipRecord, session);
  const removeResult = scene.removeDynamicEntity(fighterEntity.itemID, {
    broadcast: true,
  });
  if (!removeResult || !removeResult.success) {
    return false;
  }

  const updateResult = updateInventoryItem(fighterEntity.itemID, (currentItem) => ({
    ...currentItem,
    ownerID: toInt(shipRecord.ownerID, toInt(currentItem && currentItem.ownerID, 0)),
    locationID: shipRecord.itemID,
    flagID: toFlagID,
    launcherID: null,
    spaceState: null,
    fighterState: null,
  }));
  if (!updateResult.success) {
    return false;
  }

  const changes = [{
    item: updateResult.data,
    previousData: updateResult.previousData || {},
  }];
  if (toFlagID === ITEM_FLAGS.FIGHTER_BAY) {
    const mergeTarget = listContainerItems(
      toInt(shipRecord.ownerID, 0),
      shipRecord.itemID,
      ITEM_FLAGS.FIGHTER_BAY,
    ).find((item) => (
      toInt(item.itemID, 0) !== toInt(fighterEntity.itemID, 0) &&
      toInt(item.typeID, 0) === toInt(fighterEntity.typeID, 0) &&
      toInt(item.ownerID, 0) === toInt(shipRecord.ownerID, 0)
    ));
    if (mergeTarget) {
      const mergeResult = mergeItemStacks(fighterEntity.itemID, mergeTarget.itemID);
      if (mergeResult.success) {
        changes.push(...(mergeResult.data && mergeResult.data.changes || []));
      }
    }
  }

  syncInventoryChangesToSession(ownerSession, changes);
  if (isFighterTubeFlag(toFlagID)) {
    notifyTubeContent(ownerSession, toFlagID, updateResult.data);
    notifyTubeState(ownerSession, toFlagID, TUBE_STATE_READY);
  }
  return true;
}

function tickScene(scene, now) {
  const numericNow = toNumber(
    now,
    scene && typeof scene.getCurrentSimTimeMs === "function"
      ? scene.getCurrentSimTimeMs()
      : Date.now(),
  );

  for (const fighterEntity of getSceneFighterEntities(scene)) {
    const controllerID = toInt(fighterEntity.controllerID, 0);
    const controllerEntity = controllerID > 0 ? scene.getEntityByID(controllerID) : null;
    if (controllerID > 0 && !controllerEntity) {
      abandonFighterInSpace(scene, fighterEntity, {
        notify: true,
        stopMovement: true,
        nowMs: numericNow,
      });
      continue;
    }

    if (controllerEntity) {
      let abilityStateChanged = false;
      const ownerSession = findSessionByCharacterID(toInt(fighterEntity.controllerOwnerID, 0));
      syncFighterMobilityAbilityState(
        scene,
        fighterEntity,
        controllerEntity,
        numericNow,
      );
      for (const slotID of ABILITY_SLOT_IDS) {
        const persistedAbilityState = getEntityAbilityState(fighterEntity, slotID);
        if (!persistedAbilityState) {
          continue;
        }

        const abilityMeta =
          resolveFighterAbilitySnapshot(
            fighterEntity,
            controllerEntity,
            slotID,
          ) ||
          getFighterAbilityMetaForSlot(fighterEntity.typeID, slotID);
        if (!abilityMeta) {
          setEntityAbilityState(fighterEntity, slotID, null);
          syncFighterMobilityAbilityState(
            scene,
            fighterEntity,
            controllerEntity,
            numericNow,
          );
          abilityStateChanged = true;
          continue;
        }

        const previousStateSignature = JSON.stringify(persistedAbilityState || null);
        let abilityState = refreshAbilityCharges(
          fighterEntity,
          slotID,
          abilityMeta,
          numericNow,
        );
        if (JSON.stringify(abilityState || null) !== previousStateSignature) {
          abilityStateChanged = true;
        }
        if (!abilityState) {
          continue;
        }

        const isActive = toNumber(abilityState.activeUntilMs, 0) > numericNow;
        if (isActive) {
          continue;
        }

        if (toNumber(abilityState.activeUntilMs, 0) > 0) {
          const cycleResult =
            abilityMeta &&
            abilityMeta.isOffensive &&
            !isJammerAbilitySnapshot(abilityMeta)
            ? executeFighterOffensiveCycle(
              scene,
              fighterEntity,
              controllerEntity,
              slotID,
              abilityState,
              numericNow,
            )
            : executeFighterUtilityCycle(
              scene,
              fighterEntity,
              controllerEntity,
              slotID,
              abilityState,
              numericNow,
            );
          const nextState = {
            ...abilityState,
          };
          clearAbilityActiveWindow(nextState);
          if (cycleResult && cycleResult.continueActive === true) {
            nextState.activeSinceMs = numericNow;
            nextState.durationMs = getEffectiveAbilityDurationMs(abilityMeta);
            nextState.activeUntilMs = numericNow + getEffectiveAbilityDurationMs(abilityMeta);
            if (toInt(abilityState.targetID, 0) > 0) {
              nextState.targetID = toInt(abilityState.targetID, 0);
            }
            if (abilityState.targetPoint) {
              nextState.targetPoint = cloneVector(abilityState.targetPoint);
            }
          } else {
            notifyAbilityDeactivated(ownerSession, fighterEntity.itemID, slotID, null);
          }

          const maxChargeCount = getEffectiveAbilityChargeCount(abilityMeta);
          if (
            maxChargeCount !== null &&
            getAbilityStateChargeCount(nextState, abilityMeta) >= maxChargeCount &&
            toNumber(nextState.cooldownEndMs, 0) <= numericNow
          ) {
            delete nextState.remainingChargeCount;
            delete nextState.cooldownStartMs;
            delete nextState.cooldownEndMs;
          } else if (toNumber(nextState.cooldownEndMs, 0) <= numericNow) {
            delete nextState.cooldownStartMs;
            delete nextState.cooldownEndMs;
          }
          setEntityAbilityState(
            fighterEntity,
            slotID,
            Object.keys(nextState).length > 0 ? nextState : null,
          );
          if (isMobilityAbilitySnapshot(abilityMeta)) {
            syncFighterMobilityAbilityState(
              scene,
              fighterEntity,
              controllerEntity,
              numericNow,
            );
          }
          abilityStateChanged = true;
          continue;
        }

        const maxChargeCount = getEffectiveAbilityChargeCount(abilityMeta);
        if (
          maxChargeCount !== null &&
          getAbilityStateChargeCount(abilityState, abilityMeta) >= maxChargeCount &&
          toNumber(abilityState.cooldownEndMs, 0) <= numericNow
        ) {
          setEntityAbilityState(fighterEntity, slotID, null);
          abilityStateChanged = true;
        } else if (
          maxChargeCount === null &&
          toNumber(abilityState.cooldownEndMs, 0) <= numericNow
        ) {
          setEntityAbilityState(fighterEntity, slotID, null);
          abilityStateChanged = true;
        }
      }

      if (abilityStateChanged) {
        persistFighterEntityState(fighterEntity);
      }
    }

    if (fighterEntity.fighterCommand !== "RECALL_TUBE" || !controllerEntity) {
      continue;
    }

    if (distance(fighterEntity.position, controllerEntity.position) > FIGHTER_RECOVERY_DISTANCE_METERS) {
      continue;
    }

    const shipRecord = findItemById(controllerEntity.itemID);
    if (!shipRecord) {
      continue;
    }

    landFighterToTube(scene, shipRecord, fighterEntity, findSessionByCharacterID(
      toInt(shipRecord.ownerID, 0),
    ));
  }
}

module.exports = {
  FIGHTER_CATEGORY_ID,
  MOVEMENT_COMMAND_ORBIT,
  MOVEMENT_COMMAND_FOLLOW,
  MOVEMENT_COMMAND_STOP,
  MOVEMENT_COMMAND_GOTO_POINT,
  DEFAULT_FIGHTER_ORBIT_DISTANCE_METERS,
  FIGHTER_RECOVERY_DISTANCE_METERS,
  isFighterEntity,
  hydrateFighterEntityFromItem,
  applyDamageToFighterSquadron,
  handleFighterPostDamage,
  handleFighterDestroyed,
  buildFighterAbilitySlotStatesPayload,
  buildFightersInSpaceRowsForShip,
  buildAbilityStateEntriesForShip,
  launchFightersFromTubes,
  recallFightersToTubes,
  activateAbilitySlots,
  deactivateAbilitySlots,
  executeMovementCommandOnFighters,
  commandAbandonFighter,
  handleControllerLost,
  scoopAbandonedFighterFromSpace,
  tickScene,
};
