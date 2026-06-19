const path = require("path");
const { performance } = require("perf_hooks");

const {
  getControllerByEntityID,
  listControllersBySystem,
  unregisterController,
} = require(path.join(__dirname, "./npcRegistry"));
const {
  normalizeTargetClassList,
  isCharacterInvulnerable,
} = require(path.join(__dirname, "./npcControlState"));
const {
  getNpcWeaponModules,
  getNpcWeaponBankGroupForModule,
  getNpcHostileModules,
  getNpcAssistanceModules,
  getNpcSelfModules,
  getNpcSuperweaponModules,
  estimateNpcAssistanceEffectiveRange,
  estimateNpcHostileEffectiveRange,
  estimateNpcWeaponEffectiveRange,
  getNpcEntityMissileWeaponSource,
  getNpcPropulsionModules,
  PROPULSION_EFFECT_AFTERBURNER,
  PROPULSION_EFFECT_MICROWARPDRIVE,
} = require(path.join(__dirname, "./npcEquipment"));
const {
  resolveSyntheticChasePropulsionTemplate,
} = require(path.join(__dirname, "./npcHardwareCatalog"));
const {
  logNpcCombatDebug,
  summarizeNpcCombatEntity,
  summarizeNpcCombatModule,
} = require(path.join(__dirname, "./npcCombatDebug"));
const {
  syncCapitalNpcSystems,
} = require(path.join(__dirname, "./capitals/capitalNpcBehavior"));
const {
  syncCapitalNpcMovement,
  syncCapitalNpcReturnHome,
} = require(path.join(__dirname, "./capitals/capitalNpcMovement"));
const {
  resolveCapitalMovementDirective,
} = require(path.join(__dirname, "./capitals/capitalNpcDoctrine"));
const {
  resolveCapitalBehaviorTarget,
} = require(path.join(__dirname, "./capitals/capitalNpcTargeting"));
const {
  resolveCapitalEngagementPolicy,
} = require(path.join(__dirname, "./capitals/capitalNpcEngagement"));
const hostileModuleRuntime = require(path.join(
  __dirname,
  "../modules/hostileModuleRuntime",
));
const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));

const CAPSULE_GROUP_ID = 29;
const NPC_SYNTHETIC_PROPULSION_DURATION_MS = 60_000;
const NPC_COMBAT_PRESENTATION_HISTORY_LEAD = 2;
const NPC_COMBAT_PRESENTATION_PRESENTED_CLEAR_LEAD = 1;
const DRIFTER_FACTION_ID = 500024;
const TURBO_SHIELD_STATE_ACTIVE = 0;
const TURBO_SHIELD_STATE_INVULNERABLE = 1;
const TURBO_SHIELD_STATE_RESISTIVE = 2;
const TURBO_SHIELD_STATE_DEPLETED = 3;
const DRIFTER_SUPERWEAPON_SCAN_RESOLUTION = 10_000;
const DRIFTER_SUPERWEAPON_RETRY_MS = 1_000;
const DRIFTER_TARGET_SWITCH_INTERVAL_MS = 60_000;
const DRIFTER_TARGET_SWITCH_SCORE_MARGIN = 250;
const DRIFTER_RECENT_AGGRESSION_MEMORY_MS = 60_000;
const DRIFTER_GUARD_PRIORITY_BASE_SCORE = 900;
const DRIFTER_GUARD_PRIORITY_BONUS_SCORE = 900;
const DRIFTER_GUARD_PRIORITY_MIN_RADIUS_METERS = 15_000;
const DRIFTER_GUARD_ENTOSIS_PRIORITY_SCORE = 1_500;
const DRIFTER_PURSUIT_LOCATION_MEMORY_MS = 10_000;
const DRIFTER_PURSUIT_WARP_COOLDOWN_MS = 15_000;
const DRIFTER_REGROUP_WARP_COOLDOWN_MS = 15_000;
const DRIFTER_WARP_MIN_DISTANCE_METERS = 150_000;
const NPC_IDLE_ANCHOR_WARP_COOLDOWN_MS = 15_000;
const NPC_IDLE_ANCHOR_WARP_MIN_DISTANCE_METERS = 150_000;
const NPC_BEHAVIOR_MAX_CONTROLLERS_PER_TICK = 3;
const NPC_BEHAVIOR_TICK_BUDGET_MS = 2;
const NPC_INITIAL_MODULE_CYCLE_SPREAD_MS = 5000;
const NPC_STABLE_COMBAT_RESYNC_MS = 1_250;
const NPC_WEAPON_MAINTENANCE_MS = 2_500;
const NPC_HOSTILE_MAINTENANCE_MS = 3_000;
const NPC_SELF_MODULE_MAINTENANCE_MS = 5_000;
const NPC_ASSISTANCE_MAINTENANCE_MS = 2_000;

let npcRuntimeModule = null;
let nativeNpcServiceModule = null;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function getNpcInitialModuleCycleDelayMs(entity, moduleItem, salt = 0) {
  const entityID = toPositiveInt(entity && entity.itemID, 0);
  const moduleID = toPositiveInt(moduleItem && moduleItem.itemID, 0);
  const seed = (
    (entityID * 31) +
    (moduleID * 17) +
    (toPositiveInt(salt, 0) * 13)
  ) >>> 0;
  return 25 + (seed % NPC_INITIAL_MODULE_CYCLE_SPREAD_MS);
}

function getNpcMaintenanceJitterMs(entity, salt = 0, windowMs = 500) {
  const normalizedWindowMs = Math.max(0, toPositiveInt(windowMs, 0));
  if (normalizedWindowMs <= 0) {
    return 0;
  }
  const entityID = toPositiveInt(entity && entity.itemID, 0);
  const seed = (
    (entityID * 37) +
    (toPositiveInt(salt, 0) * 101)
  ) >>> 0;
  return seed % normalizedWindowMs;
}

function isNpcMaintenanceDue(controller, fieldName, now, intervalMs, entity, salt = 0) {
  if (!controller || !fieldName) {
    return true;
  }
  const normalizedIntervalMs = Math.max(0, toFiniteNumber(intervalMs, 0));
  if (normalizedIntervalMs <= 0) {
    controller[fieldName] = now;
    return true;
  }
  const lastSyncAtMs = toFiniteNumber(controller[fieldName], 0);
  if (lastSyncAtMs <= 0) {
    controller[fieldName] = now;
    return true;
  }
  const dueAtMs =
    lastSyncAtMs +
    normalizedIntervalMs +
    getNpcMaintenanceJitterMs(entity, salt, Math.min(750, normalizedIntervalMs));
  if (dueAtMs > now) {
    return false;
  }
  controller[fieldName] = now;
  return true;
}

function resetNpcCombatMaintenanceCadence(controller, targetID) {
  if (!controller || typeof controller !== "object") {
    return;
  }
  controller._npcCombatMaintenanceTargetID = toPositiveInt(targetID, 0);
  controller._lastNpcWeaponMaintenanceAtMs = 0;
  controller._lastNpcHostileMaintenanceAtMs = 0;
  controller._lastNpcSelfModuleMaintenanceAtMs = 0;
  controller._lastNpcAssistanceMaintenanceAtMs = 0;
}

function normalizeOrderType(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function distance(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
  const length = Math.sqrt(
    (resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2),
  );
  if (!Number.isFinite(length) || length <= 0) {
    return { ...fallback };
  }
  return {
    x: resolved.x / length,
    y: resolved.y / length,
    z: resolved.z / length,
  };
}

function isDirectionChangeSignificant(left, right) {
  if (!left || !right) {
    return true;
  }

  const leftLength = Math.sqrt((left.x ** 2) + (left.y ** 2) + (left.z ** 2));
  const rightLength = Math.sqrt((right.x ** 2) + (right.y ** 2) + (right.z ** 2));
  if (leftLength <= 0 || rightLength <= 0) {
    return true;
  }

  const dot = (
    ((left.x * right.x) + (left.y * right.y) + (left.z * right.z)) /
    (leftLength * rightLength)
  );
  return dot < 0.995;
}

function getSurfaceDistance(left, right) {
  return Math.max(
    0,
    distance(left && left.position, right && right.position) -
      toFiniteNumber(left && left.radius, 0) -
      toFiniteNumber(right && right.radius, 0),
  );
}

function buildNpcSyntheticPropulsionBroadcastOptions() {
  return {
    avoidCurrentHistoryInsertion: true,
    minimumHistoryLeadFloor: NPC_COMBAT_PRESENTATION_PRESENTED_CLEAR_LEAD,
    minimumLeadFromCurrentHistory: NPC_COMBAT_PRESENTATION_PRESENTED_CLEAR_LEAD,
    maximumLeadFromCurrentHistory: NPC_COMBAT_PRESENTATION_PRESENTED_CLEAR_LEAD,
    maximumHistorySafeLeadOverride: NPC_COMBAT_PRESENTATION_HISTORY_LEAD,
    historyLeadUsesPresentedSessionStamp: true,
    historyLeadPresentedMaximumFutureLead:
      NPC_COMBAT_PRESENTATION_PRESENTED_CLEAR_LEAD,
  };
}

function buildNpcSyntheticPropulsionFxOptions(baseOptions = {}) {
  return {
    ...baseOptions,
    useCurrentStamp: true,
    avoidCurrentHistoryInsertion: true,
    minimumHistoryLeadFloor: NPC_COMBAT_PRESENTATION_PRESENTED_CLEAR_LEAD,
    minimumLeadFromCurrentHistory: Math.max(
      toPositiveInt(baseOptions.minimumLeadFromCurrentHistory, 0),
      NPC_COMBAT_PRESENTATION_PRESENTED_CLEAR_LEAD,
    ),
    maximumLeadFromCurrentHistory: Math.max(
      toPositiveInt(baseOptions.maximumLeadFromCurrentHistory, 0),
      NPC_COMBAT_PRESENTATION_PRESENTED_CLEAR_LEAD,
    ),
    maximumHistorySafeLeadOverride: Math.max(
      toPositiveInt(baseOptions.maximumHistorySafeLeadOverride, 0),
      NPC_COMBAT_PRESENTATION_HISTORY_LEAD,
    ),
    historyLeadUsesPresentedSessionStamp: true,
    historyLeadPresentedMaximumFutureLead:
      NPC_COMBAT_PRESENTATION_PRESENTED_CLEAR_LEAD,
  };
}

function buildNpcPseudoSession(entity) {
  const pilotCharacterID = toPositiveInt(
    entity && (
      entity.pilotCharacterID ??
      entity.characterID
    ),
    0,
  );
  return {
    characterID: pilotCharacterID,
    corporationID: toPositiveInt(entity && entity.corporationID, 0),
    allianceID: toPositiveInt(entity && entity.allianceID, 0),
    _space: {
      systemID: toPositiveInt(entity && entity.systemID, 0),
      shipID: toPositiveInt(entity && entity.itemID, 0),
    },
  };
}

function getNpcRuntime() {
  if (!npcRuntimeModule) {
    npcRuntimeModule = require(path.join(__dirname, "./npcRuntime"));
  }
  return npcRuntimeModule;
}

function getNativeNpcService() {
  if (!nativeNpcServiceModule) {
    nativeNpcServiceModule = require(path.join(__dirname, "./nativeNpcService"));
  }
  return nativeNpcServiceModule;
}

function clonePlainValue(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function isDrifterNpcEntity(entity, behaviorProfile = null) {
  if (!entity || entity.kind !== "ship" || entity.nativeNpc !== true) {
    return false;
  }
  if (behaviorProfile && behaviorProfile.drifterBehavior === true) {
    return true;
  }
  return toPositiveInt(entity && entity.factionID, 0) === DRIFTER_FACTION_ID;
}

function isDrifterEntosisPriorityEnabled(behaviorProfile = null) {
  return !behaviorProfile || behaviorProfile.drifterEnableEntosisPriority !== false;
}

function isDrifterPursuitWarpEnabled(behaviorProfile = null) {
  return !behaviorProfile || behaviorProfile.drifterEnablePursuitWarp !== false;
}

function isDrifterPackRegroupEnabled(behaviorProfile = null) {
  return !behaviorProfile || behaviorProfile.drifterEnablePackRegroup !== false;
}

function isDrifterReinforcementEnabled(behaviorProfile = null) {
  return !behaviorProfile || behaviorProfile.drifterEnableReinforcements !== false;
}

function getDrifterSuperweaponCycleMs(entity) {
  return Math.max(
    1_000,
    toFiniteNumber(
      getTypeAttributeValue(
        toPositiveInt(entity && entity.typeID, 0),
        "entitySuperWeaponDuration",
      ),
      5_000,
    ),
  );
}

function ensureDrifterCombatState(controller, entity, scene, nowMs) {
  if (!controller || !entity) {
    return null;
  }
  if (!controller.drifterCombatState || typeof controller.drifterCombatState !== "object") {
    controller.drifterCombatState = {};
  }
  const state = controller.drifterCombatState;
  if (!Number.isFinite(Number(state.baseScanResolution)) || Number(state.baseScanResolution) <= 0) {
    state.baseScanResolution = Math.max(
      1,
      toFiniteNumber(
        entity.scanResolution,
        entity.passiveDerivedState && entity.passiveDerivedState.scanResolution,
      ),
    );
  }
  if (!Number.isFinite(Number(state.baseMaxTargetRange)) || Number(state.baseMaxTargetRange) <= 0) {
    state.baseMaxTargetRange = Math.max(
      0,
      toFiniteNumber(
        entity.maxTargetRange,
        entity.passiveDerivedState && entity.passiveDerivedState.maxTargetRange,
      ),
    );
  }
  if (
    state.waitingForTurboShieldResistive !== true &&
    (!Number.isFinite(Number(state.nextSuperweaponReadyAtMs)) || Number(state.nextSuperweaponReadyAtMs) <= 0)
  ) {
    state.nextSuperweaponReadyAtMs = toFiniteNumber(nowMs, Date.now()) + getDrifterSuperweaponCycleMs(entity);
  }
  if (!Object.prototype.hasOwnProperty.call(state, "turboShieldState")) {
    state.turboShieldState = TURBO_SHIELD_STATE_ACTIVE;
  }
  if (
    scene &&
    (
      entity.component_turboshield === undefined ||
      entity.component_turboshield === null
    )
  ) {
    entity.component_turboshield = TURBO_SHIELD_STATE_ACTIVE;
  }
  return state;
}

function setNpcScanResolutionOverride(entity, nextScanResolution) {
  if (!entity || entity.kind !== "ship") {
    return;
  }
  const resolvedScanResolution = Math.max(1, toFiniteNumber(nextScanResolution, 1));
  if (Math.abs(toFiniteNumber(entity.scanResolution, 0) - resolvedScanResolution) <= 1e-6) {
    return;
  }
  entity.scanResolution = resolvedScanResolution;
  if (entity.passiveDerivedState && typeof entity.passiveDerivedState === "object") {
    entity.passiveDerivedState.scanResolution = resolvedScanResolution;
  }
}

function setNpcTurboShieldState(scene, entity, state, drifterState = null) {
  const resolvedNumericState = Math.trunc(Number(state));
  const resolvedState =
    Number.isFinite(resolvedNumericState)
      ? Math.max(
          TURBO_SHIELD_STATE_ACTIVE,
          Math.min(TURBO_SHIELD_STATE_DEPLETED, resolvedNumericState),
        )
      : TURBO_SHIELD_STATE_ACTIVE;
  if (drifterState && drifterState.turboShieldState === resolvedState) {
    return false;
  }
  const previousState = Number.isFinite(Number(entity && entity.component_turboshield))
    ? Math.trunc(Number(entity && entity.component_turboshield))
    : -1;
  if (drifterState) {
    drifterState.turboShieldState = resolvedState;
  }
  entity.component_turboshield = resolvedState;
  if (scene && previousState !== resolvedState) {
    scene.broadcastSlimItemChanges([entity]);
  }
  return previousState !== resolvedState;
}

function resetDrifterCombatState(scene, entity, controller, nowMs = Date.now()) {
  if (!controller || !controller.drifterCombatState || !entity) {
    return;
  }
  const drifterState = controller.drifterCombatState;
  setNpcScanResolutionOverride(
    entity,
    toFiniteNumber(drifterState.baseScanResolution, entity && entity.scanResolution),
  );
  setNpcTurboShieldState(
    scene,
    entity,
    TURBO_SHIELD_STATE_ACTIVE,
    drifterState,
  );
  drifterState.superweaponReady = false;
  drifterState.waitingForTurboShieldResistive = false;
  drifterState.lastSuperweaponTargetID = 0;
  drifterState.pendingPoddingOwnerID = 0;
  drifterState.nextSuperweaponReadyAtMs = toFiniteNumber(nowMs, Date.now()) + getDrifterSuperweaponCycleMs(entity);
}

function resolveDrifterPendingPoddingOwnerID(controller) {
  return toPositiveInt(
    controller &&
      controller.drifterCombatState &&
      controller.drifterCombatState.pendingPoddingOwnerID,
    0,
  );
}

function resolveDrifterPackGroupKey(controller) {
  const groupedFields = [
    "startupRuleID",
    "spawnSiteID",
    "spawnGroupID",
    "selectionID",
    "operatorKind",
  ];
  for (const field of groupedFields) {
    const normalizedValue = String(controller && controller[field] || "").trim();
    if (normalizedValue) {
      return `${field}:${normalizedValue}`;
    }
  }
  return "";
}

function isSameDrifterPack(sourceController, candidateController, sourceEntity, candidateEntity) {
  if (
    !sourceController ||
    !candidateController ||
    sourceController.entityID === candidateController.entityID
  ) {
    return false;
  }

  const sourceGroupKey = resolveDrifterPackGroupKey(sourceController);
  const candidateGroupKey = resolveDrifterPackGroupKey(candidateController);
  if (sourceGroupKey && candidateGroupKey) {
    return sourceGroupKey === candidateGroupKey;
  }
  if (sourceGroupKey || candidateGroupKey) {
    return false;
  }

  const sourceFactionID = toPositiveInt(sourceEntity && sourceEntity.factionID, 0);
  const candidateFactionID = toPositiveInt(candidateEntity && candidateEntity.factionID, 0);
  if (
    sourceFactionID > 0 &&
    candidateFactionID > 0 &&
    sourceFactionID === candidateFactionID
  ) {
    return true;
  }

  const sourceCorporationID = toPositiveInt(sourceEntity && sourceEntity.corporationID, 0);
  const candidateCorporationID = toPositiveInt(candidateEntity && candidateEntity.corporationID, 0);
  return (
    sourceCorporationID > 0 &&
    candidateCorporationID > 0 &&
    sourceCorporationID === candidateCorporationID
  );
}

function listDrifterPackMembers(scene, controller, entity) {
  if (!scene || !controller || !entity) {
    return [];
  }

  const members = [{
    controller,
    entity,
  }];
  for (const candidateController of listControllersBySystem(scene.systemID)) {
    const candidateEntityID = toPositiveInt(candidateController && candidateController.entityID, 0);
    if (!candidateEntityID || candidateEntityID === toPositiveInt(entity && entity.itemID, 0)) {
      continue;
    }
    const candidateEntity = scene.getEntityByID(candidateEntityID);
    if (
      !candidateEntity ||
      !isDrifterNpcEntity(
        candidateEntity,
        resolveEffectiveBehaviorProfile(candidateController),
      ) ||
      !isSameDrifterPack(controller, candidateController, entity, candidateEntity)
    ) {
      continue;
    }
    members.push({
      controller: candidateController,
      entity: candidateEntity,
    });
  }

  return members.sort((left, right) => (
    toPositiveInt(left && left.entity && left.entity.itemID, 0) -
    toPositiveInt(right && right.entity && right.entity.itemID, 0)
  ));
}

function buildDrifterReinforcementGroup(scene, controller, entity) {
  const members = listDrifterPackMembers(scene, controller, entity);
  return members.length > 0
    ? members
    : [{
      controller,
      entity,
    }];
}

function getRecentDrifterReinforcementRequestAtMs(scene, controller, entity) {
  let latestRequestAtMs = 0;
  for (const member of buildDrifterReinforcementGroup(scene, controller, entity)) {
    latestRequestAtMs = Math.max(
      latestRequestAtMs,
      toFiniteNumber(
        member &&
          member.controller &&
          member.controller.drifterCombatState &&
          member.controller.drifterCombatState.lastReinforcementRequestAtMs,
        0,
      ),
    );
  }
  return latestRequestAtMs;
}

function propagateDrifterReinforcementRequestState(scene, controller, entity, nowMs) {
  for (const member of buildDrifterReinforcementGroup(scene, controller, entity)) {
    const memberController = member && member.controller;
    const memberEntity = member && member.entity;
    if (!memberController || !memberEntity) {
      continue;
    }
    const memberState = ensureDrifterCombatState(
      memberController,
      memberEntity,
      scene,
      nowMs,
    );
    if (!memberState) {
      continue;
    }
    memberState.lastReinforcementRequestAtMs = nowMs;
  }
}

function maybeRequestDrifterReinforcements(scene, entity, controller, behaviorProfile, targetEntity, nowMs) {
  if (
    !scene ||
    !entity ||
    !controller ||
    !targetEntity ||
    !isDrifterNpcEntity(entity, behaviorProfile) ||
    !isDrifterReinforcementEnabled(behaviorProfile)
  ) {
    return {
      requested: false,
    };
  }

  const reinforcementDefinitions = Array.isArray(
    behaviorProfile && behaviorProfile.reinforcementDefinitions,
  )
    ? behaviorProfile.reinforcementDefinitions.filter((definition) => (
      definition &&
      definition.profile &&
      definition.behaviorProfile
    ))
    : [];
  if (reinforcementDefinitions.length <= 0) {
    return {
      requested: false,
    };
  }

  const recentAggressionWindowMs = Math.max(
    1_000,
    toFiniteNumber(
      behaviorProfile && behaviorProfile.reinforcementAggressionWindowMs,
      15_000,
    ),
  );
  const lastAggressedAtMs = toFiniteNumber(controller && controller.lastAggressedAtMs, 0);
  if (
    lastAggressedAtMs <= 0 ||
    (nowMs - lastAggressedAtMs) > recentAggressionWindowMs
  ) {
    return {
      requested: false,
    };
  }

  const cooldownMs = Math.max(
    1_000,
    toFiniteNumber(
      behaviorProfile && behaviorProfile.reinforcementCooldownMs,
      60_000,
    ),
  );
  const lastPackRequestAtMs = getRecentDrifterReinforcementRequestAtMs(
    scene,
    controller,
    entity,
  );
  if (
    lastPackRequestAtMs > 0 &&
    (nowMs - lastPackRequestAtMs) < cooldownMs
  ) {
    return {
      requested: false,
    };
  }

  const drifterState = ensureDrifterCombatState(controller, entity, scene, nowMs);
  if (!drifterState) {
    return {
      requested: false,
    };
  }
  const maxCalls = Math.max(
    1,
    toPositiveInt(
      behaviorProfile && behaviorProfile.maxReinforcementCalls,
      1,
    ),
  );
  if (toPositiveInt(drifterState.reinforcementRequestCount, 0) >= maxCalls) {
    return {
      requested: false,
    };
  }

  const targetID = toPositiveInt(targetEntity && targetEntity.itemID, 0);
  if (targetID <= 0) {
    return {
      requested: false,
    };
  }

  const selectionKind = String(
    controller.selectionKind ||
      behaviorProfile && behaviorProfile.reinforcementSelectionKind ||
      "reinforcement",
  ).trim() || "reinforcement";
  const selectionID = String(
    controller.selectionID ||
      behaviorProfile && behaviorProfile.reinforcementSelectionID ||
      `drifter-reinforcement:${toPositiveInt(entity && entity.itemID, 0)}`,
  ).trim();
  const selectionName = String(
    controller.selectionName ||
      behaviorProfile && behaviorProfile.reinforcementSelectionName ||
      "Drifter Reinforcements",
  ).trim() || "Drifter Reinforcements";

  const spawnResult = getNativeNpcService().spawnNativeDefinitionsInContext(
    {
      systemID: toPositiveInt(entity && entity.systemID, 0),
      scene,
      anchorEntity: targetEntity,
      preferredTargetID: targetID,
      anchorKind: "ship",
      anchorLabel: String(
        targetEntity && (
          targetEntity.itemName ||
          targetEntity.slimName
        ) || "Ship",
      ),
    },
    {
      data: {
        selectionKind,
        selectionID,
        selectionName,
        definitions: clonePlainValue(reinforcementDefinitions),
      },
      suggestions: [],
    },
    {
      transient: entity.transient === true,
      operatorKind: String(controller.operatorKind || "").trim() || "drifterspawn",
      preferredTargetID: targetID,
      runtimeKind: "nativeCombat",
      behaviorOverrides: {
        movementMode: "hold",
        autoAggro: true,
        targetPreference: "preferredTargetThenNearestPlayer",
        aggressionRangeMeters: Math.max(
          250_000,
          toFiniteNumber(behaviorProfile && behaviorProfile.aggressionRangeMeters, 0),
        ),
        autoActivateWeapons: true,
        returnToHomeWhenIdle: false,
        useChasePropulsion: false,
        drifterBehavior: true,
      },
      skipInitialBehaviorTick: true,
      spawnDistanceMeters: Math.max(
        5_000,
        toFiniteNumber(
          behaviorProfile && behaviorProfile.reinforcementSpawnDistanceMeters,
          35_000,
        ),
      ),
      formationSpacingMeters: Math.max(
        250,
        toFiniteNumber(
          behaviorProfile && behaviorProfile.reinforcementFormationSpacingMeters,
          1_500,
        ),
      ),
      selectionKind,
      selectionID,
      selectionName,
      anchorKind: "ship",
      anchorName: String(
        targetEntity && (
          targetEntity.itemName ||
          targetEntity.slimName
        ) || "Ship",
      ),
      anchorID: targetID,
    },
  );
  if (!(spawnResult && spawnResult.success)) {
    return {
      requested: false,
      errorMsg: spawnResult && spawnResult.errorMsg
        ? String(spawnResult.errorMsg)
        : "NPC_NATIVE_SPAWN_FAILED",
    };
  }

  drifterState.reinforcementRequestCount =
    toPositiveInt(drifterState.reinforcementRequestCount, 0) + 1;
  drifterState.lastReinforcementTargetID = targetID;
  propagateDrifterReinforcementRequestState(scene, controller, entity, nowMs);

  return {
    requested: true,
    spawnedCount:
      spawnResult &&
      spawnResult.data &&
      Array.isArray(spawnResult.data.spawned)
        ? spawnResult.data.spawned.length
        : 0,
  };
}

function resolveDrifterPackLeader(scene, controller, entity) {
  const members = listDrifterPackMembers(scene, controller, entity);
  return members[0] || null;
}

function resolveDrifterPursuitPoint(targetEntity) {
  if (!targetEntity) {
    return null;
  }
  if (
    targetEntity.warpState &&
    typeof targetEntity.warpState === "object" &&
    targetEntity.warpState.targetPoint
  ) {
    return cloneVector(targetEntity.warpState.targetPoint, targetEntity.position);
  }
  if (targetEntity.targetPoint && typeof targetEntity.targetPoint === "object") {
    return cloneVector(targetEntity.targetPoint, targetEntity.position);
  }
  if (targetEntity.position && typeof targetEntity.position === "object") {
    return cloneVector(targetEntity.position);
  }
  return null;
}

function publishDrifterPursuitLocation(scene, entity, controller, targetEntity, nowMs) {
  const behaviorProfile = resolveEffectiveBehaviorProfile(controller);
  if (
    !scene ||
    !entity ||
    !controller ||
    !targetEntity ||
    !isDrifterNpcEntity(entity, behaviorProfile) ||
    !isDrifterPursuitWarpEnabled(behaviorProfile)
  ) {
    return;
  }

  const pursuitPoint = resolveDrifterPursuitPoint(targetEntity);
  if (!pursuitPoint) {
    return;
  }

  for (const member of listDrifterPackMembers(scene, controller, entity)) {
    const memberController = member && member.controller;
    const memberEntity = member && member.entity;
    if (!memberController || !memberEntity) {
      continue;
    }

    const drifterState = ensureDrifterCombatState(
      memberController,
      memberEntity,
      scene,
      nowMs,
    );
    if (!drifterState) {
      continue;
    }

    drifterState.lastPursuitPosition = pursuitPoint;
    drifterState.lastPursuitTargetID = toPositiveInt(targetEntity.itemID, 0);
    drifterState.lastPursuitPostedAtMs = nowMs;
    if (
      memberController.entityID !== controller.entityID &&
      toFiniteNumber(memberController.nextThinkAtMs, Number.MAX_SAFE_INTEGER) > nowMs
    ) {
      memberController.nextThinkAtMs = nowMs;
    }
  }
}

function clearDrifterCombatTravelState(drifterState) {
  if (!drifterState || typeof drifterState !== "object") {
    return;
  }
  drifterState.lastPursuitTargetID = 0;
  drifterState.lastPursuitPostedAtMs = 0;
  drifterState.lastPursuitPosition = null;
}

function beginNpcWarpToPoint(scene, entity, controller, destination, options = {}) {
  if (
    !scene ||
    !entity ||
    !controller ||
    !destination ||
    hostileModuleRuntime.isEntityWarpScrambled(entity) === true
  ) {
    return {
      success: false,
      handled: false,
      nextThinkAtMs: null,
    };
  }

  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const stateObject =
    options.stateObject && typeof options.stateObject === "object"
      ? options.stateObject
      : controller;
  const cooldownField = String(options.cooldownField || "").trim();
  const cooldownMs = Math.max(0, toFiniteNumber(options.cooldownMs, 0));
  const lastWarpAtMs = Math.max(
    0,
    toFiniteNumber(
      cooldownField && stateObject
        ? stateObject[cooldownField]
        : 0,
      0,
    ),
  );
  if (lastWarpAtMs > 0 && (nowMs - lastWarpAtMs) < cooldownMs) {
    return {
      success: false,
      handled: true,
      nextThinkAtMs: lastWarpAtMs + cooldownMs,
    };
  }

  if (entity.mode === "WARP" || entity.pendingWarp || entity.warpState) {
    return {
      success: true,
      handled: true,
      nextThinkAtMs: Math.max(
        nowMs + 1_000,
        toFiniteNumber(controller.nextThinkAtMs, nowMs + 1_000),
      ),
    };
  }

  deactivateNpcWeapons(scene, entity);
  deactivateNpcPropulsion(scene, entity);
  clearNpcTargetLocks(scene, entity);
  stopNpcMovement(scene, entity);

  const warpResult = getNpcRuntime().warpToPoint(
    entity.itemID,
    destination,
    {
      forceImmediateStart: true,
      broadcastWarpStartToVisibleSessions: true,
    },
  );
  if (!(warpResult && warpResult.success)) {
    return {
      success: false,
      handled: false,
      nextThinkAtMs: null,
    };
  }

  if (cooldownField && stateObject && typeof stateObject === "object") {
    stateObject[cooldownField] = nowMs;
  }
  return {
    success: true,
    handled: true,
    nextThinkAtMs: toFiniteNumber(
      warpResult &&
      warpResult.data &&
      warpResult.data.ingressCompleteAtMs,
      nowMs + cooldownMs,
    ),
  };
}

function beginDrifterWarp(scene, entity, controller, destination, cooldownField, nowMs) {
  const drifterState = ensureDrifterCombatState(controller, entity, scene, nowMs);
  if (!drifterState) {
    return {
      success: false,
      handled: false,
      nextThinkAtMs: null,
    };
  }

  const cooldownMs =
    cooldownField === "lastRegroupWarpAtMs"
      ? DRIFTER_REGROUP_WARP_COOLDOWN_MS
      : DRIFTER_PURSUIT_WARP_COOLDOWN_MS;
  return beginNpcWarpToPoint(
    scene,
    entity,
    controller,
    destination,
    {
      stateObject: drifterState,
      cooldownField,
      cooldownMs,
      nowMs,
    },
  );
}

function tryDrifterPursuitOrRegroup(scene, entity, controller, behaviorProfile, nowMs) {
  if (!isDrifterNpcEntity(entity, behaviorProfile)) {
    return {
      handled: false,
      nextThinkAtMs: null,
    };
  }

  const drifterState = ensureDrifterCombatState(controller, entity, scene, nowMs);
  if (!drifterState) {
    return {
      handled: false,
      nextThinkAtMs: null,
    };
  }

  const lastPursuitPostedAtMs = Math.max(
    0,
    toFiniteNumber(drifterState.lastPursuitPostedAtMs, 0),
  );
  const pursuitEnabled = isDrifterPursuitWarpEnabled(behaviorProfile);
  const regroupEnabled = isDrifterPackRegroupEnabled(behaviorProfile);
  const pursuitPosition =
    drifterState.lastPursuitPosition &&
    typeof drifterState.lastPursuitPosition === "object"
      ? drifterState.lastPursuitPosition
      : null;
  if (
    pursuitEnabled &&
    pursuitPosition &&
    lastPursuitPostedAtMs > 0 &&
    (nowMs - lastPursuitPostedAtMs) <= DRIFTER_PURSUIT_LOCATION_MEMORY_MS &&
    distance(entity.position, pursuitPosition) > DRIFTER_WARP_MIN_DISTANCE_METERS
  ) {
    return beginDrifterWarp(
      scene,
      entity,
      controller,
      pursuitPosition,
      "lastPursuitWarpAtMs",
      nowMs,
    );
  }

  const leader = resolveDrifterPackLeader(scene, controller, entity);
  const leaderEntity = leader && leader.entity;
  if (
    regroupEnabled &&
    leader &&
    leaderEntity &&
    toPositiveInt(leaderEntity.itemID, 0) !== toPositiveInt(entity.itemID, 0) &&
    entity.bubbleID &&
    leaderEntity.bubbleID &&
    entity.bubbleID !== leaderEntity.bubbleID
  ) {
    const regroupDestination = resolveDrifterPursuitPoint(leaderEntity);
    if (
      regroupDestination &&
      distance(entity.position, regroupDestination) > DRIFTER_WARP_MIN_DISTANCE_METERS
    ) {
      return beginDrifterWarp(
        scene,
        entity,
        controller,
        regroupDestination,
        "lastRegroupWarpAtMs",
        nowMs,
      );
    }
  }

  return {
    handled: false,
    nextThinkAtMs: null,
  };
}

function activateNpcHostileModuleOnTarget(scene, entity, moduleEntry, targetEntity) {
  if (!scene || !entity || !moduleEntry || !moduleEntry.moduleItem || !targetEntity) {
    return false;
  }
  const pseudoSession = buildNpcPseudoSession(entity);
  const moduleItem = moduleEntry.moduleItem;
  const activeEffect = entity.activeModuleEffects instanceof Map
    ? entity.activeModuleEffects.get(toPositiveInt(moduleItem.itemID, 0)) || null
    : null;
  if (activeEffect && toPositiveInt(activeEffect.targetID, 0) === toPositiveInt(targetEntity.itemID, 0)) {
    return true;
  }
  if (activeEffect) {
    scene.deactivateGenericModule(pseudoSession, moduleItem.itemID, {
      reason: "npc",
      deferUntilCycle: false,
    });
  }
  const activationResult = scene.activateGenericModule(
    pseudoSession,
    moduleItem,
    moduleEntry.effectName || null,
    {
      targetID: targetEntity.itemID,
    },
  );
  return Boolean(activationResult && activationResult.success);
}

function syncDrifterCombatSystems(scene, entity, controller, behaviorProfile, targetEntity, options = {}) {
  if (
    !scene ||
    !entity ||
    !controller ||
    !targetEntity ||
    !isDrifterNpcEntity(entity, behaviorProfile)
  ) {
    return {
      forceMaintainLock: false,
      suppressWeapons: false,
      suppressHostiles: false,
      nextThinkOverrideMs: null,
      preservedModuleIDs: [],
    };
  }

  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  maybeRequestDrifterReinforcements(
    scene,
    entity,
    controller,
    behaviorProfile,
    targetEntity,
    nowMs,
  );

  const superweaponModule = getNpcSuperweaponModules(entity)[0] || null;
  if (!superweaponModule) {
    return {
      forceMaintainLock: false,
      suppressWeapons: false,
      suppressHostiles: false,
      nextThinkOverrideMs: null,
      preservedModuleIDs: [],
    };
  }

  const drifterState = ensureDrifterCombatState(controller, entity, scene, nowMs);
  if (!drifterState) {
    return {
      forceMaintainLock: false,
      suppressWeapons: false,
      suppressHostiles: false,
      nextThinkOverrideMs: null,
      preservedModuleIDs: [],
    };
  }

  const cycleMs = getDrifterSuperweaponCycleMs(entity);
  const activeSuperweaponEffect = entity.activeModuleEffects instanceof Map
    ? entity.activeModuleEffects.get(toPositiveInt(superweaponModule.itemID, 0)) || null
    : null;
  const scrambleEntry = getNpcHostileModules(entity).find((entry) => {
    const effectName = String(entry && entry.effectName || "").trim().toLowerCase();
    return effectName === "warpscrambleforentity" || effectName === "behaviorwarpscramble";
  }) || null;
  const scrambleModuleID = toPositiveInt(
    scrambleEntry && scrambleEntry.moduleItem && scrambleEntry.moduleItem.itemID,
    0,
  );
  if (activeSuperweaponEffect) {
    setNpcTurboShieldState(scene, entity, TURBO_SHIELD_STATE_ACTIVE, drifterState);
    drifterState.superweaponReady = false;
    drifterState.waitingForTurboShieldResistive = true;
    drifterState.nextSuperweaponReadyAtMs = 0;
    setNpcScanResolutionOverride(entity, drifterState.baseScanResolution);
    stopNpcMovement(scene, entity);
    if (scrambleEntry) {
      activateNpcHostileModuleOnTarget(scene, entity, scrambleEntry, targetEntity);
    }
    deactivateNpcWeapons(scene, entity, {
      excludeModuleIDs: scrambleModuleID > 0 ? [scrambleModuleID] : [],
    });
    return {
      forceMaintainLock: true,
      suppressWeapons: true,
      suppressHostiles: true,
      nextThinkOverrideMs: Math.max(
        nowMs + 50,
        toFiniteNumber(
          activeSuperweaponEffect.deactivateAtMs,
          activeSuperweaponEffect.nextCycleAtMs,
        ),
      ),
      preservedModuleIDs: scrambleModuleID > 0 ? [scrambleModuleID] : [],
    };
  }

  const waitingForShieldRearm = drifterState.waitingForTurboShieldResistive === true;
  const currentTurboShieldState = Number.isFinite(Number(entity && entity.component_turboshield))
    ? Math.trunc(Number(entity && entity.component_turboshield))
    : Math.trunc(Number(drifterState.turboShieldState));
  const superweaponReady = waitingForShieldRearm
    ? currentTurboShieldState === TURBO_SHIELD_STATE_RESISTIVE
    : toFiniteNumber(drifterState.nextSuperweaponReadyAtMs, 0) <= nowMs;
  drifterState.superweaponReady = superweaponReady;
  if (superweaponReady) {
    drifterState.waitingForTurboShieldResistive = false;
    setNpcTurboShieldState(scene, entity, TURBO_SHIELD_STATE_RESISTIVE, drifterState);
    setNpcScanResolutionOverride(
      entity,
      Math.max(
        toFiniteNumber(drifterState.baseScanResolution, 0),
        DRIFTER_SUPERWEAPON_SCAN_RESOLUTION,
      ),
    );
  } else if (!waitingForShieldRearm) {
    setNpcTurboShieldState(scene, entity, TURBO_SHIELD_STATE_ACTIVE, drifterState);
    setNpcScanResolutionOverride(entity, drifterState.baseScanResolution);
  } else {
    setNpcScanResolutionOverride(entity, drifterState.baseScanResolution);
  }

  if (!superweaponReady) {
    return {
      forceMaintainLock: false,
      suppressWeapons: false,
      suppressHostiles: false,
      nextThinkOverrideMs: waitingForShieldRearm
        ? null
        : toFiniteNumber(drifterState.nextSuperweaponReadyAtMs, null),
      preservedModuleIDs: [],
    };
  }

  const lockedTargets = scene.getTargetsForEntity(entity);
  const pendingTargetLocks = scene.getSortedPendingTargetLocks(entity);
  const hasDesiredLock = lockedTargets.includes(targetEntity.itemID);
  const pendingLock = pendingTargetLocks.find(
    (entry) => toPositiveInt(entry && entry.targetID, 0) === toPositiveInt(targetEntity.itemID, 0),
  ) || null;
  if (!hasDesiredLock) {
    return {
      forceMaintainLock: true,
      suppressWeapons: false,
      suppressHostiles: false,
      nextThinkOverrideMs: pendingLock
        ? toFiniteNumber(pendingLock.completeAtMs, null)
        : nowMs + DRIFTER_SUPERWEAPON_RETRY_MS,
      preservedModuleIDs: [],
    };
  }

  if (scrambleEntry) {
    activateNpcHostileModuleOnTarget(scene, entity, scrambleEntry, targetEntity);
  }

  deactivateNpcWeapons(scene, entity, {
    excludeModuleIDs: scrambleModuleID > 0 ? [scrambleModuleID] : [],
  });
  stopNpcMovement(scene, entity);

  const activationResult = scene.activateGenericModule(
    buildNpcPseudoSession(entity),
    superweaponModule,
    String(superweaponModule.npcEffectName || "").trim() || null,
    {
      targetID: targetEntity.itemID,
    },
  );
  if (!(activationResult && activationResult.success)) {
    return {
      forceMaintainLock: true,
      suppressWeapons: true,
      suppressHostiles: true,
      nextThinkOverrideMs: nowMs + DRIFTER_SUPERWEAPON_RETRY_MS,
      preservedModuleIDs: scrambleModuleID > 0 ? [scrambleModuleID] : [],
    };
  }

  drifterState.superweaponReady = false;
  drifterState.waitingForTurboShieldResistive = true;
  drifterState.nextSuperweaponReadyAtMs = 0;
  drifterState.lastSuperweaponTargetID = toPositiveInt(targetEntity.itemID, 0);
  drifterState.pendingPoddingOwnerID =
    resolveCombatActorClass(targetEntity) === "player"
      ? toPositiveInt(targetEntity.ownerID, 0)
      : 0;
  setNpcTurboShieldState(scene, entity, TURBO_SHIELD_STATE_ACTIVE, drifterState);
  setNpcScanResolutionOverride(entity, drifterState.baseScanResolution);

  const refreshedEffect = entity.activeModuleEffects instanceof Map
    ? entity.activeModuleEffects.get(toPositiveInt(superweaponModule.itemID, 0)) || null
    : null;
  return {
    forceMaintainLock: true,
    suppressWeapons: true,
    suppressHostiles: true,
    nextThinkOverrideMs: refreshedEffect
      ? Math.max(
          nowMs + 50,
          toFiniteNumber(refreshedEffect.deactivateAtMs, refreshedEffect.nextCycleAtMs),
        )
      : nowMs + cycleMs,
    preservedModuleIDs: scrambleModuleID > 0 ? [scrambleModuleID] : [],
  };
}

function resolveCombatActorClass(entity) {
  if (!entity || entity.kind !== "ship") {
    return null;
  }

  if (
    entity.session &&
    toPositiveInt(entity.session.characterID, 0) > 0
  ) {
    return "player";
  }

  const npcEntityType = String(entity.npcEntityType || "").trim().toLowerCase();
  if (npcEntityType === "concord") {
    return "concord";
  }
  if (npcEntityType === "npc") {
    return "npc";
  }

  return null;
}

function getEntityCharacterID(entity) {
  if (!entity || entity.kind !== "ship") {
    return 0;
  }

  return toPositiveInt(
    entity.session && entity.session.characterID
      ? entity.session.characterID
      : entity.pilotCharacterID ?? entity.characterID,
    0,
  );
}

function isPlayerShip(entity) {
  return resolveCombatActorClass(entity) === "player";
}

function isIgnoredInvulnerablePlayer(target) {
  if (resolveCombatActorClass(target) !== "player") {
    return false;
  }

  return isCharacterInvulnerable(getEntityCharacterID(target));
}

function isFriendlyCombatTarget(entity, target) {
  const sourceClass = resolveCombatActorClass(entity);
  const targetClass = resolveCombatActorClass(target);
  if (!sourceClass || !targetClass) {
    return false;
  }

  if (sourceClass === "npc" && targetClass === "npc") {
    const sourceController = getControllerByEntityID(
      toPositiveInt(entity && entity.itemID, 0),
    );
    const targetController = getControllerByEntityID(
      toPositiveInt(target && target.itemID, 0),
    );
    const sourceAllowsFriendlyNpcTargets = Boolean(
      sourceController &&
      sourceController.behaviorOverrides &&
      sourceController.behaviorOverrides.allowFriendlyNpcTargets === true,
    );
    const targetAllowsFriendlyNpcTargets = Boolean(
      targetController &&
      targetController.behaviorOverrides &&
      targetController.behaviorOverrides.allowFriendlyNpcTargets === true,
    );
    const sourceOperatorKind = String(sourceController && sourceController.operatorKind || "").trim();
    const targetOperatorKind = String(targetController && targetController.operatorKind || "").trim();
    if (
      sourceAllowsFriendlyNpcTargets &&
      targetAllowsFriendlyNpcTargets &&
      sourceOperatorKind &&
      sourceOperatorKind === targetOperatorKind
    ) {
      return false;
    }
  }

  if (sourceClass === "concord") {
    return targetClass === "concord";
  }
  if (sourceClass === "npc") {
    return targetClass === "npc";
  }

  return false;
}

function resolveAutoAggroTargetClasses(behaviorProfile) {
  const explicitClasses = normalizeTargetClassList(
    behaviorProfile && behaviorProfile.autoAggroTargetClasses,
  );
  if (
    explicitClasses.length > 0 ||
    (
      behaviorProfile &&
      Object.prototype.hasOwnProperty.call(behaviorProfile, "autoAggroTargetClasses")
    )
  ) {
    return explicitClasses;
  }

  const targetPreference = String(
    behaviorProfile && behaviorProfile.targetPreference || "preferredTargetThenNearestPlayer",
  )
    .trim()
    .toLowerCase();
  switch (targetPreference) {
    case "none":
    case "preferredtargetonly":
      return [];
    case "nearestnpc":
    case "preferredtargetthennearestnpc":
    case "preferredtargetthennearestrat":
      return ["npc"];
    case "preferredtargetthennearestnonconcord":
      return ["player", "npc"];
    case "nearesteligible":
    case "preferredtargetthennearesteligible":
      return ["player", "npc", "concord"];
    case "nearestplayer":
    case "preferredtargetthennearestplayer":
    default:
      return ["player"];
  }
}

function resolveProximityAggroTargetClasses(behaviorProfile) {
  const explicitClasses = normalizeTargetClassList(
    behaviorProfile && behaviorProfile.proximityAggroTargetClasses,
  );
  if (
    explicitClasses.length > 0 ||
    (
      behaviorProfile &&
      Object.prototype.hasOwnProperty.call(behaviorProfile, "proximityAggroTargetClasses")
    )
  ) {
    return explicitClasses;
  }
  return resolveAutoAggroTargetClasses(behaviorProfile);
}

function normalizeBehaviorOverrides(overrides) {
  if (!overrides || typeof overrides !== "object") {
    return {};
  }

  const normalized = {};
  const booleanFields = [
    "autoAggro",
    "autoActivateWeapons",
    "returnToHomeWhenIdle",
    "allowPodKill",
    "allowFriendlyNpcTargets",
    "idleAnchorOrbit",
    "useChasePropulsion",
  ];
  for (const field of booleanFields) {
    if (overrides[field] !== undefined) {
      normalized[field] = overrides[field] === true;
    }
  }

  const numericFields = [
    "thinkIntervalMs",
    "orbitDistanceMeters",
    "followRangeMeters",
    "aggressionRangeMeters",
    "proximityAggroRangeMeters",
    "leashRangeMeters",
    "homeArrivalMeters",
    "idleAnchorOrbitDistanceMeters",
    "chasePropulsionActivateDistanceMeters",
    "chasePropulsionDeactivateDistanceMeters",
  ];
  for (const field of numericFields) {
    if (overrides[field] !== undefined) {
      normalized[field] = Math.max(0, toFiniteNumber(overrides[field], 0));
    }
  }

  if (overrides.movementMode !== undefined) {
    normalized.movementMode = String(overrides.movementMode || "").trim().toLowerCase() || "orbit";
  }
  if (overrides.targetPreference !== undefined) {
    normalized.targetPreference =
      String(overrides.targetPreference || "").trim() ||
      "preferredTargetThenNearestPlayer";
  }
  if (overrides.autoAggroTargetClasses !== undefined) {
    normalized.autoAggroTargetClasses = normalizeTargetClassList(
      overrides.autoAggroTargetClasses,
    );
  }
  if (overrides.proximityAggroTargetClasses !== undefined) {
    normalized.proximityAggroTargetClasses = normalizeTargetClassList(
      overrides.proximityAggroTargetClasses,
    );
  }
  if (overrides.syntheticChasePropulsionTier !== undefined) {
    const normalizedTier = String(
      overrides.syntheticChasePropulsionTier || "",
    ).trim().toLowerCase();
    if (
      normalizedTier === "small" ||
      normalizedTier === "medium" ||
      normalizedTier === "large"
    ) {
      normalized.syntheticChasePropulsionTier = normalizedTier;
    }
  }

  return normalized;
}

function resolveEffectiveBehaviorProfile(controller) {
  return {
    ...(controller && controller.behaviorProfile ? controller.behaviorProfile : {}),
    ...normalizeBehaviorOverrides(controller && controller.behaviorOverrides),
  };
}

function isCapsuleEntity(entity) {
  return Boolean(
    entity &&
    entity.kind === "ship" &&
    toPositiveInt(entity.groupID, 0) === CAPSULE_GROUP_ID,
  );
}

function isEntityInActiveWarp(entity) {
  return Boolean(
    entity &&
    entity.kind === "ship" &&
    (
      String(entity.mode || "").trim().toUpperCase() === "WARP" ||
      (
        entity.warpState &&
        typeof entity.warpState === "object"
      )
    ),
  );
}

function isValidCombatTarget(entity, target, options = {}) {
  const isCapsuleTarget = isCapsuleEntity(target);
  const allowedCapsuleOwnerID = toPositiveInt(options.allowedCapsuleOwnerID, 0);
  return Boolean(
    entity &&
    target &&
    target.kind === "ship" &&
    target.itemID !== entity.itemID &&
    !isEntityInActiveWarp(target) &&
    !isFriendlyCombatTarget(entity, target) &&
    !isIgnoredInvulnerablePlayer(target) &&
    (
      !isCapsuleTarget ||
      (
        options.allowPodKill === true &&
        (
          allowedCapsuleOwnerID <= 0 ||
          toPositiveInt(target.ownerID, 0) === allowedCapsuleOwnerID
        )
      )
    ),
  );
}

function isValidManualMovementTarget(entity, target) {
  return Boolean(
    entity &&
    target &&
    target.itemID !== entity.itemID &&
    target.position,
  );
}

function findNearestCombatTarget(scene, entity, maxRangeMeters, options = {}) {
  const maxRange = Math.max(0, toFiniteNumber(maxRangeMeters, 0));
  const allowedTargetClasses = normalizeTargetClassList(
    options.allowedTargetClasses,
  );
  if (allowedTargetClasses.length === 0) {
    return null;
  }

  let bestTarget = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of scene.dynamicEntities.values()) {
    if (
      !allowedTargetClasses.includes(resolveCombatActorClass(candidate)) ||
      !isValidCombatTarget(entity, candidate, options)
    ) {
      continue;
    }
    if (entity.bubbleID && candidate.bubbleID && entity.bubbleID !== candidate.bubbleID) {
      continue;
    }

    const candidateDistance = getSurfaceDistance(entity, candidate);
    if (maxRange > 0 && candidateDistance > maxRange) {
      continue;
    }
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestTarget = candidate;
    }
  }

  return bestTarget;
}

function hasActiveEffectName(entity, effectName) {
  const normalizedEffectName = String(effectName || "").trim().toLowerCase();
  if (!normalizedEffectName || !(entity && entity.activeModuleEffects instanceof Map)) {
    return false;
  }

  for (const effectState of entity.activeModuleEffects.values()) {
    const activeEffectName = String(
      effectState && effectState.effectName || "",
    ).trim().toLowerCase();
    if (activeEffectName === normalizedEffectName) {
      return true;
    }
  }

  return false;
}

function resolveCombatOwnerID(entity) {
  if (!entity || typeof entity !== "object") {
    return 0;
  }
  return toPositiveInt(
    entity.ownerID,
    toPositiveInt(
      entity.pilotCharacterID,
      toPositiveInt(entity.characterID, 0),
    ),
  );
}

function scoreDrifterTarget(entity, controller, candidate, options = {}) {
  const candidateID = toPositiveInt(candidate && candidate.itemID, 0);
  const candidateOwnerID = resolveCombatOwnerID(candidate);
  const currentTargetID = toPositiveInt(controller && controller.currentTargetID, 0);
  const preferredTargetID = toPositiveInt(controller && controller.preferredTargetID, 0);
  const preferredTargetOwnerID = toPositiveInt(options.preferredTargetOwnerID, 0);
  const lastAggressorID = toPositiveInt(controller && controller.lastAggressorID, 0);
  const lastAggressorOwnerID = toPositiveInt(options.lastAggressorOwnerID, 0);
  const lastAggressedAtMs = toFiniteNumber(controller && controller.lastAggressedAtMs, 0);
  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const distanceMeters = Math.max(
    0,
    toFiniteNumber(
      options.getSurfaceDistance
        ? options.getSurfaceDistance(entity, candidate)
        : 0,
      0,
    ),
  );
  const drifterState =
    options.drifterState && typeof options.drifterState === "object"
      ? options.drifterState
      : {};
  const lastSuperweaponTargetID = toPositiveInt(
    drifterState.lastSuperweaponTargetID,
    0,
  );
  const pendingPoddingOwnerID = toPositiveInt(
    drifterState.pendingPoddingOwnerID,
    0,
  );
  const guardAnchorEntity =
    options.guardAnchorEntity && typeof options.guardAnchorEntity === "object"
      ? options.guardAnchorEntity
      : null;
  const guardPriorityRadiusMeters = Math.max(
    0,
    toFiniteNumber(options.guardPriorityRadiusMeters, 0),
  );
  const ignoreCurrentTargetBias = options.ignoreCurrentTargetBias === true;
  const entosisPriorityEnabled = options.entosisPriorityEnabled !== false;

  let score = 0;
  if (!ignoreCurrentTargetBias && candidateID === currentTargetID) {
    score += 3_000;
  }
  if (candidateID === preferredTargetID) {
    score += 2_200;
  }
  if (
    preferredTargetOwnerID > 0 &&
    candidateOwnerID === preferredTargetOwnerID &&
    candidateID !== preferredTargetID
  ) {
    score += 3_000;
  }
  if (
    candidateID === lastAggressorID &&
    lastAggressedAtMs > 0 &&
    (nowMs - lastAggressedAtMs) <= DRIFTER_RECENT_AGGRESSION_MEMORY_MS
  ) {
    score += 2_600;
  }
  if (
    lastAggressorOwnerID > 0 &&
    candidateOwnerID === lastAggressorOwnerID &&
    candidateID !== lastAggressorID &&
    lastAggressedAtMs > 0 &&
    (nowMs - lastAggressedAtMs) <= DRIFTER_RECENT_AGGRESSION_MEMORY_MS
  ) {
    // Preserve the Drifter grudge against the same owner even if the original
    // ship entity disappeared and the pilot came back on a new hull.
    score += 5_000;
  }
  if (candidateID === lastSuperweaponTargetID) {
    score += 1_700;
  }
  if (
    pendingPoddingOwnerID > 0 &&
    isCapsuleEntity(candidate) &&
    toPositiveInt(candidate && candidate.ownerID, 0) === pendingPoddingOwnerID
  ) {
    score += 6_500;
  }
  if (entosisPriorityEnabled && hasActiveEffectName(candidate, "entosislink")) {
    score += 3_500;
  }
  if (
    guardAnchorEntity &&
    guardAnchorEntity.position &&
    candidate &&
    candidate.position &&
    guardPriorityRadiusMeters > 0
  ) {
    const guardDistanceMeters = Math.max(
      0,
      toFiniteNumber(
        options.getSurfaceDistance
          ? options.getSurfaceDistance(guardAnchorEntity, candidate)
          : getSurfaceDistance(guardAnchorEntity, candidate),
        0,
      ),
    );
    if (guardDistanceMeters <= guardPriorityRadiusMeters) {
      const normalizedGuardPriority = Math.max(
        0,
        1 - (guardDistanceMeters / guardPriorityRadiusMeters),
      );
      score += DRIFTER_GUARD_PRIORITY_BASE_SCORE +
        Math.round(normalizedGuardPriority * DRIFTER_GUARD_PRIORITY_BONUS_SCORE);
      if (entosisPriorityEnabled && hasActiveEffectName(candidate, "entosislink")) {
        score += DRIFTER_GUARD_ENTOSIS_PRIORITY_SCORE;
      }
    }
  }
  if (
    String(
      options.resolveCombatActorClass
        ? options.resolveCombatActorClass(candidate)
        : "",
    ).trim().toLowerCase() === "player"
  ) {
    score += 600;
  }

  score += Math.max(0, 400 - Math.round(distanceMeters / 1000));

  return {
    candidate,
    score,
    distanceMeters,
  };
}

function selectBestScoredCombatTarget(scoredCandidates = []) {
  return [...scoredCandidates]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.distanceMeters !== right.distanceMeters) {
        return left.distanceMeters - right.distanceMeters;
      }
      return (
        toPositiveInt(left && left.candidate && left.candidate.itemID, 0) -
        toPositiveInt(right && right.candidate && right.candidate.itemID, 0)
      );
    })[0] || null;
}

function resolveDrifterBehaviorTarget(scene, entity, controller, behaviorProfile, options = {}) {
  if (!scene || !entity || !controller || !isDrifterNpcEntity(entity, behaviorProfile)) {
    return null;
  }

  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const aggressionRangeMeters = Math.max(
    0,
    toFiniteNumber(options.aggressionRangeMeters, 0),
  );
  const allowedTargetClasses = normalizeTargetClassList(options.allowedTargetClasses);
  if (allowedTargetClasses.length <= 0) {
    return null;
  }

  const drifterState = ensureDrifterCombatState(controller, entity, scene, nowMs);
  const allowedCapsuleOwnerID = resolveDrifterPendingPoddingOwnerID(controller);
  const allowPodKill =
    options.allowPodKill === true ||
    allowedCapsuleOwnerID > 0;
  const recentAggressionMemoryActive =
    toFiniteNumber(controller && controller.lastAggressedAtMs, 0) > 0 &&
    (nowMs - toFiniteNumber(controller && controller.lastAggressedAtMs, 0)) <=
      DRIFTER_RECENT_AGGRESSION_MEMORY_MS;
  const currentTargetID = toPositiveInt(controller.currentTargetID, 0);
  const currentTarget = currentTargetID > 0
    ? scene.getEntityByID(currentTargetID)
    : null;
  const currentTargetInActiveWarp = isEntityInActiveWarp(currentTarget);
  const pursuitEnabled = isDrifterPursuitWarpEnabled(behaviorProfile);
  const entosisPriorityEnabled = isDrifterEntosisPriorityEnabled(behaviorProfile);
  const recentPursuitForCurrentTarget = Boolean(
    pursuitEnabled &&
    currentTargetInActiveWarp &&
    drifterState &&
    toPositiveInt(drifterState.lastPursuitTargetID, 0) === currentTargetID &&
    toFiniteNumber(drifterState.lastPursuitPostedAtMs, 0) > 0 &&
    (nowMs - toFiniteNumber(drifterState.lastPursuitPostedAtMs, 0)) <=
      DRIFTER_PURSUIT_LOCATION_MEMORY_MS
  );

  const isEligibleTarget = (candidate) => {
    if (!candidate) {
      return false;
    }
    if (
      options.isValidCombatTarget &&
      options.isValidCombatTarget(entity, candidate, {
        allowPodKill,
        allowedCapsuleOwnerID,
      }) !== true
    ) {
      return false;
    }
    const candidateClass = String(
      options.resolveCombatActorClass
        ? options.resolveCombatActorClass(candidate)
        : "",
    ).trim().toLowerCase();
    if (!allowedTargetClasses.includes(candidateClass)) {
      return false;
    }
    if (entity.bubbleID && candidate.bubbleID && entity.bubbleID !== candidate.bubbleID) {
      return false;
    }
    if (
      aggressionRangeMeters > 0 &&
      options.getSurfaceDistance &&
      toFiniteNumber(options.getSurfaceDistance(entity, candidate), 0) > aggressionRangeMeters
    ) {
      return false;
    }
    return true;
  };
  if (allowedCapsuleOwnerID > 0) {
    const matchingOwnerCapsuleExists = [...scene.dynamicEntities.values()].some((candidate) => (
      candidate &&
      isCapsuleEntity(candidate) &&
      toPositiveInt(candidate.ownerID, 0) === allowedCapsuleOwnerID &&
      isEligibleTarget(candidate)
    ));
    if (!matchingOwnerCapsuleExists) {
      drifterState.pendingPoddingOwnerID = 0;
    }
  }
  const preferredTargetEntity = toPositiveInt(controller.preferredTargetID, 0) > 0
    ? scene.getEntityByID(toPositiveInt(controller.preferredTargetID, 0))
    : null;
  const lastAggressorEntity = toPositiveInt(controller.lastAggressorID, 0) > 0
    ? scene.getEntityByID(toPositiveInt(controller.lastAggressorID, 0))
    : null;
  const preferredTargetOwnerFallbackID =
    preferredTargetEntity && isEligibleTarget(preferredTargetEntity)
      ? 0
      : toPositiveInt(controller.preferredTargetOwnerID, 0);
  const lastAggressorOwnerFallbackID =
    recentAggressionMemoryActive &&
    !(lastAggressorEntity && isEligibleTarget(lastAggressorEntity))
      ? toPositiveInt(controller.lastAggressorOwnerID, 0)
      : 0;

  const nextTargetSwitchAtMs = Math.max(
    0,
    toFiniteNumber(
      drifterState && drifterState.nextTargetSwitchAtMs,
      toFiniteNumber(drifterState && drifterState.lastTargetSwitchAtMs, 0) +
        DRIFTER_TARGET_SWITCH_INTERVAL_MS,
    ),
  );
  if (
    currentTarget &&
    isEligibleTarget(currentTarget) &&
    nextTargetSwitchAtMs > nowMs
  ) {
    return currentTarget;
  }

  if (recentPursuitForCurrentTarget) {
    publishDrifterPursuitLocation(
      scene,
      entity,
      controller,
      currentTarget,
      nowMs,
    );
    return null;
  }

  const switchingWindowExpired =
    currentTarget &&
    isEligibleTarget(currentTarget) &&
    nextTargetSwitchAtMs > 0 &&
    nextTargetSwitchAtMs <= nowMs;
  const guardAnchorEntity =
    behaviorProfile && behaviorProfile.idleAnchorOrbit === true
      ? resolveIdleAnchorEntity(scene, controller, entity)
      : null;
  const guardPriorityRadiusMeters = guardAnchorEntity
    ? Math.max(
        DRIFTER_GUARD_PRIORITY_MIN_RADIUS_METERS,
        toFiniteNumber(behaviorProfile && behaviorProfile.idleAnchorOrbitDistanceMeters, 0) + 5_000,
      )
    : 0;
  const scoredCandidates = [];
  for (const candidate of scene.dynamicEntities.values()) {
    if (!isEligibleTarget(candidate)) {
      continue;
    }
    scoredCandidates.push(
      scoreDrifterTarget(entity, controller, candidate, {
        nowMs,
        drifterState,
        getSurfaceDistance: options.getSurfaceDistance,
        resolveCombatActorClass: options.resolveCombatActorClass,
        preferredTargetOwnerID: preferredTargetOwnerFallbackID,
        lastAggressorOwnerID: lastAggressorOwnerFallbackID,
        guardAnchorEntity,
        guardPriorityRadiusMeters,
        entosisPriorityEnabled,
        ignoreCurrentTargetBias:
          switchingWindowExpired &&
          toPositiveInt(candidate && candidate.itemID, 0) === currentTargetID,
      }),
    );
  }
  const bestCandidate = selectBestScoredCombatTarget(scoredCandidates);
  if (!bestCandidate) {
    return currentTarget && isEligibleTarget(currentTarget) ? currentTarget : null;
  }

  const shouldKeepCurrentTarget = Boolean(
    currentTarget &&
    isEligibleTarget(currentTarget) &&
    bestCandidate.candidate.itemID !== currentTarget.itemID,
  );
  const entosisCandidate = switchingWindowExpired && entosisPriorityEnabled
    ? selectBestScoredCombatTarget(
        scoredCandidates.filter((entry) => hasActiveEffectName(entry && entry.candidate, "entosislink")),
      )
    : null;
  const currentTargetHasEntosis = hasActiveEffectName(currentTarget, "entosislink");
  const preferredSwitchCandidate =
    entosisCandidate &&
    entosisCandidate.candidate &&
    toPositiveInt(entosisCandidate.candidate.itemID, 0) > 0 &&
    !currentTargetHasEntosis
      ? entosisCandidate
      : bestCandidate;
  if (shouldKeepCurrentTarget) {
    const currentScore = scoreDrifterTarget(entity, controller, currentTarget, {
      nowMs,
      drifterState,
      getSurfaceDistance: options.getSurfaceDistance,
      resolveCombatActorClass: options.resolveCombatActorClass,
      preferredTargetOwnerID: preferredTargetOwnerFallbackID,
      lastAggressorOwnerID: lastAggressorOwnerFallbackID,
      guardAnchorEntity,
      guardPriorityRadiusMeters,
      entosisPriorityEnabled,
      ignoreCurrentTargetBias: switchingWindowExpired,
    });
    if (
      preferredSwitchCandidate.candidate.itemID !== currentTarget.itemID &&
      hasActiveEffectName(preferredSwitchCandidate.candidate, "entosislink") &&
      !currentTargetHasEntosis
    ) {
      // CCP's Drifter aggression monitors explicitly elevate active entosis
      // users into the combat target set. Once the target-switch cadence gate
      // has expired, keep that escalation authoritative instead of letting the
      // stale current-target bias hold the Drifter on an unrelated ship.
    } else if (
      preferredSwitchCandidate.score <= currentScore.score + DRIFTER_TARGET_SWITCH_SCORE_MARGIN
    ) {
      if (drifterState) {
        drifterState.nextTargetSwitchAtMs = nowMs + DRIFTER_TARGET_SWITCH_INTERVAL_MS;
      }
      return currentTarget;
    }
  }

  if (drifterState) {
    drifterState.lastTargetID = toPositiveInt(preferredSwitchCandidate.candidate.itemID, 0);
    drifterState.lastTargetSwitchAtMs = nowMs;
    drifterState.nextTargetSwitchAtMs = nowMs + DRIFTER_TARGET_SWITCH_INTERVAL_MS;
  }
  const bestCandidateOwnerID = resolveCombatOwnerID(preferredSwitchCandidate.candidate);
  if (
    preferredTargetOwnerFallbackID > 0 &&
    bestCandidateOwnerID === preferredTargetOwnerFallbackID
  ) {
    controller.preferredTargetID = toPositiveInt(preferredSwitchCandidate.candidate.itemID, 0);
  }
  if (
    lastAggressorOwnerFallbackID > 0 &&
    bestCandidateOwnerID === lastAggressorOwnerFallbackID
  ) {
    controller.lastAggressorID = toPositiveInt(preferredSwitchCandidate.candidate.itemID, 0);
  }
  return preferredSwitchCandidate.candidate;
}

function resolveNpcAssistanceNeedRatio(target, family) {
  if (!target || target.kind !== "ship") {
    return 0;
  }

  const conditionState =
    target.conditionState && typeof target.conditionState === "object"
      ? target.conditionState
      : {};
  const normalizedFamily = String(family || "").trim().toLowerCase();
  if (normalizedFamily === "remoteshield") {
    const shieldChargeRatio = Math.min(
      1,
      Math.max(0, toFiniteNumber(conditionState.shieldCharge, 1)),
    );
    return 1 - shieldChargeRatio;
  }
  if (normalizedFamily === "remotearmor") {
    return Math.min(
      1,
      Math.max(0, toFiniteNumber(conditionState.armorDamage, 0)),
    );
  }
  if (normalizedFamily === "remotehull") {
    return Math.min(
      1,
      Math.max(0, toFiniteNumber(conditionState.damage, 0)),
    );
  }
  if (normalizedFamily === "remotecapacitor") {
    const capacitorChargeRatio = Math.min(
      1,
      Math.max(
        0,
        toFiniteNumber(
          target.capacitorChargeRatio,
          target.passiveDerivedState && target.passiveDerivedState.capacitorChargeRatio,
        ),
      ),
    );
    return 1 - capacitorChargeRatio;
  }
  return 0;
}

function isFriendlyNpcAssistanceTarget(entity, target, sourceController = null) {
  if (
    !entity ||
    !target ||
    entity.itemID === target.itemID ||
    resolveCombatActorClass(entity) !== "npc" ||
    resolveCombatActorClass(target) !== "npc"
  ) {
    return false;
  }

  const resolvedSourceController = sourceController || getControllerByEntityID(
    toPositiveInt(entity && entity.itemID, 0),
  );
  const targetController = getControllerByEntityID(
    toPositiveInt(target && target.itemID, 0),
  );
  const sourceOperatorKind = String(
    resolvedSourceController && resolvedSourceController.operatorKind || "",
  ).trim();
  const targetOperatorKind = String(
    targetController && targetController.operatorKind || "",
  ).trim();
  if (sourceOperatorKind && targetOperatorKind) {
    return sourceOperatorKind === targetOperatorKind;
  }

  const sourceFactionID = toPositiveInt(entity && entity.factionID, 0);
  const targetFactionID = toPositiveInt(target && target.factionID, 0);
  if (sourceFactionID > 0 && sourceFactionID === targetFactionID) {
    return true;
  }

  const sourceCorporationID = toPositiveInt(entity && entity.corporationID, 0);
  const targetCorporationID = toPositiveInt(target && target.corporationID, 0);
  return sourceCorporationID > 0 && sourceCorporationID === targetCorporationID;
}

function findNearestNpcAssistanceTarget(scene, entity, controller, family, maxRangeMeters = 0) {
  const normalizedRange = Math.max(0, toFiniteNumber(maxRangeMeters, 0));
  let bestTarget = null;
  let bestNeedRatio = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of scene.dynamicEntities.values()) {
    if (!isFriendlyNpcAssistanceTarget(entity, candidate, controller)) {
      continue;
    }
    if (entity.bubbleID && candidate.bubbleID && entity.bubbleID !== candidate.bubbleID) {
      continue;
    }

    const needRatio = resolveNpcAssistanceNeedRatio(candidate, family);
    if (needRatio <= 0) {
      continue;
    }

    const candidateDistance = getSurfaceDistance(entity, candidate);
    if (normalizedRange > 0 && candidateDistance > normalizedRange + 1) {
      continue;
    }

    if (
      needRatio > bestNeedRatio + 0.000001 ||
      (
        Math.abs(needRatio - bestNeedRatio) <= 0.000001 &&
        candidateDistance < bestDistance
      )
    ) {
      bestTarget = candidate;
      bestNeedRatio = needRatio;
      bestDistance = candidateDistance;
    }
  }

  return bestTarget;
}

function normalizeManualOrder(order) {
  if (!order || typeof order !== "object") {
    return null;
  }

  const normalizedType = normalizeOrderType(order.type);
  if (!normalizedType || normalizedType === "resume" || normalizedType === "resumebehavior") {
    return null;
  }

  const mappedType = {
    attack: "attack",
    orbit: "orbit",
    follow: "follow",
    holdfire: "holdFire",
    stop: "stop",
    returnhome: "returnHome",
  }[normalizedType] || String(order.type || "");

  return {
    ...order,
    type: mappedType,
    targetID: toPositiveInt(order.targetID, 0),
    movementMode: String(order.movementMode || "").trim().toLowerCase() || null,
    orbitDistanceMeters: Math.max(0, toFiniteNumber(order.orbitDistanceMeters, 0)),
    followRangeMeters: Math.max(0, toFiniteNumber(order.followRangeMeters, 0)),
    allowWeapons:
      order.allowWeapons === undefined ? null : order.allowWeapons === true,
    keepLock:
      order.keepLock === undefined ? null : order.keepLock === true,
    allowPodKill:
      order.allowPodKill === undefined ? null : order.allowPodKill === true,
  };
}

function resolveBehaviorTarget(scene, controller, entity, behaviorProfile) {
  const nowMs = scene && scene.getCurrentSimTimeMs ? scene.getCurrentSimTimeMs() : Date.now();
  const allowPodKill = behaviorProfile.allowPodKill === true;
  const aggressionRangeMeters = Math.max(
    0,
    toFiniteNumber(behaviorProfile.aggressionRangeMeters, 0),
  );
  const preferredTarget = scene.getEntityByID(toPositiveInt(controller.preferredTargetID, 0));
  if (
    isValidCombatTarget(entity, preferredTarget, { allowPodKill }) &&
    (
      aggressionRangeMeters <= 0 ||
      getSurfaceDistance(entity, preferredTarget) <= aggressionRangeMeters
    )
  ) {
    return preferredTarget;
  }

  const proximityAggroRangeMeters = Math.max(
    0,
    toFiniteNumber(behaviorProfile.proximityAggroRangeMeters, 0),
  );
  if (behaviorProfile.autoAggro === false) {
    if (proximityAggroRangeMeters <= 0) {
      return null;
    }

    const proximityAggroTargetClasses = resolveProximityAggroTargetClasses(behaviorProfile);
    if (proximityAggroTargetClasses.length <= 0) {
      return null;
    }

    if (entity && entity.capitalNpc === true) {
      return resolveCapitalBehaviorTarget(
        scene,
        entity,
        controller,
        behaviorProfile,
        {
          nowMs,
          allowPodKill,
          aggressionRangeMeters: proximityAggroRangeMeters,
          allowedTargetClasses: proximityAggroTargetClasses,
          isValidCombatTarget,
          resolveCombatActorClass,
          getSurfaceDistance,
        },
      );
    }

    if (isDrifterNpcEntity(entity, behaviorProfile)) {
      return resolveDrifterBehaviorTarget(
        scene,
        entity,
        controller,
        behaviorProfile,
        {
          nowMs,
          allowPodKill,
          aggressionRangeMeters: proximityAggroRangeMeters,
          allowedTargetClasses: proximityAggroTargetClasses,
          isValidCombatTarget,
          resolveCombatActorClass,
          getSurfaceDistance,
        },
      );
    }

    return findNearestCombatTarget(scene, entity, proximityAggroRangeMeters, {
      allowPodKill,
      allowedTargetClasses: proximityAggroTargetClasses,
    });
  }

  const autoAggroTargetClasses = resolveAutoAggroTargetClasses(behaviorProfile);
  if (autoAggroTargetClasses.length === 0) {
    return null;
  }

  if (entity && entity.capitalNpc === true) {
    return resolveCapitalBehaviorTarget(
      scene,
      entity,
      controller,
      behaviorProfile,
      {
        nowMs,
        allowPodKill,
        aggressionRangeMeters,
        allowedTargetClasses: autoAggroTargetClasses,
        isValidCombatTarget,
        resolveCombatActorClass,
        getSurfaceDistance,
      },
    );
  }

  if (isDrifterNpcEntity(entity, behaviorProfile)) {
    return resolveDrifterBehaviorTarget(
      scene,
      entity,
      controller,
      behaviorProfile,
      {
        nowMs,
        allowPodKill,
        aggressionRangeMeters,
        allowedTargetClasses: autoAggroTargetClasses,
        isValidCombatTarget,
        resolveCombatActorClass,
        getSurfaceDistance,
      },
    );
  }

  return findNearestCombatTarget(scene, entity, aggressionRangeMeters, {
    allowPodKill,
    allowedTargetClasses: autoAggroTargetClasses,
  });
}

function resolveDesiredTarget(scene, controller, entity, behaviorProfile, manualOrder) {
  const allowPodKill =
    manualOrder && manualOrder.allowPodKill !== null
      ? manualOrder.allowPodKill === true
      : behaviorProfile.allowPodKill === true;
  if (
    manualOrder &&
    manualOrder.type === "attack" &&
    manualOrder.targetID > 0
  ) {
    const manualTarget = scene.getEntityByID(manualOrder.targetID);
    if (!manualTarget) {
      controller.manualOrder = null;
      return resolveBehaviorTarget(scene, controller, entity, behaviorProfile);
    }
    return isValidCombatTarget(entity, manualTarget, { allowPodKill }) ? manualTarget : null;
  }

  if (
    manualOrder &&
    (
      manualOrder.type === "orbit" ||
      manualOrder.type === "follow"
    ) &&
    manualOrder.targetID > 0
  ) {
    const manualTarget = scene.getEntityByID(manualOrder.targetID);
    if (!isValidManualMovementTarget(entity, manualTarget)) {
      return null;
    }
    if (manualTarget.kind === "ship") {
      return isValidCombatTarget(entity, manualTarget, { allowPodKill }) ? manualTarget : null;
    }
    return manualTarget;
  }

  if (manualOrder && manualOrder.type === "stop") {
    return null;
  }
  if (manualOrder && manualOrder.type === "returnHome") {
    return null;
  }

  if (manualOrder && manualOrder.type === "holdFire" && manualOrder.targetID > 0) {
    const manualTarget = scene.getEntityByID(manualOrder.targetID);
    if (!manualTarget) {
      controller.manualOrder = null;
      return resolveBehaviorTarget(scene, controller, entity, behaviorProfile);
    }
    return isValidCombatTarget(entity, manualTarget, { allowPodKill }) ? manualTarget : null;
  }

  return resolveBehaviorTarget(scene, controller, entity, behaviorProfile);
}

function deactivateNpcWeapons(scene, entity, options = {}) {
  const pseudoSession = buildNpcPseudoSession(entity);
  const excludedModuleIDs = new Set(
    (Array.isArray(options.excludeModuleIDs) ? options.excludeModuleIDs : [options.excludeModuleIDs])
      .map((moduleID) => toPositiveInt(moduleID, 0))
      .filter((moduleID) => moduleID > 0),
  );
  const combatModuleIDs = new Set([
    ...getNpcWeaponModules(entity)
      .map((moduleItem) => toPositiveInt(moduleItem && moduleItem.itemID, 0))
      .filter((moduleID) => moduleID > 0),
    ...getNpcHostileModules(entity)
      .map((entry) => toPositiveInt(entry && entry.moduleItem && entry.moduleItem.itemID, 0))
      .filter((moduleID) => moduleID > 0),
    ...getNpcAssistanceModules(entity)
      .map((entry) => toPositiveInt(entry && entry.moduleItem && entry.moduleItem.itemID, 0))
      .filter((moduleID) => moduleID > 0),
    ...getNpcSelfModules(entity)
      .map((entry) => toPositiveInt(entry && entry.moduleItem && entry.moduleItem.itemID, 0))
      .filter((moduleID) => moduleID > 0),
  ]);
  if (combatModuleIDs.size <= 0) {
    return;
  }
  if (entity && entity.nativeNpc === true && entity.activeModuleEffects instanceof Map) {
    logNpcCombatDebug("npc.weapons.deactivate-all", {
      entity: summarizeNpcCombatEntity(entity),
      activeModuleIDs: [...entity.activeModuleEffects.keys()]
        .map((moduleID) => toPositiveInt(moduleID, 0))
        .filter((moduleID) => combatModuleIDs.has(moduleID)),
    });
  }
  for (const effectState of [...(entity.activeModuleEffects || new Map()).values()]) {
    const moduleID = toPositiveInt(effectState && effectState.moduleID, 0);
    if (!combatModuleIDs.has(moduleID) || excludedModuleIDs.has(moduleID)) {
      continue;
    }
    scene.deactivateGenericModule(pseudoSession, effectState.moduleID, {
      reason: "npc",
      deferUntilCycle: false,
    });
  }
}

function syncNpcHostileModules(scene, entity, target) {
  const pseudoSession = buildNpcPseudoSession(entity);
  const modules = getNpcHostileModules(entity);
  for (const { moduleItem, definition, effectName } of modules) {
    const activeEffect = entity.activeModuleEffects instanceof Map
      ? entity.activeModuleEffects.get(toPositiveInt(moduleItem.itemID, 0)) || null
      : null;
    if (
      activeEffect &&
      toPositiveInt(activeEffect.targetID, 0) !== toPositiveInt(target.itemID, 0)
    ) {
      logNpcCombatDebug("npc.hostile.module-retarget-deactivate", {
        entity: summarizeNpcCombatEntity(entity),
        target: summarizeNpcCombatEntity(target),
        moduleItem: summarizeNpcCombatModule(moduleItem),
        activeTargetID: toPositiveInt(activeEffect && activeEffect.targetID, 0),
      });
      scene.deactivateGenericModule(pseudoSession, moduleItem.itemID, {
        reason: "npc",
        deferUntilCycle: false,
      });
      continue;
    }
    if (activeEffect) {
      continue;
    }

    const effectiveRange = estimateNpcHostileEffectiveRange(entity, moduleItem);
    if (
      effectiveRange > 0 &&
      getSurfaceDistance(entity, target) > effectiveRange + 1
    ) {
      continue;
    }

    const activationOutcome = scene.activateGenericModule(
      pseudoSession,
      moduleItem,
      effectName || null,
      {
        targetID: target.itemID,
      },
    );
    logNpcCombatDebug("npc.hostile.module-activate", {
      entity: summarizeNpcCombatEntity(entity),
      target: summarizeNpcCombatEntity(target),
      moduleItem: summarizeNpcCombatModule(moduleItem),
      hostileFamily: definition && definition.family ? String(definition.family) : null,
      success: Boolean(activationOutcome && activationOutcome.success),
      errorMsg:
        activationOutcome && activationOutcome.success === false
          ? String(activationOutcome.errorMsg || "")
          : null,
    });
  }
}

function syncNpcAssistanceModules(scene, entity, controller) {
  const pseudoSession = buildNpcPseudoSession(entity);
  const modules = getNpcAssistanceModules(entity);
  let maintainedAssistance = false;
  for (const { moduleItem, definition, effectName } of modules) {
    const activeEffect = entity.activeModuleEffects instanceof Map
      ? entity.activeModuleEffects.get(toPositiveInt(moduleItem && moduleItem.itemID, 0)) || null
      : null;
    const effectiveRange = estimateNpcAssistanceEffectiveRange(entity, moduleItem);
    if (activeEffect) {
      const activeTarget = scene.getEntityByID(toPositiveInt(activeEffect.targetID, 0));
      const activeNeedRatio = resolveNpcAssistanceNeedRatio(
        activeTarget,
        activeEffect.assistanceFamily || definition && definition.family,
      );
      const activeTargetStillValid = Boolean(
        activeTarget &&
        isFriendlyNpcAssistanceTarget(entity, activeTarget, controller) &&
        activeNeedRatio > 0 &&
        (
          effectiveRange <= 0 ||
          getSurfaceDistance(entity, activeTarget) <= effectiveRange + 1
        ),
      );
      if (activeTargetStillValid) {
        maintainedAssistance = true;
        continue;
      }

      logNpcCombatDebug("npc.assistance.module-retarget-deactivate", {
        entity: summarizeNpcCombatEntity(entity),
        target: summarizeNpcCombatEntity(activeTarget),
        moduleItem: summarizeNpcCombatModule(moduleItem),
        activeTargetID: toPositiveInt(activeEffect && activeEffect.targetID, 0),
      });
      scene.deactivateGenericModule(pseudoSession, moduleItem.itemID, {
        reason: "npc",
        deferUntilCycle: false,
      });
      continue;
    }

    const supportTarget = findNearestNpcAssistanceTarget(
      scene,
      entity,
      controller,
      definition && definition.family,
      effectiveRange,
    );
    if (!supportTarget) {
      continue;
    }
    maintainedAssistance = true;

    let hasLock = scene.getTargetsForEntity(entity).includes(supportTarget.itemID);
    if (!hasLock) {
      const lockResult = scene.finalizeTargetLock(
        entity,
        supportTarget,
        {
          nowMs: scene.getCurrentSimTimeMs(),
        },
      );
      hasLock = Boolean(lockResult && lockResult.success);
      logNpcCombatDebug("npc.assistance.acquire-lock", {
        entity: summarizeNpcCombatEntity(entity),
        target: summarizeNpcCombatEntity(supportTarget),
        moduleItem: summarizeNpcCombatModule(moduleItem),
        success: hasLock,
      });
    }
    if (!hasLock) {
      continue;
    }

    const activationOutcome = scene.activateGenericModule(
      pseudoSession,
      moduleItem,
      effectName || null,
      {
        targetID: supportTarget.itemID,
      },
    );
    logNpcCombatDebug("npc.assistance.module-activate", {
      entity: summarizeNpcCombatEntity(entity),
      target: summarizeNpcCombatEntity(supportTarget),
      moduleItem: summarizeNpcCombatModule(moduleItem),
      assistanceFamily: definition && definition.family ? String(definition.family) : null,
      success: Boolean(activationOutcome && activationOutcome.success),
      errorMsg:
        activationOutcome && activationOutcome.success === false
          ? String(activationOutcome.errorMsg || "")
          : null,
    });
  }
  return maintainedAssistance;
}

function syncNpcSelfModules(scene, entity, desiredTarget, options = {}) {
  const pseudoSession = buildNpcPseudoSession(entity);
  const modules = getNpcSelfModules(entity);
  const combatEnabled = options.combatEnabled === true;
  for (const { moduleItem, definition, effectName } of modules) {
    const activeEffect = entity.activeModuleEffects instanceof Map
      ? entity.activeModuleEffects.get(toPositiveInt(moduleItem && moduleItem.itemID, 0)) || null
      : null;
    const activateWhen = String(definition && definition.activateWhen || "combat")
      .trim()
      .toLowerCase();
    const shouldActivate =
      activateWhen === "combat"
        ? combatEnabled && Boolean(desiredTarget)
        : combatEnabled;

    if (!shouldActivate) {
      if (!activeEffect) {
        continue;
      }
      logNpcCombatDebug("npc.self.module-deactivate", {
        entity: summarizeNpcCombatEntity(entity),
        moduleItem: summarizeNpcCombatModule(moduleItem),
        selfFamily: definition && definition.family ? String(definition.family) : null,
      });
      scene.deactivateGenericModule(pseudoSession, moduleItem.itemID, {
        reason: "npc",
        deferUntilCycle: false,
      });
      continue;
    }

    if (activeEffect) {
      continue;
    }

    const activationOutcome = scene.activateGenericModule(
      pseudoSession,
      moduleItem,
      effectName || null,
      {},
    );
    logNpcCombatDebug("npc.self.module-activate", {
      entity: summarizeNpcCombatEntity(entity),
      moduleItem: summarizeNpcCombatModule(moduleItem),
      selfFamily: definition && definition.family ? String(definition.family) : null,
      success: Boolean(activationOutcome && activationOutcome.success),
      errorMsg:
        activationOutcome && activationOutcome.success === false
          ? String(activationOutcome.errorMsg || "")
          : null,
    });
  }
}

function clearNpcTargetLocks(scene, entity) {
  scene.clearTargets(buildNpcPseudoSession(entity), {
    notifySelf: false,
    notifyTarget: true,
  });
}

function stopNpcMovement(scene, entity) {
  if (entity.mode !== "STOP" || toFiniteNumber(entity.speedFraction, 0) > 0) {
    scene.stop(buildNpcPseudoSession(entity));
  }
}

function clearNpcCombatState(scene, entity, controller, options = {}) {
  resetDrifterCombatState(
    scene,
    entity,
    controller,
    toFiniteNumber(options.nowMs, Date.now()),
  );
  if (options.deactivateWeapons !== false) {
    deactivateNpcWeapons(scene, entity);
  }
  if (options.deactivatePropulsion !== false) {
    deactivateNpcPropulsion(scene, entity);
  }
  if (options.clearTargets !== false) {
    clearNpcTargetLocks(scene, entity);
  }
  if (options.stopShip !== false) {
    stopNpcMovement(scene, entity);
  }
  controller.currentTargetID = 0;
  controller.returningHome = false;
}

function resolveMovementDirective(manualOrder, behaviorProfile) {
  const manualMovementMode = manualOrder && manualOrder.movementMode
    ? manualOrder.movementMode
    : null;
  const typeDrivenMode =
    manualOrder && manualOrder.type === "follow"
      ? "follow"
      : manualOrder && manualOrder.type === "orbit"
        ? "orbit"
        : null;
  return {
    movementMode: String(
      manualMovementMode ||
        typeDrivenMode ||
        behaviorProfile.movementMode ||
        "orbit"
    ).trim().toLowerCase(),
    orbitDistanceMeters: Math.max(
      0,
      toFiniteNumber(
        manualOrder && manualOrder.orbitDistanceMeters > 0
          ? manualOrder.orbitDistanceMeters
          : behaviorProfile.orbitDistanceMeters,
        0,
      ),
    ),
    followRangeMeters: Math.max(
      0,
      toFiniteNumber(
        manualOrder && manualOrder.followRangeMeters > 0
          ? manualOrder.followRangeMeters
          : behaviorProfile.followRangeMeters,
        0,
      ),
    ),
  };
}

function syncNpcMovement(scene, entity, target, movementDirective) {
  const pseudoSession = buildNpcPseudoSession(entity);
  const movementMode = String(movementDirective && movementDirective.movementMode || "orbit");
  if (movementMode === "hold" || movementMode === "stop") {
    stopNpcMovement(scene, entity);
    return;
  }
  if (movementMode === "follow") {
    const followRangeMeters = Math.max(
      0,
      toFiniteNumber(movementDirective && movementDirective.followRangeMeters, 0),
    );
    if (
      entity.mode !== "FOLLOW" ||
      toPositiveInt(entity.targetEntityID, 0) !== toPositiveInt(target.itemID, 0) ||
      Math.abs(toFiniteNumber(entity.followRange, 0) - followRangeMeters) > 1
    ) {
      scene.followBall(pseudoSession, target.itemID, followRangeMeters, {
        queueHistorySafeContract: true,
        suppressFreshAcquireReplay: true,
      });
    }
    return;
  }

  const orbitDistanceMeters = Math.max(
    0,
    toFiniteNumber(movementDirective && movementDirective.orbitDistanceMeters, 0),
  );
  const surfaceDistanceMeters = getSurfaceDistance(entity, target);
  const sameTarget =
    toPositiveInt(entity.targetEntityID, 0) === toPositiveInt(target.itemID, 0);
  const followRangeMatchesOrbit =
    Math.abs(toFiniteNumber(entity.followRange, 0) - orbitDistanceMeters) <= 1;
  const currentlyFollowingOrbitBand =
    entity.mode === "FOLLOW" &&
    sameTarget &&
    followRangeMatchesOrbit;
  const orbitReacquireDistanceMeters =
    orbitDistanceMeters + Math.max(5_000, orbitDistanceMeters * 0.5);
  const orbitSettleDistanceMeters =
    orbitDistanceMeters + Math.max(1_000, orbitDistanceMeters * 0.2);
  if (
    surfaceDistanceMeters > orbitReacquireDistanceMeters ||
    (
      currentlyFollowingOrbitBand &&
      surfaceDistanceMeters > orbitSettleDistanceMeters
    )
  ) {
    if (
      entity.mode !== "FOLLOW" ||
      toPositiveInt(entity.targetEntityID, 0) !== toPositiveInt(target.itemID, 0) ||
      Math.abs(toFiniteNumber(entity.followRange, 0) - orbitDistanceMeters) > 1
    ) {
      // CCP-style orbit commands still spend most of their time in "close the
      // gap first" behavior when the target opens range. Keeping our NPCs on a
      // pure orbit vector that far outside the requested band lets some hulls
      // spiral inefficiently or even grow range after abrupt target movement.
      // Re-enter follow until we are back near the requested orbit band, then
      // hand the ship back to orbit mode. `client/jolt9.txt` showed that
      // returning to orbit as soon as the ship is merely "not far anymore"
      // creates visible FOLLOW -> ORBIT churn, so keep FOLLOW latched until we
      // are genuinely near the requested orbit band.
      scene.followBall(pseudoSession, target.itemID, orbitDistanceMeters, {
        queueHistorySafeContract: true,
        suppressFreshAcquireReplay: true,
      });
    }
    return;
  }
  if (
    entity.mode !== "ORBIT" ||
    toPositiveInt(entity.targetEntityID, 0) !== toPositiveInt(target.itemID, 0) ||
    Math.abs(toFiniteNumber(entity.orbitDistance, 0) - orbitDistanceMeters) > 1
  ) {
    scene.orbit(pseudoSession, target.itemID, orbitDistanceMeters, {
      queueHistorySafeContract: true,
      suppressFreshAcquireReplay: true,
    });
  }
}

function deactivateNpcPropulsion(scene, entity) {
  if (!scene || !entity || !(entity.activeModuleEffects instanceof Map)) {
    return;
  }

  const pseudoSession = buildNpcPseudoSession(entity);
  const now = toFiniteNumber(
    scene.getCurrentSimTimeMs && scene.getCurrentSimTimeMs(),
    Date.now(),
  );
  for (const effectState of [...entity.activeModuleEffects.values()]) {
    if (!effectState) {
      continue;
    }
    if (
      effectState.effectName !== PROPULSION_EFFECT_AFTERBURNER &&
      effectState.effectName !== PROPULSION_EFFECT_MICROWARPDRIVE
    ) {
      continue;
    }
    if (effectState.npcSyntheticPropulsion === true) {
      entity.activeModuleEffects.delete(effectState.moduleID);
      scene.refreshShipEntityDerivedState(entity, {
        broadcast: true,
        broadcastOptions: buildNpcSyntheticPropulsionBroadcastOptions(),
      });
      if (effectState.guid) {
        scene.broadcastSpecialFx(
          entity.itemID,
          effectState.guid,
          buildNpcSyntheticPropulsionFxOptions({
            moduleID: null,
            moduleTypeID: null,
            start: false,
            active: false,
            duration: effectState.durationMs,
          }),
          entity,
        );
      }
      continue;
    }
    scene.deactivatePropulsionModule(
      pseudoSession,
      toPositiveInt(effectState.moduleID, 0),
      {
        reason: "npc",
        deferUntilCycle: false,
      },
    );
  }
}

function activateNpcSyntheticPropulsion(scene, entity, behaviorProfile) {
  if (!scene || !entity) {
    return false;
  }

  const template = resolveSyntheticChasePropulsionTemplate(behaviorProfile);
  if (!template) {
    return false;
  }

  if (!(entity.activeModuleEffects instanceof Map)) {
    entity.activeModuleEffects = new Map();
  }

  for (const effectState of entity.activeModuleEffects.values()) {
    if (
      effectState &&
      effectState.npcSyntheticPropulsion === true &&
      effectState.effectName === template.effectName
    ) {
      return true;
    }
  }

  const now = toFiniteNumber(
    scene.getCurrentSimTimeMs && scene.getCurrentSimTimeMs(),
    Date.now(),
  );
  const effectState = {
    moduleID: -Math.max(1, toPositiveInt(entity.itemID, 0)),
    effectName: template.effectName,
    groupID: 0,
    typeID: 0,
    startedAtMs: now,
    durationMs: NPC_SYNTHETIC_PROPULSION_DURATION_MS,
    nextCycleAtMs: now + NPC_SYNTHETIC_PROPULSION_DURATION_MS,
    capNeed: 0,
    speedFactor: toFiniteNumber(template.speedFactor, 0),
    speedBoostFactor: toFiniteNumber(template.speedBoostFactor, 0),
    massAddition: toFiniteNumber(template.massAddition, 0),
    signatureRadiusBonus: toFiniteNumber(template.signatureRadiusBonus, 0),
    reactivationDelayMs: 0,
    guid: String(template.guid || ""),
    repeat: null,
    deactivationRequestedAtMs: 0,
    deactivateAtMs: 0,
    stopReason: null,
    npcSyntheticPropulsion: true,
  };
  entity.activeModuleEffects.set(effectState.moduleID, effectState);
  scene.refreshShipEntityDerivedState(entity, {
    broadcast: true,
    broadcastOptions: buildNpcSyntheticPropulsionBroadcastOptions(),
  });
  if (effectState.guid) {
    scene.broadcastSpecialFx(
      entity.itemID,
      effectState.guid,
      buildNpcSyntheticPropulsionFxOptions({
        moduleID: null,
        moduleTypeID: null,
        start: true,
        active: true,
        duration: effectState.durationMs,
      }),
      entity,
    );
  }
  return true;
}

function syncNpcPropulsion(scene, entity, target, behaviorProfile) {
  if (!scene || !entity || !target) {
    return;
  }

  if (behaviorProfile.useChasePropulsion !== true) {
    deactivateNpcPropulsion(scene, entity);
    return;
  }

  const propulsionModules = getNpcPropulsionModules(entity);
  if (propulsionModules.length === 0) {
    const activateDistanceMeters = Math.max(
      0,
      toFiniteNumber(behaviorProfile.chasePropulsionActivateDistanceMeters, 10_000),
    );
    const deactivateDistanceMeters = Math.max(
      0,
      toFiniteNumber(
        behaviorProfile.chasePropulsionDeactivateDistanceMeters,
        activateDistanceMeters,
      ),
    );
    const surfaceDistanceMeters = getSurfaceDistance(entity, target);
    if (surfaceDistanceMeters <= deactivateDistanceMeters) {
      deactivateNpcPropulsion(scene, entity);
      return;
    }
    if (surfaceDistanceMeters <= activateDistanceMeters) {
      return;
    }
    activateNpcSyntheticPropulsion(scene, entity, behaviorProfile);
    return;
  }

  const activateDistanceMeters = Math.max(
    0,
    toFiniteNumber(behaviorProfile.chasePropulsionActivateDistanceMeters, 10_000),
  );
  const deactivateDistanceMeters = Math.max(
    0,
    toFiniteNumber(
      behaviorProfile.chasePropulsionDeactivateDistanceMeters,
      activateDistanceMeters,
    ),
  );
  const surfaceDistanceMeters = getSurfaceDistance(entity, target);
  const preferredPropulsion = propulsionModules[0];
  const preferredModuleID = toPositiveInt(
    preferredPropulsion && preferredPropulsion.moduleItem && preferredPropulsion.moduleItem.itemID,
    0,
  );
  const activePropulsionEffects = entity.activeModuleEffects instanceof Map
    ? [...entity.activeModuleEffects.values()].filter((effectState) => (
      effectState &&
      (
        effectState.effectName === PROPULSION_EFFECT_AFTERBURNER ||
        effectState.effectName === PROPULSION_EFFECT_MICROWARPDRIVE
      )
    ))
    : [];
  const hasPreferredPropulsionActive = activePropulsionEffects.some((effectState) => (
    toPositiveInt(effectState && effectState.moduleID, 0) === preferredModuleID
  ));

  if (surfaceDistanceMeters <= deactivateDistanceMeters) {
    if (activePropulsionEffects.length > 0) {
      deactivateNpcPropulsion(scene, entity);
    }
    return;
  }

  if (surfaceDistanceMeters <= activateDistanceMeters) {
    return;
  }

  if (hasPreferredPropulsionActive) {
    return;
  }

  if (activePropulsionEffects.length > 0) {
    deactivateNpcPropulsion(scene, entity);
    return;
  }

  const pseudoSession = buildNpcPseudoSession(entity);
  scene.activatePropulsionModule(
    pseudoSession,
    preferredPropulsion.moduleItem,
    preferredPropulsion.effectName,
    {
      repeat: null,
    },
  );
}

function syncNpcWeapons(scene, entity, target) {
  const pseudoSession = buildNpcPseudoSession(entity);
  const entityMissileSource = getNpcEntityMissileWeaponSource(entity);
  const modules = getNpcWeaponModules(entity);
  const processedWeaponBankMasterIDs = new Set();
  const modulesByID = new Map(
    modules
      .map((moduleItem) => [toPositiveInt(moduleItem && moduleItem.itemID, 0), moduleItem])
      .filter(([moduleID]) => moduleID > 0),
  );
  logNpcCombatDebug("npc.weapons.sync.begin", () => ({
    entity: summarizeNpcCombatEntity(entity),
    target: summarizeNpcCombatEntity(target),
    entityMissileSource:
      entityMissileSource
        ? {
            chargeTypeID: toPositiveInt(entityMissileSource.chargeTypeID, 0),
            durationMs: toFiniteNumber(entityMissileSource.durationMs, 0),
            approxRange: toFiniteNumber(entityMissileSource.approxRange, 0),
            nextLaunchAtMs: toFiniteNumber(
              entity &&
              entity.npcEntityMissileState &&
              entity.npcEntityMissileState.nextLaunchAtMs,
              0,
            ),
          }
        : null,
    modules: modules.map(summarizeNpcCombatModule),
  }));
  if (entityMissileSource) {
    if (!entity.npcEntityMissileState || typeof entity.npcEntityMissileState !== "object") {
      entity.npcEntityMissileState = {
        targetID: 0,
        nextLaunchAtMs: 0,
      };
    }
    if (toPositiveInt(entity.npcEntityMissileState.targetID, 0) !== toPositiveInt(target.itemID, 0)) {
      entity.npcEntityMissileState.targetID = toPositiveInt(target.itemID, 0);
      entity.npcEntityMissileState.nextLaunchAtMs = 0;
    }

    const now = scene.getCurrentSimTimeMs();
    if (
      getSurfaceDistance(entity, target) <= entityMissileSource.approxRange + 1 &&
      now >= toFiniteNumber(entity.npcEntityMissileState.nextLaunchAtMs, 0)
    ) {
      const launchResult = scene.launchMissile(
        entity,
        target.itemID,
        entityMissileSource,
        {
          launchTimeMs: now,
          chargeItem: {
            typeID: entityMissileSource.chargeTypeID,
            groupID: entityMissileSource.chargeGroupID,
            categoryID: entityMissileSource.chargeCategoryID,
            itemName: entityMissileSource.chargeName,
          },
          moduleItem: {
            itemID: 0,
            typeID: 0,
          },
          launchModules: entityMissileSource.launchModules,
        },
      );
      logNpcCombatDebug("npc.weapons.entity-missile-launch", () => ({
        entity: summarizeNpcCombatEntity(entity),
        target: summarizeNpcCombatEntity(target),
        success: Boolean(launchResult && launchResult.success),
        errorMsg: launchResult && launchResult.success === false
          ? String(launchResult.errorMsg || "")
          : null,
        chargeTypeID: toPositiveInt(entityMissileSource.chargeTypeID, 0),
      }));
      if (launchResult && launchResult.success) {
        entity.npcEntityMissileState.nextLaunchAtMs = now + entityMissileSource.durationMs;
      }
    }
  }
  for (const rawModuleItem of modules) {
    const authoredBankModuleIDs = Array.isArray(rawModuleItem && rawModuleItem.npcWeaponBankModuleIDs)
      ? rawModuleItem.npcWeaponBankModuleIDs
          .map((moduleID) => toPositiveInt(moduleID, 0))
          .filter((moduleID) => moduleID > 0)
      : [];
    const authoredBankMasterID = toPositiveInt(
      rawModuleItem && rawModuleItem.npcWeaponBankMasterID,
      0,
    );
    const bankGroup =
      authoredBankMasterID > 0 && authoredBankModuleIDs.length > 1
        ? {
            masterModuleID: authoredBankMasterID,
            masterModuleItem: modulesByID.get(authoredBankMasterID) || null,
            moduleIDs: authoredBankModuleIDs,
          }
        : getNpcWeaponBankGroupForModule(entity, rawModuleItem);
    const bankMasterModuleID = toPositiveInt(
      bankGroup && bankGroup.masterModuleID,
      toPositiveInt(rawModuleItem && rawModuleItem.itemID, 0),
    );
    const bankModuleIDs =
      bankGroup && Array.isArray(bankGroup.moduleIDs) && bankGroup.moduleIDs.length > 1
        ? [...bankGroup.moduleIDs]
        : [toPositiveInt(rawModuleItem && rawModuleItem.itemID, 0)].filter((moduleID) => moduleID > 0);
    if (bankMasterModuleID <= 0 || processedWeaponBankMasterIDs.has(bankMasterModuleID)) {
      continue;
    }
    processedWeaponBankMasterIDs.add(bankMasterModuleID);

    const moduleItem =
      bankGroup &&
      bankGroup.masterModuleItem &&
      toPositiveInt(bankGroup.masterModuleItem.itemID, 0) === bankMasterModuleID
        ? bankGroup.masterModuleItem
        : rawModuleItem;
    if (toPositiveInt(moduleItem && moduleItem.itemID, 0) !== bankMasterModuleID) {
      continue;
    }

    const activeEffect = entity.activeModuleEffects instanceof Map
      ? (
          bankModuleIDs
            .map((moduleID) => entity.activeModuleEffects.get(toPositiveInt(moduleID, 0)) || null)
            .find(Boolean) ||
          [...entity.activeModuleEffects.values()].find((effectState) => (
            effectState &&
            Array.isArray(effectState.bankModuleIDs) &&
            effectState.bankModuleIDs.some((moduleID) => bankModuleIDs.includes(toPositiveInt(moduleID, 0)))
          )) ||
          null
        )
      : null;
    if (
      activeEffect &&
      toPositiveInt(activeEffect.targetID, 0) !== toPositiveInt(target.itemID, 0)
    ) {
      logNpcCombatDebug("npc.weapons.module-retarget-deactivate", () => ({
        entity: summarizeNpcCombatEntity(entity),
        target: summarizeNpcCombatEntity(target),
        moduleItem: summarizeNpcCombatModule(moduleItem),
        activeTargetID: toPositiveInt(activeEffect && activeEffect.targetID, 0),
      }));
      scene.deactivateGenericModule(pseudoSession, activeEffect.moduleID || moduleItem.itemID, {
        reason: "npc",
        deferUntilCycle: false,
      });
      continue;
    }
    if (activeEffect) {
      logNpcCombatDebug("npc.weapons.module-already-active", () => ({
        entity: summarizeNpcCombatEntity(entity),
        target: summarizeNpcCombatEntity(target),
        moduleItem: summarizeNpcCombatModule(moduleItem),
        activeTargetID: toPositiveInt(activeEffect && activeEffect.targetID, 0),
      }));
      continue;
    }

    const effectiveRange = estimateNpcWeaponEffectiveRange(entity, moduleItem);
    if (
      effectiveRange > 0 &&
      getSurfaceDistance(entity, target) > effectiveRange + 1
    ) {
      logNpcCombatDebug("npc.weapons.module-range-wait", () => ({
        entity: summarizeNpcCombatEntity(entity),
        target: summarizeNpcCombatEntity(target),
        moduleItem: summarizeNpcCombatModule(moduleItem),
        effectiveRange,
      }));
      continue;
    }

    const activationOutcome = scene.activateGenericModule(
      pseudoSession,
      moduleItem,
      String(moduleItem && moduleItem.npcEffectName || "").trim() || null,
      {
        targetID: target.itemID,
        activationHint: "weapon",
        bankModuleIDs,
        deferInitialCycleMs: getNpcInitialModuleCycleDelayMs(entity, moduleItem, 1),
      },
    );
    logNpcCombatDebug("npc.weapons.module-activate", () => ({
      entity: summarizeNpcCombatEntity(entity),
      target: summarizeNpcCombatEntity(target),
      moduleItem: summarizeNpcCombatModule(moduleItem),
      success: Boolean(activationOutcome && activationOutcome.success),
      errorMsg:
        activationOutcome && activationOutcome.success === false
          ? String(activationOutcome.errorMsg || "")
          : null,
    }));
  }
}

function syncNpcReturnHome(scene, entity, controller, behaviorProfile, now) {
  const pseudoSession = buildNpcPseudoSession(entity);
  const homePosition = controller && controller.homePosition;
  if (!homePosition || behaviorProfile.returnToHomeWhenIdle === false) {
    controller.returningHome = false;
    stopNpcMovement(scene, entity);
    return;
  }

  const arrivalMeters = Math.max(
    250,
    toFiniteNumber(behaviorProfile.homeArrivalMeters, 1500),
  );
  const distanceToHome = distance(entity.position, homePosition);
  if (distanceToHome <= arrivalMeters) {
    controller.returningHome = false;
    stopNpcMovement(scene, entity);
    return;
  }

  const homeDirection = normalizeVector(
    subtractVectors(homePosition, entity.position),
    entity.direction || controller.homeDirection || { x: 1, y: 0, z: 0 },
  );
  const shouldRefreshCommand =
    entity.mode !== "GOTO" ||
    toFiniteNumber(controller.lastHomeCommandAtMs, 0) + 1_000 <= now ||
    isDirectionChangeSignificant(controller.lastHomeDirection || null, homeDirection);

  controller.returningHome = true;
  if (!shouldRefreshCommand) {
    return;
  }

  scene.gotoDirection(pseudoSession, homeDirection, {
    queueHistorySafeContract: true,
    suppressFreshAcquireReplay: true,
  });
  controller.lastHomeCommandAtMs = now;
  controller.lastHomeDirection = homeDirection;
}

function resolveIdleAnchorEntity(scene, controller, entity) {
  const anchorID = toPositiveInt(controller && controller.anchorID, 0);
  if (!scene || !anchorID || anchorID === toPositiveInt(entity && entity.itemID, 0)) {
    return null;
  }

  return scene.getEntityByID(anchorID);
}

function resolveIdleAnchorOrbitDistance(entity, controller, anchorEntity, behaviorProfile) {
  const explicitDistance = Math.max(
    0,
    toFiniteNumber(behaviorProfile && behaviorProfile.idleAnchorOrbitDistanceMeters, 0),
  );
  if (explicitDistance > 0) {
    return explicitDistance;
  }

  const homePosition = controller && controller.homePosition;
  if (homePosition && anchorEntity && anchorEntity.position) {
    const derivedSurfaceDistance = Math.max(
      0,
      distance(homePosition, anchorEntity.position) -
        toFiniteNumber(entity && entity.radius, 0) -
        toFiniteNumber(anchorEntity && anchorEntity.radius, 0),
    );
    if (derivedSurfaceDistance > 0) {
      return derivedSurfaceDistance;
    }
  }

  return Math.max(
    2_500,
    toFiniteNumber(behaviorProfile && behaviorProfile.orbitDistanceMeters, 0),
  );
}

function syncNpcIdleAnchorOrbit(scene, entity, controller, behaviorProfile) {
  if (behaviorProfile.idleAnchorOrbit !== true) {
    return false;
  }

  const anchorEntity = resolveIdleAnchorEntity(scene, controller, entity);
  if (!anchorEntity) {
    return false;
  }

  const orbitDistanceMeters = resolveIdleAnchorOrbitDistance(
    entity,
    controller,
    anchorEntity,
    behaviorProfile,
  );
  if (orbitDistanceMeters <= 0) {
    return false;
  }

  if (
    entity.mode !== "ORBIT" ||
    toPositiveInt(entity.targetEntityID, 0) !== toPositiveInt(anchorEntity.itemID, 0) ||
    Math.abs(toFiniteNumber(entity.orbitDistance, 0) - orbitDistanceMeters) > 1
  ) {
    scene.orbit(
      buildNpcPseudoSession(entity),
      anchorEntity.itemID,
      orbitDistanceMeters,
      {
        queueHistorySafeContract: true,
        suppressFreshAcquireReplay: true,
      },
    );
  }

  controller.returningHome = false;
  return true;
}

function tryNpcIdleAnchorWarp(scene, entity, controller, behaviorProfile, nowMs) {
  if (!scene || !entity || !controller || behaviorProfile.idleAnchorOrbit !== true) {
    return {
      handled: false,
      nextThinkAtMs: null,
    };
  }

  const anchorEntity = resolveIdleAnchorEntity(scene, controller, entity);
  if (!anchorEntity) {
    return {
      handled: false,
      nextThinkAtMs: null,
    };
  }

  if (
    toPositiveInt(entity.bubbleID, 0) > 0 &&
    toPositiveInt(anchorEntity.bubbleID, 0) > 0 &&
    toPositiveInt(entity.bubbleID, 0) === toPositiveInt(anchorEntity.bubbleID, 0)
  ) {
    return {
      handled: false,
      nextThinkAtMs: null,
    };
  }

  const anchorDestination = resolveDrifterPursuitPoint(anchorEntity);
  if (
    !anchorDestination ||
    distance(entity.position, anchorDestination) <= NPC_IDLE_ANCHOR_WARP_MIN_DISTANCE_METERS
  ) {
    return {
      handled: false,
      nextThinkAtMs: null,
    };
  }

  return beginNpcWarpToPoint(
    scene,
    entity,
    controller,
    anchorDestination,
    {
      cooldownField: "lastIdleAnchorWarpAtMs",
      cooldownMs: NPC_IDLE_ANCHOR_WARP_COOLDOWN_MS,
      nowMs,
    },
  );
}

function isBeyondLeash(entity, controller, behaviorProfile) {
  const leashRangeMeters = Math.max(
    0,
    toFiniteNumber(behaviorProfile.leashRangeMeters, 0),
  );
  if (leashRangeMeters <= 0) {
    return false;
  }

  if (controller && controller.homePosition) {
    return distance(entity.position, controller.homePosition) > leashRangeMeters;
  }

  return false;
}

function shouldMaintainLock(manualOrder) {
  if (!manualOrder) {
    return true;
  }
  if (manualOrder.keepLock !== null) {
    return manualOrder.keepLock === true;
  }

  return (
    manualOrder.type === "attack" ||
    manualOrder.type === "holdFire"
  );
}

function shouldAllowWeapons(manualOrder, behaviorProfile) {
  if (manualOrder && manualOrder.allowWeapons !== null) {
    return manualOrder.allowWeapons === true;
  }
  if (manualOrder && manualOrder.type === "holdFire") {
    return false;
  }
  if (manualOrder && (manualOrder.type === "orbit" || manualOrder.type === "follow")) {
    return false;
  }
  return behaviorProfile.autoActivateWeapons !== false;
}

function scheduleNextThink(controller, behaviorProfile, now, forcedAtMs = null, options = {}) {
  const defaultNextThinkAtMs =
    now + Math.max(50, toFiniteNumber(behaviorProfile.thinkIntervalMs, 250));
  const normalizedForcedAtMs = toFiniteNumber(forcedAtMs, 0);
  const notBeforeMs = toFiniteNumber(options && options.notBeforeMs, 0);
  if (normalizedForcedAtMs > now) {
    controller.nextThinkAtMs = Math.min(defaultNextThinkAtMs, normalizedForcedAtMs);
    return;
  }
  controller.nextThinkAtMs =
    notBeforeMs > now
      ? Math.max(defaultNextThinkAtMs, notBeforeMs)
      : defaultNextThinkAtMs;
}

function tickController(scene, controller, now) {
  const entity = scene.getEntityByID(controller.entityID);
  if (!entity || entity.kind !== "ship") {
    unregisterController(controller.entityID);
    return;
  }

  const behaviorProfile = resolveEffectiveBehaviorProfile(controller);
  const manualOrder = normalizeManualOrder(controller.manualOrder);
  if (!manualOrder && controller.manualOrder) {
    controller.manualOrder = null;
  }

  if (manualOrder && manualOrder.type === "stop") {
    clearNpcCombatState(scene, entity, controller, {
      deactivateWeapons: true,
      clearTargets: true,
      stopShip: true,
    });
    scheduleNextThink(controller, behaviorProfile, now);
    return;
  }

  if (manualOrder && manualOrder.type === "returnHome") {
    clearNpcCombatState(scene, entity, controller, {
      deactivateWeapons: true,
      clearTargets: true,
      stopShip: false,
    });
    syncNpcReturnHome(scene, entity, controller, behaviorProfile, now);
    scheduleNextThink(controller, behaviorProfile, now);
    return;
  }

  const desiredTarget = resolveDesiredTarget(
    scene,
    controller,
    entity,
    behaviorProfile,
    manualOrder,
  );
  if (!desiredTarget) {
    const maintainedAssistance = syncNpcAssistanceModules(scene, entity, controller);
    if (maintainedAssistance) {
      controller.returningHome = false;
      scheduleNextThink(controller, behaviorProfile, now);
      return;
    }
    const drifterTravel = tryDrifterPursuitOrRegroup(
      scene,
      entity,
      controller,
      behaviorProfile,
      now,
    );
    if (drifterTravel && drifterTravel.handled === true) {
      const nextThinkAtMs = toFiniteNumber(
        drifterTravel.nextThinkAtMs,
        toFiniteNumber(controller.nextThinkAtMs, now + 1_000),
      );
      controller.nextThinkAtMs = Math.max(now + 50, nextThinkAtMs);
      controller.returningHome = false;
      return;
    }
    const targetOnlyManualOrder = Boolean(
      manualOrder &&
      manualOrder.targetID > 0 &&
      (
        manualOrder.type === "attack" ||
        manualOrder.type === "orbit" ||
        manualOrder.type === "follow"
      ),
    );
    clearNpcCombatState(scene, entity, controller, {
      deactivateWeapons: true,
      clearTargets: true,
      stopShip: targetOnlyManualOrder,
    });
    if (!targetOnlyManualOrder) {
      const idleAnchorWarp = tryNpcIdleAnchorWarp(
        scene,
        entity,
        controller,
        behaviorProfile,
        now,
      );
      if (idleAnchorWarp && idleAnchorWarp.handled === true) {
        const nextThinkAtMs = toFiniteNumber(
          idleAnchorWarp.nextThinkAtMs,
          toFiniteNumber(controller.nextThinkAtMs, now + 1_000),
        );
        controller.nextThinkAtMs = Math.max(now + 50, nextThinkAtMs);
        controller.returningHome = false;
        return;
      }
      const handledIdleAnchorOrbit = syncNpcIdleAnchorOrbit(
        scene,
        entity,
        controller,
        behaviorProfile,
      );
      if (!handledIdleAnchorOrbit) {
        const handledCapitalReturnHome =
          entity && entity.capitalNpc === true
            ? syncCapitalNpcReturnHome(
                scene,
                entity,
                controller,
                behaviorProfile,
                { nowMs: now },
              )
            : false;
        if (!handledCapitalReturnHome) {
          syncNpcReturnHome(scene, entity, controller, behaviorProfile, now);
        }
      }
    }
    scheduleNextThink(controller, behaviorProfile, now);
    return;
  }

  if (isBeyondLeash(entity, controller, behaviorProfile)) {
    clearNpcCombatState(scene, entity, controller, {
      deactivateWeapons: true,
      clearTargets: true,
      stopShip: false,
    });
    const handledCapitalReturnHome =
      entity && entity.capitalNpc === true
        ? syncCapitalNpcReturnHome(
            scene,
            entity,
            controller,
            behaviorProfile,
            { nowMs: now },
          )
        : false;
    if (!handledCapitalReturnHome) {
      syncNpcReturnHome(scene, entity, controller, behaviorProfile, now);
    }
    scheduleNextThink(controller, behaviorProfile, now);
    return;
  }

  const baseMovementDirective = resolveMovementDirective(manualOrder, behaviorProfile);
  const movementDirective =
    entity && entity.capitalNpc === true && desiredTarget
      ? resolveCapitalMovementDirective(
          entity,
          behaviorProfile,
          desiredTarget,
          baseMovementDirective,
        )
      : baseMovementDirective;
  const maintainLock = shouldMaintainLock(manualOrder);
  const baseAllowWeapons = shouldAllowWeapons(manualOrder, behaviorProfile);
  const capitalEngagement =
    entity && entity.capitalNpc === true && desiredTarget && desiredTarget.kind === "ship"
      ? resolveCapitalEngagementPolicy(
          entity,
          controller,
          behaviorProfile,
          desiredTarget,
          {
            nowMs: now,
            getSurfaceDistance,
          },
        )
      : null;
  const allowWeapons =
    baseAllowWeapons &&
    (
      !capitalEngagement ||
      capitalEngagement.allowWeapons === true
    );
  let nextThinkOverrideMs = null;
  if (capitalEngagement && capitalEngagement.nextThinkOverrideMs) {
    nextThinkOverrideMs = toFiniteNumber(capitalEngagement.nextThinkOverrideMs, null);
  }

  const desiredTargetID = toPositiveInt(desiredTarget.itemID, 0);
  const combatMaintenanceTargetChanged =
    toPositiveInt(controller._npcCombatMaintenanceTargetID, 0) !== desiredTargetID;
  if (combatMaintenanceTargetChanged) {
    resetNpcCombatMaintenanceCadence(controller, desiredTargetID);
  }
  controller.currentTargetID = desiredTargetID;
  controller.returningHome = false;
  publishDrifterPursuitLocation(
    scene,
    entity,
    controller,
    desiredTarget,
    now,
  );
  const handledCapitalMovement =
    entity && entity.capitalNpc === true
      ? syncCapitalNpcMovement(
          scene,
          entity,
          controller,
          desiredTarget,
          movementDirective,
          { nowMs: now },
        )
      : false;
  if (!handledCapitalMovement) {
    syncNpcMovement(scene, entity, desiredTarget, movementDirective);
  }
  if (movementDirective.movementMode === "hold" || movementDirective.movementMode === "stop") {
    deactivateNpcPropulsion(scene, entity);
  } else {
    syncNpcPropulsion(scene, entity, desiredTarget, behaviorProfile);
  }

  const drifterEngagement =
    entity && entity.nativeNpc === true
      ? syncDrifterCombatSystems(
          scene,
          entity,
          controller,
          behaviorProfile,
          desiredTarget,
          { nowMs: now },
        )
      : {
          forceMaintainLock: false,
          suppressWeapons: false,
          suppressHostiles: false,
          nextThinkOverrideMs: null,
          preservedModuleIDs: [],
        };
  if (
    drifterEngagement &&
    drifterEngagement.nextThinkOverrideMs !== null &&
    drifterEngagement.nextThinkOverrideMs !== undefined
  ) {
    nextThinkOverrideMs =
      nextThinkOverrideMs === null
        ? toFiniteNumber(drifterEngagement.nextThinkOverrideMs, null)
        : Math.min(
            toFiniteNumber(nextThinkOverrideMs, null),
            toFiniteNumber(
              drifterEngagement.nextThinkOverrideMs,
              nextThinkOverrideMs,
            ),
          );
  }

  const maintainCombatLock = maintainLock || drifterEngagement.forceMaintainLock === true;
  const allowCombatWeapons =
    allowWeapons && drifterEngagement.suppressWeapons !== true;

  if (maintainCombatLock) {
    scene.validateEntityTargetLocks(entity, now);
  }

  const lockedTargets = scene.getTargetsForEntity(entity);
  const pendingTargetLocks = scene.getSortedPendingTargetLocks(entity);
  const hasDesiredLock = lockedTargets.includes(desiredTarget.itemID);
  const hasPendingDesiredLock = pendingTargetLocks.some(
    (pendingLock) => toPositiveInt(pendingLock && pendingLock.targetID, 0) === desiredTarget.itemID,
  );
  if (
    entity &&
    entity.nativeNpc === true &&
    (
      desiredTarget ||
      lockedTargets.length > 0 ||
      pendingTargetLocks.length > 0 ||
      (entity.activeModuleEffects instanceof Map && entity.activeModuleEffects.size > 0)
    )
  ) {
    logNpcCombatDebug("npc.tick.combat", () => ({
      entity: summarizeNpcCombatEntity(entity),
      desiredTarget: summarizeNpcCombatEntity(desiredTarget),
      maintainLock: maintainCombatLock,
      allowWeapons: allowCombatWeapons,
      lockedTargets,
      pendingTargetLocks: pendingTargetLocks.map((entry) => ({
        targetID: toPositiveInt(entry && entry.targetID, 0),
        completeAtMs: toFiniteNumber(entry && entry.completeAtMs, 0),
      })),
      hasDesiredLock,
      hasPendingDesiredLock,
      movementMode: String(movementDirective && movementDirective.movementMode || ""),
    }));
  }

  if (maintainCombatLock) {
    if (!hasDesiredLock && !hasPendingDesiredLock) {
      scene.addTarget(buildNpcPseudoSession(entity), desiredTarget.itemID);
      const pendingLock = scene.getSortedPendingTargetLocks(entity).find(
        (entry) => toPositiveInt(entry && entry.targetID, 0) === desiredTarget.itemID,
      );
      if (pendingLock) {
        nextThinkOverrideMs = toFiniteNumber(pendingLock.completeAtMs, null);
      }
    }
  } else if (lockedTargets.length > 0 || pendingTargetLocks.length > 0) {
    clearNpcTargetLocks(scene, entity);
  }

  if (nextThinkOverrideMs === null && hasPendingDesiredLock) {
    const pendingLock = pendingTargetLocks.find(
      (entry) => toPositiveInt(entry && entry.targetID, 0) === desiredTarget.itemID,
    );
    if (pendingLock) {
      nextThinkOverrideMs = toFiniteNumber(pendingLock.completeAtMs, null);
    }
  }

  if (maintainCombatLock && hasDesiredLock) {
    syncCapitalNpcSystems(scene, entity, controller, behaviorProfile, desiredTarget, {
      nowMs: now,
    });
  }

  const shouldRunAssistanceMaintenance =
    combatMaintenanceTargetChanged ||
    isNpcMaintenanceDue(
      controller,
      "_lastNpcAssistanceMaintenanceAtMs",
      now,
      NPC_ASSISTANCE_MAINTENANCE_MS,
      entity,
      1,
    );
  if (maintainCombatLock && allowCombatWeapons && shouldRunAssistanceMaintenance) {
    syncNpcAssistanceModules(scene, entity, controller);
  }

  if (maintainCombatLock && allowCombatWeapons && hasDesiredLock) {
    const shouldRunSelfMaintenance =
      combatMaintenanceTargetChanged ||
      isNpcMaintenanceDue(
        controller,
        "_lastNpcSelfModuleMaintenanceAtMs",
        now,
        NPC_SELF_MODULE_MAINTENANCE_MS,
        entity,
        2,
      );
    if (shouldRunSelfMaintenance) {
      syncNpcSelfModules(scene, entity, desiredTarget, {
        combatEnabled: true,
      });
    }

    const shouldRunWeaponMaintenance =
      combatMaintenanceTargetChanged ||
      isNpcMaintenanceDue(
        controller,
        "_lastNpcWeaponMaintenanceAtMs",
        now,
        NPC_WEAPON_MAINTENANCE_MS,
        entity,
        3,
      );
    if (shouldRunWeaponMaintenance) {
      syncNpcWeapons(scene, entity, desiredTarget);
    }

    const shouldRunHostileMaintenance =
      combatMaintenanceTargetChanged ||
      isNpcMaintenanceDue(
        controller,
        "_lastNpcHostileMaintenanceAtMs",
        now,
        NPC_HOSTILE_MAINTENANCE_MS,
        entity,
        4,
      );
    if (drifterEngagement.suppressHostiles !== true && shouldRunHostileMaintenance) {
      syncNpcHostileModules(scene, entity, desiredTarget);
    }
  } else {
    if (entity && entity.nativeNpc === true) {
      logNpcCombatDebug("npc.tick.weapons-blocked", () => ({
        entity: summarizeNpcCombatEntity(entity),
        desiredTarget: summarizeNpcCombatEntity(desiredTarget),
        maintainLock: maintainCombatLock,
        allowWeapons: allowCombatWeapons,
        hasDesiredLock,
        hasPendingDesiredLock,
      }));
    }
    deactivateNpcWeapons(scene, entity, {
      excludeModuleIDs:
        drifterEngagement &&
        Array.isArray(drifterEngagement.preservedModuleIDs)
          ? drifterEngagement.preservedModuleIDs
          : [],
    });
  }

  const stableCombatNotBeforeMs =
    nextThinkOverrideMs === null &&
    maintainCombatLock &&
    allowCombatWeapons &&
    hasDesiredLock
      ? now +
        NPC_STABLE_COMBAT_RESYNC_MS +
        getNpcMaintenanceJitterMs(entity, 8, NPC_STABLE_COMBAT_RESYNC_MS)
      : 0;
  scheduleNextThink(controller, behaviorProfile, now, nextThinkOverrideMs, {
    notBeforeMs: stableCombatNotBeforeMs,
  });
}

function tickScene(scene, now) {
  if (!scene) {
    return;
  }

  const controllers = listControllersBySystem(scene.systemID);
  if (controllers.length <= 0) {
    scene._npcBehaviorTickCursor = 0;
    return;
  }

  const startedAtMs = performance.now();
  const startIndex =
    Math.max(0, toPositiveInt(scene._npcBehaviorTickCursor, 0)) %
    controllers.length;
  let processed = 0;
  let nextCursor = 0;
  let exhausted = true;

  for (let offset = 0; offset < controllers.length; offset += 1) {
    const controllerIndex = (startIndex + offset) % controllers.length;
    nextCursor = (controllerIndex + 1) % controllers.length;
    if (
      processed > 0 &&
      (
        processed >= NPC_BEHAVIOR_MAX_CONTROLLERS_PER_TICK ||
        performance.now() - startedAtMs >= NPC_BEHAVIOR_TICK_BUDGET_MS
      )
    ) {
      exhausted = false;
      break;
    }

    const controller = controllers[controllerIndex];
    if (String(controller && controller.runtimeKind || "").trim() === "nativeAmbient") {
      continue;
    }
    if (toFiniteNumber(controller.nextThinkAtMs, 0) > now) {
      continue;
    }
    tickController(scene, controller, now);
    processed += 1;
  }

  scene._npcBehaviorTickCursor = exhausted ? 0 : nextCursor;
}

function tickControllersByEntityID(scene, entityIDs, now) {
  if (!scene) {
    return;
  }

  const normalizedEntityIDs = [
    ...new Set(
      (Array.isArray(entityIDs) ? entityIDs : [entityIDs])
        .map((entityID) => toPositiveInt(entityID, 0))
        .filter((entityID) => entityID > 0),
    ),
  ];
  if (normalizedEntityIDs.length === 0) {
    return;
  }

  for (const entityID of normalizedEntityIDs) {
    const controller = getControllerByEntityID(entityID);
    if (!controller) {
      continue;
    }
    if (String(controller && controller.runtimeKind || "").trim() === "nativeAmbient") {
      continue;
    }
    if (toFiniteNumber(controller.nextThinkAtMs, 0) > now) {
      continue;
    }
    tickController(scene, controller, now);
  }
}

function issueManualOrder(entityID, order) {
  const controller = getControllerByEntityID(entityID);
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  const normalizedOrder = normalizeManualOrder(order);
  controller.manualOrder = normalizedOrder;
  const manualTargetID = toPositiveInt(
    normalizedOrder && normalizedOrder.targetID,
    0,
  );
  if (
    normalizedOrder &&
    manualTargetID > 0 &&
    (
      normalizedOrder.type === "attack" ||
      normalizedOrder.type === "orbit" ||
      normalizedOrder.type === "follow" ||
      normalizedOrder.type === "holdFire"
    )
  ) {
    if (String(controller.runtimeKind || "").trim() === "nativeAmbient") {
      controller.runtimeKind = "nativeCombat";
    }
    controller.currentTargetID = manualTargetID;
    controller.preferredTargetID = manualTargetID;
  } else if (
    normalizedOrder &&
    (
      normalizedOrder.type === "stop" ||
      normalizedOrder.type === "returnHome"
    )
  ) {
    controller.currentTargetID = 0;
  }
  controller.nextThinkAtMs = 0;
  return {
    success: true,
    data: controller,
  };
}

function setBehaviorOverrides(entityID, overrides) {
  const controller = getControllerByEntityID(entityID);
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  controller.behaviorOverrides = normalizeBehaviorOverrides(overrides);
  controller.nextThinkAtMs = 0;
  return {
    success: true,
    data: controller,
  };
}

function noteIncomingAggression(entityID, attackerEntityID, now = Date.now(), options = {}) {
  const controller = getControllerByEntityID(entityID);
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  const normalizedAttackerEntityID = toPositiveInt(attackerEntityID, 0);
  if (!normalizedAttackerEntityID) {
    return {
      success: false,
      errorMsg: "ATTACKER_NOT_FOUND",
    };
  }

  controller.preferredTargetID = normalizedAttackerEntityID;
  controller.lastAggressorID = normalizedAttackerEntityID;
  controller.preferredTargetOwnerID = toPositiveInt(options.attackerOwnerID, 0);
  controller.lastAggressorOwnerID = toPositiveInt(options.attackerOwnerID, 0);
  controller.lastAggressedAtMs = toFiniteNumber(now, Date.now());
  controller.nextThinkAtMs = Math.min(
    toFiniteNumber(controller.nextThinkAtMs, controller.lastAggressedAtMs),
    controller.lastAggressedAtMs,
  );
  return {
    success: true,
    data: controller,
  };
}

module.exports = {
  normalizeBehaviorOverrides,
  tickScene,
  tickControllersByEntityID,
  issueManualOrder,
  setBehaviorOverrides,
  noteIncomingAggression,
  __testing: {
    isFriendlyCombatTarget,
    buildNpcSyntheticPropulsionBroadcastOptions,
    buildNpcSyntheticPropulsionFxOptions,
    syncNpcMovement,
    syncNpcPropulsion,
    syncNpcWeapons,
    syncNpcHostileModules,
  },
};
