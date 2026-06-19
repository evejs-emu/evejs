const crypto = require("crypto");
const path = require("path");
const { performance } = require("perf_hooks");
const rotatingLog = require(path.join(__dirname, "../utils/rotatingLog"));
const syncLedger = require(path.join(__dirname, "../network/syncLedger"));

const config = require(path.join(__dirname, "../config"));
const log = require(path.join(__dirname, "../utils/logger"));
const {
  updateShipItem,
  updateInventoryItem,
  removeInventoryItem,
  listContainerItems,
  listSystemSpaceItems,
  findItemById,
  findShipItemById,
  getShipConditionState,
  normalizeShipConditionState,
  getItemMetadata,
  pruneExpiredSpaceItems,
} = require(path.join(__dirname, "../services/inventory/itemStore"));
const {
  resolveRuntimeWreckRadius,
  resolveRuntimeWreckStructureFallbackHP,
} = require(path.join(__dirname, "../services/inventory/wreckRadius"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../services/inventory/itemTypeRegistry"));
const {
  resolveStargatePhysicalRadius,
} = require(path.join(__dirname, "./stargateRadius"));
const {
  getStargateVisualOverrideField,
} = require(path.join(__dirname, "./stargateVisualOverrides"));
const {
  buildDunRotationFromNormalizedDirection: buildStargateDunRotationFromDirection,
  getStargateSystemForwardDirection,
} = require(path.join(__dirname, "./stargateOrientation"));
const {
  getClientParityWarpInPoint,
} = require(path.join(__dirname, "./destiny/simulation/warpInPointParity"));
const defaultEmpireScenery = require(path.join(__dirname, "./defaultEmpireScenery"));
const authoredSpaceProps = require(path.join(__dirname, "./authoredSpaceProps"));
const planetOrbitalState = require(path.join(__dirname, "../services/planet/planetOrbitalState"));
const {
  getAppliedSkinMaterialSetID,
} = require(path.join(__dirname, "../services/ship/shipCosmeticsState"));
const {
  getEnabledCosmeticsEntries,
} = require(path.join(__dirname, "../services/ship/shipLogoFittingState"));
const {
  getModulesInBank: getGroupedWeaponBankModuleIDs,
  getMasterModuleID: getGroupedWeaponBankMasterID,
} = require(path.join(__dirname, "../services/moduleGrouping/moduleGroupingRuntime"));
const {
  getFittedModuleItems,
  buildSlimModuleTuples,
  buildCharacterTargetingState,
  buildChargeTupleItemID,
  buildShipResourceState,
  getAttributeIDByNames,
  getEffectIDByNames,
  getTypeDogmaAttributes,
  getTypeDogmaEffects,
  getTypeAttributeValue,
  getEffectTypeRecord,
  getLoadedChargeByFlag,
  isChargeCompatibleWithModule,
  isModuleOnline,
  appendDirectModifierEntries,
  buildEffectiveItemAttributeMap,
} = require(path.join(__dirname, "../services/fitting/liveFittingState"));
const {
  buildLiveModuleAttributeMap,
} = require(path.join(__dirname, "./modules/liveModuleAttributes"));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../services/skills/skillState"));
const {
  isNativeNpcEntity,
  getNpcFittedModuleItems,
  getNpcLoadedChargeForModule,
  getNpcWeaponModules,
  getNpcHostileModules,
  getNpcAssistanceModules,
  getNpcSelfModules,
  getNpcSuperweaponModules,
  getNpcPropulsionModules,
} = require(path.join(__dirname, "./npc/npcEquipment"));
const {
  logNpcCombatDebug,
  summarizeNpcCombatEntity,
  summarizeNpcCombatModule,
} = require(path.join(__dirname, "./npc/npcCombatDebug"));
const {
  buildStartupPresenceSummary,
  getSceneActivityState,
} = require(path.join(__dirname, "./npc/npcSceneActivity"));
const {
  materializeAmbientStartupControllersForScene,
  dematerializeAmbientStartupControllersForScene,
} = require(path.join(__dirname, "./npc/npcAmbientMaterialization"));
const {
  MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
  MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
} = require(path.join(__dirname, "./movement/movementMichelleContract"));
const {
  DESTINY_CONTRACTS,
} = require(path.join(__dirname, "./movement/authority/destinyContracts"));
const {
  snapshotDestinyAuthorityState,
} = require(path.join(__dirname, "./movement/authority/destinySessionState"));
const {
  PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
} = require(path.join(__dirname, "./movement/warp/movementWarpContract"));
const {
  DESTINY_STAMP_INTERVAL_MS,
  DESTINY_STAMP_MAX_LEAD,
  OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
  projectPreviouslySentDestinyLane,
  resolvePreviousLastSentDestinyWasOwnerCritical,
  resolveOwnerMonotonicState,
  resolveGotoCommandSyncState,
  resolveDestinyLifecycleRestampState,
  resolveDamageStateDispatchStamp,
} = require(path.join(__dirname, "./movement/movementDeliveryPolicy"));
const {
  isMovementContractPayload,
  isSteeringPayloadName,
  updatesContainMovementContractPayload,
} = require(path.join(__dirname, "./movement/movementParity"));
const {
  resolvePresentedSessionDestinyStamp,
  resolvePendingHistorySafeSessionDestinyStamp,
} = require(path.join(__dirname, "./movement/movementSessionWindows"));
const {
  resolveStateRefreshStamp,
  clampQueuedSubwarpUpdates,
} = require(path.join(__dirname, "./movement/movementSync"));
const {
  tagUpdatesRequireExistingVisibility,
  tagUpdatesFreshAcquireLifecycleGroup,
  tagUpdatesMissileLifecycleGroup,
  tagUpdatesOwnerMissileLifecycleGroup,
  buildDirectedMovementUpdates,
  buildPointMovementUpdates,
} = require(path.join(__dirname, "./movement/dispatch/movementDispatchUtils"));
const {
  createMovementSceneRefresh,
} = require(path.join(__dirname, "./movement/dispatch/movementSceneRefresh"));
const {
  createMovementContractDispatch,
} = require(path.join(__dirname, "./movement/dispatch/movementContractDispatch"));
const {
  createMovementOwnerDispatch,
} = require(path.join(__dirname, "./movement/dispatch/movementOwnerDispatch"));
const {
  createMovementDestinyDispatch,
} = require(path.join(__dirname, "./movement/dispatch/movementDestinyDispatch"));
const {
  createMovementWatcherCorrections,
} = require(path.join(__dirname, "./movement/dispatch/movementWatcherCorrections"));
const {
  createMovementWarpBuilders,
} = require(path.join(__dirname, "./movement/warp/movementWarpBuilders"));
const {
  createMovementWarpStateHelpers,
} = require(path.join(__dirname, "./movement/warp/movementWarpState"));
const {
  createMovementSubwarpCommands,
} = require(path.join(__dirname, "./movement/commands/movementSubwarpCommands"));
const {
  createMovementWarpCommands,
} = require(path.join(__dirname, "./movement/commands/movementWarpCommands"));
const {
  createMovementStopSpeedCommands,
} = require(path.join(__dirname, "./movement/commands/movementStopSpeedCommands"));
const {
  materializeDormantCombatControllersForScene,
  dematerializeDormantCombatControllersForScene,
} = require(path.join(__dirname, "./npc/npcCombatDormancy"));
const {
  isAnchorRelevanceEnabled,
  hasStartupAnchorRelevanceContext,
  syncRelevantStartupControllersForScene,
  prewarmStartupControllersForWarpDestination,
} = require(path.join(__dirname, "./npc/npcAnchorRelevance"));
const {
  buildNpcEffectiveModuleItem,
} = require(path.join(__dirname, "./npc/npcCapabilityResolver"));
const nativeNpcStore = require(path.join(__dirname, "./npc/nativeNpcStore"));
const {
  currentFileTime,
  buildFiletimeLong,
  buildMarshalReal,
} = require(path.join(__dirname, "../services/_shared/serviceHelpers"));
const commandBurstRuntime = require(path.join(
  __dirname,
  "./modules/commandBurstRuntime",
));
const hudIconRuntime = require(path.join(
  __dirname,
  "./modules/hudIconRuntime",
));
const assistanceModuleRuntime = require(path.join(
  __dirname,
  "./modules/assistanceModuleRuntime",
));
const hostileModuleRuntime = require(path.join(
  __dirname,
  "./modules/hostileModuleRuntime",
));
const jammerModuleRuntime = require(path.join(
  __dirname,
  "./modules/jammerModuleRuntime",
));
const microJumpDriveRuntime = require(path.join(
  __dirname,
  "./modules/microJumpDriveRuntime",
));
const tractorBeamRuntime = require(path.join(
  __dirname,
  "./modules/tractorBeamRuntime",
));
const salvagerRuntime = require(path.join(
  __dirname,
  "./modules/salvagerRuntime",
));
const genericModuleFuelRuntime = require(path.join(
  __dirname,
  "./modules/genericModuleFuelRuntime",
));
const remoteRepairShowRuntime = require(path.join(
  __dirname,
  "../RemoteRepShow/remoteRepairShowRuntime",
));
const structureState = require(path.join(
  __dirname,
  "../services/structure/structureState",
));
const sessionRegistry = require(path.join(
  __dirname,
  "../services/chat/sessionRegistry",
));
const {
  buildStructureHangarViewState,
} = require(path.join(
  __dirname,
  "../services/structure/structureHangarViewState",
));
const {
  resolveStructureEffectiveHitpoints,
} = require(path.join(
  __dirname,
  "../services/structure/structureFullPowerDogma",
));
const structureLocatorGeometry = require(path.join(
  __dirname,
  "../services/structure/structureLocatorGeometry",
));
const stationLocatorGeometry = require(path.join(
  __dirname,
  "../services/station/stationLocatorGeometry",
));

function getCharacterStateService() {
  return require(path.join(__dirname, "../services/character/characterState"));
}

function resolveCharacterRecord(characterID) {
  const characterState = getCharacterStateService();
  return characterState && typeof characterState.getCharacterRecord === "function"
    ? characterState.getCharacterRecord(characterID)
    : null;
}

function resolveActiveShipRecord(characterID) {
  const characterState = getCharacterStateService();
  return characterState && typeof characterState.getActiveShipRecord === "function"
    ? characterState.getActiveShipRecord(characterID)
    : null;
}

function resolveChargeDogmaPrimeEntry(item, options = {}) {
  const characterState = getCharacterStateService();
  return characterState && typeof characterState.buildChargeDogmaPrimeEntry === "function"
    ? characterState.buildChargeDogmaPrimeEntry(item, options)
    : null;
}

function syncInventoryChangesToSession(session, changes = []) {
  const characterState = getCharacterStateService();
  if (
    !session ||
    !characterState ||
    typeof characterState.syncInventoryItemForSession !== "function"
  ) {
    return;
  }

  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    characterState.syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      {
        emitCfgLocation: true,
      },
    );
  }
}

function getDroneRuntimeService() {
  return require(path.join(__dirname, "../services/drone/droneRuntime"));
}

function getFighterRuntimeService() {
  return require(path.join(__dirname, "../services/fighter/fighterRuntime"));
}

function getDroneCategoryID() {
  const droneRuntime = getDroneRuntimeService();
  return toInt(droneRuntime && droneRuntime.DRONE_CATEGORY_ID, 18) || 18;
}

function getFighterCategoryID() {
  const fighterRuntime = getFighterRuntimeService();
  return toInt(fighterRuntime && fighterRuntime.FIGHTER_CATEGORY_ID, 87) || 87;
}

function hydrateDroneEntityFromInventoryItem(entity, itemRecord) {
  const droneRuntime = getDroneRuntimeService();
  if (droneRuntime && typeof droneRuntime.hydrateDroneEntityFromItem === "function") {
    return droneRuntime.hydrateDroneEntityFromItem(entity, itemRecord);
  }
  return entity;
}

function hydrateFighterEntityFromInventoryItem(entity, itemRecord) {
  const fighterRuntime = getFighterRuntimeService();
  if (fighterRuntime && typeof fighterRuntime.hydrateFighterEntityFromItem === "function") {
    return fighterRuntime.hydrateFighterEntityFromItem(entity, itemRecord);
  }
  return entity;
}

function applyDamageToFighterSquadronSafe(scene, fighterEntity, rawDamage, whenMs = null) {
  const fighterRuntime = getFighterRuntimeService();
  if (fighterRuntime && typeof fighterRuntime.applyDamageToFighterSquadron === "function") {
    return fighterRuntime.applyDamageToFighterSquadron(
      scene,
      fighterEntity,
      rawDamage,
      whenMs,
    );
  }
  return null;
}

function handleFighterPostDamageSafe(scene, fighterEntity, damageResult, options = {}) {
  const fighterRuntime = getFighterRuntimeService();
  if (fighterRuntime && typeof fighterRuntime.handleFighterPostDamage === "function") {
    return fighterRuntime.handleFighterPostDamage(
      scene,
      fighterEntity,
      damageResult,
      options,
    );
  }
  return false;
}

function handleFighterDestroyedSafe(scene, fighterEntity) {
  const fighterRuntime = getFighterRuntimeService();
  if (fighterRuntime && typeof fighterRuntime.handleFighterDestroyed === "function") {
    return fighterRuntime.handleFighterDestroyed(scene, fighterEntity);
  }
  return false;
}

function handleDroneDestroyedSafe(scene, droneEntity) {
  const droneRuntime = getDroneRuntimeService();
  if (droneRuntime && typeof droneRuntime.handleDroneDestroyed === "function") {
    return droneRuntime.handleDroneDestroyed(scene, droneEntity);
  }
  return false;
}

function handleDroneControllerLostSafe(scene, controllerEntity, options = {}) {
  const droneRuntime = getDroneRuntimeService();
  if (droneRuntime && typeof droneRuntime.handleControllerLost === "function") {
    return droneRuntime.handleControllerLost(scene, controllerEntity, options);
  }
  return {
    success: false,
    releasedCount: 0,
    recoveredCount: 0,
  };
}

function handleFighterControllerLostSafe(scene, controllerEntity, options = {}) {
  const fighterRuntime = getFighterRuntimeService();
  if (fighterRuntime && typeof fighterRuntime.handleControllerLost === "function") {
    return fighterRuntime.handleControllerLost(scene, controllerEntity, options);
  }
  return {
    success: false,
    releasedCount: 0,
    recoveredCount: 0,
  };
}
const structureTethering = require(path.join(
  __dirname,
  "./structureTethering",
));
const worldData = require(path.join(__dirname, "./worldData"));
const destiny = require(path.join(__dirname, "./destiny"));
const {
  applyDamageToEntity,
  buildLiveDamageState,
  hasDamageableHealth,
  getEntityCurrentHealthLayers,
  getEntityMaxHealthLayers,
  sumDamageVector,
} = require(path.join(__dirname, "./combat/damage"));
const {
  buildWeaponModuleSnapshot,
  isChargeOptionalTurretWeapon,
  isTurretWeaponFamily,
  isMissileWeaponFamily,
  resolveWeaponFamily,
  resolveWeaponSpecialFxGUID,
} = require(path.join(__dirname, "./combat/weaponDogma"));
const {
  resolveTurretShot,
} = require(path.join(__dirname, "./combat/laserTurrets"));
const {
  ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_CURRENT,
  ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP,
  isPrecursorTurretFamily,
  initializePrecursorTurretEffectState,
  synchronizePrecursorTurretEffectState,
  advancePrecursorTurretSpool,
  resetPrecursorTurretSpool,
  buildPrecursorTurretGraphicInfo,
  applyPrecursorTurretSpoolToSnapshot,
} = require(path.join(__dirname, "./combat/precursorTurrets"));
const {
  estimateMissileEffectiveRange,
  estimateMissileClientImpactTimeMs,
  estimateMissileClientVisualImpactTimeMs,
  resolveMissileClientVisualProfile,
  estimateMissileFlightBudgetMs,
  resolveMissileAppliedDamage,
} = require(path.join(__dirname, "./combat/missiles/missileSolver"));
const {
  flushDogmaReloadsAtSimTime,
  queueAutomaticMissileReload,
  resolvePendingMissileReload,
} = require(path.join(__dirname, "./combat/missiles/missileReloads"));
const {
  prepareLocalCycleActivation,
  prepareLocalCycleBoundary,
  executeLocalCycle,
} = require(path.join(__dirname, "./modules/localCycleRuntime"));
const {
  queueAutomaticLocalModuleReload,
  resolvePendingLocalModuleReload,
} = require(path.join(__dirname, "./modules/localCycleReloads"));
const wormholeEnvironmentRuntime = require(path.join(
  __dirname,
  "../services/exploration/wormholes/wormholeEnvironmentRuntime",
));
const {
  buildSuperweaponFreshAcquireFxOptions,
  prepareSuperweaponActivation,
  executeSuperweaponActivation,
  finalizeSuperweaponDeactivation,
  isSuperweaponFxReplayWindowActive,
  tickScene: tickSuperweaponScene,
  isSuperweaponMovementLocked,
  isSuperweaponJumpOrCloakLocked,
} = require(path.join(__dirname, "./modules/superweapons/superweaponRuntime"));
const {
  noteDamage: noteKillmailDamage,
  recordKillmailFromDestruction,
} = require(path.join(__dirname, "./combat/killmailTracker"));
//testing: import TiDi notification helpers for system entry/leave
const {
  sendTimeDilationNotificationToSession,
} = require(path.join(__dirname, "../utils/synchronizedTimeDilation"));

const ONE_AU_IN_METERS = 149597870700;
const MIN_WARP_DISTANCE_METERS = 150000;
const RUNTIME_TICK_INTERVAL_MS = 100;
const DEFAULT_UP = Object.freeze({ x: 0, y: 1, z: 0 });
const DEFAULT_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });
const DUPLICATE_DIRECTION_DOT = 0.99999;
const VALID_MODES = new Set(["STOP", "GOTO", "FOLLOW", "WARP", "ORBIT"]);
const CHARGE_TUPLE_PRIME_SETTLE_DELAY_MS = 0;
const CHARGE_TUPLE_PRIME_GRACE_WINDOW_MS = 1000;
const INCLUDE_STARGATES_IN_SCENE = true;
const STARGATE_ACTIVATION_STATE = Object.freeze({
  CLOSED: 0,
  ACTIVATING: 1,
  OPEN: 2,
});
const STARGATE_ACTIVATION_TRANSITION_MS = 3000;
const NEW_EDEN_SYSTEM_LOADING = Object.freeze({
  LAZY: 1,
  HIGHSEC: 2,
  ALL: 3,
  ONGOING_LAZY: 4,
});
// Modes 1 and 4 intentionally preserve the current startup preload so a fresh
// boot still only materializes the known Jita <-> New Caldari <-> Manifest
// path up front.
// Mode 4 then keeps every stargate active so additional systems load only when
// players actually jump into them.
const STARTUP_PRELOADED_SYSTEM_IDS = Object.freeze([30000142, 30000145, 30100032]);
const MAX_STARGATE_JUMP_DISTANCE_METERS = 2500;
const DEFAULT_STARGATE_INTERACTION_RADIUS = MAX_STARGATE_JUMP_DISTANCE_METERS;
const DEFAULT_STATION_INTERACTION_RADIUS = 1000;
const DEFAULT_STATION_UNDOCK_DISTANCE = 8000;
const DEFAULT_STATION_DOCKING_RADIUS = 2500;
const WARP_EXIT_VARIANCE_RADIUS_METERS = 2500;
const DEBUG_TEST_AUTO_TARGET_DEFAULT_RANGE_METERS = 250_000;
const STATION_DOCK_ACCEPT_DELAY_MS = 4000;
const LEGACY_STATION_NORMALIZATION_RADIUS = 100000;
const MOVEMENT_DEBUG_PATH = path.join(__dirname, "../../logs/space-movement-debug.log");
const DESTINY_DEBUG_PATH = path.join(__dirname, "../../logs/space-destiny-debug.log");
const MISSILE_DEBUG_PATH = path.join(__dirname, "../../logs/space-missile-debug.log");
const WARP_DEBUG_PATH = path.join(__dirname, "../../logs/space-warp-debug.log");
const BALL_DEBUG_PATH = path.join(__dirname, "../../logs/space-ball-debug.log");
const BUBBLE_DEBUG_PATH = path.join(__dirname, "../../logs/space-bubble-debug.log");
const JUMP_TIMING_TRACE_PATH = path.join(__dirname, "../../logs/space-jump-timing-trace.log");
const SHIP_FITTING_FLAG_RANGES = Object.freeze([
  Object.freeze([11, 34]),
  Object.freeze([92, 99]),
  Object.freeze([125, 132]),
]);
const WATCHER_CORRECTION_INTERVAL_MS = 500;
const WATCHER_POSITION_CORRECTION_INTERVAL_MS = 1000;
const ACTIVE_SUBWARP_WATCHER_CORRECTION_INTERVAL_MS = 250;
const HOSTILE_JAM_REFRESH_GRACE_MS = RUNTIME_TICK_INTERVAL_MS;
// Keep active subwarp watcher velocity corrections tight, but do not spam
// position anchors faster than the 1-second Destiny stamp cadence. Repeated
// same-stamp SetBallPosition rebases are what made remote ships jolt and drift.
const ACTIVE_SUBWARP_WATCHER_POSITION_CORRECTION_INTERVAL_MS = 1000;
const WARP_POSITION_CORRECTION_INTERVAL_MS = 250;
// Local CCP code consistently treats scene membership as bubble ownership
// (`ball.newBubbleId`, `current_bubble_members`) rather than one global
// visibility radius. Crucible EVEmu uses 300km bubbles but also documents
// retail as 250km, so use 250km as the default server-side bubble radius and
// keep hysteresis explicit to avoid churn at the edge.
const BUBBLE_RADIUS_METERS = 250_000;
const BUBBLE_HYSTERESIS_METERS = 5_000;
const BUBBLE_RADIUS_SQUARED = BUBBLE_RADIUS_METERS * BUBBLE_RADIUS_METERS;
const BUBBLE_CENTER_MIN_DISTANCE_METERS = BUBBLE_RADIUS_METERS * 2;
const BUBBLE_CENTER_MIN_DISTANCE_SQUARED =
  BUBBLE_CENTER_MIN_DISTANCE_METERS * BUBBLE_CENTER_MIN_DISTANCE_METERS;
const BUBBLE_RETENTION_RADIUS_METERS =
  BUBBLE_RADIUS_METERS + BUBBLE_HYSTERESIS_METERS;
const BUBBLE_RETENTION_RADIUS_SQUARED =
  BUBBLE_RETENTION_RADIUS_METERS * BUBBLE_RETENTION_RADIUS_METERS;
// CCP expanded the player-facing grid from 250km to 8000km on
// December 8, 2015, and CCP Nullarbor clarified the underlying grid-box size
// as 7,864,320m. Keep 250km bubbles as the INTERNAL ownership unit, but drive
// player-facing dynamic visibility from these larger public-grid boxes.
const PUBLIC_GRID_BOX_METERS = 7_864_320;
const PUBLIC_GRID_HALF_BOX_METERS = PUBLIC_GRID_BOX_METERS / 2;
const MOVEMENT_TRACE_WINDOW_MS = 5000;
const MAX_SUBWARP_SPEED_FRACTION = 1.0;
// Client missile visuals for doSpread=True missiles rely on the compiled Destiny
// FOLLOW ball reaching the target to call DoCollision(), which sets
// `self.collided = True`. Only then does Release() (triggered by DoBallRemove)
// skip clearing the warhead model. Destiny stamps have 1-second granularity, so
// the RemoveBalls delivery stamp must land at least one full stamp AFTER the
// client's FOLLOW ball has physically reached the target. With model loading
// adding ~0.5-1s before Prepare() runs, and stamp rounding consuming up to 1s,
// 100ms grace was far too tight — the FOLLOW ball was still short of the target
// when Release() fired, causing doSpread missiles to fizzle visually.
// Use 2 full Destiny stamps (2000ms) of grace to cover stamp granularity,
// model loading delay, and client-side evolution latency.
const MISSILE_CLIENT_RELEASE_GRACE_MS = 2000;
const DESTINY_ACCEL_LOG_DENOMINATOR = Math.log(10000);
const DESTINY_ALIGN_LOG_DENOMINATOR = Math.log(4);
// The published passive recharge curve is asymptotic near full. Settle the
// final client-visible capacitor unit so ships do not linger at 6749/6750.
const PASSIVE_RECHARGE_FULL_SNAP_UNITS = 1;
// Retail parity: passive shield recharge runs continuously in space.
const DEFAULT_PASSIVE_SHIELD_RECHARGE_ENABLED = true;
let passiveShieldRechargeEnabled = DEFAULT_PASSIVE_SHIELD_RECHARGE_ENABLED;
const TURN_ALIGNMENT_RADIANS = 4 * (Math.PI / 180);
const WARP_ALIGNMENT_RADIANS = 6 * (Math.PI / 180);
const FILETIME_TICKS_PER_MS = 10000n;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const MIN_TIME_DILATION = 0.1;
const MAX_TIME_DILATION = 1.0;
const SIM_CLOCK_REBASE_INTERVAL_MS = 250;
const PROPULSION_EFFECT_AFTERBURNER = "moduleBonusAfterburner";
const PROPULSION_EFFECT_MICROWARPDRIVE = "moduleBonusMicrowarpdrive";
const PROPULSION_GUID_BY_EFFECT = Object.freeze({
  [PROPULSION_EFFECT_AFTERBURNER]: "effects.Afterburner",
  [PROPULSION_EFFECT_MICROWARPDRIVE]: "effects.MicroWarpDrive",
});
const EFFECT_ID_AFTERBURNER = getEffectIDByNames(PROPULSION_EFFECT_AFTERBURNER) || 6731;
const EFFECT_ID_MICROWARPDRIVE = getEffectIDByNames(PROPULSION_EFFECT_MICROWARPDRIVE) || 6730;
// Michelle destiny-critical function names — these trigger
// SynchroniseToSimulationTime + rebase in RealFlushState.
// Non-critical names (OnSpecialFX, OnDamageStateChange,
// OnSlimItemChange, TerminalPlayDestructionEffect) are omitted.
const DESTINY_CRITICAL_PAYLOAD_NAMES = new Set([
  "GotoDirection", "GotoPoint", "AddBalls2", "RemoveBalls",
  "Orbit", "FollowBall", "Stop", "WarpTo",
  "SetBallAgility", "SetBallMass", "SetMaxSpeed", "SetBallMassive",
  "SetSpeedFraction", "SetBallPosition", "SetBallVelocity",
]);
const SESSION_JUMP_TRACE_WINDOW_MS = 120000;
let nextSessionJumpTraceID = 1;
const PROPULSION_SKILL_AFTERBURNER = 3450;
const PROPULSION_SKILL_FUEL_CONSERVATION = 3451;
const PROPULSION_SKILL_ACCELERATION_CONTROL = 3452;
const PROPULSION_SKILL_HIGH_SPEED_MANEUVERING = 3454;
const SKILL_TYPE_FLEET_COMPRESSION_LOGISTICS = 62453;
const MODULE_ATTRIBUTE_CAPACITOR_NEED = 6;
const MODULE_ATTRIBUTE_SPEED_FACTOR = 20;
const MODULE_ATTRIBUTE_SPEED = 51;
const MODULE_ATTRIBUTE_DURATION = 73;
const GROUP_SCAN_PROBE_LAUNCHER = 481;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP_RUNTIME =
  ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP;
const MODULE_ATTRIBUTE_CAPACITOR_CAPACITY_MULTIPLIER = 147;
const MODULE_ATTRIBUTE_SIGNATURE_RADIUS_BONUS = 554;
const MODULE_ATTRIBUTE_SPEED_BOOST_FACTOR = 567;
const MODULE_ATTRIBUTE_MAX_GROUP_ACTIVE = 763;
const MODULE_ATTRIBUTE_MASS_ADDITION = 796;
const MODULE_ATTRIBUTE_MAX_VELOCITY_ACTIVATION_LIMIT = 1028;
const MODULE_ATTRIBUTE_REACTIVATION_DELAY = 669;
const MODULE_ATTRIBUTE_CONSUMPTION_TYPE = 713;
const MODULE_ATTRIBUTE_CONSUMPTION_QUANTITY = 714;
const MODULE_ATTRIBUTE_COMPRESSIBLE_ITEMS_TYPELIST = 3255;
const MODULE_ATTRIBUTE_FLEET_COMPRESSION_LOGISTICS_RANGE_BONUS = 3263;
const MODULE_ATTRIBUTE_ACTIVATION_REQUIRES_ACTIVE_INDUSTRIAL_CORE = 3265;
const DEFAULT_IN_SPACE_COMPRESSION_RANGE_METERS = 250_000;
const SPECIAL_FX_REPEAT_WINDOW_MS = 12 * 60 * 60 * 1000;
const WARP_ENTRY_SPEED_FRACTION = 0.749;
const WARP_NATIVE_ACTIVATION_SPEED_FRACTION = 0.75;
const WARP_NATIVE_ACTIVATION_SPEED_MARGIN_MS = 1;
const WARP_DECEL_RATE_MAX = 2;
const WARP_DROPOUT_SPEED_MAX_MS = 100;
const WARP_ACCEL_EXPONENT = 5;
const WARP_DECEL_EXPONENT = 5;
const WARP_MEDIUM_DISTANCE_AU = 12;
const WARP_LONG_DISTANCE_AU = 24;
// The native DLL solver starts its elapsed timer ~5 seconds after the server
// builds the warp state (network transmission + client processing + WarpState
// transition delay).  The old 100 km minimum caused the server's distance-based
// completion check to fire while the DLL still had tens of thousands of km of
// decel remaining, producing a visible snap-to-target teleport.
// Fix: distance check effectively disabled (1 m threshold), and durationMs gets
// a grace period (WARP_NATIVE_DECEL_GRACE_MS) so the server waits for the DLL
// solver to finish its decel before sending the completion snap.
const WARP_COMPLETION_DISTANCE_RATIO = 0;
const WARP_COMPLETION_DISTANCE_MIN_METERS = 1;
const WARP_COMPLETION_DISTANCE_MAX_METERS = 1;
const WARP_NATIVE_DECEL_GRACE_MS = 5000;
const SESSIONLESS_WARP_INGRESS_DURATION_MS = 1500;
// Keep the prepare-phase pilot seed only slightly above subwarp max. The
// activation AddBalls2 refresh still resets the ego ball's raw maxVelocity back
// to its subwarp ceiling, so the only activation nudge that matches the client
// gate cleanly is a tiny pre-WarpTo velocity floor just above
// `0.75 * subwarpMaxVelocity`.
const WARP_START_ACTIVATION_SEED_SCALE = 1.1;
// Option A is closed after a clean no-hook run: the pilot really received the
// bumped warpFactor, but the client still stayed on the same wrapper-only path.
const ENABLE_PILOT_WARP_FACTOR_OPTION_A = false;
const PILOT_WARP_FACTOR_OPTION_A_SCALE = 1.15;
// Option B: keep the live branch honest and isolated by sending one late
// pilot-only SetMaxSpeed assist at the predicted start of exit / deceleration.
const ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B = false;
const PILOT_WARP_SOLVER_ASSIST_SCALE = 1.5;
const PILOT_WARP_SOLVER_ASSIST_LEAD_MS = DESTINY_STAMP_INTERVAL_MS;
const ENABLE_PILOT_PRE_WARP_ADDBALL_REBASE = true;
// `auditwarp7.txt` and `overshoot1.txt` both showed the pilot still receiving
// a same-stamp AddBalls2 -> SetState replay on the already-existing ego ball at
// activation. Michelle applies both full-state reads, so keep the live warp
// handoff on WarpTo / SetBallVelocity / FX instead of rebootstraping the ego
// ball mid-warp.
const ENABLE_PILOT_WARP_EGO_STATE_REFRESH = false;
// `auditwarp12.txt` showed that later in-warp pilot `SetMaxSpeed` bumps freeze
// the client exactly when it enters the later warp phase.
// `auditwarp14.txt` then narrowed the remaining long-warp failure down further:
// the current one-shot activation `SetMaxSpeed` keeps the pilot on the slow
// forced-warp fallback, because it raises the native `0.75 * maxVelocity` gate
// far above the carried align speed. Leave the later in-warp ramp disabled and
// keep activation help on the velocity floor instead.
const ENABLE_PILOT_WARP_MAX_SPEED_RAMP = false;
// Active-warp pilot SetBallPosition / SetBallVelocity pushes are currently
// worse than the original freeze: the client visibly fights them, snaps nose,
// and then stalls its own active-warp traversal. Keep the handoff on the
// activation bundle and let the local warp solver own the flight.
const ENABLE_PILOT_WARP_ACTIVE_CORRECTIONS = false;
const PILOT_WARP_SPEED_RAMP_FRACTIONS = Object.freeze([0.2, 0.45, 0.7, 1.0]);
const PILOT_WARP_SPEED_RAMP_SCALES = Object.freeze([0.6, 0.75, 0.9, 0.95]);
const ASSISTANCE_JAM_REFRESH_GRACE_MS = RUNTIME_TICK_INTERVAL_MS;
const FRESH_ACQUIRE_REPLAYABLE_STATEFUL_SELF_BUFF_GUIDS = new Set([
  "effects.SiegeMode",
]);

let nextMovementTraceID = 1;
let nextMissileDebugTraceID = 1;
let nextMissileLaunchTraceID = 1;
let nextRuntimeEntityID = 900_000_000_000;
let nextFallbackStamp = 0;

function getCurrentDestinyStamp(now = Date.now()) {
  const numericNow = Number(now);
  const stampSource = Number.isFinite(numericNow)
    ? Math.floor(numericNow / DESTINY_STAMP_INTERVAL_MS)
    : Math.floor(Date.now() / DESTINY_STAMP_INTERVAL_MS);
  return (stampSource & 0x7fffffff) >>> 0;
}

function getMovementStamp(now = Date.now()) {
  return getCurrentDestinyStamp(now);
}

function getMonotonicTimeMs() {
  return performance.now();
}

function getNextStamp(now = Date.now()) {
  const currentStamp = getCurrentDestinyStamp(now);
  const maxAllowedStamp = (currentStamp + DESTINY_STAMP_MAX_LEAD) >>> 0;
  if (nextFallbackStamp < currentStamp) {
    nextFallbackStamp = currentStamp;
    return nextFallbackStamp;
  }
  if (nextFallbackStamp >= maxAllowedStamp) {
    nextFallbackStamp = maxAllowedStamp;
    return nextFallbackStamp;
  }
  nextFallbackStamp = (nextFallbackStamp + 1) >>> 0;
  return nextFallbackStamp;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toFiniteNumber(value, fallback));
}

function roundNumber(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(toFiniteNumber(value, 0) * factor) / factor;
}

const VISIBILITY_JOURNAL_MAX_ENTRIES = 200;
const VISIBILITY_JOURNAL_MAX_IDS = 64;

function summarizeVisibilityIDs(values) {
  const seen = new Set();
  const ids = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = toInt(value, 0);
    if (id <= 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return {
    count: ids.length,
    ids: ids.slice(0, VISIBILITY_JOURNAL_MAX_IDS),
    omitted: Math.max(0, ids.length - VISIBILITY_JOURNAL_MAX_IDS),
  };
}

function summarizeVisibilityEntities(entities) {
  return summarizeVisibilityIDs(
    (Array.isArray(entities) ? entities : [])
      .map((entity) => entity && entity.itemID),
  );
}

function normalizeVisibilityJournalDetails(details = {}) {
  const normalized = { ...details };
  const idKeys = [
    "addedEntityIDs",
    "entityIDs",
    "removedEntityIDs",
    "desiredVisibleEntityIDs",
    "dynamicEntityIDs",
    "staticEntityIDs",
    "removedStaticEntityIDs",
    "addedStaticEntityIDs",
  ];
  for (const key of idKeys) {
    if (Array.isArray(normalized[key])) {
      normalized[key] = summarizeVisibilityIDs(normalized[key]);
    }
  }
  if (Array.isArray(normalized.entities)) {
    normalized.entities = summarizeVisibilityEntities(normalized.entities);
  }
  return normalized;
}

function recordVisibilityJournal(session, event, details = {}) {
  if (!session || !session._space) {
    return null;
  }
  const normalizedDetails = normalizeVisibilityJournalDetails(details);
  const atMs = Date.now();
  const nowMs = toFiniteNumber(normalizedDetails.nowMs, atMs);
  const record = {
    seq: toInt(session._space.visibilityJournalSeq, 0) + 1,
    event,
    atMs,
    nowMs,
    destinyStamp: getCurrentDestinyStamp(nowMs),
    systemID: toInt(session._space.systemID, 0),
    shipID: toInt(session._space.shipID, 0),
    characterID: toInt(session.characterID || session.charID, 0),
    ...normalizedDetails,
  };
  session._space.visibilityJournalSeq = record.seq;
  if (!Array.isArray(session._space.visibilityJournal)) {
    session._space.visibilityJournal = [];
  }
  session._space.visibilityJournal.push(record);
  if (session._space.visibilityJournal.length > VISIBILITY_JOURNAL_MAX_ENTRIES) {
    session._space.visibilityJournal.splice(
      0,
      session._space.visibilityJournal.length - VISIBILITY_JOURNAL_MAX_ENTRIES,
    );
  }
  syncLedger.recordSyncLedgerEvent(session, `visibility.${event}`, {
    kind: "visibility",
    ...record,
  });
  return record;
}

function advancePassiveRechargeRatio(currentRatio, deltaSeconds, rechargeSeconds) {
  const clampedRatio = clamp(toFiniteNumber(currentRatio, 0), 0, 1);
  const elapsedSeconds = Math.max(0, toFiniteNumber(deltaSeconds, 0));
  const totalRechargeSeconds = Math.max(0, toFiniteNumber(rechargeSeconds, 0));
  if (
    clampedRatio <= 0 ||
    clampedRatio >= 1 ||
    elapsedSeconds <= 0 ||
    totalRechargeSeconds <= 0
  ) {
    return clampedRatio;
  }

  // Closed-form progression of CCP's published capacitor curve:
  //   C1/Cmax = (1 + (sqrt(C0/Cmax) - 1) * e^(-5 * dt / T))^2
  const nextRoot =
    1 + ((Math.sqrt(clampedRatio) - 1) * Math.exp((-5 * elapsedSeconds) / totalRechargeSeconds));
  return clamp(nextRoot * nextRoot, 0, 1);
}

function settlePassiveRechargeRatio(nextRatio, capacity) {
  const clampedRatio = clamp(toFiniteNumber(nextRatio, 0), 0, 1);
  const maxCapacity = Math.max(0, toFiniteNumber(capacity, 0));
  if (clampedRatio >= 1 || maxCapacity <= 0) {
    return clampedRatio >= 1 ? 1 : clampedRatio;
  }

  const remainingUnits = maxCapacity * (1 - clampedRatio);
  return remainingUnits <= PASSIVE_RECHARGE_FULL_SNAP_UNITS ? 1 : clampedRatio;
}

function toFileTimeFromMs(value, fallback = currentFileTime()) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return BigInt(Math.trunc(numericValue)) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
}

function fileTimeToMs(value, fallback = Date.now()) {
  try {
    const numericValue =
      typeof value === "bigint"
        ? value
        : BigInt(value && value.type === "long" ? value.value : value);
    if (numericValue <= FILETIME_EPOCH_OFFSET) {
      return fallback;
    }
    return Number((numericValue - FILETIME_EPOCH_OFFSET) / FILETIME_TICKS_PER_MS);
  } catch (error) {
    return fallback;
  }
}

function clampTimeDilationFactor(value, fallback = 1) {
  return clamp(
    toFiniteNumber(value, fallback),
    MIN_TIME_DILATION,
    MAX_TIME_DILATION,
  );
}

function unwrapMarshalNumber(value, fallback = 0) {
  if (value && typeof value === "object" && value.type === "real") {
    return toFiniteNumber(value.value, fallback);
  }
  return toFiniteNumber(value, fallback);
}

function marshalModuleDurationWireValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (value && typeof value === "object" && value.type === "real") {
    return value;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return value;
  }
  if (numericValue < 0) {
    return Math.trunc(numericValue);
  }
  return buildMarshalReal(numericValue, 0);
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function clonePilotWarpMaxSpeedRamp(rawRamp, fallback = []) {
  const source = Array.isArray(rawRamp) ? rawRamp : fallback;
  return source
    .map((entry) => ({
      atMs: toFiniteNumber(entry && entry.atMs, 0),
      stamp: toInt(entry && entry.stamp, 0),
      speed: Math.max(toFiniteNumber(entry && entry.speed, 0), 0),
      label: String((entry && entry.label) || ""),
    }))
    .filter((entry) => entry.atMs > 0 && entry.speed > 0);
}

function addVectors(left, right) {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function subtractVectors(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function dotProduct(left, right) {
  return (left.x * right.x) + (left.y * right.y) + (left.z * right.z);
}

function directionsNearlyMatch(
  left,
  right,
  minimumAlignment = 0.999999,
) {
  if (!left || !right) {
    return false;
  }
  return dotProduct(
    normalizeVector(left, { x: 1, y: 0, z: 0 }),
    normalizeVector(right, { x: 1, y: 0, z: 0 }),
  ) >= minimumAlignment;
}

function crossProduct(left, right) {
  return {
    x: (left.y * right.z) - (left.z * right.y),
    y: (left.z * right.x) - (left.x * right.z),
    z: (left.x * right.y) - (left.y * right.x),
  };
}

function magnitude(vector) {
  return Math.sqrt((vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = magnitude(vector);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }

  return scaleVector(vector, 1 / length);
}

function distance(left, right) {
  return magnitude(subtractVectors(left, right));
}

function distanceSquared(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return (dx ** 2) + (dy ** 2) + (dz ** 2);
}

const UNIVERSE_SITE_ATTACH_AUTO_MATERIALIZE_RANGE_METERS = 1_000_000;
const UNIVERSE_SITE_ATTACH_AUTO_MATERIALIZE_RANGE_SQUARED =
  UNIVERSE_SITE_ATTACH_AUTO_MATERIALIZE_RANGE_METERS ** 2;

function resolveEntityLikePosition(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }
  if (entity.position && typeof entity.position === "object") {
    return {
      x: toFiniteNumber(entity.position.x, 0),
      y: toFiniteNumber(entity.position.y, 0),
      z: toFiniteNumber(entity.position.z, 0),
    };
  }
  if (
    Number.isFinite(toFiniteNumber(entity.x, Number.NaN)) &&
    Number.isFinite(toFiniteNumber(entity.y, Number.NaN)) &&
    Number.isFinite(toFiniteNumber(entity.z, Number.NaN))
  ) {
    return {
      x: toFiniteNumber(entity.x, 0),
      y: toFiniteNumber(entity.y, 0),
      z: toFiniteNumber(entity.z, 0),
    };
  }
  return null;
}

function autoMaterializeNearbyUniverseSiteForAttach(scene, anchorEntity, options = {}) {
  if (!scene || !anchorEntity) {
    return null;
  }
  const anchorPosition = resolveEntityLikePosition(anchorEntity);
  if (!anchorPosition) {
    return null;
  }

  let nearestSite = null;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  const staticEntities = Array.isArray(scene.staticEntities) ? scene.staticEntities : [];
  for (const entity of staticEntities) {
    if (
      !entity ||
      (
        entity.signalTrackerUniverseSeededSite !== true &&
        String(entity.kind || "").trim() !== "missionSite"
      )
    ) {
      continue;
    }
    const entityPosition = resolveEntityLikePosition(entity);
    if (!entityPosition) {
      continue;
    }
    const candidateDistanceSquared = distanceSquared(anchorPosition, entityPosition);
    if (
      candidateDistanceSquared > UNIVERSE_SITE_ATTACH_AUTO_MATERIALIZE_RANGE_SQUARED ||
      candidateDistanceSquared >= nearestDistanceSquared
    ) {
      continue;
    }
    nearestSite = entity;
    nearestDistanceSquared = candidateDistanceSquared;
  }

  if (!nearestSite) {
    return null;
  }

  try {
    const dungeonUniverseSiteService = require(path.join(
      __dirname,
      "../services/dungeon/dungeonUniverseSiteService",
    ));
    if (
      !dungeonUniverseSiteService ||
      typeof dungeonUniverseSiteService.ensureSiteContentsMaterialized !== "function"
    ) {
      return null;
    }
    return dungeonUniverseSiteService.ensureSiteContentsMaterialized(scene, nearestSite, {
      spawnEncounters: true,
      broadcast: options.broadcast === true,
      excludedSession: options.excludedSession || null,
      session: options.session || anchorEntity.session || null,
      nowMs: options.nowMs,
    });
  } catch (error) {
    log.warn(
      `[SpaceRuntime] attach-session site auto-materialize failed for system=${toInt(scene && scene.systemID, 0)}: ${error.message}`,
    );
    return null;
  }
}

function getPublicGridAxisIndex(value) {
  return Math.floor(toFiniteNumber(value, 0) / PUBLIC_GRID_BOX_METERS);
}

function buildPublicGridKeyFromIndices(xIndex, yIndex, zIndex) {
  return `${toInt(xIndex, 0)}:${toInt(yIndex, 0)}:${toInt(zIndex, 0)}`;
}

function buildPublicGridKey(position) {
  const resolvedPosition = cloneVector(position);
  return buildPublicGridKeyFromIndices(
    getPublicGridAxisIndex(resolvedPosition.x),
    getPublicGridAxisIndex(resolvedPosition.y),
    getPublicGridAxisIndex(resolvedPosition.z),
  );
}

function parsePublicGridKey(key) {
  if (typeof key !== "string" || key.trim() === "") {
    return {
      key: buildPublicGridKeyFromIndices(0, 0, 0),
      xIndex: 0,
      yIndex: 0,
      zIndex: 0,
    };
  }

  const [rawX, rawY, rawZ] = key.split(":");
  const xIndex = toInt(rawX, 0);
  const yIndex = toInt(rawY, 0);
  const zIndex = toInt(rawZ, 0);
  return {
    key: buildPublicGridKeyFromIndices(xIndex, yIndex, zIndex),
    xIndex,
    yIndex,
    zIndex,
  };
}

function summarizePublicGrid(position) {
  const resolvedPosition = cloneVector(position);
  return {
    key: buildPublicGridKey(resolvedPosition),
    xIndex: getPublicGridAxisIndex(resolvedPosition.x),
    yIndex: getPublicGridAxisIndex(resolvedPosition.y),
    zIndex: getPublicGridAxisIndex(resolvedPosition.z),
    boxMeters: PUBLIC_GRID_BOX_METERS,
  };
}

// Debug/test-only helper for slash-command FX previews. This is intentionally
// not gameplay target acquisition logic and should not be reused for modules.
function resolveDebugTestNearestStationTarget(
  scene,
  sourceEntity,
  maxRangeMeters = DEBUG_TEST_AUTO_TARGET_DEFAULT_RANGE_METERS,
) {
  if (!scene || !sourceEntity) {
    return {
      success: false,
      errorMsg: "DEBUG_TEST_TARGET_CONTEXT_MISSING",
    };
  }

  const numericMaxRangeMeters = Math.max(0, toFiniteNumber(
    maxRangeMeters,
    DEBUG_TEST_AUTO_TARGET_DEFAULT_RANGE_METERS,
  ));
  let nearestStation = null;
  let nearestDistanceMeters = Number.POSITIVE_INFINITY;
  for (const entity of scene.staticEntities) {
    if (!entity || entity.kind !== "station") {
      continue;
    }

    const entityDistanceMeters = distance(sourceEntity.position, entity.position);
    if (entityDistanceMeters < nearestDistanceMeters) {
      nearestStation = entity;
      nearestDistanceMeters = entityDistanceMeters;
    }
  }

  if (!nearestStation) {
    return {
      success: false,
      errorMsg: "DEBUG_TEST_TARGET_NO_STATION",
      data: {
        maxRangeMeters: numericMaxRangeMeters,
      },
    };
  }

  if (nearestDistanceMeters > numericMaxRangeMeters) {
    return {
      success: false,
      errorMsg: "DEBUG_TEST_TARGET_OUT_OF_RANGE",
      data: {
        maxRangeMeters: numericMaxRangeMeters,
        nearestDistanceMeters,
        targetID: nearestStation.itemID,
        targetName: nearestStation.itemName || `station ${nearestStation.itemID}`,
      },
    };
  }

  return {
    success: true,
    data: {
      maxRangeMeters: numericMaxRangeMeters,
      nearestDistanceMeters,
      target: nearestStation,
    },
  };
}

function getTurnMetrics(currentDirection, targetDirection) {
  const current = normalizeVector(currentDirection, targetDirection);
  const target = normalizeVector(targetDirection, current);
  const alignment = clamp(dotProduct(current, target), -1, 1);
  const radians = Math.acos(alignment);
  const turnFraction = Math.sqrt(Math.max(0, (alignment + 1) * 0.5));
  return {
    alignment,
    radians: Number.isFinite(radians) ? radians : 0,
    turnFraction: Number.isFinite(turnFraction) ? turnFraction : 1,
  };
}

function summarizeVector(vector) {
  return {
    x: roundNumber(vector && vector.x),
    y: roundNumber(vector && vector.y),
    z: roundNumber(vector && vector.z),
  };
}

function isMovementTraceActive(entity, now = Date.now()) {
  return Boolean(
    entity &&
      entity.movementTrace &&
      Number(entity.movementTrace.untilMs || 0) > Number(now || Date.now()),
  );
}

function getMovementTraceSnapshot(entity, now = Date.now()) {
  if (!isMovementTraceActive(entity, now)) {
    return null;
  }

  return {
    id: toInt(entity.movementTrace.id, 0),
    reason: entity.movementTrace.reason || "unknown",
    stamp: toInt(entity.movementTrace.stamp, 0),
    ageMs: Math.max(0, toInt(now, Date.now()) - toInt(entity.movementTrace.startedAtMs, 0)),
    remainingMs: Math.max(0, toInt(entity.movementTrace.untilMs, 0) - toInt(now, Date.now())),
    context: entity.movementTrace.context || null,
  };
}

function summarizePendingWarp(pendingWarp) {
  if (!pendingWarp) {
    return null;
  }

  return {
    requestedAtMs: toInt(pendingWarp.requestedAtMs, 0),
    preWarpSyncStamp: toInt(pendingWarp.preWarpSyncStamp, 0),
    prepareStamp: toInt(pendingWarp.prepareStamp, 0),
    prepareVisibleStamp: toInt(pendingWarp.prepareVisibleStamp, 0),
    stopDistance: roundNumber(pendingWarp.stopDistance),
    totalDistance: roundNumber(pendingWarp.totalDistance),
    warpSpeedAU: roundNumber(pendingWarp.warpSpeedAU, 3),
    targetEntityID: toInt(pendingWarp.targetEntityID, 0),
    targetPoint: summarizeVector(pendingWarp.targetPoint),
    rawDestination: summarizeVector(pendingWarp.rawDestination),
  };
}

function armMovementTrace(entity, reason, context = {}, now = Date.now()) {
  if (!entity) {
    return null;
  }

  entity.movementTrace = {
    id: nextMovementTraceID++,
    reason,
    startedAtMs: now,
    untilMs: now + MOVEMENT_TRACE_WINDOW_MS,
    stamp: getCurrentDestinyStamp(now),
    context,
  };
  return entity.movementTrace;
}

function appendMovementDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(MOVEMENT_DEBUG_PATH, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write movement debug log: ${error.message}`);
  }
}

function appendDestinyDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(DESTINY_DEBUG_PATH, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write destiny debug log: ${error.message}`);
  }
}

function appendMissileDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(MISSILE_DEBUG_PATH, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write missile debug log: ${error.message}`);
  }
}

function appendWarpDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(WARP_DEBUG_PATH, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write warp debug log: ${error.message}`);
  }
}

function appendBallDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(BALL_DEBUG_PATH, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write ball debug log: ${error.message}`);
  }
}

function appendBubbleDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(BUBBLE_DEBUG_PATH, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to append bubble debug log: ${error.message}`);
  }
}

function normalizeTraceValue(value, depth = 0) {
  if (depth > 4) {
    return "[depth-limit]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeTraceValue(entry, depth + 1));
  }
  if (value instanceof Set) {
    return Array.from(value.values()).map((entry) =>
      normalizeTraceValue(entry, depth + 1),
    );
  }
  if (typeof value === "object") {
    const normalized = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "function") {
        continue;
      }
      normalized[key] = normalizeTraceValue(entry, depth + 1);
    }
    return normalized;
  }
  return String(value);
}

function limitTraceArray(values, limit = 20) {
  const normalizedValues = Array.isArray(values) ? values : [];
  const maxItems = Math.max(1, toInt(limit, 20));
  if (normalizedValues.length <= maxItems) {
    return normalizedValues;
  }
  return [
    ...normalizedValues.slice(0, maxItems),
    `[+${normalizedValues.length - maxItems} more]`,
  ];
}

function getMarshalListItems(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    value.type === "list" &&
    Array.isArray(value.items)
  ) {
    return value.items;
  }
  return [];
}

function getMarshalDictEntry(value, key) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.type !== "dict" &&
    Object.prototype.hasOwnProperty.call(value, key)
  ) {
    return value[key];
  }
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return undefined;
  }
  const entry = value.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : undefined;
}

function extractSlimItemIdentity(slimEntry) {
  const slimItem = Array.isArray(slimEntry) ? slimEntry[0] : slimEntry;
  const itemID = toInt(
    slimItem && typeof slimItem === "object" && "itemID" in slimItem
      ? slimItem.itemID
      : getMarshalDictEntry(slimItem, "itemID"),
    0,
  );
  const typeID = toInt(
    slimItem && typeof slimItem === "object" && "typeID" in slimItem
      ? slimItem.typeID
      : getMarshalDictEntry(slimItem, "typeID"),
    0,
  );
  return {
    itemID,
    typeID,
  };
}

function summarizeAddBalls2Args(args) {
  return getMarshalListItems(args).map((batchEntry, index) => {
    const stateBuffer = Array.isArray(batchEntry) ? batchEntry[0] : null;
    const slimEntries = getMarshalListItems(
      Array.isArray(batchEntry) ? batchEntry[1] : null,
    );
    const slimIDs = slimEntries
      .map((entry) => extractSlimItemIdentity(entry))
      .filter((entry) => entry.itemID > 0);
    return {
      batchIndex: index,
      stateStamp:
        Buffer.isBuffer(stateBuffer) && stateBuffer.length >= 5
          ? (stateBuffer.readUInt32LE(1) >>> 0)
          : 0,
      entityCount: slimIDs.length,
      entityIDs: limitTraceArray(
        slimIDs.map((entry) => entry.itemID),
        25,
      ),
      typeIDs: limitTraceArray(
        slimIDs.map((entry) => entry.typeID).filter((value) => value > 0),
        12,
      ),
    };
  });
}

function summarizeSetStateArgs(args) {
  const state = Array.isArray(args) ? args[0] : null;
  const slims = getMarshalListItems(getMarshalDictEntry(state, "slims"));
  const slimIDs = slims
    .map((entry) => extractSlimItemIdentity(entry))
    .filter((entry) => entry.itemID > 0);
  const damageState = getMarshalDictEntry(state, "damageState");
  const damageStateEntityIDs =
    damageState && damageState.type === "dict" && Array.isArray(damageState.entries)
      ? damageState.entries
        .map((entry) => toInt(Array.isArray(entry) ? entry[0] : 0, 0))
        .filter((value) => value > 0)
      : [];
  return [{
    stamp: toInt(getMarshalDictEntry(state, "stamp"), 0) >>> 0,
    ego: toInt(getMarshalDictEntry(state, "ego"), 0) >>> 0,
    slimCount: slimIDs.length,
    slimIDs: limitTraceArray(
      slimIDs.map((entry) => entry.itemID),
      25,
    ),
    damageStateEntityIDs: limitTraceArray(damageStateEntityIDs, 25),
  }];
}

function summarizeDamageStateArgs(args) {
  return [
    toInt(args && args[0], 0),
    normalizeTraceValue(args && args[1]),
  ];
}

function summarizeRemoveBallsArgs(args) {
  const entityIDs = getMarshalListItems(args && args[0])
    .map((entry) => toInt(entry, 0))
    .filter((value) => value > 0);
  return [{
    entityCount: entityIDs.length,
    entityIDs: limitTraceArray(entityIDs, 30),
  }];
}

const MISSILE_SESSION_MUTATION_FIELDS = Object.freeze([
  "currentSessionStamp",
  "currentVisibleStamp",
  "currentPresentedStamp",
  "currentImmediateStamp",
  "historyFloorDestinyStamp",
  "lastSentDestinyStamp",
  "lastSentDestinyRawDispatchStamp",
  "lastSentDestinyOnlyStaleProjectedOwnerMissileLane",
  "lastSentDestinyWasOwnerCritical",
  "lastOwnerNonMissileCriticalStamp",
  "lastOwnerNonMissileCriticalRawDispatchStamp",
  "lastPilotCommandMovementStamp",
  "lastPilotCommandMovementAnchorStamp",
  "lastPilotCommandMovementRawDispatchStamp",
  "lastFreshAcquireLifecycleStamp",
  "lastMissileLifecycleStamp",
  "lastOwnerMissileLifecycleStamp",
  "lastOwnerMissileLifecycleAnchorStamp",
  "lastOwnerMissileFreshAcquireStamp",
  "lastOwnerMissileFreshAcquireAnchorStamp",
  "lastOwnerMissileFreshAcquireRawDispatchStamp",
  "lastOwnerMissileLifecycleRawDispatchStamp",
]);

function buildMissileSessionMutation(before, after) {
  if (!before || !after) {
    return null;
  }
  const mutation = {};
  for (const field of MISSILE_SESSION_MUTATION_FIELDS) {
    const previous = before[field];
    const next = after[field];
    if (JSON.stringify(previous) === JSON.stringify(next)) {
      continue;
    }
    mutation[field] =
      typeof previous === "number" && typeof next === "number"
        ? { before: previous, after: next, delta: next - previous }
        : { before: previous, after: next };
  }
  return Object.keys(mutation).length > 0 ? mutation : null;
}

const MISSILE_DEBUG_PAYLOAD_NAMES = new Set([
  "AddBalls2",
  "FollowBall",
  "GotoDirection",
  "OnDamageStateChange",
  "Orbit",
  "RemoveBalls",
  "SetBallPosition",
  "SetBallVelocity",
  "SetSpeedFraction",
  "SetState",
  "TerminalPlayDestructionEffect",
]);

function summarizeMissileEntity(entity) {
  if (!entity || entity.kind !== "missile") {
    return null;
  }
  const clientVisualReleaseAtMs = roundNumber(
    toFiniteNumber(entity.clientVisualReleaseAtMs, 0),
    3,
  );
  return {
    debugLaunchTraceID: toInt(entity.debugLaunchTraceID, 0),
    itemID: toInt(entity.itemID, 0),
    sourceShipID: toInt(entity.sourceShipID, 0),
    sourceModuleID: toInt(entity.sourceModuleID, 0),
    targetEntityID: toInt(entity.targetEntityID, 0),
    typeID: toInt(entity.typeID, 0),
    groupID: toInt(entity.groupID, 0),
    categoryID: toInt(entity.categoryID, 0),
    mode: String(entity.mode || ""),
    launchedAtMs: roundNumber(toFiniteNumber(entity.launchedAtMs, 0), 3),
    impactAtMs: roundNumber(toFiniteNumber(entity.impactAtMs, 0), 3),
    liveImpactAtMs: roundNumber(toFiniteNumber(entity.liveImpactAtMs, 0), 3),
    surfaceImpactAtMs: roundNumber(toFiniteNumber(entity.surfaceImpactAtMs, 0), 3),
    expiresAtMs: roundNumber(toFiniteNumber(entity.expiresAtMs, 0), 3),
    pendingGeometryImpact: entity.pendingGeometryImpact === true,
    pendingGeometryImpactAtMs: roundNumber(
      toFiniteNumber(entity.pendingGeometryImpactAtMs, 0),
      3,
    ),
    pendingGeometryImpactReason:
      entity.pendingGeometryImpact === true
        ? String(entity.pendingGeometryImpactReason || "")
        : "",
    pendingGeometryImpactPosition: summarizeVector(
      entity.pendingGeometryImpactPosition,
    ),
    impactResolved: clientVisualReleaseAtMs > 0,
    clientVisualReleaseAtMs,
    clientDoSpread: entity.clientDoSpread === true,
    maxVelocity: roundNumber(toFiniteNumber(entity.maxVelocity, 0), 3),
    speedFraction: roundNumber(toFiniteNumber(entity.speedFraction, 0), 3),
    position: summarizeVector(entity.position),
    velocity: summarizeVector(entity.velocity),
    direction: summarizeVector(entity.direction),
    targetPoint: summarizeVector(entity.targetPoint),
    launchModules: Array.isArray(entity.launchModules)
      ? entity.launchModules.map((value) => toInt(value, 0))
      : [],
  };
}

function buildMissileSessionSnapshot(scene, session, rawSimTimeMs = null) {
  if (!session) {
    return null;
  }
  const nowMs =
    rawSimTimeMs === null || rawSimTimeMs === undefined
      ? scene && typeof scene.getCurrentSimTimeMs === "function"
        ? scene.getCurrentSimTimeMs()
        : Date.now()
      : toFiniteNumber(
        rawSimTimeMs,
        scene && typeof scene.getCurrentSimTimeMs === "function"
          ? scene.getCurrentSimTimeMs()
          : Date.now(),
      );
  const sessionSpace = session._space || null;
  const rawDispatchStamp =
    scene && typeof scene.getCurrentDestinyStamp === "function"
      ? scene.getCurrentDestinyStamp(nowMs)
      : getCurrentDestinyStamp(nowMs);
  const currentSessionStamp =
    scene && typeof scene.getCurrentSessionDestinyStamp === "function"
      ? scene.getCurrentSessionDestinyStamp(session, nowMs)
      : null;
  const currentVisibleStamp =
    scene && typeof scene.getCurrentVisibleSessionDestinyStamp === "function"
      ? scene.getCurrentVisibleSessionDestinyStamp(session, nowMs)
      : null;
  const currentPresentedStamp =
    scene && typeof scene.getCurrentPresentedSessionDestinyStamp === "function"
      ? scene.getCurrentPresentedSessionDestinyStamp(
        session,
        nowMs,
        Math.max(
          MICHELLE_HELD_FUTURE_DESTINY_LEAD,
          PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS + MICHELLE_HELD_FUTURE_DESTINY_LEAD,
        ),
      )
      : null;
  const currentImmediateStamp =
    scene && typeof scene.getImmediateDestinyStampForSession === "function"
      ? scene.getImmediateDestinyStampForSession(
        session,
        currentSessionStamp === null
          ? rawDispatchStamp
          : currentSessionStamp,
      )
      : null;
  return {
    clientID: toInt(session.clientID, 0),
    charID: toInt(session.characterID, 0),
    shipID: toInt(sessionSpace && sessionSpace.shipID, 0),
    systemID: toInt(sessionSpace && sessionSpace.systemID, 0),
    nowMs: roundNumber(nowMs, 3),
    rawDispatchStamp,
    clockOffsetMs: roundNumber(toFiniteNumber(sessionSpace && sessionSpace.clockOffsetMs, 0), 3),
    currentSessionStamp,
    currentVisibleStamp,
    currentPresentedStamp,
    currentImmediateStamp,
    historyFloorDestinyStamp: toInt(sessionSpace && sessionSpace.historyFloorDestinyStamp, 0) >>> 0,
    lastSentDestinyStamp: toInt(sessionSpace && sessionSpace.lastSentDestinyStamp, 0) >>> 0,
    lastSentDestinyRawDispatchStamp:
      toInt(sessionSpace && sessionSpace.lastSentDestinyRawDispatchStamp, 0) >>> 0,
    lastSentDestinyOnlyStaleProjectedOwnerMissileLane:
      sessionSpace &&
      typeof sessionSpace.lastSentDestinyOnlyStaleProjectedOwnerMissileLane === "boolean"
        ? sessionSpace.lastSentDestinyOnlyStaleProjectedOwnerMissileLane
        : null,
    lastSentDestinyWasOwnerCritical:
      sessionSpace &&
      typeof sessionSpace.lastSentDestinyWasOwnerCritical === "boolean"
        ? sessionSpace.lastSentDestinyWasOwnerCritical
        : null,
    lastOwnerNonMissileCriticalStamp:
      toInt(sessionSpace && sessionSpace.lastOwnerNonMissileCriticalStamp, 0) >>> 0,
    lastOwnerNonMissileCriticalRawDispatchStamp:
      toInt(
        sessionSpace && sessionSpace.lastOwnerNonMissileCriticalRawDispatchStamp,
        0,
      ) >>> 0,
    lastPilotCommandMovementStamp:
      toInt(sessionSpace && sessionSpace.lastPilotCommandMovementStamp, 0) >>> 0,
    lastPilotCommandMovementAnchorStamp:
      toInt(sessionSpace && sessionSpace.lastPilotCommandMovementAnchorStamp, 0) >>> 0,
    lastPilotCommandMovementRawDispatchStamp:
      toInt(
        sessionSpace && sessionSpace.lastPilotCommandMovementRawDispatchStamp,
        0,
      ) >>> 0,
    lastFreshAcquireLifecycleStamp:
      toInt(sessionSpace && sessionSpace.lastFreshAcquireLifecycleStamp, 0) >>> 0,
    lastMissileLifecycleStamp:
      toInt(sessionSpace && sessionSpace.lastMissileLifecycleStamp, 0) >>> 0,
    lastOwnerMissileLifecycleStamp:
      toInt(sessionSpace && sessionSpace.lastOwnerMissileLifecycleStamp, 0) >>> 0,
    lastOwnerMissileLifecycleAnchorStamp:
      toInt(
        sessionSpace && sessionSpace.lastOwnerMissileLifecycleAnchorStamp,
        0,
      ) >>> 0,
    lastOwnerMissileFreshAcquireStamp:
      toInt(sessionSpace && sessionSpace.lastOwnerMissileFreshAcquireStamp, 0) >>> 0,
    lastOwnerMissileFreshAcquireAnchorStamp:
      toInt(
        sessionSpace && sessionSpace.lastOwnerMissileFreshAcquireAnchorStamp,
        0,
      ) >>> 0,
    lastOwnerMissileFreshAcquireRawDispatchStamp:
      toInt(
        sessionSpace && sessionSpace.lastOwnerMissileFreshAcquireRawDispatchStamp,
        0,
      ) >>> 0,
    lastOwnerMissileLifecycleRawDispatchStamp:
      toInt(sessionSpace && sessionSpace.lastOwnerMissileLifecycleRawDispatchStamp, 0) >>> 0,
  };
}

function shouldLogMissilePayloadGroup(updates = []) {
  return Array.isArray(updates) && updates.some((update) => {
    const payloadName =
      update &&
      Array.isArray(update.payload)
        ? update.payload[0]
        : null;
    return MISSILE_DEBUG_PAYLOAD_NAMES.has(payloadName);
  });
}

function summarizeMissileUpdatesForLog(updates = []) {
  return Array.isArray(updates)
    ? updates.map((update) => ({
        stamp: toInt(update && update.stamp, 0) >>> 0,
        freshAcquireLifecycleGroup:
          update && update.freshAcquireLifecycleGroup === true,
        missileLifecycleGroup:
          update && update.missileLifecycleGroup === true,
        ownerMissileLifecycleGroup:
          update && update.ownerMissileLifecycleGroup === true,
        name:
          update &&
          Array.isArray(update.payload)
            ? update.payload[0]
            : null,
        args: summarizeDestinyArgs(
          update &&
          Array.isArray(update.payload)
            ? update.payload[0]
            : null,
          update &&
          Array.isArray(update.payload)
            ? update.payload[1]
            : null,
        ),
      }))
    : [];
}

function logMissileDebug(event, details = {}) {
  appendMissileDebug(JSON.stringify(normalizeTraceValue({
    event,
    atMs: Date.now(),
    ...details,
  })));
}

function summarizeMissileInventoryItemForDebug(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  return {
    itemID: toInt(item.itemID, 0),
    typeID: toInt(item.typeID, 0),
    ownerID: toInt(item.ownerID, 0),
    locationID: toInt(item.locationID, 0),
    flagID: toInt(item.flagID, 0),
    groupID: toInt(item.groupID, 0),
    categoryID: toInt(item.categoryID, 0),
    quantity: Math.max(0, toInt(item.quantity, 0)),
    stacksize: Math.max(0, toInt(item.stacksize, 0)),
    singleton: toInt(item.singleton, 0),
    launcherID: toInt(item.launcherID, 0),
    itemName: typeof item.itemName === "string" ? item.itemName : null,
    moduleState:
      item.moduleState && typeof item.moduleState === "object"
        ? {
            damage: roundNumber(toFiniteNumber(item.moduleState.damage, 0), 6),
            armorDamage: roundNumber(toFiniteNumber(item.moduleState.armorDamage, 0), 6),
            shieldCharge: roundNumber(toFiniteNumber(item.moduleState.shieldCharge, 0), 6),
            incapacitated: item.moduleState.incapacitated === true,
          }
        : null,
  };
}

function summarizeMissileWeaponSnapshotForDebug(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  return {
    family: String(snapshot.family || ""),
    moduleID: toInt(snapshot.moduleID, 0),
    moduleTypeID: toInt(snapshot.moduleTypeID, 0),
    chargeItemID: toInt(snapshot.chargeItemID, 0),
    chargeTypeID: toInt(snapshot.chargeTypeID, 0),
    chargeQuantity: Math.max(0, toInt(snapshot.chargeQuantity, 0)),
    durationMs: roundNumber(toFiniteNumber(snapshot.durationMs, 0), 6),
    capNeed: roundNumber(toFiniteNumber(snapshot.capNeed, 0), 6),
    damageMultiplier: roundNumber(toFiniteNumber(snapshot.damageMultiplier, 0), 6),
    rawShotDamage:
      snapshot.rawShotDamage && typeof snapshot.rawShotDamage === "object"
        ? {
            em: roundNumber(toFiniteNumber(snapshot.rawShotDamage.em, 0), 6),
            thermal: roundNumber(toFiniteNumber(snapshot.rawShotDamage.thermal, 0), 6),
            kinetic: roundNumber(toFiniteNumber(snapshot.rawShotDamage.kinetic, 0), 6),
            explosive: roundNumber(toFiniteNumber(snapshot.rawShotDamage.explosive, 0), 6),
          }
        : null,
    flightTimeMs: roundNumber(toFiniteNumber(snapshot.flightTimeMs, 0), 6),
    maxVelocity: roundNumber(toFiniteNumber(snapshot.maxVelocity, 0), 6),
    approxRange: roundNumber(toFiniteNumber(snapshot.approxRange, 0), 6),
    explosionRadius: roundNumber(toFiniteNumber(snapshot.explosionRadius, 0), 6),
    explosionVelocity: roundNumber(toFiniteNumber(snapshot.explosionVelocity, 0), 6),
    damageReductionFactor: roundNumber(
      toFiniteNumber(snapshot.damageReductionFactor, 0),
      6,
    ),
    damageReductionSensitivity: roundNumber(
      toFiniteNumber(snapshot.damageReductionSensitivity, 0),
      6,
    ),
    moduleAttributes:
      snapshot.moduleAttributes && typeof snapshot.moduleAttributes === "object"
        ? snapshot.moduleAttributes
        : {},
    chargeAttributes:
      snapshot.chargeAttributes && typeof snapshot.chargeAttributes === "object"
        ? snapshot.chargeAttributes
        : {},
    shipModifierAttributes:
      snapshot.shipModifierAttributes && typeof snapshot.shipModifierAttributes === "object"
        ? snapshot.shipModifierAttributes
        : {},
    characterAttributes:
      snapshot.characterAttributes && typeof snapshot.characterAttributes === "object"
        ? snapshot.characterAttributes
        : {},
  };
}

function buildMissileChargeTupleDebugContext(attackerEntity, moduleItem, chargeItem) {
  const shipID = toInt(attackerEntity && attackerEntity.itemID, 0);
  const moduleFlagID = toInt(moduleItem && moduleItem.flagID, 0);
  const chargeTypeID = toInt(chargeItem && chargeItem.typeID, 0);
  return {
    shipID,
    moduleFlagID,
    chargeTypeID,
    tupleItemID:
      shipID > 0 && moduleFlagID > 0 && chargeTypeID > 0
        ? buildChargeTupleItemID(shipID, moduleFlagID, chargeTypeID)
        : null,
  };
}

function buildMissileLaunchRangeDebugContext(
  attackerEntity,
  targetEntity,
  weaponSnapshot,
  moduleItem = null,
  chargeItem = null,
) {
  if (!attackerEntity || !targetEntity || !weaponSnapshot) {
    return null;
  }
  const sourceRadius = Math.max(0, toFiniteNumber(attackerEntity.radius, 0));
  const surfaceDistance = roundNumber(
    getEntitySurfaceDistance(attackerEntity, targetEntity),
    6,
  );
  const effectiveRange = roundNumber(
    estimateMissileEffectiveRange(weaponSnapshot),
    6,
  );
  const flightBudgetMs = roundNumber(
    estimateMissileFlightBudgetMs(weaponSnapshot, sourceRadius),
    6,
  );
  const visualProfile = resolveMissileClientVisualProfile(
    attackerEntity.position,
    targetEntity.position,
    Math.max(0, toFiniteNumber(targetEntity.radius, 0)),
    Math.max(0, toFiniteNumber(weaponSnapshot.maxVelocity, 0)),
  );
  return {
    moduleItem: summarizeMissileInventoryItemForDebug(moduleItem),
    chargeItem: summarizeMissileInventoryItemForDebug(chargeItem),
    chargeTuple: buildMissileChargeTupleDebugContext(
      attackerEntity,
      moduleItem,
      chargeItem,
    ),
    weaponSnapshot: summarizeMissileWeaponSnapshotForDebug(weaponSnapshot),
    sourceRadius: roundNumber(sourceRadius, 6),
    targetRadius: roundNumber(toFiniteNumber(targetEntity.radius, 0), 6),
    surfaceDistance,
    effectiveRange,
    rangeMargin: roundNumber(effectiveRange - surfaceDistance, 6),
    flightBudgetMs,
    visualProfile: normalizeTraceValue(visualProfile),
  };
}

function buildMissileFlightSnapshot(scene, missileEntity, nowMs) {
  if (!scene || !missileEntity || missileEntity.kind !== "missile") {
    return null;
  }
  const targetEntity = scene.getEntityByID(missileEntity.targetEntityID);
  const liveImpactAtMs = toFiniteNumber(missileEntity.liveImpactAtMs, 0);
  const visualImpactAtMs = toFiniteNumber(missileEntity.impactAtMs, 0);
  const surfaceImpactAtMs = toFiniteNumber(missileEntity.surfaceImpactAtMs, 0);
  const expiresAtMs = toFiniteNumber(missileEntity.expiresAtMs, 0);
  const launchedAtMs = toFiniteNumber(missileEntity.launchedAtMs, 0);
  const pendingGeometryImpactAtMs = toFiniteNumber(
    missileEntity.pendingGeometryImpactAtMs,
    0,
  );
  const clientReleaseGraceMs =
    missileEntity.clientDoSpread === true
      ? MISSILE_CLIENT_RELEASE_GRACE_MS
      : 0;
  const impactReleaseFloorAtMs = Math.max(
    visualImpactAtMs,
    pendingGeometryImpactAtMs,
  );
  const hasReachedImpactRadius =
    Boolean(targetEntity) &&
    getMissileImpactDistance(missileEntity, targetEntity) <= 0.001;
  const timeoutSuppressedByResolvedImpact =
    missileEntity.pendingGeometryImpact === true ||
    hasReachedImpactRadius;
  const timeoutExpiryAtMs = timeoutSuppressedByResolvedImpact
    ? Math.max(
        expiresAtMs,
        impactReleaseFloorAtMs + clientReleaseGraceMs,
      )
    : expiresAtMs;
  const lastMissileStep =
    missileEntity.lastMissileStep &&
    typeof missileEntity.lastMissileStep === "object"
      ? missileEntity.lastMissileStep
      : null;
  return {
    missile: summarizeMissileEntity(missileEntity),
    target: targetEntity
      ? {
          itemID: toInt(targetEntity.itemID, 0),
          kind: String(targetEntity.kind || ""),
          mode: String(targetEntity.mode || ""),
          position: summarizeVector(targetEntity.position),
          velocity: summarizeVector(targetEntity.velocity),
          radius: roundNumber(toFiniteNumber(targetEntity.radius, 0), 3),
        }
      : null,
    nowMs: roundNumber(toFiniteNumber(nowMs, 0), 3),
    rawDispatchStamp: scene.getCurrentDestinyStamp(nowMs),
    impactDistance: roundNumber(
      targetEntity ? getMissileImpactDistance(missileEntity, targetEntity) : 0,
      3,
    ),
    launchAgeMs: roundNumber(
      Math.max(0, toFiniteNumber(nowMs, 0) - launchedAtMs),
      3,
    ),
    clientReleaseGraceMs,
    impactReleaseFloorAtMs: roundNumber(impactReleaseFloorAtMs, 3),
    remainingImpactReleaseMs: roundNumber(
      Math.max(
        0,
        (impactReleaseFloorAtMs + clientReleaseGraceMs) -
          toFiniteNumber(nowMs, 0),
      ),
      3,
    ),
    timeoutSuppressedByResolvedImpact,
    timeoutExpiryAtMs: roundNumber(timeoutExpiryAtMs, 3),
    remainingTimeoutExpiryMs: roundNumber(
      Math.max(0, timeoutExpiryAtMs - toFiniteNumber(nowMs, 0)),
      3,
    ),
    flightBudgetMs: roundNumber(
      Math.max(0, expiresAtMs - launchedAtMs),
      3,
    ),
    remainingVisualImpactMs: roundNumber(
      Math.max(0, visualImpactAtMs - toFiniteNumber(nowMs, 0)),
      3,
    ),
    remainingSurfaceImpactMs: roundNumber(
      Math.max(
        0,
        surfaceImpactAtMs - toFiniteNumber(nowMs, 0),
      ),
      3,
    ),
    remainingExpiryMs: roundNumber(
      Math.max(0, expiresAtMs - toFiniteNumber(nowMs, 0)),
      3,
    ),
    expiryMinusVisualImpactMs: roundNumber(expiresAtMs - visualImpactAtMs, 3),
    expiryMinusSurfaceImpactMs: roundNumber(expiresAtMs - surfaceImpactAtMs, 3),
    expiryMinusLiveImpactMs: roundNumber(expiresAtMs - liveImpactAtMs, 3),
    pendingGeometryImpact: missileEntity.pendingGeometryImpact === true,
    pendingGeometryImpactAtMs: roundNumber(pendingGeometryImpactAtMs, 3),
    pendingGeometryImpactReason:
      missileEntity.pendingGeometryImpact === true
        ? String(missileEntity.pendingGeometryImpactReason || "")
        : "",
    pendingGeometryImpactPosition: summarizeVector(
      missileEntity.pendingGeometryImpactPosition,
    ),
    lastMissileStep: lastMissileStep
      ? normalizeTraceValue({
          deltaSeconds: roundNumber(
            toFiniteNumber(lastMissileStep.deltaSeconds, 0),
            6,
          ),
          stepDistance: roundNumber(
            toFiniteNumber(lastMissileStep.stepDistance, 0),
            6,
          ),
          surfaceDistanceBefore: roundNumber(
            toFiniteNumber(lastMissileStep.surfaceDistanceBefore, 0),
            6,
          ),
          surfaceDistanceAfter: roundNumber(
            toFiniteNumber(lastMissileStep.surfaceDistanceAfter, 0),
            6,
          ),
          rawSurfaceDistanceAfter: roundNumber(
            toFiniteNumber(lastMissileStep.rawSurfaceDistanceAfter, 0),
            6,
          ),
          reachedImpactSurface: lastMissileStep.reachedImpactSurface === true,
          frozenAtGeometryImpact:
            lastMissileStep.frozenAtGeometryImpact === true,
          legacyHeuristicImpactSurface:
            lastMissileStep.legacyHeuristicImpactSurface === true,
          pendingGeometryImpactAtMs: roundNumber(
            toFiniteNumber(lastMissileStep.pendingGeometryImpactAtMs, 0),
            3,
          ),
          previousPosition: summarizeVector(lastMissileStep.previousPosition),
          targetStepStartPosition: summarizeVector(
            lastMissileStep.targetStepStartPosition,
          ),
          targetPosition: summarizeVector(lastMissileStep.targetPosition),
          impactPosition: summarizeVector(lastMissileStep.impactPosition),
          sweptImpact: normalizeTraceValue(lastMissileStep.sweptImpact),
        })
      : null,
  };
}

function summarizeRuntimeEntityForMissileDebug(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }
  return {
    itemID: toInt(entity.itemID, 0),
    kind: String(entity.kind || ""),
    mode: String(entity.mode || ""),
    bubbleID: toInt(entity.bubbleID, 0),
    radius: roundNumber(toFiniteNumber(entity.radius, 0), 3),
    maxVelocity: roundNumber(toFiniteNumber(entity.maxVelocity, 0), 3),
    speedFraction: roundNumber(toFiniteNumber(entity.speedFraction, 0), 6),
    position: summarizeVector(entity.position),
    velocity: summarizeVector(entity.velocity),
    direction: summarizeVector(entity.direction),
    targetEntityID: toInt(entity.targetEntityID, 0),
    ownerShipID: toInt(entity.sourceShipID, 0),
    typeID: toInt(entity.typeID, 0),
  };
}

function buildSessionJumpTraceSnapshot(session) {
  if (!session) {
    return null;
  }
  return normalizeTraceValue({
    clientID: session.clientID || null,
    characterID: session.characterID || null,
    characterName: session.characterName || null,
    transitionState: session._transitionState || null,
    space: session._space
      ? {
          systemID: session._space.systemID,
          shipID: session._space.shipID,
          beyonceBound: session._space.beyonceBound === true,
          initialStateSent: session._space.initialStateSent === true,
          initialBallparkVisualsSent:
            session._space.initialBallparkVisualsSent === true,
          initialBallparkClockSynced:
            session._space.initialBallparkClockSynced === true,
          deferInitialBallparkClockUntilBind:
            session._space.deferInitialBallparkClockUntilBind === true,
          deferInitialBallparkStateUntilBind:
            session._space.deferInitialBallparkStateUntilBind === true,
          timeDilation: session._space.timeDilation,
          simTimeMs: session._space.simTimeMs,
          simFileTime: session._space.simFileTime,
        }
      : null,
    nextInitialBallparkPreviousSimTimeMs:
      session._nextInitialBallparkPreviousSimTimeMs ?? null,
    nextInitialBallparkPreviousTimeDilation:
      session._nextInitialBallparkPreviousTimeDilation ?? null,
    nextInitialBallparkPreviousCapturedAtWallclockMs:
      session._nextInitialBallparkPreviousCapturedAtWallclockMs ?? null,
    skipNextInitialBallparkRebase:
      session._skipNextInitialBallparkRebase === true,
  });
}

function appendJumpTimingTrace(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(
      JUMP_TIMING_TRACE_PATH,
      `${JSON.stringify(normalizeTraceValue({
        loggedAt: new Date().toISOString(),
        ...entry,
      }))}\n`,
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to append jump timing trace log: ${error.message}`);
  }
}

function getActiveSessionJumpTrace(session) {
  if (!session || !session._jumpTimingTrace) {
    return null;
  }
  const trace = session._jumpTimingTrace;
  const now = Date.now();
  if (Number(trace.untilMs || 0) > 0 && now > Number(trace.untilMs)) {
    session._jumpTimingTrace = null;
    return null;
  }
  return trace;
}

function beginSessionJumpTimingTrace(session, kind, details = {}) {
  if (!session) {
    return null;
  }
  const now = Date.now();
  const trace = {
    id: nextSessionJumpTraceID++,
    kind,
    startedAtMs: now,
    untilMs: now + SESSION_JUMP_TRACE_WINDOW_MS,
  };
  session._jumpTimingTrace = trace;
  appendJumpTimingTrace({
    traceID: trace.id,
    event: "trace-start",
    kind,
    atMs: now,
    details,
    session: buildSessionJumpTraceSnapshot(session),
  });
  return trace;
}

function recordSessionJumpTimingTrace(session, event, details = {}) {
  const trace = getActiveSessionJumpTrace(session);
  if (!trace) {
    return false;
  }
  appendJumpTimingTrace({
    traceID: trace.id,
    event,
    kind: trace.kind,
    atMs: Date.now(),
    details,
    session: buildSessionJumpTraceSnapshot(session),
  });
  return true;
}

function logBubbleDebug(event, details = {}) {
  appendBubbleDebug(JSON.stringify({
    event,
    atMs: Date.now(),
    destinyStamp: getCurrentDestinyStamp(),
    ...details,
  }));
}

function summarizeBubbleEntity(entity) {
  if (!entity) {
    return null;
  }

  return {
    itemID: toInt(entity.itemID, 0),
    name: String(entity.itemName || entity.name || ""),
    mode: String(entity.mode || ""),
    bubbleID: toInt(entity.bubbleID, 0),
    departureBubbleID: toInt(entity.departureBubbleID, 0),
    position: summarizeVector(entity.position),
    velocityMs: roundNumber(magnitude(entity.velocity || { x: 0, y: 0, z: 0 }), 3),
  };
}

function summarizeBubbleState(bubble) {
  if (!bubble) {
    return null;
  }

  return {
    id: toInt(bubble.id, 0),
    uuid: String(bubble.uuid || ""),
    center: summarizeVector(bubble.center),
    entityCount: bubble.entityIDs instanceof Set ? bubble.entityIDs.size : 0,
    entityIDs:
      bubble.entityIDs instanceof Set
        ? [...bubble.entityIDs].map((itemID) => toInt(itemID, 0))
        : [],
  };
}

function buildPerpendicular(vector) {
  const direction = normalizeVector(vector, DEFAULT_RIGHT);
  const firstPass = crossProduct(direction, DEFAULT_UP);
  if (magnitude(firstPass) > 0) {
    return normalizeVector(firstPass, DEFAULT_RIGHT);
  }

  return normalizeVector(crossProduct(direction, DEFAULT_RIGHT), DEFAULT_UP);
}

function normalizeMode(value, fallback = "STOP") {
  return VALID_MODES.has(value) ? value : fallback;
}

function allocateRuntimeEntityID(preferredItemID = null) {
  const numericPreferred = toInt(preferredItemID, 0);
  if (numericPreferred > 0) {
    nextRuntimeEntityID = Math.max(nextRuntimeEntityID, numericPreferred + 1);
    return numericPreferred;
  }

  const allocated = nextRuntimeEntityID;
  nextRuntimeEntityID += 1;
  return allocated;
}

function deriveAgilitySeconds(alignTime, maxAccelerationTime, mass = 0, inertia = 0) {
  const officialTauSeconds = deriveOfficialTauSeconds(mass, inertia);
  if (officialTauSeconds > 0) {
    return Math.max(officialTauSeconds, 0.05);
  }

  const accelSeconds =
    toFiniteNumber(maxAccelerationTime, 0) / DESTINY_ACCEL_LOG_DENOMINATOR;
  if (accelSeconds > 0) {
    return Math.max(accelSeconds, 0.05);
  }

  const alignSeconds =
    toFiniteNumber(alignTime, 0) / DESTINY_ALIGN_LOG_DENOMINATOR;
  if (alignSeconds > 0) {
    return Math.max(alignSeconds, 0.05);
  }

  return 1;
}

function deriveOfficialTauSeconds(mass = 0, inertia = 0) {
  const numericMass = toFiniteNumber(mass, 0);
  const numericInertia = toFiniteNumber(inertia, 0);
  const tauSeconds = (numericMass * numericInertia) / 1_000_000;
  return tauSeconds > 0 ? tauSeconds : 0;
}

function getCurrentAlignmentDirection(entity, fallbackDirection = DEFAULT_RIGHT) {
  const resolvedFallback = normalizeVector(
    fallbackDirection,
    normalizeVector(entity && entity.direction, DEFAULT_RIGHT),
  );
  const currentVelocity = cloneVector(entity && entity.velocity);
  const currentSpeed = magnitude(currentVelocity);
  const maxVelocity = Math.max(toFiniteNumber(entity && entity.maxVelocity, 0), 0);
  const minimumAlignmentSpeed = Math.max(0.5, maxVelocity * 0.01);
  if (currentSpeed > minimumAlignmentSpeed) {
    return normalizeVector(currentVelocity, resolvedFallback);
  }
  return normalizeVector(entity && entity.direction, resolvedFallback);
}

function integrateVelocityTowardTarget(
  currentVelocity,
  desiredVelocity,
  responseSeconds,
  deltaSeconds,
) {
  const tau = Math.max(toFiniteNumber(responseSeconds, 0.05), 0.05);
  const delta = Math.max(toFiniteNumber(deltaSeconds, 0), 0);
  const decay = Math.exp(-(delta / tau));
  const velocityOffset = subtractVectors(currentVelocity, desiredVelocity);
  const nextVelocity = addVectors(
    desiredVelocity,
    scaleVector(velocityOffset, decay),
  );
  const positionDelta = addVectors(
    scaleVector(desiredVelocity, delta),
    scaleVector(velocityOffset, tau * (1 - decay)),
  );
  return {
    nextVelocity,
    positionDelta,
    decay,
    tau,
  };
}

function deriveTurnDegreesPerTick(agilitySeconds) {
  const normalizedAgility = Math.max(toFiniteNumber(agilitySeconds, 0.05), 0.05);
  // The old linear falloff effectively stalled capital-class turns once
  // agility drifted past ~60s. Use a bounded inverse curve instead so large
  // hulls still converge in a finite, client-like amount of time while small
  // hulls retain noticeably sharper turns.
  return clamp(75 / normalizedAgility, 0.75, 12);
}

function slerpDirection(current, target, fraction, radians) {
  const clampedFraction = clamp(fraction, 0, 1);
  if (clampedFraction <= 0) {
    return current;
  }
  if (clampedFraction >= 1) {
    return target;
  }

  const totalRadians = Math.max(toFiniteNumber(radians, 0), 0);
  const sinTotal = Math.sin(totalRadians);
  if (!Number.isFinite(sinTotal) || Math.abs(sinTotal) < 0.000001) {
    return normalizeVector(
      addVectors(
        scaleVector(current, 1 - clampedFraction),
        scaleVector(target, clampedFraction),
      ),
      target,
    );
  }

  const leftWeight =
    Math.sin((1 - clampedFraction) * totalRadians) / sinTotal;
  const rightWeight =
    Math.sin(clampedFraction * totalRadians) / sinTotal;

  return normalizeVector(
    addVectors(
      scaleVector(current, leftWeight),
      scaleVector(target, rightWeight),
    ),
    target,
  );
}

function getStationConfiguredUndockDistance(station) {
  const undockPosition = station && station.undockPosition;
  if (!station || !station.position || !undockPosition) {
    return 0;
  }

  return distance(
    cloneVector(station.position),
    cloneVector(undockPosition),
  );
}

function hasRealStationDockData(station) {
  return Boolean(
    station &&
      station.dockPosition &&
      station.dockOrientation &&
      magnitude(cloneVector(station.dockOrientation)) > 0,
  );
}

function isStructureDockable(station) {
  return Boolean(
    station &&
      (
        station.kind === "structure" ||
        station.isStructure === true ||
        Number(station.structureID || 0) > 0
      ),
  );
}

function getStationDockPosition(station, options = {}) {
  if (isStructureDockable(station)) {
    return structureLocatorGeometry.getStructureDockPosition(station, {
      shipTypeID: options.shipTypeID,
      selectionStrategy: options.selectionStrategy || "hash",
      selectionKey: options.selectionKey,
    });
  }

  if (station) {
    return stationLocatorGeometry.getStationDockPosition(station, {
      shipTypeID: options.shipTypeID,
      selectionStrategy: options.selectionStrategy || "hash",
      selectionKey: options.selectionKey,
    });
  }

  if (station && station.dockPosition) {
    return cloneVector(station.dockPosition, station.position);
  }

  return cloneVector(station && station.position);
}

function getStationApproachPosition(station, options = {}) {
  if (options.useDockPosition === true) {
    return getStationDockPosition(station, options);
  }

  return cloneVector(station && station.position);
}

function getStationWarpTargetPosition(station, options = {}) {
  // Inbound warp aims at the station or structure ball center. The warp stop
  // distance places the ship on the near-side perimeter along its approach.
  return cloneVector(station && station.position);
}

function getStargateInteractionRadius(stargate) {
  const configuredRadius = toFiniteNumber(
    stargate && stargate.interactionRadius,
    0,
  );
  if (configuredRadius > 0) {
    return configuredRadius;
  }

  return DEFAULT_STARGATE_INTERACTION_RADIUS;
}

function getRandomPointInSphere(radius) {
  const maxRadius = Math.max(0, toFiniteNumber(radius, 0));
  if (maxRadius <= 0) {
    return { x: 0, y: 0, z: 0 };
  }

  const theta = Math.random() * Math.PI * 2;
  const vertical = (Math.random() * 2) - 1;
  const distanceScale = Math.cbrt(Math.random());
  const radialDistance = maxRadius * distanceScale;
  const planarDistance = Math.sqrt(Math.max(0, 1 - (vertical * vertical))) * radialDistance;

  return {
    x: Math.cos(theta) * planarDistance,
    y: vertical * radialDistance,
    z: Math.sin(theta) * planarDistance,
  };
}

function getStargateWarpExitPoint(entity, stargate, minimumRange = 0) {
  const gateRadius = resolveStargatePhysicalRadius(stargate);
  const shipRadius = Math.max(0, toFiniteNumber(entity && entity.radius, 0));
  // "Warp to 0" in EVE means 0 m from the edge of the Destiny ball. The map
  // stargate rows carry a layout radius, so use the resolved item radius here.
  const minimumOffset = gateRadius + shipRadius + 500;
  const requestedRange = Math.max(minimumOffset, toFiniteNumber(minimumRange, 0));
  const gatePosition = cloneVector(stargate && stargate.position);
  const fallbackDirection = normalizeVector(
    entity && entity.direction ? entity.direction : DEFAULT_RIGHT,
    DEFAULT_RIGHT,
  );
  const fromGateToShip = normalizeVector(
    subtractVectors(entity && entity.position, gatePosition),
    fallbackDirection,
  );

  return addVectors(
    gatePosition,
    scaleVector(fromGateToShip, requestedRange),
  );
}

function getStargateWarpExitEnvelopePoint(entity, stargate, minimumRange = 0) {
  const gateRadius = resolveStargatePhysicalRadius(stargate);
  const requestedRange = Math.max(0, toFiniteNumber(minimumRange, 0));
  const explicitSurfaceRange =
    requestedRange > MAX_STARGATE_JUMP_DISTANCE_METERS
      ? requestedRange
      : 0;
  const gatePosition = cloneVector(stargate && stargate.position);
  const fallbackDirection = normalizeVector(
    entity && entity.direction ? entity.direction : DEFAULT_RIGHT,
    DEFAULT_RIGHT,
  );
  const fromGateToShip = normalizeVector(
    subtractVectors(entity && entity.position, gatePosition),
    fallbackDirection,
  );

  return addVectors(
    gatePosition,
    scaleVector(fromGateToShip, gateRadius + explicitSurfaceRange),
  );
}

function getStargateWarpLandingPoint(entity, stargate, minimumRange = 0) {
  const requestedClearance = Math.max(0, toFiniteNumber(minimumRange, 0));
  const scatterRadius =
    requestedClearance > MAX_STARGATE_JUMP_DISTANCE_METERS
      ? WARP_EXIT_VARIANCE_RADIUS_METERS
      : 0;
  return addVectors(
    getStargateWarpExitPoint(entity, stargate, minimumRange),
    getRandomPointInSphere(scatterRadius),
  );
}

function getRandomPointInHemisphere(radius, normal) {
  const point = getRandomPointInSphere(radius);
  const hemisphereNormal = normalizeVector(normal, DEFAULT_RIGHT);
  const projection = dotProduct(point, hemisphereNormal);
  if (projection >= 0) {
    return point;
  }

  return subtractVectors(
    point,
    scaleVector(hemisphereNormal, projection * 2),
  );
}

function resolveStargateWarpTarget(entity, stargate, minimumRange = 0) {
  const requestedRange = Math.max(0, toFiniteNumber(minimumRange, 0));
  // Retail gate warps target the near-side zero-distance envelope as the WXP.
  // A center target leaves large gates reading 0 m and causes client-side
  // presentation nudges against the Destiny ball.
  const nativeStopDistance = Math.max(
    1,
    Math.random() * WARP_EXIT_VARIANCE_RADIUS_METERS,
  );
  const gatePosition = cloneVector(stargate && stargate.position);
  const fallbackDirection = normalizeVector(
    entity && entity.direction ? entity.direction : DEFAULT_RIGHT,
    DEFAULT_RIGHT,
  );
  const fromGateToShip = normalizeVector(
    subtractVectors(entity && entity.position, gatePosition),
    fallbackDirection,
  );
  const travelDirection = scaleVector(fromGateToShip, -1);
  const warpExitPoint = getStargateWarpExitEnvelopePoint(
    entity,
    stargate,
    requestedRange,
  );
  const landingPoint = addVectors(
    warpExitPoint,
    getRandomPointInHemisphere(
      WARP_EXIT_VARIANCE_RADIUS_METERS,
      fromGateToShip,
    ),
  );

  return {
    rawDestination: addVectors(
      landingPoint,
      scaleVector(travelDirection, nativeStopDistance),
    ),
    stopDistance: nativeStopDistance,
  };
}

function getTargetMotionPosition(target, options = {}) {
  if (target && (target.kind === "station" || target.kind === "structure")) {
    return getStationApproachPosition(target, options);
  }

  return cloneVector(target && target.position);
}

function getFollowMotionProfile(entity, target) {
  return {
    targetPoint: getTargetMotionPosition(target),
    rangeRadius: Math.max(0, toFiniteNumber(target && target.radius, 0)),
  };
}

function getStationDockDirection(station) {
  if (station && !isStructureDockable(station)) {
    return normalizeVector(
      stationLocatorGeometry.buildStationDockingGeometry(station, {
        selectionStrategy: "first",
      }).dockOrientation,
      DEFAULT_RIGHT,
    );
  }

  if (station && station.dockOrientation) {
    return normalizeVector(station.dockOrientation, DEFAULT_RIGHT);
  }

  return normalizeVector(
    station && station.undockDirection,
    DEFAULT_RIGHT,
  );
}

function coerceDunRotationTuple(source) {
  if (!Array.isArray(source) || source.length !== 3) {
    return null;
  }

  const tuple = source.map((value) => roundNumber(value, 6));
  return tuple.every((value) => Number.isFinite(value)) ? tuple : null;
}

function getStationRenderMetadata(station, fieldName) {
  if (!station || !fieldName) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(station, fieldName)) {
    return station[fieldName];
  }

  const stationType = worldData.getStationTypeByID(station.stationTypeID);
  if (
    stationType &&
    Object.prototype.hasOwnProperty.call(stationType, fieldName)
  ) {
    return stationType[fieldName];
  }

  return undefined;
}

function getStationAuthoredDunRotation(station) {
  return coerceDunRotationTuple(
    getStationRenderMetadata(station, "dunRotation"),
  );
}

function coerceStageTuple(source) {
  if (!Array.isArray(source) || source.length !== 2) {
    return [0, 1];
  }

  const stage = roundNumber(source[0], 6);
  const maximum = Math.max(roundNumber(source[1], 6), 1);
  return Number.isFinite(stage) && Number.isFinite(maximum)
    ? [stage, maximum]
    : [0, 1];
}

function coerceActivationState(value, fallback = STARGATE_ACTIVATION_STATE.CLOSED) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function coerceStableActivationState(
  value,
  fallback = STARGATE_ACTIVATION_STATE.CLOSED,
) {
  const state = coerceActivationState(value, fallback);
  if (state <= STARGATE_ACTIVATION_STATE.CLOSED) {
    return STARGATE_ACTIVATION_STATE.CLOSED;
  }
  if (state === STARGATE_ACTIVATION_STATE.ACTIVATING) {
    return STARGATE_ACTIVATION_STATE.OPEN;
  }
  return state;
}

function getSolarSystemPseudoSecurity(system) {
  const security = clamp(toFiniteNumber(system && system.security, 0), 0, 1);
  if (security > 0 && security < 0.05) {
    return 0.05;
  }

  return security;
}

function getSystemSecurityClass(system) {
  const security = getSolarSystemPseudoSecurity(system);
  if (security <= 0) {
    return 0;
  }
  if (security < 0.45) {
    return 1;
  }
  return 2;
}

function getSystemOwnerID(system) {
  const factionID = toInt(system && system.factionID, 0);
  return factionID > 0 ? factionID : null;
}

function getSecurityStatusIconKey(system) {
  const securityTenths = clamp(
    Math.round(getSolarSystemPseudoSecurity(system) * 10),
    0,
    10,
  );
  const whole = Math.floor(securityTenths / 10);
  const tenths = securityTenths % 10;
  return `SEC_${whole}_${tenths}`;
}

function getDisplayedSecurityForStartupLoading(system) {
  return Math.round(getSolarSystemPseudoSecurity(system) * 10) / 10;
}

function getConfiguredStartupSystemLoadingMode() {
  const configuredMode = toInt(
    config.NewEdenSystemLoading,
    NEW_EDEN_SYSTEM_LOADING.LAZY,
  );
  if (
    configuredMode === NEW_EDEN_SYSTEM_LOADING.ONGOING_LAZY ||
    configuredMode === NEW_EDEN_SYSTEM_LOADING.HIGHSEC ||
    configuredMode === NEW_EDEN_SYSTEM_LOADING.ALL
  ) {
    return configuredMode;
  }
  return NEW_EDEN_SYSTEM_LOADING.LAZY;
}

function keepsAllStargatesActiveDuringLazyLoading(
  mode = getConfiguredStartupSystemLoadingMode(),
) {
  return mode === NEW_EDEN_SYSTEM_LOADING.ONGOING_LAZY;
}

function normalizeStartupSystemIDs(systemIDs) {
  return [...new Set(
    (Array.isArray(systemIDs) ? systemIDs : [])
      .map((value) => toInt(value, 0))
      .filter((value) => value > 0),
  )].sort((left, right) => left - right);
}

function getStartupPreloadSystemLabel(systemID) {
  const numericSystemID = toInt(systemID, 0);
  const systemRecord = worldData.getSolarSystemByID(numericSystemID) || null;
  const systemName = String(
    systemRecord &&
      (systemRecord.solarSystemName ||
        systemRecord.itemName ||
        systemRecord.name ||
        ""),
  ).trim();
  return systemName
    ? `${systemName} (${numericSystemID})`
    : `system ${numericSystemID}`;
}

function shouldLogDetailedStartupPreload(totalSystems) {
  return Math.max(0, toInt(totalSystems, 0)) <= 25;
}

function shouldLogStartupPreloadCheckpoint(index, totalSystems) {
  const normalizedIndex = Math.max(1, toInt(index, 1));
  const normalizedTotal = Math.max(1, toInt(totalSystems, 1));
  if (shouldLogDetailedStartupPreload(normalizedTotal)) {
    return true;
  }
  if (normalizedIndex === 1 || normalizedIndex === normalizedTotal) {
    return true;
  }
  const checkpointStride =
    normalizedTotal >= 1000 ? 100 : normalizedTotal >= 250 ? 25 : 10;
  return normalizedIndex % checkpointStride === 0;
}

function formatStartupBootstrapMetrics(metrics = {}) {
  const parts = [];
  if ((Number(metrics.sceneConstructionElapsedMs) || 0) > 0) {
    parts.push(`scene ${metrics.sceneConstructionElapsedMs}ms`);
  }
  if ((Number(metrics.asteroidsElapsedMs) || 0) > 0) {
    parts.push(`asteroids ${metrics.asteroidsElapsedMs}ms`);
  }
  if ((Number(metrics.miningElapsedMs) || 0) > 0) {
    parts.push(`mining ${metrics.miningElapsedMs}ms`);
  }
  if ((Number(metrics.npcElapsedMs) || 0) > 0) {
    parts.push(`npc ${metrics.npcElapsedMs}ms`);
  }
  if ((Number(metrics.dungeonElapsedMs) || 0) > 0) {
    parts.push(`dungeon ${metrics.dungeonElapsedMs}ms`);
  }
  if ((Number(metrics.wormholesElapsedMs) || 0) > 0) {
    parts.push(`wormholes ${metrics.wormholesElapsedMs}ms`);
  }
  return parts.join(" | ");
}

function resolveStartupSolarSystemPreloadPlan() {
  const mode = getConfiguredStartupSystemLoadingMode();

  if (mode === NEW_EDEN_SYSTEM_LOADING.ONGOING_LAZY) {
    return {
      mode,
      modeName: "OnGoingLazy",
      label:
        "preloading only the default startup systems (Jita, New Caldari, and Manifest) while keeping every stargate active for on-demand loading",
      selectionRule:
        "Preserves the lazy preload list, but all stargates remain active and destination scenes load only when jumped into",
      targetSummary:
        "Jita, New Caldari, and Manifest preload with on-demand access to the rest of New Eden",
      systemIDs: [...STARTUP_PRELOADED_SYSTEM_IDS],
    };
  }

  if (mode === NEW_EDEN_SYSTEM_LOADING.HIGHSEC) {
    return {
      mode,
      modeName: "High-Sec Preload",
      label:
        "preloading every high-security system with displayed security 0.5+ from world data",
      selectionRule: "Displayed security >= 0.5, resolved dynamically from world data",
      targetSummary: "All high-security systems",
      systemIDs: normalizeStartupSystemIDs(
        worldData.getSolarSystems()
          .filter(
            (system) => getDisplayedSecurityForStartupLoading(system) >= 0.5,
          )
          .map((system) => system && system.solarSystemID),
      ),
    };
  }

  if (mode === NEW_EDEN_SYSTEM_LOADING.ALL) {
    return {
      mode,
      modeName: "All Systems",
      label: "preloading every solar system in New Eden",
      selectionRule: "Every solar system row is queued during startup",
      targetSummary: "All solar systems",
      systemIDs: normalizeStartupSystemIDs(
        worldData.getSolarSystems().map((system) => system && system.solarSystemID),
      ),
    };
  }

  return {
    mode: NEW_EDEN_SYSTEM_LOADING.LAZY,
    modeName: "Lazy Default",
    label: "preloading only the default startup systems (Jita, New Caldari, and Manifest)",
    selectionRule: "Preserves the current startup behavior",
    targetSummary: "Jita, New Caldari, and Manifest",
    systemIDs: [...STARTUP_PRELOADED_SYSTEM_IDS],
  };
}

function resolveStartupPreloadedSystemIDs() {
  return resolveStartupSolarSystemPreloadPlan().systemIDs;
}

function isHazardousSecurityTransition(sourceSystem, destinationSystem) {
  const sourceSecurityClass = getSystemSecurityClass(sourceSystem);
  const destinationSecurityClass = getSystemSecurityClass(destinationSystem);
  return (
    (sourceSecurityClass === 2 && destinationSecurityClass !== 2) ||
    (sourceSecurityClass === 1 && destinationSecurityClass === 0)
  );
}

function getStargateAuthoredDunRotation(stargate) {
  return coerceDunRotationTuple(stargate && stargate.dunRotation);
}

function getSharedWorldPosition(systemPosition, localPosition) {
  if (!systemPosition || !localPosition) {
    return null;
  }

  return {
    x: toFiniteNumber(systemPosition.x, 0) - toFiniteNumber(localPosition.x, 0),
    y: toFiniteNumber(systemPosition.y, 0) + toFiniteNumber(localPosition.y, 0),
    z: toFiniteNumber(systemPosition.z, 0) + toFiniteNumber(localPosition.z, 0),
  };
}

function buildDunRotationFromDirection(direction) {
  if (!direction || magnitude(direction) <= 0) {
    return null;
  }

  const forward = scaleVector(direction, 1 / magnitude(direction));
  const yawDegrees = Math.atan2(forward.x, forward.z) * (180 / Math.PI);
  const pitchDegrees = -Math.asin(clamp(forward.y, -1, 1)) * (180 / Math.PI);
  return coerceDunRotationTuple([yawDegrees, pitchDegrees, 0]);
}

function getStargateDerivedDunRotation(stargate) {
  if (!stargate) {
    return null;
  }

  const sourceSystem = worldData.getSolarSystemByID(stargate.solarSystemID);
  const destinationGate =
    worldData.getStargateByID(stargate.destinationID) || null;
  const destinationSystemID =
    toInt(stargate.destinationSolarSystemID, 0) ||
    toInt(destinationGate && destinationGate.solarSystemID, 0);
  const destinationSystem = worldData.getSolarSystemByID(destinationSystemID);
  if (!sourceSystem || !destinationSystem) {
    return null;
  }

  return buildStargateDunRotationFromDirection(
    getStargateSystemForwardDirection(stargate, sourceSystem, destinationSystem),
  );
}

function getResolvedStargateDunRotation(stargate) {
  return (
    getStargateAuthoredDunRotation(stargate) ||
    getStargateDerivedDunRotation(stargate)
  );
}

function getStargateTypeMetadata(stargate, fieldName) {
  if (!stargate || !fieldName) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(stargate, fieldName)) {
    return stargate[fieldName];
  }

  const stargateType = worldData.getStargateTypeByID(stargate.typeID);
  if (
    stargateType &&
    Object.prototype.hasOwnProperty.call(stargateType, fieldName)
  ) {
    return stargateType[fieldName];
  }

  return undefined;
}

function getStargateRenderMetadata(stargate, fieldName) {
  if (!stargate || !fieldName) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(stargate, fieldName)) {
    return stargate[fieldName];
  }

  const authoredValue = getStargateVisualOverrideField(
    stargate,
    fieldName,
  );
  if (authoredValue !== undefined) {
    return authoredValue;
  }

  return getStargateTypeMetadata(stargate, fieldName);
}

function getStargateStatusIcons(stargate, destinationSystem) {
  const configuredIcons = Array.isArray(stargate && stargate.destinationSystemStatusIcons)
    ? stargate.destinationSystemStatusIcons
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];
  if (configuredIcons.length > 0) {
    return configuredIcons;
  }

  if (!destinationSystem) {
    return [];
  }

  return [getSecurityStatusIconKey(destinationSystem)];
}

function getStargateWarningIcon(stargate, sourceSystem, destinationSystem) {
  if (stargate && stargate.destinationSystemWarningIcon) {
    return String(stargate.destinationSystemWarningIcon);
  }

  return isHazardousSecurityTransition(sourceSystem, destinationSystem)
    ? "stargate_travelwarning3.dds"
    : null;
}

function resolveShipSkinMaterialSetID(shipItem) {
  if (!shipItem) {
    return null;
  }

  return getAppliedSkinMaterialSetID(shipItem.itemID);
}

function isShipFittingFlag(flagID) {
  const numericFlagID = toInt(flagID, 0);
  return SHIP_FITTING_FLAG_RANGES.some(
    ([minimum, maximum]) =>
      numericFlagID >= minimum && numericFlagID <= maximum,
  );
}

function normalizeSlimShipModules(modules) {
  if (!Array.isArray(modules)) {
    return [];
  }

  return modules
    .map((entry) => {
      if (Array.isArray(entry)) {
        return [
          toInt(entry[0], 0),
          toInt(entry[1], 0),
          toInt(entry[2], 0),
        ];
      }
      if (!entry || typeof entry !== "object") {
        return null;
      }
      return [
        toInt(entry.itemID, 0),
        toInt(entry.typeID, 0),
        toInt(entry.flagID, 0),
      ];
    })
    .filter(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 3 &&
        entry.every((value) => Number.isInteger(value) && value > 0),
    )
    .sort((left, right) => {
      if (left[2] !== right[2]) {
        return left[2] - right[2];
      }
      return left[0] - right[0];
    });
}

function getShipEntityInventoryCharacterID(entity, fallback = 0) {
  return toInt(
    entity && (
      entity.pilotCharacterID ??
      entity.characterID
    ),
    fallback,
  );
}

function isRuntimeDogmaHostEntity(entity) {
  return Boolean(
    entity &&
    (
      entity.kind === "ship" ||
      entity.kind === "structure"
    ),
  );
}

function buildRuntimeShipItemFromEntity(entity) {
  if (!isRuntimeDogmaHostEntity(entity)) {
    return null;
  }

  return {
    itemID: toInt(entity.itemID, 0),
    typeID: toInt(entity.typeID, 0),
    groupID: toInt(entity.groupID, 0),
    categoryID: toInt(entity.categoryID, 0),
    itemName: String(entity.itemName || entity.slimName || "Ship"),
    ownerID: toInt(entity.ownerID, 0),
    radius: toFiniteNumber(entity.radius, 0),
    conditionState: normalizeShipConditionState(entity.conditionState),
  };
}

function getEntityRuntimeSkillMap(entity) {
  if (!isRuntimeDogmaHostEntity(entity)) {
    return new Map();
  }

  if (entity.skillMap instanceof Map) {
    return entity.skillMap;
  }

  const characterID = getShipEntityInventoryCharacterID(entity, 0);
  if (characterID <= 0) {
    return new Map();
  }
  return getCharacterSkillMap(characterID);
}

function getEntityRuntimeShipItem(entity) {
  if (!isRuntimeDogmaHostEntity(entity)) {
    return null;
  }

  const characterID = getShipEntityInventoryCharacterID(entity, 0);
  if (characterID > 0) {
    return entity.kind === "structure"
      ? buildRuntimeShipItemFromEntity(entity)
      : resolveActiveShipRecord(characterID) ||
        findShipItemById(entity.itemID) ||
        buildRuntimeShipItemFromEntity(entity);
  }

  return buildRuntimeShipItemFromEntity(entity);
}

function getEntityRuntimeFittedItems(entity) {
  if (!isRuntimeDogmaHostEntity(entity)) {
    return [];
  }

  if (isNativeNpcEntity(entity)) {
    return getNpcFittedModuleItems(entity);
  }

  const characterID = getShipEntityInventoryCharacterID(entity, 0);
  if (characterID > 0) {
    return getFittedModuleItems(characterID, entity.itemID);
  }

  return Array.isArray(entity.fittedItems)
    ? entity.fittedItems.map((item) => ({ ...item }))
    : [];
}

function getEntityRuntimeModuleItem(entity, moduleID = 0, moduleFlagID = 0) {
  const normalizedModuleID = toInt(moduleID, 0);
  const normalizedModuleFlagID = toInt(moduleFlagID, 0);
  const candidateItems = [
    ...getEntityRuntimeFittedItems(entity),
    ...(isNativeNpcEntity(entity)
      ? [
        ...getNpcWeaponModules(entity),
        ...getNpcHostileModules(entity).map((entry) => entry && entry.moduleItem).filter(Boolean),
        ...getNpcAssistanceModules(entity).map((entry) => entry && entry.moduleItem).filter(Boolean),
        ...getNpcSelfModules(entity).map((entry) => entry && entry.moduleItem).filter(Boolean),
        ...getNpcSuperweaponModules(entity),
        ...getNpcPropulsionModules(entity).map((entry) => entry && entry.moduleItem).filter(Boolean),
      ]
      : []),
  ];
  const seenModuleIDs = new Set();
  for (const moduleItem of candidateItems) {
    const candidateModuleID = toInt(moduleItem && moduleItem.itemID, 0);
    if (candidateModuleID > 0) {
      if (seenModuleIDs.has(candidateModuleID)) {
        continue;
      }
      seenModuleIDs.add(candidateModuleID);
    }
    if (
      (normalizedModuleID > 0 && candidateModuleID === normalizedModuleID) ||
      (normalizedModuleFlagID > 0 && toInt(moduleItem && moduleItem.flagID, 0) === normalizedModuleFlagID)
    ) {
      return moduleItem;
    }
  }
  return null;
}

function getEntityRuntimeLoadedCharge(entity, moduleItem = null, moduleFlagID = 0) {
  if (!isRuntimeDogmaHostEntity(entity)) {
    return null;
  }

  const resolvedModuleItem =
    moduleItem ||
    getEntityRuntimeModuleItem(entity, 0, moduleFlagID);
  const resolvedFlagID = toInt(
    resolvedModuleItem && resolvedModuleItem.flagID,
    moduleFlagID,
  );
  if (resolvedFlagID <= 0) {
    return null;
  }

  if (isNativeNpcEntity(entity)) {
    return resolvedModuleItem
      ? getNpcLoadedChargeForModule(entity, resolvedModuleItem)
      : null;
  }

  const characterID = getShipEntityInventoryCharacterID(entity, 0);
  if (characterID <= 0) {
    if (
      resolvedModuleItem &&
      resolvedModuleItem.loadedChargeItem &&
      toInt(resolvedModuleItem.loadedChargeItem.typeID, 0) > 0
    ) {
      return {
        ...resolvedModuleItem.loadedChargeItem,
      };
    }

    const resolvedModuleID = toInt(resolvedModuleItem && resolvedModuleItem.itemID, 0);
    const fallbackChargeItem = getEntityRuntimeFittedItems(entity).find((candidate) => (
      candidate &&
      toInt(candidate.itemID, 0) !== resolvedModuleID &&
      toInt(candidate.flagID, 0) === resolvedFlagID &&
      (
        resolvedModuleItem
          ? isChargeCompatibleWithModule(
            toInt(resolvedModuleItem.typeID, 0),
            toInt(candidate.typeID, 0),
          )
          : toInt(candidate.typeID, 0) > 0
      )
    ));
    return fallbackChargeItem
      ? { ...fallbackChargeItem }
      : null;
  }
  return getLoadedChargeByFlag(characterID, toInt(entity.itemID, 0), resolvedFlagID);
}

function getEntityRuntimeActiveModuleContexts(entity, options = {}) {
  if (!entity || !(entity.activeModuleEffects instanceof Map)) {
    return [];
  }

  const excludeModuleID = toInt(options.excludeModuleID, 0);
  const genericOnly = options.genericOnly !== false;
  const contexts = [];

  for (const effectState of entity.activeModuleEffects.values()) {
    if (!effectState) {
      continue;
    }
    if (genericOnly && effectState.isGeneric !== true) {
      continue;
    }
    if (
      excludeModuleID > 0 &&
      toInt(effectState.moduleID, 0) === excludeModuleID
    ) {
      continue;
    }

    const moduleItem = getEntityRuntimeModuleItem(
      entity,
      effectState.moduleID,
      effectState.moduleFlagID,
    );
    const effectRecord = getEffectTypeRecord(effectState.effectID);
    if (!moduleItem || !effectRecord) {
      continue;
    }

    contexts.push({
      effectState,
      effectRecord,
      moduleItem,
      chargeItem: getEntityRuntimeLoadedCharge(entity, moduleItem),
    });
  }

  return contexts;
}

function buildLocalCycleRuntimeCallbacks(fallbackCharacterID = 0) {
  return {
    resolveCharacterID(entity) {
      return getShipEntityInventoryCharacterID(entity, fallbackCharacterID);
    },
    getEntityRuntimeShipItem,
    getEntityRuntimeFittedItems,
    getEntityRuntimeActiveModuleContexts,
    getEntityRuntimeLoadedCharge,
    getEntityCapacitorAmount,
    setEntityCapacitorRatio,
    notifyCapacitorChangeToSession,
    buildShipHealthTransitionResult,
    notifyShipHealthAttributesToSession,
    broadcastDamageStateChange,
    persistDynamicEntity,
    notifyRuntimeChargeTransitionToSession,
  };
}

function buildAssistanceModuleRuntimeCallbacks() {
  return {
    isEntityLockedTarget,
    getEntitySurfaceDistance,
    getEntityCapacitorAmount,
    setEntityCapacitorRatio,
    notifyCapacitorChangeToSession,
    normalizeShipConditionState,
    buildShipHealthTransitionResult,
    notifyShipHealthAttributesToSession,
    broadcastDamageStateChange,
    persistDynamicEntity,
  };
}

function buildHostileModuleRuntimeCallbacks(scene = null) {
  return {
    getEntityByID(entityID) {
      return scene && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(entityID)
        : null;
    },
    isEntityLockedTarget,
    getEntitySurfaceDistance,
    getEntityCapacitorAmount,
    setEntityCapacitorRatio,
    persistEntityCapacitorRatio,
    notifyCapacitorChangeToSession,
  };
}

function buildJammerModuleRuntimeCallbacks(scene = null) {
  return {
    getEntityByID(entityID) {
      return scene && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(entityID)
        : null;
    },
    isEntityLockedTarget,
    getEntitySurfaceDistance,
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

function buildMicroJumpDriveRuntimeCallbacks(scene = null) {
  return {
    getCurrentAlignmentDirection,
    addVectors,
    scaleVector,
    breakEntityStructureTether(runtimeScene, entity, options = {}) {
      return breakEntityStructureTether(runtimeScene || scene, entity, options);
    },
  };
}

function buildTractorBeamRuntimeCallbacks() {
  return {
    getEntitySurfaceDistance,
    persistDynamicEntity,
  };
}

function buildSalvagerRuntimeCallbacks(scene = null) {
  return {
    isEntityLockedTarget,
    getEntitySurfaceDistance(sourceEntity, targetEntity) {
      return scene && typeof scene.getCommandTimeEntitySurfaceDistance === "function"
        ? scene.getCommandTimeEntitySurfaceDistance(sourceEntity, targetEntity)
        : getEntitySurfaceDistance(sourceEntity, targetEntity);
    },
    resolveCharacterID(entity) {
      return getShipEntityInventoryCharacterID(entity, 0);
    },
    getEntityRuntimeShipItem,
    getEntityRuntimeFittedItems,
    getEntityRuntimeSkillMap,
    syncInventoryChangesToSession,
    random() {
      return scene && typeof scene.__salvageRandom === "function"
        ? scene.__salvageRandom()
        : Math.random();
    },
    onWreckSalvaged(event = {}) {
      const session = event && event.sourceEntity && event.sourceEntity.session
        ? event.sourceEntity.session
        : null;
      if (session) {
        syncLedger.recordSyncLedgerEvent(session, "space.wreck.salvaged", {
          targetID: toInt(event.targetID, 0),
          moduleTypeID: toInt(event.moduleTypeID, 0),
          rewardTypeIDs: Array.isArray(event.rewards)
            ? event.rewards.map((entry) => toInt(entry && entry.itemType, 0)).filter(Boolean)
            : [],
        });
      }
    },
    spawnInventoryBackedEntity(itemRecord, options = {}) {
      if (!scene || !itemRecord || !itemRecord.itemID) {
        return {
          success: false,
          errorMsg: "CONTAINER_NOT_FOUND",
        };
      }
      const entity = buildRuntimeSpaceEntityFromItem(
        itemRecord,
        scene.systemID,
        scene.getCurrentSimTimeMs(),
      );
      if (!entity) {
        return {
          success: false,
          errorMsg: "UNSUPPORTED_DYNAMIC_ITEM",
        };
      }
      return scene.spawnDynamicEntity(entity, options);
    },
  };
}

function buildSuperweaponRuntimeCallbacks(scene, fallbackCharacterID = 0) {
  return {
    resolveCharacterID(entity) {
      return getShipEntityInventoryCharacterID(entity, fallbackCharacterID);
    },
    getEntityRuntimeShipItem,
    getEntityRuntimeFittedItems,
    getEntityRuntimeModuleItem,
    getEntityRuntimeActiveModuleContexts,
    getEntityRuntimeLoadedCharge,
    getEntityCapacitorAmount,
    setEntityCapacitorRatio,
    notifyCapacitorChangeToSession,
    persistDynamicEntity,
    allocateRuntimeEntityID,
    applyWeaponDamageToTarget,
    notifyWeaponDamageMessages,
    getAppliedDamageAmount,
    noteKillmailDamage,
    recordKillmailFromDestruction,
    stopShipEntity(entity, options = {}) {
      return scene && typeof scene.stopShipEntity === "function"
        ? scene.stopShipEntity(entity, options)
        : false;
    },
    breakEntityStructureTether(runtimeScene, entity, options = {}) {
      return breakEntityStructureTether(runtimeScene || scene, entity, options);
    },
  };
}

function collectEntityActiveShipAttributeModifierEntries(entity, nowMs = Date.now()) {
  const modifierEntries = [];

  modifierEntries.push(
    ...wormholeEnvironmentRuntime.collectShipAttributeModifierEntriesForSystem(
      entity && entity.systemID,
    ),
  );

  for (const activeModuleContext of getEntityRuntimeActiveModuleContexts(entity)) {
    appendDirectModifierEntries(
      modifierEntries,
      buildEffectiveItemAttributeMap(
        activeModuleContext.moduleItem,
        activeModuleContext.chargeItem,
      ),
      [activeModuleContext.effectRecord],
      "fittedModule",
    );
  }

  const shipItem = getEntityRuntimeShipItem(entity);
  if (shipItem) {
    modifierEntries.push(
      ...commandBurstRuntime.collectModifierEntriesForItem(
        entity,
        shipItem,
        nowMs,
      ),
    );
  }

  modifierEntries.push(
    ...hostileModuleRuntime.collectModifierEntriesForTarget(entity),
  );

  return modifierEntries;
}

function collectEntityWormholeLocationModifierSources(entity) {
  return wormholeEnvironmentRuntime.getLocationModifierSourcesForSystem(
    entity && entity.systemID,
  );
}

function buildWeaponSnapshotForEntity(entity, moduleItem, chargeItem = null, options = {}) {
  const shipItem = options.shipItem || getEntityRuntimeShipItem(entity);
  if (!shipItem || !moduleItem) {
    return null;
  }
  const hostileWeaponModifiers =
    options.directModuleModifierEntries || options.directChargeModifierEntries
      ? {
        moduleEntries: Array.isArray(options.directModuleModifierEntries)
          ? options.directModuleModifierEntries
          : [],
        chargeEntries: Array.isArray(options.directChargeModifierEntries)
          ? options.directChargeModifierEntries
          : [],
      }
      : hostileModuleRuntime.collectWeaponModifierEntriesForTarget(entity);

  return buildWeaponModuleSnapshot({
    characterID: getShipEntityInventoryCharacterID(entity, 0),
    shipItem,
    moduleItem,
    chargeItem,
    fittedItems: options.fittedItems || getEntityRuntimeFittedItems(entity),
    skillMap: options.skillMap || getEntityRuntimeSkillMap(entity),
    activeModuleContexts:
      options.activeModuleContexts ||
      getEntityRuntimeActiveModuleContexts(entity, {
        excludeModuleID: toInt(moduleItem && moduleItem.itemID, 0),
      }),
    additionalLocationModifierSources:
      options.additionalLocationModifierSources ||
      collectEntityWormholeLocationModifierSources(entity),
    directModuleModifierEntries: hostileWeaponModifiers.moduleEntries,
    directChargeModifierEntries: hostileWeaponModifiers.chargeEntries,
  });
}

function isSnapshotWeaponFamily(family) {
  return isTurretWeaponFamily(family) || isMissileWeaponFamily(family);
}

function isOffensiveWeaponFamily(family) {
  return isSnapshotWeaponFamily(family);
}

// getEntitySurfaceDistance is defined at ~line 5283 (uses getEntityTargetingRadius)

function buildMissileLaunchModuleList(moduleItem, options = {}) {
  if (Array.isArray(options.launchModules) && options.launchModules.length > 0) {
    return options.launchModules
      .map((value) => toInt(value, 0))
      .filter((value) => value >= 0);
  }

  const moduleID = toInt(moduleItem && moduleItem.itemID, 0);
  return moduleID > 0 ? [moduleID] : [0];
}

function scaleDamageVector(rawDamage, multiplier = 1) {
  const resolvedDamage =
    rawDamage && typeof rawDamage === "object"
      ? rawDamage
      : {};
  const resolvedMultiplier = Math.max(0, toFiniteNumber(multiplier, 0));
  return {
    em: roundNumber(toFiniteNumber(resolvedDamage.em, 0) * resolvedMultiplier, 6),
    thermal: roundNumber(toFiniteNumber(resolvedDamage.thermal, 0) * resolvedMultiplier, 6),
    kinetic: roundNumber(toFiniteNumber(resolvedDamage.kinetic, 0) * resolvedMultiplier, 6),
    explosive: roundNumber(toFiniteNumber(resolvedDamage.explosive, 0) * resolvedMultiplier, 6),
  };
}

function resolveGroupedWeaponBankContext(
  attackerEntity,
  effectState,
  moduleItem,
  options = {},
) {
  const fallbackModuleItem = moduleItem || null;
  const fallbackChargeItem = getEntityRuntimeLoadedCharge(
    attackerEntity,
    fallbackModuleItem,
  );
  const expectedFamily =
    typeof options.family === "string" && options.family
      ? options.family
      : resolveWeaponFamily(fallbackModuleItem, fallbackChargeItem);
  const shipID = toInt(attackerEntity && attackerEntity.itemID, 0);
  const requestedModuleID = toInt(fallbackModuleItem && fallbackModuleItem.itemID, 0);
  const resolvedMasterModuleID =
    shipID > 0 && requestedModuleID > 0
      ? (
        getGroupedWeaponBankMasterID(shipID, requestedModuleID) ||
        requestedModuleID
      )
      : requestedModuleID;
  const resolvedBankModuleIDs =
    shipID > 0 && resolvedMasterModuleID > 0
      ? getGroupedWeaponBankModuleIDs(shipID, resolvedMasterModuleID)
      : [];
  const candidateModuleIDs =
    Array.isArray(resolvedBankModuleIDs) && resolvedBankModuleIDs.length > 0
      ? resolvedBankModuleIDs
      : [requestedModuleID];
  const allEntries = [];
  const fallbackTypeID = toInt(fallbackModuleItem && fallbackModuleItem.typeID, 0);

  for (const candidateModuleID of candidateModuleIDs) {
    const candidateModuleItem = getEntityRuntimeModuleItem(
      attackerEntity,
      candidateModuleID,
    );
    if (!candidateModuleItem || !isModuleOnline(candidateModuleItem)) {
      continue;
    }
    if (
      fallbackTypeID > 0 &&
      toInt(candidateModuleItem.typeID, 0) !== fallbackTypeID
    ) {
      continue;
    }
    const candidateChargeItem = getEntityRuntimeLoadedCharge(
      attackerEntity,
      candidateModuleItem,
    );
    const candidateFamily = resolveWeaponFamily(
      candidateModuleItem,
      candidateChargeItem,
    );
    if (expectedFamily && candidateFamily !== expectedFamily) {
      continue;
    }
    allEntries.push({
      moduleItem: candidateModuleItem,
      chargeItem: candidateChargeItem,
    });
  }

  const fallbackEntry = {
    moduleItem: fallbackModuleItem,
    chargeItem: fallbackChargeItem,
  };
  const normalizedAllEntries = allEntries.length > 0 ? allEntries : [fallbackEntry];
  const entriesWithCharge = normalizedAllEntries.filter(
    (entry) => entry && entry.chargeItem,
  );
  let primaryEntry =
    entriesWithCharge.find(
      (entry) =>
        toInt(entry && entry.moduleItem && entry.moduleItem.itemID, 0) ===
        resolvedMasterModuleID,
    ) ||
    entriesWithCharge[0] ||
    normalizedAllEntries.find(
      (entry) =>
        toInt(entry && entry.moduleItem && entry.moduleItem.itemID, 0) ===
        resolvedMasterModuleID,
    ) ||
    normalizedAllEntries[0] ||
    fallbackEntry;
  const primaryChargeTypeID = toInt(
    primaryEntry && primaryEntry.chargeItem && primaryEntry.chargeItem.typeID,
    0,
  );
  const contributingEntries =
    primaryChargeTypeID > 0
      ? normalizedAllEntries.filter(
        (entry) =>
          toInt(entry && entry.chargeItem && entry.chargeItem.typeID, 0) ===
          primaryChargeTypeID,
      )
      : entriesWithCharge;
  if (contributingEntries.length > 0) {
    primaryEntry =
      contributingEntries.find(
        (entry) =>
          toInt(entry && entry.moduleItem && entry.moduleItem.itemID, 0) ===
          resolvedMasterModuleID,
      ) ||
      contributingEntries[0];
  }
  const launchModuleIDs = contributingEntries
    .map((entry) => toInt(entry && entry.moduleItem && entry.moduleItem.itemID, 0))
    .filter((moduleID) => moduleID > 0);

  return {
    masterModuleID: resolvedMasterModuleID,
    allEntries: normalizedAllEntries,
    contributingEntries,
    primaryEntry,
    launchModuleIDs,
    banked: launchModuleIDs.length > 1,
  };
}

function buildBankedWeaponSnapshot(weaponSnapshot, bankContext) {
  if (!weaponSnapshot) {
    return null;
  }
  const bankModuleIDs =
    bankContext && Array.isArray(bankContext.launchModuleIDs)
      ? bankContext.launchModuleIDs
      : [];
  const bankSize = Math.max(bankModuleIDs.length, 1);
  if (bankSize <= 1) {
    return {
      ...weaponSnapshot,
      isBanked: false,
      bankSize: 1,
      bankModuleIDs: bankModuleIDs.length > 0
        ? bankModuleIDs.map((moduleID) => toInt(moduleID, 0))
        : [toInt(weaponSnapshot.moduleID, 0)].filter((moduleID) => moduleID > 0),
    };
  }

  return {
    ...weaponSnapshot,
    damageMultiplier: roundNumber(
      toFiniteNumber(weaponSnapshot.damageMultiplier, 0) * bankSize,
      6,
    ),
    rawShotDamage: scaleDamageVector(weaponSnapshot.rawShotDamage, bankSize),
    isBanked: true,
    bankSize,
    bankModuleIDs: bankModuleIDs.map((moduleID) => toInt(moduleID, 0)),
  };
}

function queueGroupedMissileReloadStates(
  scene,
  attackerEntity,
  effectState,
  moduleEntries,
  startedAtMs,
) {
  const ownerSession = getOwningSessionForEntity(scene, attackerEntity);
  const reloadStates = [];
  const seenModuleIDs = new Set();
  for (const entry of Array.isArray(moduleEntries) ? moduleEntries : []) {
    const candidateModuleItem = entry && entry.moduleItem ? entry.moduleItem : null;
    const candidateModuleID = toInt(
      candidateModuleItem && candidateModuleItem.itemID,
      0,
    );
    if (candidateModuleID <= 0 || seenModuleIDs.has(candidateModuleID)) {
      continue;
    }
    seenModuleIDs.add(candidateModuleID);
    const chargeTypeID = toInt(
      entry && entry.chargeItem && entry.chargeItem.typeID,
      toInt(effectState && effectState.chargeTypeID, 0),
    );
    if (chargeTypeID <= 0) {
      continue;
    }
    const reloadResult = queueAutomaticMissileReload({
      session: ownerSession,
      entity: attackerEntity,
      moduleItem: candidateModuleItem,
      chargeTypeID,
      reloadTimeMs: Math.max(
        0,
        Math.round(Number(getTypeAttributeValue(candidateModuleItem.typeID, "reloadTime")) || 0),
      ),
      startedAtMs,
      shipID: toInt(attackerEntity && attackerEntity.itemID, 0),
    });
    if (
      reloadResult.success &&
      reloadResult.data &&
      reloadResult.data.reloadState
    ) {
      reloadStates.push(reloadResult.data.reloadState);
    }
  }
  return reloadStates;
}

function resolvePendingGroupedMissileReloads(
  entity,
  effectState,
  options = {},
) {
  const reloadStates = Array.isArray(effectState && effectState.pendingMissileBankReloads)
    ? effectState.pendingMissileBankReloads.filter(Boolean)
    : [];
  if (reloadStates.length <= 0) {
    return {
      success: true,
      waiting: false,
      data: {
        completed: false,
      },
    };
  }

  const nowMs = Math.max(0, Number(options.nowMs) || 0);
  for (const reloadState of reloadStates) {
    const completeAtMs = Math.max(0, Number(reloadState && reloadState.completeAtMs) || 0);
    if (completeAtMs > nowMs) {
      return {
        success: true,
        waiting: true,
        data: {
          reloadStates,
        },
      };
    }
  }

  for (const reloadState of reloadStates) {
    const moduleItem = getEntityRuntimeModuleItem(
      entity,
      toInt(reloadState && reloadState.moduleID, 0),
      toInt(reloadState && reloadState.moduleFlagID, 0),
    );
    if (!moduleItem) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }
    const individualEffectState = {
      pendingMissileReload: reloadState,
      chargeTypeID: toInt(effectState && effectState.chargeTypeID, 0),
    };
    const reloadResult = resolvePendingMissileReload(
      entity,
      individualEffectState,
      moduleItem,
      {
        nowMs,
      },
    );
    if (!reloadResult.success) {
      return reloadResult;
    }
  }

  effectState.pendingMissileBankReloads = null;
  effectState.chargeTypeID = toInt(
    reloadStates[0] && reloadStates[0].chargeTypeID,
    toInt(effectState && effectState.chargeTypeID, 0),
  );
  return {
    success: true,
    waiting: false,
    data: {
      completed: true,
      reloadStates,
    },
  };
}

function resolveMissileLauncherPresentationLayout(entity, moduleItem = null) {
  const normalizedModuleID = toInt(moduleItem && moduleItem.itemID, 0);
  const normalizedFlagID = toInt(moduleItem && moduleItem.flagID, 0);
  const orderedLaunchers = getEntityRuntimeFittedItems(entity)
    .filter((candidate) => (
      resolveWeaponFamily(
        candidate,
        getEntityRuntimeLoadedCharge(entity, candidate),
      ) === "missileLauncher"
    ))
    .sort((left, right) => (
      toInt(left && left.flagID, 0) - toInt(right && right.flagID, 0) ||
      toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0)
    ));

  let launcherIndex = orderedLaunchers.findIndex((candidate) => (
    toInt(candidate && candidate.itemID, 0) === normalizedModuleID
  ));
  if (launcherIndex < 0 && normalizedFlagID > 0) {
    launcherIndex = orderedLaunchers.findIndex((candidate) => (
      toInt(candidate && candidate.flagID, 0) === normalizedFlagID
    ));
  }
  if (launcherIndex < 0) {
    launcherIndex = Math.max(0, normalizedFlagID > 0 ? normalizedFlagID - 27 : 0);
  }

  return {
    index: launcherIndex,
    count: Math.max(orderedLaunchers.length, launcherIndex + 1, 1),
  };
}

function resolveMissileLaunchPosition(
  attackerEntity,
  targetEntity,
  moduleItem = null,
) {
  const shipPosition = cloneVector(attackerEntity && attackerEntity.position);
  if (!attackerEntity) {
    return shipPosition;
  }

  const targetDirection = normalizeVector(
    subtractVectors(targetEntity && targetEntity.position, shipPosition),
    DEFAULT_RIGHT,
  );
  // Keep the synthetic muzzle offset aligned to the actual firing solution.
  // Using the hull's travel heading here leaks sideways ship motion into the
  // live missile ball and produces the lateral launch wobble the client does
  // not show.
  const shipForward = normalizeVector(
    targetDirection,
    targetDirection,
  );
  const shipRight = buildPerpendicular(shipForward);
  const shipUp = normalizeVector(
    crossProduct(shipRight, shipForward),
    DEFAULT_UP,
  );
  const radius = Math.max(1, toFiniteNumber(attackerEntity && attackerEntity.radius, 0));
  const { index, count } = resolveMissileLauncherPresentationLayout(
    attackerEntity,
    moduleItem,
  );
  const centeredIndex = index - ((count - 1) / 2);
  const forwardOffsetMeters = clamp(radius * 0.45, 12, 90);
  const lateralStepMeters = clamp(radius * 0.28, 10, 55);
  const verticalStepMeters = clamp(radius * 0.08, 0, 16);
  const rowIndex = Math.floor(index / 2);
  const verticalOffsetMeters =
    rowIndex <= 0
      ? 0
      : ((rowIndex % 2 === 0 ? 1 : -1) * verticalStepMeters * rowIndex);

  return addVectors(
    shipPosition,
    addVectors(
      scaleVector(shipForward, forwardOffsetMeters),
      addVectors(
        scaleVector(shipRight, centeredIndex * lateralStepMeters),
        scaleVector(shipUp, verticalOffsetMeters),
      ),
    ),
  );
}

function resolveMissileBallRadius(chargeTypeID, chargeItem = null) {
  const chargeType =
    chargeTypeID > 0
      ? resolveItemByTypeID(chargeTypeID)
      : null;
  const authoredRadius = Math.max(
    0,
    toFiniteNumber(
      chargeItem && chargeItem.radius,
      toFiniteNumber(chargeType && chargeType.radius, 0),
    ),
  );
  return authoredRadius > 0 ? authoredRadius : 1;
}

function resolveMissileFlightDynamics(chargeTypeID, chargeItem = null) {
  const chargeType =
    chargeTypeID > 0
      ? resolveItemByTypeID(chargeTypeID)
      : null;
  const authoredMass = Math.max(
    0,
    toFiniteNumber(
      chargeItem && chargeItem.mass,
      toFiniteNumber(chargeType && chargeType.mass, 0),
    ),
  );
  const missileInertia = Math.max(
    0,
    toFiniteNumber(
      getTypeAttributeValue(chargeTypeID, "agility"),
      0,
    ),
  );
  const resolvedMass = authoredMass > 0 ? authoredMass : 1;
  const resolvedInertia = missileInertia > 0 ? missileInertia : 0.1;
  const officialTauSeconds = deriveOfficialTauSeconds(
    resolvedMass,
    resolvedInertia,
  );
  return {
    mass: resolvedMass,
    inertia: resolvedInertia,
    agilitySeconds:
      officialTauSeconds > 0
        ? officialTauSeconds
        : deriveAgilitySeconds(0, 0, resolvedMass, resolvedInertia),
  };
}

function buildMissileDynamicEntity(
  attackerEntity,
  targetEntity,
  weaponSnapshot,
  launchTimeMs,
  options = {},
) {
  if (!attackerEntity || !targetEntity || !weaponSnapshot) {
    return null;
  }

  const launchPosition = resolveMissileLaunchPosition(
    attackerEntity,
    targetEntity,
    options.moduleItem,
  );
  const direction = normalizeVector(
    subtractVectors(targetEntity.position, launchPosition),
    attackerEntity.direction,
  );
  const maxVelocity = Math.max(
    0,
    toFiniteNumber(weaponSnapshot.maxVelocity, 0),
  );
  const chargeTypeID = toInt(weaponSnapshot.chargeTypeID, 0);
  const missileRadius = resolveMissileBallRadius(
    chargeTypeID,
    options.chargeItem,
  );
  const launchAtMs = Math.max(0, toFiniteNumber(launchTimeMs, 0));
  // CCP's `spaceObject.Missile._GetTimeToTarget` uses the live surface ETA to
  // decide whether the missile visually spreads (`doSpread`) and a separate
  // averaged surface/center time for the Trinity missile model.
  const visualProfile = resolveMissileClientVisualProfile(
    launchPosition,
    targetEntity.position,
    Math.max(0, toFiniteNumber(targetEntity.radius, 0)),
    maxVelocity,
  );
  const missileDynamics = resolveMissileFlightDynamics(
    chargeTypeID,
    options.chargeItem,
  );
  const initialSpeedFraction = visualProfile.doSpread ? 0 : (maxVelocity > 0 ? 1 : 0);
  const initialVelocity =
    visualProfile.doSpread
      ? { x: 0, y: 0, z: 0 }
      : scaleVector(direction, maxVelocity);

  const missileEntity = {
    debugLaunchTraceID: nextMissileLaunchTraceID++,
    itemID: allocateRuntimeEntityID(),
    kind: "missile",
    systemID: toInt(attackerEntity.systemID, 0),
    ownerID: toInt(attackerEntity.ownerID, 0),
    corporationID: toInt(attackerEntity.corporationID, 0),
    allianceID: toInt(attackerEntity.allianceID, 0),
    warFactionID: toInt(attackerEntity.warFactionID, 0),
    typeID: chargeTypeID,
    groupID: toInt(options.chargeItem && options.chargeItem.groupID, 0),
    categoryID: toInt(options.chargeItem && options.chargeItem.categoryID, 8),
    itemName: String(
      options.chargeItem && options.chargeItem.itemName ||
      "Missile",
    ),
    radius: missileRadius,
    position: launchPosition,
    velocity: initialVelocity,
    direction,
    targetPoint: cloneVector(targetEntity.position),
    mode: "FOLLOW",
    targetEntityID: toInt(targetEntity.itemID, 0),
    followRange: 0,
    maxVelocity,
    // Parity: long-range doSpread missiles must not bootstrap as an already-
    // active FOLLOW ball. Their authored missile agility is tiny, so leaving
    // speedFraction at 1 lets the client re-accelerate almost instantly even
    // when launch velocity is zero, which still shortens Prepare()'s
    // time-to-target and makes the Trinity warhead fizzle early.
    speedFraction: initialSpeedFraction,
    mass: missileDynamics.mass,
    inertia: missileDynamics.inertia,
    agilitySeconds: missileDynamics.agilitySeconds,
    launchedAtMs: launchAtMs,
    impactAtMs: launchAtMs + visualProfile.visualImpactMs,
    surfaceImpactAtMs: launchAtMs + visualProfile.surfaceImpactMs,
    expiresAtMs: Math.max(0, launchAtMs + estimateMissileFlightBudgetMs(
      weaponSnapshot,
      toFiniteNumber(attackerEntity.radius, 0),
    )),
    clientDoSpread: visualProfile.doSpread,
    sourceShipID: toInt(attackerEntity.itemID, 0),
    launchModules: buildMissileLaunchModuleList(
      options.moduleItem,
      options,
    ),
    missileSnapshot: weaponSnapshot,
    sourceModuleTypeID: toInt(options.moduleItem && options.moduleItem.typeID, 0),
    sourceModuleID: toInt(options.moduleItem && options.moduleItem.itemID, 0),
    clientVisualReleaseAtMs: 0,
  };
  missileEntity.launchPresentationSnapshot =
    buildMissileLaunchPresentationSnapshot(missileEntity);
  return missileEntity;
}

function getShipEntityVisibleCharacterID(entity, fallback = 0) {
  return toInt(entity && entity.characterID, fallback);
}

function getShipEntityDebugCharacterID(entity, fallback = 0) {
  const inventoryCharacterID = getShipEntityInventoryCharacterID(entity, 0);
  if (inventoryCharacterID > 0) {
    return inventoryCharacterID;
  }
  return getShipEntityVisibleCharacterID(entity, fallback);
}

function isOwnerLaunchedMissileVisibleToSession(session, entity) {
  if (!session || !session._space || !entity || entity.kind !== "missile") {
    return false;
  }
  return toInt(entity.sourceShipID, 0) === toInt(session._space.shipID, 0);
}

function hasOwnerLaunchedMissileVisibleToSession(session, entities) {
  if (!Array.isArray(entities) || entities.length === 0) {
    return false;
  }
  return entities.some((entity) =>
    isOwnerLaunchedMissileVisibleToSession(session, entity)
  );
}

function buildMichelleSafeDestinySendOptions(baseOptions = {}) {
  // Use MICHELLE_HELD_FUTURE_DESTINY_LEAD (2) as the default lead, not
  // MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD (3). The client holds entries where
  // (stamp - currentTime < 3), so delta 1-2 are safely held and process
  // without jolting. Delta 3 triggers SynchroniseToSimulationTime which jumps
  // currentTime forward, causing visible jolts. Lead 2 keeps stamps within
  // the hold window so they process smoothly when currentTime naturally
  // advances.
  const minimumHistoryLeadFloor = Math.max(
    0,
    toInt(
      baseOptions.minimumHistoryLeadFloor,
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    ),
  );
  const minimumLeadFromCurrentHistory = Math.max(
    toInt(baseOptions.minimumLeadFromCurrentHistory, 0),
    minimumHistoryLeadFloor,
  );
  const maximumLeadFromCurrentHistory = Math.max(
    toInt(
      baseOptions.maximumLeadFromCurrentHistory,
      minimumLeadFromCurrentHistory,
    ),
    minimumLeadFromCurrentHistory,
  );
  const historyLeadUsesImmediateSessionStamp =
    baseOptions.historyLeadUsesImmediateSessionStamp === true;
  const historyLeadUsesPresentedSessionStamp =
    baseOptions.historyLeadUsesPresentedSessionStamp === true;
  // Default anchor to the visible session stamp, NOT the current session
  // stamp.  currentSessionStamp is ~1 tick ahead of the client's
  // _current_time (which aligns with the visible stamp).  With the default
  // lead of MICHELLE_HELD_FUTURE_DESTINY_LEAD (2), using currentSession
  // as anchor gave delivery at visible+3 = delta 3 from client, which is
  // the exact threshold where Michelle fires SynchroniseToSimulationTime,
  // causing visible jolts on every non-owner entity broadcast (NPC missile
  // AddBalls2, observer movement, etc.).  Anchoring to the visible stamp
  // gives visible+2 = delta 2, safely inside the held-future window.
  // Callers that truly need the session anchor can explicitly pass
  // historyLeadUsesCurrentSessionStamp: true.
  const historyLeadUsesCurrentSessionStamp =
    !historyLeadUsesImmediateSessionStamp &&
    !historyLeadUsesPresentedSessionStamp &&
    baseOptions.historyLeadUsesCurrentSessionStamp === true;
  return {
    ...baseOptions,
    avoidCurrentHistoryInsertion: true,
    minimumLeadFromCurrentHistory,
    maximumLeadFromCurrentHistory,
    maximumHistorySafeLeadOverride: Math.max(
      toInt(baseOptions.maximumHistorySafeLeadOverride, 0),
      maximumLeadFromCurrentHistory,
    ),
    historyLeadUsesCurrentSessionStamp:
      historyLeadUsesCurrentSessionStamp || undefined,
    historyLeadUsesImmediateSessionStamp:
      historyLeadUsesImmediateSessionStamp || undefined,
    historyLeadUsesPresentedSessionStamp:
      historyLeadUsesPresentedSessionStamp || undefined,
  };
}

function buildPresentedSessionAlignedDestinySendOptions(baseOptions = {}) {
  // Reuse the owner's currently presented Michelle lane instead of forcing an
  // extra +1/+2 history lead. Critical for self ship-prime / FX bursts that
  // would otherwise arrive behind already-held owner history.
  const minimumLeadFromCurrentHistory = Math.max(
    0,
    toInt(baseOptions.minimumLeadFromCurrentHistory, 0),
  );
  const maximumLeadFromCurrentHistory = Math.max(
    toInt(
      baseOptions.maximumLeadFromCurrentHistory,
      minimumLeadFromCurrentHistory,
    ),
    minimumLeadFromCurrentHistory,
  );
  return {
    ...baseOptions,
    avoidCurrentHistoryInsertion: false,
    minimumLeadFromCurrentHistory,
    maximumLeadFromCurrentHistory,
    historyLeadUsesCurrentSessionStamp: false,
    historyLeadUsesImmediateSessionStamp: false,
    historyLeadUsesPresentedSessionStamp: true,
  };
}

function buildOwnerMissileLifecycleSendOptions(baseOptions = {}) {
  return buildMichelleSafeDestinySendOptions({
    ...baseOptions,
    destinyAuthorityContract: DESTINY_CONTRACTS.OWNER_MISSILE_LIFECYCLE,
    minimumHistoryLeadFloor: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    minimumLeadFromCurrentHistory: Math.max(
      toInt(baseOptions.minimumLeadFromCurrentHistory, 0),
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    ),
    maximumLeadFromCurrentHistory: Math.max(
      toInt(baseOptions.maximumLeadFromCurrentHistory, 0),
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    ),
    maximumHistorySafeLeadOverride: Math.max(
      toInt(baseOptions.maximumHistorySafeLeadOverride, 0),
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    ),
    historyLeadUsesCurrentSessionStamp: false,
    historyLeadUsesImmediateSessionStamp: true,
  });
}

function buildOwnerShipPrimeSendOptions(broadcastOptions = {}) {
  const baseOptions = {
    translateStamps:
      broadcastOptions &&
      Object.prototype.hasOwnProperty.call(broadcastOptions, "translateStamps")
        ? broadcastOptions.translateStamps
        : undefined,
    minimumLeadFromCurrentHistory:
      broadcastOptions && broadcastOptions.minimumLeadFromCurrentHistory,
    maximumLeadFromCurrentHistory:
      broadcastOptions && broadcastOptions.maximumLeadFromCurrentHistory,
    destinyAuthorityContract: DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
  };
  if (
    broadcastOptions &&
    broadcastOptions.historyLeadUsesPresentedSessionStamp === true
  ) {
    return buildPresentedSessionAlignedDestinySendOptions(baseOptions);
  }
  return buildMichelleSafeDestinySendOptions({
    ...baseOptions,
    minimumHistoryLeadFloor:
      broadcastOptions && broadcastOptions.minimumHistoryLeadFloor,
    maximumHistorySafeLeadOverride:
      broadcastOptions && broadcastOptions.maximumHistorySafeLeadOverride,
    historyLeadUsesCurrentSessionStamp:
      broadcastOptions && broadcastOptions.historyLeadUsesCurrentSessionStamp,
    historyLeadUsesImmediateSessionStamp:
      broadcastOptions && broadcastOptions.historyLeadUsesImmediateSessionStamp,
  });
}

function buildOwnerMissileFreshAcquireSendOptions(baseOptions = {}) {
  return buildMichelleSafeDestinySendOptions({
    ...baseOptions,
    destinyAuthorityContract: DESTINY_CONTRACTS.OWNER_MISSILE_LIFECYCLE,
    // preservePayloadStateStamp MUST be false (or omitted) for missiles.
    // When true, the AddBalls2 binary keeps its authored stamp (launch time)
    // which is 1-2 ticks behind the delivery stamp. The client's ballpark
    // reads the embedded stamp from the binary header and sets _current_time
    // to it, causing a BACKWARD time jump. This re-extrapolates every ball
    // from the wrong time = visible jolt on every missile volley.
    //
    // `client/here22.txt`: the immediate-session anchor still leaves owner
    // missile fresh-acquire AddBalls one tick behind whenever same-window
    // owner-critical history has already advanced Michelle's presented lane.
    // Reuse the trusted presented lane, capped to one future tick, then clear
    // exactly one tick past it so the fresh acquire stays inside delta 2 while
    // never replaying underneath already-consumed owner history.
    preservePayloadStateStamp: false,
    skipOwnerMonotonicRestampWhenPreviousNotOwnerCritical: true,
    minimumHistoryLeadFloor: MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    minimumLeadFromCurrentHistory: Math.max(
      toInt(baseOptions.minimumLeadFromCurrentHistory, 0),
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    ),
    maximumLeadFromCurrentHistory: Math.max(
      toInt(baseOptions.maximumLeadFromCurrentHistory, 0),
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    ),
    maximumHistorySafeLeadOverride: Math.max(
      toInt(baseOptions.maximumHistorySafeLeadOverride, 0),
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    ),
    historyLeadUsesCurrentSessionStamp: false,
    historyLeadUsesImmediateSessionStamp: false,
    historyLeadUsesPresentedSessionStamp: true,
    historyLeadPresentedMaximumFutureLead:
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
  });
}

function buildOwnerDamageStateSendOptions(baseOptions = {}) {
  return buildObserverCombatPresentedSendOptions({
    ...baseOptions,
  });
}

function buildObserverPropulsionShipPrimeBroadcastOptions(baseOptions = {}) {
  return {
    ...baseOptions,
    minimumHistoryLeadFloor: Math.max(
      toInt(baseOptions.minimumHistoryLeadFloor, 0),
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    ),
    minimumLeadFromCurrentHistory: Math.max(
      toInt(baseOptions.minimumLeadFromCurrentHistory, 0),
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    ),
    maximumLeadFromCurrentHistory: Math.max(
      toInt(baseOptions.maximumLeadFromCurrentHistory, 0),
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    ),
    maximumHistorySafeLeadOverride: Math.max(
      toInt(baseOptions.maximumHistorySafeLeadOverride, 0),
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    ),
    historyLeadUsesPresentedSessionStamp: true,
    historyLeadPresentedMaximumFutureLead:
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    avoidCurrentHistoryInsertion: true,
  };
}

function buildObserverPropulsionSpecialFxOptions(baseOptions = {}) {
  return buildMichelleSafeDestinySendOptions({
    ...baseOptions,
    destinyAuthorityContract: DESTINY_CONTRACTS.COMBAT_NONCRITICAL,
    useCurrentStamp: true,
    minimumHistoryLeadFloor: Math.max(
      toInt(baseOptions.minimumHistoryLeadFloor, 0),
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    ),
    minimumLeadFromCurrentHistory: Math.max(
      toInt(baseOptions.minimumLeadFromCurrentHistory, 0),
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    ),
    maximumLeadFromCurrentHistory: Math.max(
      toInt(baseOptions.maximumLeadFromCurrentHistory, 0),
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    ),
    maximumHistorySafeLeadOverride: Math.max(
      toInt(baseOptions.maximumHistorySafeLeadOverride, 0),
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    ),
    historyLeadUsesCurrentSessionStamp: false,
    historyLeadUsesImmediateSessionStamp: false,
    historyLeadUsesPresentedSessionStamp: true,
    historyLeadPresentedMaximumFutureLead:
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
  });
}

function buildMissileDeploymentSpecialFxOptions(baseOptions = {}) {
  // `client/here.txt`: observer missile deployment FX can still land behind the
  // client's already-presented Michelle lane if we anchor them to raw/visible
  // history. Anchor to the session's trusted presented lane instead, but cap
  // that trust to one future tick so delivery stays inside the held-future
  // window instead of drifting into delta-3 jolts.
  return buildMichelleSafeDestinySendOptions({
    ...baseOptions,
    destinyAuthorityContract: DESTINY_CONTRACTS.COMBAT_NONCRITICAL,
    useCurrentStamp: true,
    minimumHistoryLeadFloor: MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    minimumLeadFromCurrentHistory: Math.max(
      toInt(baseOptions.minimumLeadFromCurrentHistory, 0),
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    ),
    maximumLeadFromCurrentHistory: Math.max(
      toInt(baseOptions.maximumLeadFromCurrentHistory, 0),
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    ),
    maximumHistorySafeLeadOverride: Math.max(
      toInt(baseOptions.maximumHistorySafeLeadOverride, 0),
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    ),
    historyLeadUsesCurrentSessionStamp: false,
    historyLeadUsesImmediateSessionStamp: false,
    historyLeadUsesPresentedSessionStamp: true,
    historyLeadPresentedMaximumFutureLead:
      MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
  });
}

function buildObserverCombatPresentedSendOptions(baseOptions = {}) {
  return buildMichelleSafeDestinySendOptions({
    ...baseOptions,
    destinyAuthorityContract: DESTINY_CONTRACTS.COMBAT_NONCRITICAL,
    minimumHistoryLeadFloor: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    minimumLeadFromCurrentHistory: Math.max(
      toInt(baseOptions.minimumLeadFromCurrentHistory, 0),
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    ),
    maximumLeadFromCurrentHistory: Math.max(
      toInt(
        baseOptions.maximumLeadFromCurrentHistory,
        MICHELLE_HELD_FUTURE_DESTINY_LEAD,
      ),
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    ),
    maximumHistorySafeLeadOverride: Math.max(
      toInt(baseOptions.maximumHistorySafeLeadOverride, 0),
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    ),
    historyLeadUsesCurrentSessionStamp: false,
    historyLeadUsesImmediateSessionStamp: false,
    historyLeadUsesPresentedSessionStamp: true,
    historyLeadPresentedMaximumFutureLead: 0,
  });
}

function buildNpcOffensiveSpecialFxOptions(baseOptions = {}) {
  // `client/jolt00.txt`: observer projectile FX can still arrive a tick behind
  // Michelle when visible history has already been consumed by same-window
  // combat churn. Reuse the trusted presented observer lane contract.
  return buildObserverCombatPresentedSendOptions({
    ...baseOptions,
    useCurrentStamp: true,
  });
}

function splitSpecialFxGuids(guid) {
  const normalizedGuid = String(guid || "").trim();
  if (!normalizedGuid) {
    return [];
  }
  const entries = normalizedGuid
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (entries.length > 1) {
    const attackModeIndex = entries.indexOf("effects.AttackMode");
    const trigIndex = entries.indexOf("effects.TriglavianBeam");
    if (attackModeIndex >= 0 && trigIndex >= 0 && attackModeIndex > trigIndex) {
      const reordered = [...entries];
      reordered.splice(attackModeIndex, 1);
      reordered.splice(trigIndex, 0, "effects.AttackMode");
      return reordered;
    }
  }
  return entries;
}

function buildObserverDamageStateSendOptions(baseOptions = {}) {
  return buildObserverCombatPresentedSendOptions(baseOptions);
}

function buildBootstrapAcquireSendOptions(baseOptions = {}) {
  return {
    ...baseOptions,
    destinyAuthorityContract: DESTINY_CONTRACTS.BOOTSTRAP_ACQUIRE,
  };
}

function buildStateResetSendOptions(baseOptions = {}) {
  return {
    ...baseOptions,
    destinyAuthorityContract: DESTINY_CONTRACTS.STATE_RESET,
  };
}

function buildDestructionTeardownSendOptions(baseOptions = {}) {
  return {
    ...baseOptions,
    destinyAuthorityContract: DESTINY_CONTRACTS.DESTRUCTION_TEARDOWN,
  };
}

function resolveExplodingNonMissileDestructionSessionStamp(
  scene,
  session,
  nowMs,
  baseStamp = null,
) {
  if (!scene || !session || !isReadyForDestiny(session)) {
    return 0;
  }
  const resolvedNowMs = toFiniteNumber(
    nowMs,
    typeof scene.getCurrentSimTimeMs === "function"
      ? scene.getCurrentSimTimeMs()
      : 0,
  );
  const resolvedBaseStamp =
    baseStamp === null || baseStamp === undefined
      ? (
          typeof scene.getCurrentDestinyStamp === "function"
            ? scene.getCurrentDestinyStamp(resolvedNowMs)
            : 0
        )
      : (toInt(baseStamp, 0) >>> 0);
  return Math.max(
    resolvedBaseStamp,
    scene.getHistorySafeSessionDestinyStamp(
      session,
      resolvedNowMs,
      MICHELLE_HELD_FUTURE_DESTINY_LEAD -
        MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
      MICHELLE_HELD_FUTURE_DESTINY_LEAD -
        MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    ),
    scene.getCurrentPresentedSessionDestinyStamp(
      session,
      resolvedNowMs,
      MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
    ),
  ) >>> 0;
}

function getFreshVisibilityProtectionReleaseStamp(deliveryStamp) {
  return toInt(deliveryStamp, 0) >>> 0;
}

function getCharacterBackedShipPresentation(entity) {
  const characterID = getShipEntityInventoryCharacterID(entity, 0);
  if (characterID <= 0) {
    return null;
  }

  return resolveCharacterRecord(characterID) || null;
}

function resolveShipSlimModules(entity) {
  if (!entity || entity.kind !== "ship") {
    return [];
  }

  const characterID = getShipEntityInventoryCharacterID(entity, 0);
  if (characterID > 0) {
    return normalizeSlimShipModules(
      buildSlimModuleTuples(characterID, entity.itemID),
    );
  }

  return normalizeSlimShipModules(entity.modules);
}

function refreshShipConditionFields(entity) {
  if (!entity || entity.kind !== "ship") {
    return entity;
  }

  const shipItem = findShipItemById(entity.itemID) || null;
  const conditionState = shipItem
    ? getShipConditionState(shipItem)
    : normalizeShipConditionState(entity.conditionState);
  entity.conditionState = conditionState;
  entity.capacitorChargeRatio = clamp(
    toFiniteNumber(
      conditionState && conditionState.charge,
      toFiniteNumber(entity.capacitorChargeRatio, 1),
    ),
    0,
    1,
  );
  return entity;
}

function refreshShipPresentationFields(entity) {
  if (!entity || entity.kind !== "ship") {
    return entity;
  }

  const characterData = getCharacterBackedShipPresentation(entity);
  const resolvedSkinMaterialSetID = getAppliedSkinMaterialSetID(entity.itemID);
  refreshShipConditionFields(entity);
  entity.skinMaterialSetID =
    resolvedSkinMaterialSetID !== null &&
    resolvedSkinMaterialSetID !== undefined
      ? resolvedSkinMaterialSetID
      : entity.skinMaterialSetID ?? null;
  entity.modules = resolveShipSlimModules(entity);
  entity.securityStatus = toFiniteNumber(
    characterData && (characterData.securityStatus ?? characterData.securityRating),
    toFiniteNumber(entity.securityStatus, 0),
  );
  entity.bounty = toFiniteNumber(
    characterData && characterData.bounty,
    toFiniteNumber(entity.bounty, 0),
  );
  entity.cosmeticsItems = getEnabledCosmeticsEntries(entity.itemID)
    .map((entry) => Number(entry.cosmeticType || 0))
    .filter((entry) => entry > 0)
    .sort((left, right) => left - right);
  refreshShipCompressionFacilityState(entity);
  return entity;
}

function normalizeModuleEffectName(effectName) {
  return String(effectName || "").trim().toLowerCase();
}

function isIndustrialCoreEffectName(effectName) {
  const normalizedEffectName = normalizeModuleEffectName(effectName);
  return normalizedEffectName.includes("industrial") &&
    normalizedEffectName.includes("core");
}

function isIndustrialCompressionEffectName(effectName) {
  return normalizeModuleEffectName(effectName) === "industrialitemcompression";
}

function resolveCompressionFacilityTypeListID(moduleTypeID) {
  return toInt(
    getTypeAttributeValue(moduleTypeID, "compressibleItemsTypeList") ??
      getTypeDogmaAttributeValueByID(
        moduleTypeID,
        MODULE_ATTRIBUTE_COMPRESSIBLE_ITEMS_TYPELIST,
        0,
      ),
    0,
  );
}

function moduleActivationRequiresActiveIndustrialCore(moduleTypeID) {
  return toInt(
    getTypeAttributeValue(moduleTypeID, "activationRequiresActiveIndustrialCore") ??
      getTypeDogmaAttributeValueByID(
        moduleTypeID,
        MODULE_ATTRIBUTE_ACTIVATION_REQUIRES_ACTIVE_INDUSTRIAL_CORE,
        0,
      ),
    0,
  ) > 0;
}

function hasActiveIndustrialCoreEffect(entity) {
  if (!entity || !(entity.activeModuleEffects instanceof Map)) {
    return false;
  }

  for (const effectState of entity.activeModuleEffects.values()) {
    if (
      effectState &&
      toFiniteNumber(effectState.deactivatedAtMs, 0) <= 0 &&
      isIndustrialCoreEffectName(effectState.effectName)
    ) {
      return true;
    }
  }

  return false;
}

function resolveCompressionFacilityRangeMeters(entity) {
  const baseRangeMeters = Math.max(
    1,
    toFiniteNumber(
      config.miningInSpaceCompressionRangeMeters,
      DEFAULT_IN_SPACE_COMPRESSION_RANGE_METERS,
    ),
  );
  if (!entity || entity.kind !== "ship") {
    return Math.round(baseRangeMeters);
  }

  const rangeBonusPerLevel = Math.max(
    0,
    toFiniteNumber(
      getTypeAttributeValue(
        SKILL_TYPE_FLEET_COMPRESSION_LOGISTICS,
        "fleetCompressionLogisticsRangeBonus",
      ) ??
        getTypeDogmaAttributeValueByID(
          SKILL_TYPE_FLEET_COMPRESSION_LOGISTICS,
          MODULE_ATTRIBUTE_FLEET_COMPRESSION_LOGISTICS_RANGE_BONUS,
          0,
        ),
      0,
    ),
  );
  const skillLevel = getSkillLevel(
    getEntityRuntimeSkillMap(entity),
    SKILL_TYPE_FLEET_COMPRESSION_LOGISTICS,
  );
  return Math.max(
    1,
    Math.round(
      baseRangeMeters * (1 + ((rangeBonusPerLevel * skillLevel) / 100)),
    ),
  );
}

function resolveCompressionFacilityTypelistsForEntity(entity) {
  if (
    !entity ||
    entity.kind !== "ship" ||
    !(entity.activeModuleEffects instanceof Map) ||
    !hasActiveIndustrialCoreEffect(entity)
  ) {
    return null;
  }

  const activationRangeMeters = resolveCompressionFacilityRangeMeters(entity);
  const typelistEntries = new Map();
  for (const effectState of entity.activeModuleEffects.values()) {
    if (
      !effectState ||
      toFiniteNumber(effectState.deactivatedAtMs, 0) > 0 ||
      !isIndustrialCompressionEffectName(effectState.effectName)
    ) {
      continue;
    }

    const typeListID = resolveCompressionFacilityTypeListID(effectState.typeID);
    if (typeListID <= 0) {
      continue;
    }

    const previousRangeMeters = Math.max(
      0,
      toFiniteNumber(typelistEntries.get(typeListID), 0),
    );
    typelistEntries.set(
      typeListID,
      Math.max(previousRangeMeters, activationRangeMeters),
    );
  }

  return typelistEntries.size > 0
    ? [...typelistEntries.entries()].sort((left, right) => left[0] - right[0])
    : null;
}

function areCompressionFacilityTypelistsEqual(left, right) {
  const normalizedLeft = Array.isArray(left) ? left : [];
  const normalizedRight = Array.isArray(right) ? right : [];
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  for (let index = 0; index < normalizedLeft.length; index += 1) {
    const leftEntry = Array.isArray(normalizedLeft[index]) ? normalizedLeft[index] : [];
    const rightEntry = Array.isArray(normalizedRight[index]) ? normalizedRight[index] : [];
    if (
      toInt(leftEntry[0], 0) !== toInt(rightEntry[0], 0) ||
      toInt(leftEntry[1], 0) !== toInt(rightEntry[1], 0)
    ) {
      return false;
    }
  }

  return true;
}

function refreshShipCompressionFacilityState(entity) {
  if (!entity || entity.kind !== "ship") {
    return false;
  }

  const previousTypelists = Array.isArray(entity.compressionFacilityTypelists)
    ? entity.compressionFacilityTypelists.map((entry) => [
        toInt(entry && entry[0], 0),
        Math.max(1, toInt(entry && entry[1], 0)),
      ])
    : null;
  const nextTypelists = resolveCompressionFacilityTypelistsForEntity(entity);
  if (areCompressionFacilityTypelistsEqual(previousTypelists, nextTypelists)) {
    return false;
  }

  entity.compressionFacilityTypelists = nextTypelists;
  return true;
}

function getIndustrialCoreDependentModuleIDs(entity, excludedModuleID = 0) {
  if (!entity || !(entity.activeModuleEffects instanceof Map)) {
    return [];
  }

  const normalizedExcludedModuleID = toInt(excludedModuleID, 0);
  return [...entity.activeModuleEffects.values()]
    .map((effectState) => ({
      effectState,
      moduleID: toInt(effectState && effectState.moduleID, 0),
    }))
    .filter(({ effectState, moduleID }) => (
      moduleID > 0 &&
      moduleID !== normalizedExcludedModuleID &&
      toFiniteNumber(effectState && effectState.deactivatedAtMs, 0) <= 0 &&
      moduleActivationRequiresActiveIndustrialCore(
        toInt(effectState && effectState.typeID, 0),
      )
    ))
    .map(({ moduleID }) => moduleID);
}

function resolveGenericModuleSpecialFxGuid(effectRecord, options = {}) {
  const weaponGuid =
    (
      options.weaponSnapshot &&
      typeof options.weaponSnapshot.effectGUID === "string" &&
      options.weaponSnapshot.effectGUID
    ) ||
    resolveWeaponSpecialFxGUID({
      family: options.weaponFamily,
      moduleItem: options.moduleItem,
      chargeItem: options.chargeItem,
      activationEffect: effectRecord,
    }) ||
    "";
  if (weaponGuid) {
    return weaponGuid;
  }

  return String(effectRecord && effectRecord.guid || "");
}

function isEntityUsingAlternateSlimCategory(entity) {
  if (!entity || entity.kind !== "ship") {
    return false;
  }

  const categoryID = toInt(entity.categoryID, 0);
  const slimCategoryID = toInt(
    entity.slimCategoryID,
    categoryID,
  );
  return categoryID > 0 && slimCategoryID > 0 && slimCategoryID !== categoryID;
}

function isEntityUsingNpcShipHardpointPresentation(entity) {
  return Boolean(
    entity &&
    entity.kind === "ship" &&
    (
      entity.nativeNpc === true ||
      entity.nativeNpcOccupied === true ||
      isEntityUsingAlternateSlimCategory(entity)
    )
  );
}

function usesShipKeyedSpecialFxModuleBinding(visibilityEntity, options = {}) {
  if (!visibilityEntity || visibilityEntity.kind !== "ship") {
    return false;
  }

  return isEntityUsingNpcShipHardpointPresentation(visibilityEntity);
}

function resolveSpecialFxOptionsForEntity(shipID, options = {}, visibilityEntity = null) {
  if (!usesShipKeyedSpecialFxModuleBinding(visibilityEntity, options)) {
    return options;
  }

  const moduleID = toInt(options && options.moduleID, 0);
  if (moduleID <= 0) {
    return options;
  }

  return {
    ...options,
    // CCP EntityShip hardpoints are keyed by shipID for NPC/entity presentation,
    // not by the underlying fitted module itemID.
    moduleID: toInt(shipID, toInt(visibilityEntity.itemID, moduleID)),
  };
}

function buildSpecialFxPayloadsForEntity(
  shipID,
  guid,
  options = {},
  visibilityEntity = null,
) {
  const resolvedOptions = resolveSpecialFxOptionsForEntity(
    shipID,
    options,
    visibilityEntity,
  );
  return {
    resolvedOptions,
    payloads: splitSpecialFxGuids(guid).map((guidEntry) => (
      destiny.buildOnSpecialFXPayload(shipID, guidEntry, resolvedOptions)
    )),
  };
}

function isSessionViewingOwnVisibilityEntity(session, visibilityEntity) {
  return Boolean(
    session &&
    session._space &&
    visibilityEntity &&
    toInt(session._space.shipID, 0) === toInt(visibilityEntity.itemID, 0)
  );
}

function isInventoryBackedDynamicEntity(entity) {
  return Boolean(
    entity &&
    entity.nativeNpcWreck !== true &&
    (
      entity.kind === "container" ||
      entity.kind === "wreck" ||
      entity.kind === "drone" ||
      entity.kind === "fighter" ||
      entity.kind === "orbital"
    ),
  );
}

function isNativeNpcWreckDynamicEntity(entity) {
  return Boolean(
    entity &&
    entity.nativeNpcWreck === true &&
    (entity.kind === "container" || entity.kind === "wreck"),
  );
}

function refreshInventoryBackedEntityPresentationFields(entity) {
  if (!isInventoryBackedDynamicEntity(entity)) {
    return entity;
  }

  const itemRecord = findItemById(entity.itemID) || null;
  if (!itemRecord) {
    return entity;
  }

  const metadata = getItemMetadata(itemRecord.typeID, itemRecord.itemName);
  const resolvedRadius = resolveRuntimeInventoryEntityRadius(
    entity.kind,
    itemRecord,
    metadata,
    toFiniteNumber(entity.radius, 1),
  );
  entity.ownerID = toInt(itemRecord.ownerID, toInt(entity.ownerID, 0));
  entity.itemName = String(itemRecord.itemName || metadata.name || entity.itemName || "Container");
  entity.typeID = toInt(itemRecord.typeID, entity.typeID);
  entity.groupID = toInt(itemRecord.groupID, entity.groupID);
  entity.categoryID = toInt(itemRecord.categoryID, entity.categoryID);
  entity.radius = resolvedRadius;
  entity.signatureRadius = resolveRuntimeInventoryEntitySignatureRadius(
    itemRecord,
    metadata,
    resolvedRadius,
  );
  entity.spaceState = itemRecord.spaceState || entity.spaceState || null;
  entity.conditionState = normalizeShipConditionState(itemRecord.conditionState);
  entity.createdAtMs = toFiniteNumber(itemRecord.createdAtMs, 0) || null;
  entity.expiresAtMs = toFiniteNumber(itemRecord.expiresAtMs, 0) || null;
  entity.isEmpty = listContainerItems(null, entity.itemID).length === 0;
  if (entity.kind === "drone") {
    hydrateDroneEntityFromInventoryItem(entity, itemRecord);
  }
  if (entity.kind === "fighter") {
    hydrateFighterEntityFromInventoryItem(entity, itemRecord);
  }
  if (entity.kind === "orbital") {
    planetOrbitalState.hydrateOrbitalEntityFromInventoryItem(entity, itemRecord, {
      solarSystemID: entity.systemID,
    });
  }
  return entity;
}

function applySessionStateToShipEntity(entity, session, shipItem = null) {
  if (!entity || entity.kind !== "ship") {
    return entity;
  }

  const characterID = toInt(session && session.characterID, 0);
  const characterData =
    characterID > 0 ? resolveCharacterRecord(characterID) || null : null;

  entity.session = session || null;
  entity.persistSpaceState = true;
  entity.ownerID = toInt(
    shipItem && shipItem.ownerID,
    toInt(entity.ownerID, characterID),
  );
  entity.characterID = characterID;
  entity.pilotCharacterID = characterID;
  entity.corporationID = toInt(session && session.corporationID, 0);
  entity.allianceID = toInt(session && session.allianceID, 0);
  entity.warFactionID = toInt(session && session.warFactionID, 0);
  entity.itemName = String(
    (shipItem && shipItem.itemName) ||
      (session && session.shipName) ||
      entity.itemName ||
      "Ship",
  );
  entity.conditionState = normalizeShipConditionState(
    (shipItem && shipItem.conditionState) || entity.conditionState,
  );

  const resolvedSkinMaterialSetID = resolveShipSkinMaterialSetID(shipItem);
  entity.skinMaterialSetID =
    resolvedSkinMaterialSetID !== null &&
    resolvedSkinMaterialSetID !== undefined
      ? resolvedSkinMaterialSetID
      : entity.skinMaterialSetID ?? null;
  entity.modules = normalizeSlimShipModules(
    buildSlimModuleTuples(characterID, entity.itemID),
  );
  entity.securityStatus = toFiniteNumber(
    characterData && (characterData.securityStatus ?? characterData.securityRating),
    0,
  );
  entity.bounty = toFiniteNumber(characterData && characterData.bounty, 0);
  refreshShipCompressionFacilityState(entity);
  return entity;
}

function clearSessionStateFromShipEntity(entity) {
  if (!entity || entity.kind !== "ship") {
    return entity;
  }

  entity.session = null;
  entity.pendingModuleStopNotifications = [];
  entity.characterID = 0;
  entity.pilotCharacterID = 0;
  entity.corporationID = 0;
  entity.allianceID = 0;
  entity.warFactionID = 0;
  entity.securityStatus = 0;
  entity.bounty = 0;
  refreshShipCompressionFacilityState(entity);
  return entity;
}

function refreshEntitiesForSlimPayload(entities) {
  if (!Array.isArray(entities)) {
    return [];
  }

  for (const entity of entities) {
    refreshShipPresentationFields(entity);
    refreshInventoryBackedEntityPresentationFields(entity);
    if (entity && entity.kind === "structure") {
      const latestStructure = structureState.getStructureByID(entity.itemID, {
        refresh: false,
      });
      if (latestStructure) {
        entity.state = latestStructure.state;
        entity.stateStartedAt = latestStructure.stateStartedAt;
        entity.stateEndsAt = latestStructure.stateEndsAt;
        entity.upkeepState = latestStructure.upkeepState;
        entity.deedState = latestStructure.hasQuantumCore === true ? 1 : 0;
        entity.serviceStates = latestStructure.serviceStates || {};
        entity.unanchoring = latestStructure.unanchoring || null;
      }
    }
  }

  return entities;
}

function cloneDynamicEntityForDestinyPresentation(entity) {
  if (!entity || typeof entity !== "object") {
    return entity;
  }

  const clone = {
    ...entity,
    position: cloneVector(entity.position),
    velocity: cloneVector(entity.velocity),
    direction: cloneVector(entity.direction, DEFAULT_RIGHT),
    targetPoint: cloneVector(entity.targetPoint, entity.position),
  };

  if (entity.warpState && typeof entity.warpState === "object") {
    clone.warpState = {
      ...entity.warpState,
      origin: cloneVector(entity.warpState.origin, entity.position),
      targetPoint: cloneVector(
        entity.warpState.targetPoint,
        entity.targetPoint || entity.position,
      ),
      direction: cloneVector(
        entity.warpState.direction,
        entity.direction || DEFAULT_RIGHT,
      ),
      entryPosition: cloneVector(
        entity.warpState.entryPosition,
        entity.position,
      ),
    };
  }

  if (entity.pendingWarp && typeof entity.pendingWarp === "object") {
    clone.pendingWarp = {
      ...entity.pendingWarp,
      origin: cloneVector(entity.pendingWarp.origin, entity.position),
      targetPoint: cloneVector(
        entity.pendingWarp.targetPoint,
        entity.targetPoint || entity.position,
      ),
      direction: cloneVector(
        entity.pendingWarp.direction,
        entity.direction || DEFAULT_RIGHT,
      ),
    };
  }

  return clone;
}

function buildMissileLaunchPresentationSnapshot(entity) {
  if (!entity || entity.kind !== "missile") {
    return null;
  }

  const snapshot = cloneDynamicEntityForDestinyPresentation(entity);
  delete snapshot.launchPresentationSnapshot;
  delete snapshot.missileSnapshot;
  delete snapshot.lastMissileStep;
  snapshot.launchModules = Array.isArray(entity.launchModules)
    ? entity.launchModules.map((value) => toInt(value, 0))
    : [];
  snapshot.pendingGeometryImpact = false;
  snapshot.pendingGeometryImpactAtMs = 0;
  snapshot.pendingGeometryImpactReason = "";
  snapshot.pendingGeometryImpactPosition = { x: 0, y: 0, z: 0 };
  snapshot.liveImpactAtMs = 0;
  snapshot.clientVisualReleaseAtMs = 0;
  return snapshot;
}

function buildMissileFreshAcquirePresentationEntity(entity) {
  if (!entity || entity.kind !== "missile") {
    return entity;
  }

  const snapshot =
    entity.launchPresentationSnapshot &&
    typeof entity.launchPresentationSnapshot === "object"
      ? entity.launchPresentationSnapshot
      : null;
  if (!snapshot) {
    return cloneDynamicEntityForDestinyPresentation(entity);
  }

  const livePresentation = cloneDynamicEntityForDestinyPresentation(entity);
  const merged = {
    ...livePresentation,
    ...snapshot,
    position: cloneVector(snapshot.position, livePresentation.position),
    velocity: cloneVector(snapshot.velocity, livePresentation.velocity),
    direction: cloneVector(snapshot.direction, livePresentation.direction),
    targetPoint: cloneVector(snapshot.targetPoint, livePresentation.targetPoint),
    pendingGeometryImpactPosition: cloneVector(
      snapshot.pendingGeometryImpactPosition,
      { x: 0, y: 0, z: 0 },
    ),
    launchModules: Array.isArray(snapshot.launchModules)
      ? snapshot.launchModules.map((value) => toInt(value, 0))
      : [],
  };
  delete merged.launchPresentationSnapshot;
  delete merged.missileSnapshot;
  delete merged.lastMissileStep;
  return merged;
}

function isBubbleScopedStaticEntity(entity) {
  return entity && entity.staticVisibilityScope === "bubble";
}

function isPublicGridScopedStaticEntity(entity) {
  if (!entity) {
    return false;
  }
  const scope = String(entity.staticVisibilityScope || "").trim().toLowerCase();
  return scope === "grid" || scope === "publicgrid" || scope === "public_grid";
}

function isIncrementalStaticVisibilityEntity(entity) {
  return (
    isBubbleScopedStaticEntity(entity) ||
    isPublicGridScopedStaticEntity(entity)
  );
}

function isDedicatedSiteStaticVisibilityEntity(entity) {
  return (
    entity &&
    entity.dungeonMaterializedSiteContent === true &&
    isBubbleScopedStaticEntity(entity)
  );
}

function canSessionSeeAddedBallForBroadcast(scene, session, entity, now = null) {
  if (!scene || !session || !entity) {
    return false;
  }
  const entityID = toInt(entity && entity.itemID, 0);
  if (entityID > 0 && scene.dynamicEntities instanceof Map && scene.dynamicEntities.has(entityID)) {
    return scene.canSessionSeeDynamicEntity(
      session,
      entity,
      now === null ? scene.getCurrentSimTimeMs() : now,
    );
  }
  if (isBubbleScopedStaticEntity(entity)) {
    const egoEntity = scene.getShipEntityForSession(session);
    const egoBubbleID = toInt(egoEntity && egoEntity.bubbleID, 0);
    return egoBubbleID > 0 && egoBubbleID === toInt(entity && entity.bubbleID, 0);
  }
  if (isPublicGridScopedStaticEntity(entity)) {
    return scene.canSessionSeeStaticEntityForSession(session, entity);
  }
  return scene.staticEntitiesByID instanceof Map && scene.staticEntitiesByID.has(entityID);
}

function getStationInteractionRadius(station) {
  const configuredVisualRadius = toFiniteNumber(station && station.radius, 0);
  if (configuredVisualRadius > 0) {
    return configuredVisualRadius;
  }

  const configuredRadius = toFiniteNumber(
    station && station.interactionRadius,
    0,
  );
  if (configuredRadius > 0) {
    return configuredRadius;
  }

  return DEFAULT_STATION_INTERACTION_RADIUS;
}

function getStationUndockSpawnState(station, options = {}) {
  if (isStructureDockable(station)) {
    return structureLocatorGeometry.buildStructureUndockSpawnState(station, {
      shipTypeID: options.shipTypeID,
      selectionStrategy: options.selectionStrategy || "random",
      selectionKey: options.selectionKey,
      extraUndockDistance: Math.max(
        0,
        toFiniteNumber(options.extraUndockDistance, 0),
      ),
      random: options.random,
    });
  }

  if (station) {
    return stationLocatorGeometry.buildStationUndockSpawnState(station, {
      shipTypeID: options.shipTypeID,
      selectionStrategy: options.selectionStrategy || "random",
      selectionKey: options.selectionKey,
      extraUndockDistance: Math.max(
        0,
        toFiniteNumber(options.extraUndockDistance, 0),
      ),
      random: options.random,
    });
  }

  const dockDirection = normalizeVector(
    cloneVector(
      station &&
        (station.dockOrientation || station.undockDirection),
      DEFAULT_RIGHT,
    ),
    DEFAULT_RIGHT,
  );
  const storedUndockOffset = station
    ? subtractVectors(
        cloneVector(station.undockPosition, station.position),
        cloneVector(station.position),
      )
    : null;
  const direction = normalizeVector(
    magnitude(storedUndockOffset) > 0
      ? storedUndockOffset
      : dockDirection,
    DEFAULT_RIGHT,
  );
  const spawnDistance = Math.max(
    DEFAULT_STATION_UNDOCK_DISTANCE,
    getStationConfiguredUndockDistance(station),
    getStationInteractionRadius(station) + 2500,
  );

  return {
    direction,
    position: addVectors(
      cloneVector(station && station.position),
      scaleVector(direction, spawnDistance),
    ),
  };
}

function getCommandDirection(entity, fallback = DEFAULT_RIGHT) {
  if (entity && entity.targetPoint && entity.position) {
    return normalizeVector(
      subtractVectors(entity.targetPoint, entity.position),
      entity.direction || fallback,
    );
  }

  return normalizeVector(entity && entity.direction, fallback);
}

function isNearlySameDirection(left, right, minDot = DUPLICATE_DIRECTION_DOT) {
  return dotProduct(
    normalizeVector(left, DEFAULT_RIGHT),
    normalizeVector(right, DEFAULT_RIGHT),
  ) >= minDot;
}

function getShipDockingDistanceToStation(entity, station) {
  if (!entity || !station) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(
    0,
    distance(entity.position, station.position) -
      entity.radius -
      getStationInteractionRadius(station),
  );
}

function canShipDockAtStation(entity, station, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
  return getShipDockingDistanceToStation(entity, station) <= Math.max(0, toFiniteNumber(maxDistance, DEFAULT_STATION_DOCKING_RADIUS));
}

function buildDockingDebugState(entity, station, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
  if (!entity || !station) {
    return null;
  }

  const dockPosition = getStationDockPosition(station, {
    shipTypeID: entity.typeID,
    selectionKey: entity.itemID,
  });
  const approachPosition = getStationApproachPosition(station, {
    shipTypeID: entity.typeID,
    selectionKey: entity.itemID,
    useDockPosition: Number(entity.dockingTargetID || 0) === Number(station.itemID || 0),
  });

  return {
    canDock: canShipDockAtStation(entity, station, maxDistance),
    dockingDistance: roundNumber(
      getShipDockingDistanceToStation(entity, station),
    ),
    distanceToStationCenter: roundNumber(distance(entity.position, station.position)),
    distanceToDockPoint: roundNumber(distance(entity.position, dockPosition)),
    distanceToApproachPoint: roundNumber(distance(entity.position, approachPosition)),
    dockingThreshold: roundNumber(maxDistance),
    shipRadius: roundNumber(entity.radius),
    stationRadius: roundNumber(getStationInteractionRadius(station)),
    shipPosition: summarizeVector(entity.position),
    shipVelocity: summarizeVector(entity.velocity),
    stationPosition: summarizeVector(station.position),
    approachPosition: summarizeVector(approachPosition),
    dockPosition: summarizeVector(dockPosition),
    targetEntityID: entity.targetEntityID || 0,
    dockingTargetID: entity.dockingTargetID || 0,
    mode: entity.mode,
    speedFraction: roundNumber(entity.speedFraction, 3),
  };
}

function snapShipToStationPerimeter(entity, station) {
  const desiredDistance = Math.max(
    DEFAULT_STATION_UNDOCK_DISTANCE,
    getStationConfiguredUndockDistance(station),
    getStationInteractionRadius(station) + entity.radius + 500,
  );
  const approachDirection = normalizeVector(
    subtractVectors(entity.position, station.position),
    cloneVector(station.undockDirection, DEFAULT_RIGHT),
  );

  entity.position = addVectors(
    cloneVector(station.position),
    scaleVector(approachDirection, desiredDistance),
  );
  entity.targetPoint = cloneVector(station.position);
}

function getLegacyStationNormalizationTarget(entity) {
  if (!entity || entity.kind !== "ship") {
    return null;
  }

  if (
    entity.targetEntityID &&
    (entity.mode === "FOLLOW" || entity.mode === "GOTO")
  ) {
    const trackedStation = worldData.getStationByID(entity.targetEntityID);
    if (trackedStation && canShipDockAtStation(entity, trackedStation)) {
      return trackedStation;
    }
  }

  if (
    entity.mode !== "STOP" ||
    toFiniteNumber(entity.speedFraction, 0) > 0 ||
    magnitude(entity.velocity) > 1
  ) {
    return null;
  }

  let closestStation = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const station of worldData.getStationsForSystem(entity.systemID)) {
    const stationDistance = getShipDockingDistanceToStation(entity, station);
    if (stationDistance < closestDistance) {
      closestDistance = stationDistance;
      closestStation = station;
    }
  }

  return closestDistance <= LEGACY_STATION_NORMALIZATION_RADIUS ? closestStation : null;
}

function normalizeLegacyStationState(entity) {
  if (
    !entity ||
    entity.kind !== "ship"
  ) {
    return false;
  }

  const station = getLegacyStationNormalizationTarget(entity);
  if (!station) {
    return false;
  }

  snapShipToStationPerimeter(entity, station);
  return true;
}

function serializeWarpState(entity) {
  if (!entity.warpState) {
    return null;
  }

  return {
    startTimeMs: toFiniteNumber(entity.warpState.startTimeMs, Date.now()),
    durationMs: toFiniteNumber(entity.warpState.durationMs, 0),
    accelTimeMs: toFiniteNumber(entity.warpState.accelTimeMs, 0),
    cruiseTimeMs: toFiniteNumber(entity.warpState.cruiseTimeMs, 0),
    decelTimeMs: toFiniteNumber(entity.warpState.decelTimeMs, 0),
    totalDistance: toFiniteNumber(entity.warpState.totalDistance, 0),
    stopDistance: toFiniteNumber(entity.warpState.stopDistance, 0),
    maxWarpSpeedMs: toFiniteNumber(entity.warpState.maxWarpSpeedMs, 0),
    cruiseWarpSpeedMs: toFiniteNumber(entity.warpState.cruiseWarpSpeedMs, 0),
    warpFloorSpeedMs: toFiniteNumber(entity.warpState.warpFloorSpeedMs, 0),
    warpDropoutSpeedMs: toFiniteNumber(
      entity.warpState.warpDropoutSpeedMs,
      toFiniteNumber(entity.warpState.warpFloorSpeedMs, 0),
    ),
    accelDistance: toFiniteNumber(entity.warpState.accelDistance, 0),
    cruiseDistance: toFiniteNumber(entity.warpState.cruiseDistance, 0),
    decelDistance: toFiniteNumber(entity.warpState.decelDistance, 0),
    accelExponent: toFiniteNumber(entity.warpState.accelExponent, WARP_ACCEL_EXPONENT),
    decelExponent: toFiniteNumber(entity.warpState.decelExponent, WARP_DECEL_EXPONENT),
    accelRate: toFiniteNumber(
      entity.warpState.accelRate,
      toFiniteNumber(entity.warpState.accelExponent, WARP_ACCEL_EXPONENT),
    ),
    decelRate: toFiniteNumber(
      entity.warpState.decelRate,
      toFiniteNumber(entity.warpState.decelExponent, WARP_DECEL_EXPONENT),
    ),
    warpSpeed: toInt(entity.warpState.warpSpeed, 3000),
    commandStamp: toInt(entity.warpState.commandStamp, 0),
    startupGuidanceAtMs: toFiniteNumber(entity.warpState.startupGuidanceAtMs, 0),
    startupGuidanceStamp: toInt(entity.warpState.startupGuidanceStamp, 0),
    startupGuidanceVelocity: cloneVector(
      entity.warpState.startupGuidanceVelocity,
      { x: 0, y: 0, z: 0 },
    ),
    cruiseBumpAtMs: toFiniteNumber(entity.warpState.cruiseBumpAtMs, 0),
    cruiseBumpStamp: toInt(entity.warpState.cruiseBumpStamp, 0),
    effectAtMs: toFiniteNumber(entity.warpState.effectAtMs, 0),
    effectStamp: toInt(entity.warpState.effectStamp, 0),
    targetEntityID: toInt(entity.warpState.targetEntityID, 0),
    followID: toInt(entity.warpState.followID, 0),
    followRangeMarker: toFiniteNumber(
      entity.warpState.followRangeMarker,
      entity.warpState.stopDistance,
    ),
    profileType: String(entity.warpState.profileType || "legacy"),
    origin: cloneVector(entity.warpState.origin, entity.position),
    rawDestination: cloneVector(entity.warpState.rawDestination, entity.position),
    targetPoint: cloneVector(entity.warpState.targetPoint, entity.position),
    pilotMaxSpeedRamp: clonePilotWarpMaxSpeedRamp(
      entity.warpState.pilotMaxSpeedRamp,
    ),
  };
}

function serializePendingWarp(pendingWarp) {
  if (!pendingWarp) {
    return null;
  }

  return {
    requestedAtMs: toInt(pendingWarp.requestedAtMs, 0),
    preWarpSyncStamp: toInt(pendingWarp.preWarpSyncStamp, 0),
    prepareStamp: toInt(pendingWarp.prepareStamp, 0),
    prepareVisibleStamp: toInt(pendingWarp.prepareVisibleStamp, 0),
    stopDistance: toFiniteNumber(pendingWarp.stopDistance, 0),
    totalDistance: toFiniteNumber(pendingWarp.totalDistance, 0),
    warpSpeedAU: toFiniteNumber(pendingWarp.warpSpeedAU, 0),
    rawDestination: cloneVector(pendingWarp.rawDestination),
    targetPoint: cloneVector(pendingWarp.targetPoint),
    targetEntityID: toInt(pendingWarp.targetEntityID, 0),
  };
}

function buildOfficialWarpReferenceProfile(
  warpDistanceMeters,
  warpSpeedAU,
  maxSubwarpSpeedMs,
) {
  const totalDistance = Math.max(toFiniteNumber(warpDistanceMeters, 0), 0);
  const resolvedWarpSpeedAU = Math.max(toFiniteNumber(warpSpeedAU, 0), 0.001);
  const resolvedSubwarpSpeedMs = Math.max(
    Math.min(toFiniteNumber(maxSubwarpSpeedMs, 0) / 2, WARP_DROPOUT_SPEED_MAX_MS),
    1,
  );
  const kAccel = resolvedWarpSpeedAU;
  const kDecel = Math.min(resolvedWarpSpeedAU / 3, 2);

  let maxWarpSpeedMs = resolvedWarpSpeedAU * ONE_AU_IN_METERS;
  let accelDistance = maxWarpSpeedMs / kAccel;
  let decelDistance = maxWarpSpeedMs / kDecel;
  const minimumDistance = accelDistance + decelDistance;
  const cruiseDistance = Math.max(totalDistance - minimumDistance, 0);
  let cruiseTimeSeconds = 0;
  let profileType = "long";

  if (minimumDistance > totalDistance) {
    profileType = "short";
    maxWarpSpeedMs =
      (totalDistance * kAccel * kDecel) /
      Math.max(kAccel + kDecel, 0.001);
    accelDistance = maxWarpSpeedMs / kAccel;
    decelDistance = maxWarpSpeedMs / kDecel;
  } else {
    cruiseTimeSeconds = cruiseDistance / maxWarpSpeedMs;
  }

  const accelTimeSeconds =
    Math.log(Math.max(maxWarpSpeedMs / kAccel, 1)) / kAccel;
  const decelTimeSeconds =
    Math.log(Math.max(maxWarpSpeedMs / resolvedSubwarpSpeedMs, 1)) / kDecel;
  const totalTimeSeconds =
    accelTimeSeconds + cruiseTimeSeconds + decelTimeSeconds;

  return {
    profileType,
    warpDistanceMeters: roundNumber(totalDistance, 3),
    warpDistanceAU: roundNumber(totalDistance / ONE_AU_IN_METERS, 6),
    warpSpeedAU: roundNumber(resolvedWarpSpeedAU, 3),
    kAccel: roundNumber(kAccel, 6),
    kDecel: roundNumber(kDecel, 6),
    warpDropoutSpeedMs: roundNumber(resolvedSubwarpSpeedMs, 3),
    maxWarpSpeedMs: roundNumber(maxWarpSpeedMs, 3),
    maxWarpSpeedAU: roundNumber(maxWarpSpeedMs / ONE_AU_IN_METERS, 6),
    accelDistance: roundNumber(accelDistance, 3),
    accelDistanceAU: roundNumber(accelDistance / ONE_AU_IN_METERS, 6),
    cruiseDistance: roundNumber(
      Math.max(totalDistance - accelDistance - decelDistance, 0),
      3,
    ),
    cruiseDistanceAU: roundNumber(
      Math.max(totalDistance - accelDistance - decelDistance, 0) /
        ONE_AU_IN_METERS,
      6,
    ),
    decelDistance: roundNumber(decelDistance, 3),
    decelDistanceAU: roundNumber(decelDistance / ONE_AU_IN_METERS, 6),
    minimumDistance: roundNumber(
      Math.min(minimumDistance, totalDistance),
      3,
    ),
    minimumDistanceAU: roundNumber(
      Math.min(minimumDistance, totalDistance) / ONE_AU_IN_METERS,
      6,
    ),
    accelTimeMs: roundNumber(accelTimeSeconds * 1000, 3),
    cruiseTimeMs: roundNumber(cruiseTimeSeconds * 1000, 3),
    decelTimeMs: roundNumber(decelTimeSeconds * 1000, 3),
    totalTimeMs: roundNumber(totalTimeSeconds * 1000, 3),
    ceilTotalSeconds: Math.ceil(totalTimeSeconds),
  };
}

function buildWarpProfileDelta(warpState, officialProfile) {
  if (!warpState || !officialProfile) {
    return null;
  }

  return {
    durationMs: roundNumber(
      toFiniteNumber(warpState.durationMs, 0) -
        toFiniteNumber(officialProfile.totalTimeMs, 0),
      3,
    ),
    accelTimeMs: roundNumber(
      toFiniteNumber(warpState.accelTimeMs, 0) -
        toFiniteNumber(officialProfile.accelTimeMs, 0),
      3,
    ),
    cruiseTimeMs: roundNumber(
      toFiniteNumber(warpState.cruiseTimeMs, 0) -
        toFiniteNumber(officialProfile.cruiseTimeMs, 0),
      3,
    ),
    decelTimeMs: roundNumber(
      toFiniteNumber(warpState.decelTimeMs, 0) -
        toFiniteNumber(officialProfile.decelTimeMs, 0),
      3,
    ),
    maxWarpSpeedMs: roundNumber(
      toFiniteNumber(warpState.maxWarpSpeedMs, 0) -
        toFiniteNumber(officialProfile.maxWarpSpeedMs, 0),
      3,
    ),
    accelDistance: roundNumber(
      toFiniteNumber(warpState.accelDistance, 0) -
        toFiniteNumber(officialProfile.accelDistance, 0),
      3,
    ),
    cruiseDistance: roundNumber(
      toFiniteNumber(warpState.cruiseDistance, 0) -
        toFiniteNumber(officialProfile.cruiseDistance, 0),
      3,
    ),
    decelDistance: roundNumber(
      toFiniteNumber(warpState.decelDistance, 0) -
        toFiniteNumber(officialProfile.decelDistance, 0),
      3,
    ),
  };
}

function getWarpPhaseName(warpState, elapsedMs) {
  const elapsed = Math.max(toFiniteNumber(elapsedMs, 0), 0);
  const accelTimeMs = Math.max(toFiniteNumber(warpState && warpState.accelTimeMs, 0), 0);
  const cruiseTimeMs = Math.max(toFiniteNumber(warpState && warpState.cruiseTimeMs, 0), 0);
  const durationMs = Math.max(toFiniteNumber(warpState && warpState.durationMs, 0), 0);

  if (elapsed < accelTimeMs) {
    return "accel";
  }
  if (elapsed < accelTimeMs + cruiseTimeMs) {
    return "cruise";
  }
  if (elapsed < durationMs) {
    return "decel";
  }
  return "complete";
}

function buildWarpRuntimeDiagnostics(entity, now = Date.now()) {
  if (!entity || !entity.warpState) {
    return null;
  }

  const warpState = entity.warpState;
  const elapsedMs = Math.max(
    0,
    toFiniteNumber(now, Date.now()) - toFiniteNumber(warpState.startTimeMs, now),
  );
  const progress = getWarpProgress(warpState, now);
  const positionRemainingDistance = Math.max(
    distance(entity.position, warpState.targetPoint),
    0,
  );
  const profileRemainingDistance = Math.max(
    toFiniteNumber(warpState.totalDistance, 0) - toFiniteNumber(progress.traveled, 0),
    0,
  );
  const velocityMagnitude = magnitude(entity.velocity);

  return {
    stamp: getCurrentDestinyStamp(now),
    phase: getWarpPhaseName(warpState, elapsedMs),
    elapsedMs: roundNumber(elapsedMs, 3),
    remainingMs: roundNumber(
      Math.max(toFiniteNumber(warpState.durationMs, 0) - elapsedMs, 0),
      3,
    ),
    progressComplete: Boolean(progress.complete),
    progressDistance: roundNumber(toFiniteNumber(progress.traveled, 0), 3),
    progressDistanceAU: roundNumber(
      toFiniteNumber(progress.traveled, 0) / ONE_AU_IN_METERS,
      6,
    ),
    progressRemainingDistance: roundNumber(profileRemainingDistance, 3),
    progressRemainingDistanceAU: roundNumber(
      profileRemainingDistance / ONE_AU_IN_METERS,
      6,
    ),
    progressSpeedMs: roundNumber(toFiniteNumber(progress.speed, 0), 3),
    progressSpeedAU: roundNumber(
      toFiniteNumber(progress.speed, 0) / ONE_AU_IN_METERS,
      6,
    ),
    entitySpeedMs: roundNumber(velocityMagnitude, 3),
    entitySpeedAU: roundNumber(velocityMagnitude / ONE_AU_IN_METERS, 6),
    positionRemainingDistance: roundNumber(positionRemainingDistance, 3),
    positionRemainingDistanceAU: roundNumber(
      positionRemainingDistance / ONE_AU_IN_METERS,
      6,
    ),
    remainingDistanceDelta: roundNumber(
      positionRemainingDistance - profileRemainingDistance,
      3,
    ),
  };
}

function logWarpDebug(event, entity, extra = {}) {
  if (!entity) {
    return;
  }

  const now = Date.now();
  appendWarpDebug(JSON.stringify({
    event,
    atMs: now,
    destinyStamp: getCurrentDestinyStamp(now),
    charID: getShipEntityDebugCharacterID(entity, 0),
    shipID: entity.itemID || 0,
    systemID: entity.systemID || 0,
    mode: entity.mode || "UNKNOWN",
    maxVelocity: roundNumber(entity.maxVelocity, 3),
    speedFraction: roundNumber(entity.speedFraction, 3),
    pendingWarp: summarizePendingWarp(entity.pendingWarp),
    warpState: serializeWarpState(entity),
    warpRuntime: buildWarpRuntimeDiagnostics(entity, now),
    ...extra,
  }));
}

function logBallDebug(event, entity, extra = {}) {
  if (!entity) {
    return;
  }

  appendBallDebug(JSON.stringify({
    event,
    atMs: Date.now(),
    destinyStamp: getCurrentDestinyStamp(),
    charID: getShipEntityDebugCharacterID(entity, 0),
    shipID: entity.itemID || 0,
    systemID: entity.systemID || 0,
    mode: entity.mode || "UNKNOWN",
    ...destiny.debugDescribeEntityBall(entity),
    ...extra,
  }));
}

function serializeSpaceState(entity) {
  return {
    systemID: entity.systemID,
    position: cloneVector(entity.position),
    velocity: cloneVector(entity.velocity),
    direction: cloneVector(entity.direction),
    targetPoint: cloneVector(entity.targetPoint, entity.position),
    speedFraction: entity.speedFraction,
    mode: normalizeMode(entity.mode),
    targetEntityID: entity.targetEntityID || null,
    followRange: entity.followRange || 0,
    orbitDistance: entity.orbitDistance || 0,
    orbitNormal: cloneVector(entity.orbitNormal, buildPerpendicular(entity.direction)),
    orbitSign: entity.orbitSign < 0 ? -1 : 1,
    pendingWarp: serializePendingWarp(entity.pendingWarp),
    warpState: serializeWarpState(entity),
  };
}

function getActualSpeedFraction(entity) {
  if (!entity) {
    return 0;
  }

  const maxVelocity = Math.max(toFiniteNumber(entity.maxVelocity, 0), 0.001);
  return clamp(magnitude(entity.velocity) / maxVelocity, 0, 1);
}

function isReadyForDestiny(session) {
  return Boolean(
    session &&
      session._space &&
      session._space.initialStateSent &&
      session.socket &&
      !session.socket.destroyed,
  );
}

function canSessionReceiveEntityDependentDestinyUpdate(scene, session, entity) {
  if (!scene || !session || !session._space || !entity) {
    return false;
  }
  const entityID = toInt(entity && entity.itemID, 0);
  if (entityID <= 0) {
    return false;
  }
  if (toInt(session._space.shipID, 0) === entityID) {
    return true;
  }
  if (entity.session && sessionMatchesIdentity(session, entity.session)) {
    return true;
  }
  if (scene.staticEntitiesByID instanceof Map && scene.staticEntitiesByID.has(entityID)) {
    if (!isIncrementalStaticVisibilityEntity(entity)) {
      return session._space.initialStateSent === true;
    }
    return Boolean(
      session._space.visibleBubbleScopedStaticEntityIDs instanceof Set &&
      session._space.visibleBubbleScopedStaticEntityIDs.has(entityID)
    );
  }
  return Boolean(
    session._space.visibleDynamicEntityIDs instanceof Set &&
    session._space.visibleDynamicEntityIDs.has(entityID)
  );
}

function recordDependentNotificationSkip(scene, session, source, entity, details = {}) {
  if (!scene || !session || !session._space || !entity) {
    return;
  }
  recordVisibilityJournal(session, "dependent.skip", {
    source,
    reason: "entity-not-materialized",
    entityIDs: [toInt(entity && entity.itemID, 0)],
    ...details,
  });
}

function shouldBypassTickPresentationBatchForDeferredOwnerMissileAcquire(
  scene,
  ownerSession,
) {
  return Boolean(
    scene &&
      typeof scene.hasActiveTickDestinyPresentationBatch === "function" &&
      scene.hasActiveTickDestinyPresentationBatch() &&
      ownerSession &&
      isReadyForDestiny(ownerSession),
  );
}

function buildDeferredOwnerMissileAcquireOptions(scene, ownerSession) {
  return {
    nowMs:
      scene && typeof scene.getCurrentSimTimeMs === "function"
        ? scene.getCurrentSimTimeMs()
        : 0,
    visibilityFn: (session, candidate) =>
      isOwnerLaunchedMissileVisibleToSession(session, candidate),
    // `client/fulldessync11.txt`: launcher-owner missile AddBalls2 can be
    // queued behind newer owner-critical history when it rides the active
    // tick presentation batch. Keep the owner missile fresh-acquire on the
    // immediate owner lane while leaving observer missile presentation alone.
    bypassTickPresentationBatch:
      shouldBypassTickPresentationBatchForDeferredOwnerMissileAcquire(
        scene,
        ownerSession,
      ),
  };
}

function buildObserverStargateJumpFxOptions(options = {}) {
  const result = {
    start: true,
    active: false,
    useCurrentStamp: true,
    minimumLeadFromCurrentHistory: 1,
    maximumLeadFromCurrentHistory: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    historyLeadUsesPresentedSessionStamp: true,
    historyLeadPresentedMaximumFutureLead: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    destinyAuthorityContract: DESTINY_CONTRACTS.COMBAT_NONCRITICAL,
    ...options,
  };
  if (result.maximumLeadFromCurrentHistory === undefined || result.maximumLeadFromCurrentHistory === null) {
    result.maximumLeadFromCurrentHistory = MICHELLE_HELD_FUTURE_DESTINY_LEAD;
  }
  return result;
}

function buildObserverStargateGateActivityFxOptions(options = {}) {
  return buildObserverStargateJumpFxOptions({
    // CCP's observer-side gate flash is keyed to the stargate ball itself.
    // Leaving duration unspecified falls back to GenericEffect's 10s lifetime,
    // and the client FxSequencer then merges later GateActivity one-shots on
    // the same gate key instead of restarting the visible flash. Keep the
    // activation effectively instantaneous so every jump can retrigger.
    duration: Math.max(1, toInt(options.duration, 1)),
    ...options,
  });
}

function buildStructureObserverSpaceState(
  scene,
  structureID,
  previousState = null,
) {
  const baseState =
    previousState && typeof previousState === "object"
      ? previousState
      : {};
  return {
    systemID: Number(scene && scene.systemID) || 0,
    shipID: Number(structureID) || 0,
    observerKind: "structure",
    beyonceBound: true,
    initialStateSent: baseState.initialStateSent === true,
    initialBallparkVisualsSent: baseState.initialBallparkVisualsSent === true,
    initialBallparkClockSynced: baseState.initialBallparkClockSynced === true,
    pendingBallparkBind: baseState.pendingBallparkBind === true,
    deferInitialBallparkClockUntilBind: false,
    deferInitialBallparkStateUntilBind: false,
    pendingUndockMovement: false,
    visibleDynamicEntityIDs:
      baseState.visibleDynamicEntityIDs instanceof Set
        ? new Set(baseState.visibleDynamicEntityIDs)
        : new Set(),
    visibleBubbleScopedStaticEntityIDs:
      baseState.visibleBubbleScopedStaticEntityIDs instanceof Set
        ? new Set(baseState.visibleBubbleScopedStaticEntityIDs)
        : new Set(),
    freshlyVisibleDynamicEntityIDs:
      baseState.freshlyVisibleDynamicEntityIDs instanceof Set
        ? new Set(baseState.freshlyVisibleDynamicEntityIDs)
        : new Set(),
    freshlyVisibleDynamicEntityReleaseStampByID:
      baseState.freshlyVisibleDynamicEntityReleaseStampByID instanceof Map
        ? new Map(baseState.freshlyVisibleDynamicEntityReleaseStampByID)
        : new Map(),
    visibilityJournal: Array.isArray(baseState.visibilityJournal)
      ? baseState.visibilityJournal.slice(-VISIBILITY_JOURNAL_MAX_ENTRIES)
      : [],
    visibilityJournalSeq: toInt(baseState.visibilityJournalSeq, 0),
    pilotWarpQuietUntilStamp: toInt(baseState.pilotWarpQuietUntilStamp, 0),
    pilotWarpVisibilityHandoff: baseState.pilotWarpVisibilityHandoff || null,
    clockOffsetMs: toFiniteNumber(baseState.clockOffsetMs, 0),
    historyFloorDestinyStamp:
      baseState.historyFloorDestinyStamp === undefined
        ? null
        : baseState.historyFloorDestinyStamp,
    lastSentDestinyStamp:
      baseState.lastSentDestinyStamp === undefined
        ? null
        : baseState.lastSentDestinyStamp,
    lastSentDestinyRawDispatchStamp:
      baseState.lastSentDestinyRawDispatchStamp === undefined
        ? null
        : baseState.lastSentDestinyRawDispatchStamp,
    lastSentDestinyOnlyStaleProjectedOwnerMissileLane:
      baseState.lastSentDestinyOnlyStaleProjectedOwnerMissileLane === undefined
        ? null
        : baseState.lastSentDestinyOnlyStaleProjectedOwnerMissileLane,
    lastOwnerNonMissileCriticalStamp:
      baseState.lastOwnerNonMissileCriticalStamp === undefined
        ? null
        : baseState.lastOwnerNonMissileCriticalStamp,
    lastOwnerNonMissileCriticalRawDispatchStamp:
      baseState.lastOwnerNonMissileCriticalRawDispatchStamp === undefined
        ? null
        : baseState.lastOwnerNonMissileCriticalRawDispatchStamp,
    lastPilotCommandMovementStamp:
      baseState.lastPilotCommandMovementStamp === undefined
        ? null
        : baseState.lastPilotCommandMovementStamp,
    lastPilotCommandMovementAnchorStamp:
      baseState.lastPilotCommandMovementAnchorStamp === undefined
        ? null
        : baseState.lastPilotCommandMovementAnchorStamp,
    lastPilotCommandMovementRawDispatchStamp:
      baseState.lastPilotCommandMovementRawDispatchStamp === undefined
        ? null
        : baseState.lastPilotCommandMovementRawDispatchStamp,
    lastPilotCommandDirection:
      baseState.lastPilotCommandDirection === undefined
        ? null
        : cloneVector(baseState.lastPilotCommandDirection),
    lastFreshAcquireLifecycleStamp:
      baseState.lastFreshAcquireLifecycleStamp === undefined
        ? null
        : baseState.lastFreshAcquireLifecycleStamp,
    lastMissileLifecycleStamp:
      baseState.lastMissileLifecycleStamp === undefined
        ? null
        : baseState.lastMissileLifecycleStamp,
    lastOwnerMissileLifecycleStamp:
      baseState.lastOwnerMissileLifecycleStamp === undefined
        ? null
        : baseState.lastOwnerMissileLifecycleStamp,
    lastOwnerMissileLifecycleAnchorStamp:
      baseState.lastOwnerMissileLifecycleAnchorStamp === undefined
        ? null
        : baseState.lastOwnerMissileLifecycleAnchorStamp,
    lastOwnerMissileFreshAcquireStamp:
      baseState.lastOwnerMissileFreshAcquireStamp === undefined
        ? null
        : baseState.lastOwnerMissileFreshAcquireStamp,
    lastOwnerMissileFreshAcquireAnchorStamp:
      baseState.lastOwnerMissileFreshAcquireAnchorStamp === undefined
        ? null
        : baseState.lastOwnerMissileFreshAcquireAnchorStamp,
    lastOwnerMissileFreshAcquireRawDispatchStamp:
      baseState.lastOwnerMissileFreshAcquireRawDispatchStamp === undefined
        ? null
        : baseState.lastOwnerMissileFreshAcquireRawDispatchStamp,
    lastOwnerMissileLifecycleRawDispatchStamp:
      baseState.lastOwnerMissileLifecycleRawDispatchStamp === undefined
        ? null
        : baseState.lastOwnerMissileLifecycleRawDispatchStamp,
    timeDilation:
      scene && typeof scene.getTimeDilation === "function"
        ? scene.getTimeDilation()
        : 1,
    simTimeMs:
      scene && typeof scene.getCurrentSimTimeMs === "function"
        ? scene.getCurrentSimTimeMs()
        : Date.now(),
    simFileTime:
      scene && typeof scene.getCurrentFileTime === "function"
        ? scene.getCurrentFileTime()
        : currentFileTime(),
  };
}

function buildShipPrimeUpdates(entity, stampOverride = null) {
  if (!entity || entity.kind !== "ship") {
    return [];
  }

  const stamp = stampOverride === null ? getNextStamp() : toInt(stampOverride, getNextStamp());
  return [
    {
      stamp,
      payload: destiny.buildSetBallAgilityPayload(entity.itemID, entity.inertia),
    },
    {
      stamp,
      payload: destiny.buildSetBallMassPayload(entity.itemID, entity.mass),
    },
    {
      stamp,
      payload: destiny.buildSetMaxSpeedPayload(entity.itemID, entity.maxVelocity),
    },
    {
      stamp,
      payload: destiny.buildSetBallMassivePayload(entity.itemID, false),
    },
  ];
}

function buildShipPrimeUpdatesForEntities(entities, stampOverride = null) {
  const updates = [];
  for (const entity of entities) {
    updates.push(...buildShipPrimeUpdates(entity, stampOverride));
  }
  return updates;
}

function filterFreshAcquireBootstrapModeUpdates(updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return [];
  }
  // Fresh acquisition should never replay contracts that are explicitly tagged
  // for already-visible observers. For player ships already in warp, AddBalls2
  // now carries the native WARP ball state and the extra WarpTo/FX replay
  // causes the client to fire warp visuals before the model exists, which is
  // the observer "spawn in" bug from warp9.txt.
  const freshAcquireSafeUpdates = updates.filter(
    (update) => !(update && update.requireExistingVisibility === true),
  );
  if (freshAcquireSafeUpdates.length === 0) {
    return [];
  }
  const containsWarpTo = freshAcquireSafeUpdates.some(
    (update) =>
      update &&
      Array.isArray(update.payload) &&
      update.payload[0] === "WarpTo",
  );
  if (containsWarpTo) {
    return freshAcquireSafeUpdates;
  }
  return freshAcquireSafeUpdates.filter((update) => (
    !isMovementContractPayload(update && update.payload)
  ));
}

function resolveFreshAcquireBootstrapModeUpdates(entities, updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return [];
  }
  return filterFreshAcquireBootstrapModeUpdates(updates);
}

function stripMissileFreshAcquireModeReplayUpdates(entities, updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return [];
  }

  const missileIDs = new Set(
    (Array.isArray(entities) ? entities : [])
      .map((entity) => toInt(entity && entity.itemID, 0))
      .filter((entityID) => entityID > 0),
  );
  if (missileIDs.size === 0) {
    return updates;
  }

  return updates.filter((update) => {
    const payload =
      update && Array.isArray(update.payload) ? update.payload : null;
    const payloadName = payload && typeof payload[0] === "string"
      ? payload[0]
      : null;
    // Missile AddBalls2 already carries the authored launch snapshot. Fresh-
    // acquire replay should not immediately fight that snapshot with movement-
    // mode bootstrap packets for the same missile ball.
    if (
      payloadName !== "FollowBall" &&
      payloadName !== "SetSpeedFraction" &&
      payloadName !== "SetBallVelocity"
    ) {
      return true;
    }
    return !missileIDs.has(getPayloadPrimaryEntityID(payload));
  });
}

function buildPositionVelocityCorrectionUpdates(entity, options = {}) {
  return movementWatcherCorrections.buildPositionVelocityCorrectionUpdates(
    entity,
    options,
  );
}

function buildPilotWarpCorrectionUpdates(entity, stamp) {
  return movementWatcherCorrections.buildPilotWarpCorrectionUpdates(
    entity,
    stamp,
  );
}

function buildStopMovementUpdates(
  entity,
  stamp,
  options = {},
) {
  const includeVelocitySeed = options.includeVelocitySeed !== false;
  const updates = [
    {
      stamp,
      payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 0),
    },
    {
      stamp,
      payload: destiny.buildStopPayload(entity.itemID),
    },
  ];
  if (includeVelocitySeed && magnitude(entity.velocity) > 0) {
    updates.push({
      stamp,
      payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
    });
  }
  return updates;
}

function usesActiveSubwarpWatcherCorrections(entity) {
  return movementWatcherCorrections.usesActiveSubwarpWatcherCorrections(entity);
}

function usesLocalStopDecelContract(entity) {
  return movementWatcherCorrections.usesLocalStopDecelContract(entity);
}

function getWatcherCorrectionIntervalMs(entity) {
  return movementWatcherCorrections.getWatcherCorrectionIntervalMs(entity);
}

function getWatcherPositionCorrectionIntervalMs(entity) {
  return movementWatcherCorrections.getWatcherPositionCorrectionIntervalMs(
    entity,
  );
}

function summarizeDestinyArgs(name, args) {
  switch (name) {
    case "GotoDirection":
    case "GotoPoint":
    case "SetBallVelocity":
    case "SetBallPosition":
      return [
        toInt(args && args[0], 0),
        roundNumber(unwrapMarshalNumber(args && args[1])),
        roundNumber(unwrapMarshalNumber(args && args[2])),
        roundNumber(unwrapMarshalNumber(args && args[3])),
      ];
    case "SetSpeedFraction":
      return [
        toInt(args && args[0], 0),
        roundNumber(unwrapMarshalNumber(args && args[1]), 3),
      ];
    case "FollowBall":
    case "Orbit":
      return [
        toInt(args && args[0], 0),
        toInt(args && args[1], 0),
        roundNumber(args && args[2]),
      ];
    case "Stop":
      return [toInt(args && args[0], 0)];
    case "WarpTo":
      return [
        toInt(args && args[0], 0),
        roundNumber(unwrapMarshalNumber(args && args[1])),
        roundNumber(unwrapMarshalNumber(args && args[2])),
        roundNumber(unwrapMarshalNumber(args && args[3])),
        roundNumber(unwrapMarshalNumber(args && args[4])),
        toInt(args && args[5], 0),
      ];
    case "AddBall":
      return [
        toInt(args && args[0], 0),
        roundNumber(unwrapMarshalNumber(args && args[1])),
        roundNumber(unwrapMarshalNumber(args && args[2])),
        roundNumber(unwrapMarshalNumber(args && args[3])),
        toInt(args && args[4], 0),
        toInt(args && args[5], 0),
        toInt(args && args[6], 0),
        toInt(args && args[7], 0),
        toInt(args && args[8], 0),
        roundNumber(unwrapMarshalNumber(args && args[9])),
        roundNumber(unwrapMarshalNumber(args && args[10])),
        roundNumber(unwrapMarshalNumber(args && args[11])),
        roundNumber(unwrapMarshalNumber(args && args[12])),
        roundNumber(unwrapMarshalNumber(args && args[13])),
        roundNumber(unwrapMarshalNumber(args && args[14])),
        roundNumber(unwrapMarshalNumber(args && args[15]), 3),
        roundNumber(unwrapMarshalNumber(args && args[16]), 3),
      ];
    case "AddBalls2":
      return summarizeAddBalls2Args(args);
    case "SetState":
      return summarizeSetStateArgs(args);
    case "OnDamageStateChange":
      return summarizeDamageStateArgs(args);
    case "OnDbuffUpdated":
      return [{
        entityID: toInt(args && args[0], 0),
        dbuffCollectionIDs: getMarshalListItems(args && args[1])
          .map((entry) => toInt(Array.isArray(entry) ? entry[0] : 0, 0))
          .filter((value) => value > 0),
      }];
    case "RemoveBalls":
      return summarizeRemoveBallsArgs(args);
    default:
      return args;
  }
}

function getPayloadPrimaryEntityID(payload) {
  if (!Array.isArray(payload) || payload.length < 2) {
    return 0;
  }
  const [name, args] = payload;
  switch (name) {
    case "GotoDirection":
    case "GotoPoint":
    case "SetBallVelocity":
    case "SetBallPosition":
    case "SetSpeedFraction":
    case "FollowBall":
    case "Orbit":
    case "Stop":
    case "WarpTo":
    case "EntityWarpIn":
    case "OnSpecialFX":
    case "OnDbuffUpdated":
    case "SetBallMassive":
    case "SetMaxSpeed":
    case "SetBallMass":
    case "SetBallAgility":
      return toInt(args && args[0], 0);
    default:
      return 0;
  }
}

function logDestinyDispatch(session, payloads, waitForBubble) {
  if (!session || payloads.length === 0) {
    return;
  }

  const dispatchDestinyStamp = getCurrentDestinyStamp();
  const stampLeads = payloads.map((update) => (
    toInt(update && update.stamp, 0) - dispatchDestinyStamp
  ));
  appendDestinyDebug(JSON.stringify({
    event: "destiny.send",
    charID: session.characterID || 0,
    shipID: session._space ? session._space.shipID || 0 : 0,
    systemID: session._space ? session._space.systemID || 0 : 0,
    waitForBubble: Boolean(waitForBubble),
    dispatchDestinyStamp,
    maxLeadFromDispatch: stampLeads.length > 0 ? Math.max(...stampLeads) : 0,
    updates: payloads.map((update) => ({
      stamp: toInt(update && update.stamp, 0),
      leadFromDispatch: toInt(update && update.stamp, 0) - dispatchDestinyStamp,
      name: update && update.payload ? update.payload[0] : null,
      args: summarizeDestinyArgs(
        update && update.payload ? update.payload[0] : null,
        update && update.payload ? update.payload[1] : null,
      ),
    })),
  }, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
}

function sessionMatchesIdentity(left, right) {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }

  const leftClientID = Number(left.clientID ?? left.clientId ?? 0);
  const rightClientID = Number(right.clientID ?? right.clientId ?? 0);
  return leftClientID > 0 && rightClientID > 0 && leftClientID === rightClientID;
}

function clearPendingDock(entity) {
  if (entity) {
    entity.pendingDock = null;
  }
}

function logMovementDebug(event, entity, extra = {}) {
  if (!entity) {
    return;
  }

  const now = Date.now();
  appendMovementDebug(JSON.stringify({
    event,
    atMs: now,
    destinyStamp: getCurrentDestinyStamp(now),
    charID: getShipEntityDebugCharacterID(entity, 0),
    shipID: entity.itemID || 0,
    systemID: entity.systemID || 0,
    mode: entity.mode || "UNKNOWN",
    speedFraction: roundNumber(entity.speedFraction, 3),
    position: summarizeVector(entity.position),
    velocity: summarizeVector(entity.velocity),
    direction: summarizeVector(entity.direction),
    targetPoint: summarizeVector(entity.targetPoint),
    targetEntityID: entity.targetEntityID || 0,
    dockingTargetID: entity.dockingTargetID || 0,
    pendingWarp: summarizePendingWarp(entity.pendingWarp),
    speed: roundNumber(magnitude(entity.velocity), 3),
    turn: entity.lastTurnMetrics || null,
    motion: entity.lastMotionDebug || null,
    trace: getMovementTraceSnapshot(entity, now),
    ...extra,
  }));
}

function buildStaticStationEntity(station) {
  const dunRotation = getStationAuthoredDunRotation(station);
  const dockingGeometry = station
    ? stationLocatorGeometry.buildStationDockingGeometry(station, {
      selectionStrategy: "first",
    })
    : null;
  return {
    kind: "station",
    itemID: station.stationID,
    typeID: station.stationTypeID,
    groupID: station.groupID,
    categoryID: station.categoryID,
    itemName: station.stationName,
    ownerID: station.corporationID || 1,
    corporationID: station.corporationID || 0,
    allianceID: 0,
    warFactionID: 0,
    radius: getStationInteractionRadius(station),
    position: cloneVector(station.position),
    dockPosition: dockingGeometry && dockingGeometry.dockPosition
      ? cloneVector(dockingGeometry.dockPosition)
      : station.dockPosition
        ? cloneVector(station.dockPosition)
        : null,
    dockOrientation: dockingGeometry && dockingGeometry.dockOrientation
      ? normalizeVector(dockingGeometry.dockOrientation, DEFAULT_RIGHT)
      : station.dockOrientation
        ? normalizeVector(station.dockOrientation, station.undockDirection || DEFAULT_RIGHT)
        : normalizeVector(station.undockDirection, DEFAULT_RIGHT),
    undockDirection: dockingGeometry && dockingGeometry.undockDirection
      ? cloneVector(dockingGeometry.undockDirection)
      : station.undockDirection
        ? cloneVector(station.undockDirection)
        : null,
    undockPosition: dockingGeometry && dockingGeometry.undockPosition
      ? cloneVector(dockingGeometry.undockPosition)
      : station.undockPosition
        ? cloneVector(station.undockPosition)
        : null,
    dunRotation,
    activityLevel: getStationRenderMetadata(station, "activityLevel") ?? null,
    skinMaterialSetID: getStationRenderMetadata(station, "skinMaterialSetID") ?? null,
    celestialEffect: getStationRenderMetadata(station, "celestialEffect") ?? null,
    velocity: { x: 0, y: 0, z: 0 },
  };
}

function buildStaticStructureEntity(structure) {
  const typeRecord = structureState.getStructureTypeByID(structure && structure.typeID);
  const effectiveHitpoints = resolveStructureEffectiveHitpoints(structure);
  const dockingGeometry = structureLocatorGeometry.buildStructureDockingGeometry(
    structure,
    {
      selectionStrategy: "first",
    },
  );
  const passiveResourceState = buildPassiveShipResourceState(
    0,
    {
      itemID: structure && structure.structureID,
      typeID: structure && structure.typeID,
      groupID: typeRecord && typeRecord.groupID,
      categoryID: typeRecord && typeRecord.categoryID,
      itemName: structure && (structure.itemName || structure.name),
      radius: structure && structure.radius,
      conditionState: structure && structure.conditionState,
    },
    {
      fittedItems: [],
      skillMap: new Map(),
      additionalAttributeModifierEntries:
        wormholeEnvironmentRuntime.collectShipAttributeModifierEntriesForSystem(
          structure && structure.solarSystemID,
        ),
    },
  );
  return {
    kind: "structure",
    itemID: structure.structureID,
    typeID: structure.typeID,
    groupID: (typeRecord && typeRecord.groupID) || 1657,
    categoryID: (typeRecord && typeRecord.categoryID) || 65,
    itemName: structure.itemName || structure.name || `Structure ${structure.structureID}`,
    ownerID: structure.ownerCorpID || structure.ownerID || 1,
    corporationID: structure.ownerCorpID || 0,
    allianceID: structure.allianceID || 0,
    warFactionID: 0,
    radius: Math.max(getStationInteractionRadius(structure), toFiniteNumber(structure.radius, 0)),
    interactionRadius: Math.max(getStationInteractionRadius(structure), toFiniteNumber(structure.radius, 0)),
    position: cloneVector(structure.position),
    dockPosition: cloneVector(dockingGeometry.dockPosition),
    dockOrientation: cloneVector(dockingGeometry.dockOrientation),
    undockDirection: cloneVector(dockingGeometry.undockDirection),
    undockPosition: cloneVector(dockingGeometry.undockPosition),
    rotation: Array.isArray(dockingGeometry.dunRotation)
      ? [...dockingGeometry.dunRotation]
      : coerceDunRotationTuple(structure && structure.rotation),
    dunRotation: Array.isArray(dockingGeometry.dunRotation)
      ? [...dockingGeometry.dunRotation]
      : coerceDunRotationTuple(structure && structure.rotation),
    velocity: { x: 0, y: 0, z: 0 },
    state: structure.state,
    stateStartedAt: structure.stateStartedAt || null,
    stateEndsAt: structure.stateEndsAt || null,
    upkeepState: structure.upkeepState,
    deedState: structure.hasQuantumCore === true ? 1 : 0,
    serviceStates: structure.serviceStates || {},
    unanchoring: structure.unanchoring || null,
    repairing: null,
    docked: false,
    modules: [],
    dockable: structure.dockable === true,
    accessProfile:
      structure && structure.accessProfile && typeof structure.accessProfile === "object"
        ? { ...structure.accessProfile }
        : null,
    destroyedAt: structure.destroyedAt || null,
    capacitorCapacity: toFiniteNumber(passiveResourceState.capacitorCapacity, 0),
    capacitorRechargeRate: toFiniteNumber(
      passiveResourceState.capacitorRechargeRate,
      0,
    ),
    shieldCapacity: toFiniteNumber(
      effectiveHitpoints.effectiveShieldCapacity,
      toFiniteNumber(passiveResourceState.shieldCapacity, 0),
    ),
    armorHP: toFiniteNumber(
      effectiveHitpoints.effectiveArmorHP,
      toFiniteNumber(passiveResourceState.armorHP, 0),
    ),
    structureHP: toFiniteNumber(
      effectiveHitpoints.effectiveStructureHP,
      toFiniteNumber(passiveResourceState.structureHP, 0),
    ),
    conditionState: normalizeShipConditionState(structure.conditionState),
    passiveDerivedState: passiveResourceState,
    tetheringRange: toFiniteNumber(structure.tetheringRange, 0),
    tetherRepairEffectMode:
      structure &&
      structure.tetherRepairEffectMode !== undefined &&
      structure.tetherRepairEffectMode !== null
        ? String(structure.tetherRepairEffectMode)
        : null,
    maxTargetRange: toFiniteNumber(structure.maxTargetRange, 0),
    maxLockedTargets: toFiniteNumber(structure.maxLockedTargets, 0),
  };
}

function getStructureStaticEntitySignature(entity) {
  return JSON.stringify({
    itemName: entity && entity.itemName,
    ownerID: entity && entity.ownerID,
    corporationID: entity && entity.corporationID,
    allianceID: entity && entity.allianceID,
    state: entity && entity.state,
    stateStartedAt: entity && entity.stateStartedAt,
    stateEndsAt: entity && entity.stateEndsAt,
    upkeepState: entity && entity.upkeepState,
    deedState: entity && entity.deedState,
    serviceStates: entity && entity.serviceStates,
    unanchoring: entity && entity.unanchoring,
    shieldCapacity: entity && entity.shieldCapacity,
    armorHP: entity && entity.armorHP,
    structureHP: entity && entity.structureHP,
    conditionState: entity && entity.conditionState,
    tetheringRange: entity && entity.tetheringRange,
    tetherRepairEffectMode: entity && entity.tetherRepairEffectMode,
    maxTargetRange: entity && entity.maxTargetRange,
    maxLockedTargets: entity && entity.maxLockedTargets,
  });
}

function getStructureSlimItemSignature(entity) {
  return JSON.stringify(
    destiny.buildSlimItemDict(entity),
    (_key, value) => (typeof value === "bigint" ? String(value) : value),
  );
}

function buildChangedStructureRows(changePayload = {}) {
  const previousByID = new Map(
    (Array.isArray(changePayload.previousRows)
      ? changePayload.previousRows
      : [])
      .map((row) => [toInt(row && row.structureID, 0), row])
      .filter(([structureID]) => structureID > 0),
  );
  const nextByID = new Map(
    (Array.isArray(changePayload.nextRows) ? changePayload.nextRows : [])
      .map((row) => [toInt(row && row.structureID, 0), row])
      .filter(([structureID]) => structureID > 0),
  );
  const structureIDs = new Set([
    ...previousByID.keys(),
    ...nextByID.keys(),
  ]);

  return [...structureIDs]
    .map((structureID) => ({
      structureID,
      previous: previousByID.get(structureID) || null,
      next: nextByID.get(structureID) || null,
    }))
    .filter(
      (entry) =>
        JSON.stringify(entry.previous) !== JSON.stringify(entry.next),
    );
}

function isSessionDockedInStructure(session, structureID) {
  return (
    toInt(structureID, 0) > 0 &&
    toInt(session && (session.structureID || session.structureid), 0) ===
      toInt(structureID, 0)
  );
}

function notifyDockedStructureHangarViewSessions(changedStructures = []) {
  if (!Array.isArray(changedStructures) || changedStructures.length === 0) {
    return 0;
  }

  let deliveredCount = 0;
  const sessions =
    typeof sessionRegistry.getSessions === "function"
      ? sessionRegistry.getSessions()
      : [];
  for (const change of changedStructures) {
    const structure = change && change.next ? change.next : null;
    const structureID = toInt(change && change.structureID, 0);
    if (!structure || structureID <= 0) {
      continue;
    }
    const hangarViewState = buildStructureHangarViewState(structure);

    for (const session of sessions) {
      if (
        !isSessionDockedInStructure(session, structureID) ||
        typeof session.sendNotification !== "function"
      ) {
        continue;
      }
      session.sendNotification(
        "OnHangarViewStateUpdated",
        "clientID",
        [structureID, hangarViewState],
      );
      deliveredCount += 1;
    }
  }

  return deliveredCount;
}

function getStructureServiceStateSignature(structure = null) {
  const serviceStates =
    structure &&
    structure.serviceStates &&
    typeof structure.serviceStates === "object"
      ? structure.serviceStates
      : {};
  return JSON.stringify(
    Object.entries(serviceStates)
      .map(([serviceID, stateID]) => [
        toInt(serviceID, 0),
        toInt(stateID, 0),
      ])
      .filter(([serviceID]) => serviceID > 0)
      .sort((left, right) => left[0] - right[0]),
  );
}

function haveStructureServiceStatesChanged(
  previousStructure = null,
  nextStructure = null,
) {
  return (
    getStructureServiceStateSignature(previousStructure) !==
    getStructureServiceStateSignature(nextStructure)
  );
}

function notifyDockedStructureServiceSessions(changedStructures = []) {
  if (!Array.isArray(changedStructures) || changedStructures.length === 0) {
    return 0;
  }

  const sessions =
    typeof sessionRegistry.getSessions === "function"
      ? sessionRegistry.getSessions()
      : [];
  let deliveredCount = 0;

  for (const change of changedStructures) {
    const structureID = toInt(change && change.structureID, 0);
    if (
      structureID <= 0 ||
      !change ||
      !change.next ||
      !haveStructureServiceStatesChanged(change.previous, change.next)
    ) {
      continue;
    }

    for (const session of sessions) {
      if (
        !isSessionDockedInStructure(session, structureID) ||
        typeof session.sendNotification !== "function"
      ) {
        continue;
      }
      session.sendNotification(
        "OnStructureServiceChanged",
        "clientID",
        [structureID],
      );
      deliveredCount += 1;
    }
  }

  return deliveredCount;
}

function syncRuntimeStructureStateChanges(runtime, changePayload = {}) {
  if (!runtime) {
    return {
      syncedSystemCount: 0,
      dockedHangarDeliveryCount: 0,
      dockedServiceDeliveryCount: 0,
    };
  }
  const changedStructures = buildChangedStructureRows(changePayload);
  const systemIDs = [
    ...new Set(
      (Array.isArray(changePayload.systemIDs)
        ? changePayload.systemIDs
        : [])
        .map((systemID) => toInt(systemID, 0))
        .filter((systemID) => systemID > 0),
    ),
  ];
  let syncedSystemCount = 0;

  for (const systemID of systemIDs) {
    if (!(runtime.scenes instanceof Map) || !runtime.scenes.has(systemID)) {
      continue;
    }
    runtime.syncStructureSceneState(systemID, {
      reason: "structureStateChange",
    });
    syncedSystemCount += 1;
  }

  return {
    syncedSystemCount,
    dockedHangarDeliveryCount:
      notifyDockedStructureHangarViewSessions(changedStructures),
    dockedServiceDeliveryCount:
      notifyDockedStructureServiceSessions(changedStructures),
  };
}

function buildStaticCelestialEntity(celestial) {
  return {
    kind: celestial.kind || "celestial",
    itemID: celestial.itemID,
    typeID: celestial.typeID,
    groupID: celestial.groupID,
    categoryID: celestial.categoryID,
    itemName: celestial.itemName,
    ownerID: 1,
    radius: celestial.radius || (celestial.groupID === 10 ? 15000 : 1000),
    position: cloneVector(celestial.position),
    velocity: { x: 0, y: 0, z: 0 },
  };
}

function buildStaticAsteroidBeltEntity(asteroidBelt) {
  return {
    kind: asteroidBelt.kind || "asteroidBelt",
    itemID: asteroidBelt.itemID,
    typeID: asteroidBelt.typeID,
    groupID: asteroidBelt.groupID,
    categoryID: asteroidBelt.categoryID,
    itemName: asteroidBelt.itemName,
    ownerID: 1,
    radius: asteroidBelt.radius || 15_000,
    position: cloneVector(asteroidBelt.position),
    velocity: { x: 0, y: 0, z: 0 },
  };
}

function buildStaticStargateEntity(stargate) {
  const sourceSystem = worldData.getSolarSystemByID(stargate && stargate.solarSystemID);
  const destinationSystem = worldData.getSolarSystemByID(
    stargate && stargate.destinationSolarSystemID,
  );
  const originSystemOwnerID = getSystemOwnerID(sourceSystem);
  const destinationSystemOwnerID = getSystemOwnerID(destinationSystem);
  const destinationSystemStatusIcons = getStargateStatusIcons(
    stargate,
    destinationSystem,
  );
  const destinationSystemWarningIcon = getStargateWarningIcon(
    stargate,
    sourceSystem,
    destinationSystem,
  );
  const dunRotation = getResolvedStargateDunRotation(stargate);
  const groupID = toInt(getStargateTypeMetadata(stargate, "groupID"), 10);
  const categoryID = toInt(getStargateTypeMetadata(stargate, "categoryID"), 2);
  const skinMaterialSetID = getStargateRenderMetadata(
    stargate,
    "skinMaterialSetID",
  );

  return {
    kind: "stargate",
    itemID: stargate.itemID,
    typeID: stargate.typeID,
    groupID,
    categoryID,
    itemName: stargate.itemName,
    ownerID: originSystemOwnerID || 1,
    radius: resolveStargatePhysicalRadius(stargate),
    interactionRadius: getStargateInteractionRadius(stargate),
    position: cloneVector(stargate.position),
    velocity: { x: 0, y: 0, z: 0 },
    typeName: getStargateTypeMetadata(stargate, "typeName") || null,
    groupName: getStargateTypeMetadata(stargate, "groupName") || null,
    graphicID: toInt(getStargateTypeMetadata(stargate, "graphicID"), 0) || null,
    raceID: toInt(getStargateTypeMetadata(stargate, "raceID"), 0) || null,
    destinationID: stargate.destinationID,
    destinationSolarSystemID: stargate.destinationSolarSystemID,
    activationState: coerceStableActivationState(
      stargate.activationState,
      STARGATE_ACTIVATION_STATE.OPEN,
    ),
    activationTransitionAtMs: 0,
    poseID: toInt(stargate.poseID, 0),
    localCorruptionStageAndMaximum: coerceStageTuple(
      stargate.localCorruptionStageAndMaximum,
    ),
    destinationCorruptionStageAndMaximum: coerceStageTuple(
      stargate.destinationCorruptionStageAndMaximum,
    ),
    localSuppressionStageAndMaximum: coerceStageTuple(
      stargate.localSuppressionStageAndMaximum,
    ),
    destinationSuppressionStageAndMaximum: coerceStageTuple(
      stargate.destinationSuppressionStageAndMaximum,
    ),
    hasVolumetricDrifterCloud: Boolean(stargate.hasVolumetricDrifterCloud),
    originSystemOwnerID,
    destinationSystemOwnerID,
    destinationSystemWarning: destinationSystemWarningIcon,
    destinationSystemWarningIcon,
    destinationSystemStatusIcons,
    dunRotation,
    ...(skinMaterialSetID !== undefined && skinMaterialSetID !== null
      ? { skinMaterialSetID }
      : {}),
  };
}

function buildWarpState(rawWarpState, position, warpSpeedAU) {
  if (!rawWarpState || typeof rawWarpState !== "object") {
    return null;
  }
  const resolvedWarpSpeedAU = Math.max(toFiniteNumber(warpSpeedAU, 0), 0.001);
  const startTimeMs = toFiniteNumber(rawWarpState.startTimeMs, Date.now());
  const accelTimeMs = toFiniteNumber(rawWarpState.accelTimeMs, 0);
  const startupGuidanceAtMs = toFiniteNumber(
    rawWarpState.startupGuidanceAtMs,
    0,
  );
  const cruiseBumpAtMs = toFiniteNumber(
    rawWarpState.cruiseBumpAtMs,
    startTimeMs + Math.max(accelTimeMs, 0),
  );
  const effectAtMs = toFiniteNumber(
    rawWarpState.effectAtMs,
    startTimeMs,
  );

  return {
    startTimeMs,
    durationMs: toFiniteNumber(rawWarpState.durationMs, 0),
    accelTimeMs,
    cruiseTimeMs: toFiniteNumber(rawWarpState.cruiseTimeMs, 0),
    decelTimeMs: toFiniteNumber(rawWarpState.decelTimeMs, 0),
    totalDistance: toFiniteNumber(rawWarpState.totalDistance, 0),
    stopDistance: toFiniteNumber(rawWarpState.stopDistance, 0),
    maxWarpSpeedMs: toFiniteNumber(rawWarpState.maxWarpSpeedMs, 0),
    cruiseWarpSpeedMs: toFiniteNumber(rawWarpState.cruiseWarpSpeedMs, 0),
    warpFloorSpeedMs: toFiniteNumber(rawWarpState.warpFloorSpeedMs, 0),
    warpDropoutSpeedMs: toFiniteNumber(
      rawWarpState.warpDropoutSpeedMs,
      toFiniteNumber(rawWarpState.warpFloorSpeedMs, WARP_DROPOUT_SPEED_MAX_MS),
    ),
    accelDistance: toFiniteNumber(rawWarpState.accelDistance, 0),
    cruiseDistance: toFiniteNumber(rawWarpState.cruiseDistance, 0),
    decelDistance: toFiniteNumber(rawWarpState.decelDistance, 0),
    accelExponent: toFiniteNumber(rawWarpState.accelExponent, WARP_ACCEL_EXPONENT),
    decelExponent: toFiniteNumber(rawWarpState.decelExponent, WARP_DECEL_EXPONENT),
    accelRate: Math.max(
      toFiniteNumber(rawWarpState.accelRate, 0) ||
        toFiniteNumber(rawWarpState.accelExponent, 0) ||
        getWarpAccelRate(resolvedWarpSpeedAU),
      0.001,
    ),
    decelRate: Math.max(
      toFiniteNumber(rawWarpState.decelRate, 0) ||
        toFiniteNumber(rawWarpState.decelExponent, 0) ||
        getWarpDecelRate(resolvedWarpSpeedAU),
      0.001,
    ),
    warpSpeed: toInt(rawWarpState.warpSpeed, Math.round(warpSpeedAU * 1000)),
    commandStamp: toInt(rawWarpState.commandStamp, 0),
    startupGuidanceAtMs,
    startupGuidanceStamp: toInt(rawWarpState.startupGuidanceStamp, 0),
    startupGuidanceVelocity: cloneVector(
      rawWarpState.startupGuidanceVelocity,
      { x: 0, y: 0, z: 0 },
    ),
    cruiseBumpAtMs,
    cruiseBumpStamp: toInt(rawWarpState.cruiseBumpStamp, 0),
    effectAtMs,
    effectStamp: toInt(rawWarpState.effectStamp, 0),
    targetEntityID: toInt(rawWarpState.targetEntityID, 0),
    followID: toInt(rawWarpState.followID, 0),
    followRangeMarker: toFiniteNumber(
      rawWarpState.followRangeMarker,
      rawWarpState.stopDistance,
    ),
    profileType: String(rawWarpState.profileType || "legacy"),
    origin: cloneVector(rawWarpState.origin, position),
    rawDestination: cloneVector(rawWarpState.rawDestination, position),
    targetPoint: cloneVector(rawWarpState.targetPoint, position),
    pilotMaxSpeedRamp: clonePilotWarpMaxSpeedRamp(rawWarpState.pilotMaxSpeedRamp),
  };
}

function buildShipSpaceState(source = {}) {
  if (source && typeof source.spaceState === "object" && source.spaceState !== null) {
    return source.spaceState;
  }

  return {
    position: cloneVector(source.position),
    velocity: cloneVector(source.velocity),
    direction: cloneVector(source.direction, DEFAULT_RIGHT),
    targetPoint: source.targetPoint ? cloneVector(source.targetPoint) : undefined,
    speedFraction: source.speedFraction,
    mode: source.mode,
    targetEntityID: source.targetEntityID,
    followRange: source.followRange,
    orbitDistance: source.orbitDistance,
    orbitNormal: source.orbitNormal ? cloneVector(source.orbitNormal) : undefined,
    orbitSign: source.orbitSign,
    pendingWarp: source.pendingWarp,
    warpState: source.warpState,
  };
}

function calculateAlignTimeSecondsFromMassInertia(mass, inertia, fallback = 0) {
  const numericMass = toFiniteNumber(mass, 0);
  const numericInertia = toFiniteNumber(inertia, 0);
  if (numericMass > 0 && numericInertia > 0) {
    return (DESTINY_ALIGN_LOG_DENOMINATOR * numericMass * numericInertia) / 1_000_000;
  }
  return toFiniteNumber(fallback, 0);
}

function buildPassiveShipResourceState(characterID, shipItem, options = {}) {
  if (!shipItem || !shipItem.typeID) {
    return null;
  }

  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    // Sessionless runtime ships such as `/fire` dummies still need a real
    // dogma-derived health envelope so targeting, damage, death, and damage
    // state updates all follow the same authoritative combat path.
    return buildShipResourceState(0, shipItem, {
      ...options,
      fittedItems: Array.isArray(options.fittedItems) ? options.fittedItems : [],
      skillMap: options.skillMap instanceof Map ? options.skillMap : new Map(),
    });
  }

  if (!shipItem.itemID) {
    return null;
  }

  return buildShipResourceState(numericCharacterID, shipItem, options);
}

function getSkillLevel(skillMap, skillTypeID) {
  const skill = skillMap instanceof Map ? skillMap.get(skillTypeID) : null;
  if (!skill) {
    return 0;
  }

  return Math.max(
    0,
    toInt(
      skill.effectiveSkillLevel ??
        skill.trainedSkillLevel ??
        skill.skillLevel,
      0,
    ),
  );
}

function getPropulsionModuleRuntimeAttributes(characterID, moduleItem, options = {}) {
  const effectiveModuleItem = buildNpcEffectiveModuleItem(moduleItem);
  if (!effectiveModuleItem || !effectiveModuleItem.typeID) {
    return null;
  }

  const skillMap = options.skillMap instanceof Map
    ? options.skillMap
    : getCharacterSkillMap(toInt(characterID, 0));
  const groupID = toInt(effectiveModuleItem.groupID, 0);
  const speedFactorBase = toFiniteNumber(
    getTypeAttributeValue(effectiveModuleItem.typeID, "speedFactor"),
    0,
  );
  const capNeedBase = toFiniteNumber(
    getTypeDogmaAttributeValueByID(effectiveModuleItem.typeID, MODULE_ATTRIBUTE_CAPACITOR_NEED),
    0,
  );
  const durationMs = Math.max(
    1,
    toFiniteNumber(
      getTypeDogmaAttributeValueByID(effectiveModuleItem.typeID, MODULE_ATTRIBUTE_DURATION),
      10000,
    ),
  );
  const accelerationControlLevel = getSkillLevel(
    skillMap,
    PROPULSION_SKILL_ACCELERATION_CONTROL,
  );
  let speedFactor = speedFactorBase * (1 + ((5 * accelerationControlLevel) / 100));
  let capNeed = capNeedBase;

  if (groupID === 46) {
    const fuelConservationLevel = getSkillLevel(
      skillMap,
      PROPULSION_SKILL_FUEL_CONSERVATION,
    );
    capNeed *= 1 + ((-10 * fuelConservationLevel) / 100);
  } else if (groupID === 475) {
    const highSpeedLevel = getSkillLevel(
      skillMap,
      PROPULSION_SKILL_HIGH_SPEED_MANEUVERING,
    );
    capNeed *= 1 + ((-5 * highSpeedLevel) / 100);
  }

  return {
    capNeed: Math.max(0, roundNumber(capNeed, 6)),
    durationMs: Math.max(1, roundNumber(durationMs, 3)),
    speedFactor: roundNumber(speedFactor, 6),
    speedBoostFactor: toFiniteNumber(
      getTypeDogmaAttributeValueByID(
        effectiveModuleItem.typeID,
        MODULE_ATTRIBUTE_SPEED_BOOST_FACTOR,
      ),
      0,
    ),
    massAddition: toFiniteNumber(
      getTypeDogmaAttributeValueByID(
        effectiveModuleItem.typeID,
        MODULE_ATTRIBUTE_MASS_ADDITION,
      ),
      0,
    ),
    signatureRadiusBonus: toFiniteNumber(
      getTypeDogmaAttributeValueByID(
        effectiveModuleItem.typeID,
        MODULE_ATTRIBUTE_SIGNATURE_RADIUS_BONUS,
      ),
      0,
    ),
    maxGroupActive: toInt(
      getTypeDogmaAttributeValueByID(
        effectiveModuleItem.typeID,
        MODULE_ATTRIBUTE_MAX_GROUP_ACTIVE,
      ),
      0,
    ),
    maxVelocityActivationLimit: toFiniteNumber(
      getTypeDogmaAttributeValueByID(
        effectiveModuleItem.typeID,
        MODULE_ATTRIBUTE_MAX_VELOCITY_ACTIVATION_LIMIT,
      ),
      0,
    ),
    reactivationDelayMs: Math.max(
      0,
      toFiniteNumber(
        getTypeDogmaAttributeValueByID(
          effectiveModuleItem.typeID,
          MODULE_ATTRIBUTE_REACTIVATION_DELAY,
        ),
        0,
      ),
    ),
  };
}

function getTypeDogmaAttributeValueByID(typeID, attributeID, fallback = null) {
  const attributeValue = getTypeAttributeValue(typeID, getAttributeNameByID(attributeID));
  if (attributeValue !== null && attributeValue !== undefined) {
    return attributeValue;
  }
  const attributes = getTypeDogmaAttributes(typeID);
  const rawValue = attributes && attributes[String(attributeID)];
  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function getAttributeNameByID(attributeID) {
  switch (toInt(attributeID, 0)) {
    case MODULE_ATTRIBUTE_SPEED_FACTOR:
      return "speedFactor";
    case MODULE_ATTRIBUTE_DURATION:
      return "duration";
    case MODULE_ATTRIBUTE_SIGNATURE_RADIUS_BONUS:
      return "signatureRadiusBonus";
    case MODULE_ATTRIBUTE_SPEED_BOOST_FACTOR:
      return "speedBoostFactor";
    case MODULE_ATTRIBUTE_MAX_GROUP_ACTIVE:
      return "maxGroupActive";
    case MODULE_ATTRIBUTE_MASS_ADDITION:
      return "massAddition";
    case MODULE_ATTRIBUTE_REACTIVATION_DELAY:
      return "moduleReactivationDelay";
    case MODULE_ATTRIBUTE_MAX_VELOCITY_ACTIVATION_LIMIT:
      return "maxVelocityActivationLimit";
    default:
      return "";
  }
}

function applyPassiveResourceStateToEntity(entity, resourceState, options = {}) {
  if (!entity || !resourceState) {
    return entity;
  }

  const movement =
    worldData.getMovementAttributesForType(entity.typeID) || null;
  const nextMass =
    toFiniteNumber(resourceState.mass, 0) > 0
      ? toFiniteNumber(resourceState.mass, 0)
      : toFiniteNumber(entity.mass, 0);
  const nextInertia =
    toFiniteNumber(resourceState.agility, 0) > 0
      ? toFiniteNumber(resourceState.agility, 0)
      : toFiniteNumber(entity.inertia, 0);
  const fallbackAlignTime =
    toFiniteNumber(movement && movement.alignTime, 0) > 0
      ? toFiniteNumber(movement.alignTime, 0)
      : toFiniteNumber(entity.alignTime, 0);

  entity.passiveDerivedState = resourceState;
  entity.mass = nextMass > 0 ? nextMass : entity.mass;
  entity.inertia = nextInertia > 0 ? nextInertia : entity.inertia;
  entity.maxVelocity =
    toFiniteNumber(resourceState.maxVelocity, 0) > 0
      ? toFiniteNumber(resourceState.maxVelocity, 0)
      : entity.maxVelocity;
  entity.maxTargetRange = toFiniteNumber(
    resourceState.maxTargetRange,
    toFiniteNumber(entity.maxTargetRange, 0),
  );
  entity.maxLockedTargets = toFiniteNumber(
    resourceState.maxLockedTargets,
    toFiniteNumber(entity.maxLockedTargets, 0),
  );
  entity.signatureRadius = toFiniteNumber(
    resourceState.signatureRadius,
    toFiniteNumber(entity.signatureRadius, 0),
  );
  entity.cloakingTargetingDelay = toFiniteNumber(
    resourceState.cloakingTargetingDelay,
    toFiniteNumber(entity.cloakingTargetingDelay, 0),
  );
  entity.scanResolution = toFiniteNumber(
    resourceState.scanResolution,
    toFiniteNumber(entity.scanResolution, 0),
  );
  entity.capacitorCapacity = toFiniteNumber(
    resourceState.capacitorCapacity,
    toFiniteNumber(entity.capacitorCapacity, 0),
  );
  entity.capacitorRechargeRate = toFiniteNumber(
    resourceState.capacitorRechargeRate,
    toFiniteNumber(entity.capacitorRechargeRate, 0),
  );
  entity.shieldCapacity = toFiniteNumber(
    resourceState.shieldCapacity,
    toFiniteNumber(entity.shieldCapacity, 0),
  );
  entity.shieldRechargeRate = toFiniteNumber(
    resourceState.shieldRechargeRate,
    toFiniteNumber(entity.shieldRechargeRate, 0),
  );
  entity.armorHP = toFiniteNumber(
    resourceState.armorHP,
    toFiniteNumber(entity.armorHP, 0),
  );
  entity.structureHP = toFiniteNumber(
    resourceState.structureHP,
    toFiniteNumber(entity.structureHP, 0),
  );
  entity.alignTime = calculateAlignTimeSecondsFromMassInertia(
    entity.mass,
    entity.inertia,
    fallbackAlignTime,
  );
  entity.agilitySeconds = deriveAgilitySeconds(
    entity.alignTime,
    entity.maxAccelerationTime,
    entity.mass,
    entity.inertia,
  );
  if (options.recalculateSpeedFraction === true) {
    entity.speedFraction = getActualSpeedFraction(entity);
  }
  return entity;
}

function ensureEntityTargetingState(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }
  if (!(entity.lockedTargets instanceof Map)) {
    entity.lockedTargets = new Map();
  }
  if (!(entity.pendingTargetLocks instanceof Map)) {
    entity.pendingTargetLocks = new Map();
  }
  if (!(entity.targetedBy instanceof Set)) {
    entity.targetedBy = new Set();
  }
  return entity;
}

function getEntityTargetingRadius(entity) {
  return Math.max(0, toFiniteNumber(entity && entity.radius, 0));
}

function getEntityLockSignatureRadius(entity) {
  const signatureRadius = toFiniteNumber(entity && entity.signatureRadius, NaN);
  if (Number.isFinite(signatureRadius) && signatureRadius > 0) {
    return signatureRadius;
  }

  const fallbackRadius = getEntityTargetingRadius(entity);
  return fallbackRadius > 0 ? fallbackRadius : 1;
}

function getEntitySurfaceDistance(sourceEntity, targetEntity) {
  if (!sourceEntity || !targetEntity) {
    return Infinity;
  }

  return Math.max(
    0,
    distance(sourceEntity.position, targetEntity.position) -
      getEntityTargetingRadius(sourceEntity) -
      getEntityTargetingRadius(targetEntity),
  );
}

function getCommandTimeEntitySurfaceDistance(
  scene,
  sourceEntity,
  targetEntity,
  nowMs = null,
) {
  if (!scene || !sourceEntity || !targetEntity) {
    return getEntitySurfaceDistance(sourceEntity, targetEntity);
  }

  const sceneBaseSimTimeMs = Math.max(
    0,
    toFiniteNumber(scene.simTimeMs, 0),
  );
  const commandSimTimeMs = Math.max(
    sceneBaseSimTimeMs,
    toFiniteNumber(
      nowMs,
      typeof scene.getCurrentSimTimeMs === "function"
        ? scene.getCurrentSimTimeMs()
        : sceneBaseSimTimeMs,
    ),
  );
  const projectionDeltaMs = Math.max(0, commandSimTimeMs - sceneBaseSimTimeMs);
  if (projectionDeltaMs <= 0.000001) {
    return getEntitySurfaceDistance(sourceEntity, targetEntity);
  }

  const projectedByID = new Map();
  const maxProjectionDepth = 3;
  const projectEntity = (entity, depth = 0) => {
    if (!entity || typeof entity !== "object") {
      return entity;
    }

    const entityID = toInt(entity.itemID, 0);
    if (entityID > 0 && projectedByID.has(entityID)) {
      return projectedByID.get(entityID);
    }
    if (depth > maxProjectionDepth) {
      return entity;
    }

    const projectedEntity = cloneDynamicEntityForDestinyPresentation(entity);
    if (entityID > 0) {
      projectedByID.set(entityID, projectedEntity);
    }

    advanceMovement(
      projectedEntity,
      {
        getEntityByID(targetEntityID) {
          const liveEntity =
            scene && typeof scene.getEntityByID === "function"
              ? scene.getEntityByID(targetEntityID)
              : null;
          return projectEntity(liveEntity, depth + 1);
        },
      },
      projectionDeltaMs / 1000,
      commandSimTimeMs,
    );

    return projectedEntity;
  };

  return getEntitySurfaceDistance(
    projectEntity(sourceEntity),
    projectEntity(targetEntity),
  );
}

function clampTargetLockDurationMs(value) {
  const numericValue = toFiniteNumber(value, TARGETING_CLIENT_FALLBACK_LOCK_MS);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return TARGETING_CLIENT_FALLBACK_LOCK_MS;
  }

  return Math.min(Math.max(numericValue, 1), TARGETING_MAX_LOCK_MS);
}

function computeTargetLockDurationMs(sourceEntity, targetEntity) {
  const scanResolution = Math.max(
    toFiniteNumber(sourceEntity && sourceEntity.scanResolution, 0),
    0,
  );
  const signatureRadius = Math.max(getEntityLockSignatureRadius(targetEntity), 1);
  if (scanResolution <= 0) {
    return TARGETING_CLIENT_FALLBACK_LOCK_MS;
  }

  const logTerm = Math.log(
    signatureRadius + Math.sqrt(signatureRadius * signatureRadius + 1),
  );
  if (!Number.isFinite(logTerm) || logTerm <= 0) {
    return TARGETING_CLIENT_FALLBACK_LOCK_MS;
  }

  return clampTargetLockDurationMs(
    (40000000.0 / scanResolution) / (logTerm ** 2),
  );
}

function buildEntityTargetingAttributeSnapshot(entity) {
  return {
    maxTargetRange: roundNumber(toFiniteNumber(entity && entity.maxTargetRange, 0), 6),
    maxLockedTargets: roundNumber(toFiniteNumber(entity && entity.maxLockedTargets, 0), 6),
    signatureRadius: roundNumber(toFiniteNumber(entity && entity.signatureRadius, 0), 6),
    cloakingTargetingDelay: roundNumber(
      toFiniteNumber(entity && entity.cloakingTargetingDelay, 0),
      6,
    ),
    scanResolution: roundNumber(toFiniteNumber(entity && entity.scanResolution, 0), 6),
  };
}

function getEntityCapacitorRatio(entity) {
  return clamp(toFiniteNumber(entity && entity.capacitorChargeRatio, 1), 0, 1);
}

function setEntityCapacitorRatio(entity, nextRatio) {
  if (!entity) {
    return 0;
  }
  entity.capacitorChargeRatio = clamp(toFiniteNumber(nextRatio, 0), 0, 1);
  if (entity.kind === "ship") {
    entity.conditionState = normalizeShipConditionState({
      ...(entity.conditionState || {}),
      charge: entity.capacitorChargeRatio,
    });
  }
  return entity.capacitorChargeRatio;
}

function getEntityCapacitorAmount(entity) {
  return (
    toFiniteNumber(entity && entity.capacitorCapacity, 0) *
    getEntityCapacitorRatio(entity)
  );
}

function persistEntityCapacitorRatio(entity) {
  if (!entity || entity.kind !== "ship" || entity.persistSpaceState !== true) {
    return false;
  }

  const nextRatio = getEntityCapacitorRatio(entity);
  const result = updateShipItem(entity.itemID, (currentItem) => ({
    ...currentItem,
    conditionState: {
      ...(currentItem.conditionState || {}),
      charge: nextRatio,
    },
  }));
  return Boolean(result && result.success);
}

function consumeEntityCapacitor(entity, amount) {
  const requestedAmount = Math.max(0, toFiniteNumber(amount, 0));
  const capacitorCapacity = Math.max(
    toFiniteNumber(entity && entity.capacitorCapacity, 0),
    0,
  );
  if (!entity || capacitorCapacity <= 0) {
    return requestedAmount <= 0;
  }

  const currentAmount = getEntityCapacitorAmount(entity);
  if (requestedAmount > currentAmount + 1e-6) {
    return false;
  }

  setEntityCapacitorRatio(entity, (currentAmount - requestedAmount) / capacitorCapacity);
  persistEntityCapacitorRatio(entity);
  return true;
}

function repairEntityModulesOnTetherEngage(entity) {
  if (!entity || entity.kind !== "ship") {
    return [];
  }

  const repairedModuleIDs = [];
  for (const moduleItem of getFittedModuleItems(entity.itemID)) {
    const moduleState =
      moduleItem && moduleItem.moduleState && typeof moduleItem.moduleState === "object"
        ? moduleItem.moduleState
        : null;
    if (!moduleState) {
      continue;
    }
    const needsRepair =
      toFiniteNumber(moduleState.damage, 0) > 0 ||
      toFiniteNumber(moduleState.armorDamage, 0) > 0 ||
      toFiniteNumber(moduleState.shieldCharge, 1) < 1 ||
      moduleState.incapacitated === true;
    if (!needsRepair) {
      continue;
    }

    const updateResult = updateInventoryItem(moduleItem.itemID, (currentItem) => ({
      ...currentItem,
      moduleState: {
        ...(currentItem.moduleState || {}),
        damage: 0,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    }));
    if (updateResult && updateResult.success) {
      repairedModuleIDs.push(moduleItem.itemID);
    }
  }

  return repairedModuleIDs;
}

function repairEntityOnTetherEngage(scene, entity, nowMs = null) {
  if (!scene || !entity || entity.kind !== "ship") {
    return {
      repairedShip: false,
      repairedModules: [],
      rechargedCapacitor: false,
    };
  }

  const whenMs = Math.max(0, toFiniteNumber(nowMs, scene.getCurrentSimTimeMs()));
  const previousConditionState = normalizeShipConditionState(entity.conditionState);
  const previousCapacitorAmount = getEntityCapacitorAmount(entity);
  const nextConditionState = normalizeShipConditionState({
    ...previousConditionState,
    damage: 0,
    armorDamage: 0,
    shieldCharge: 1,
    charge: 1,
    incapacitated: false,
  });
  const repairedShip =
    nextConditionState.damage !== previousConditionState.damage ||
    nextConditionState.armorDamage !== previousConditionState.armorDamage ||
    nextConditionState.shieldCharge !== previousConditionState.shieldCharge;
  entity.conditionState = nextConditionState;
  setEntityCapacitorRatio(entity, 1);
  persistEntityCapacitorRatio(entity);
  const rechargedCapacitor = getEntityCapacitorAmount(entity) > previousCapacitorAmount + 1e-6;
  const repairedModules = repairEntityModulesOnTetherEngage(entity);

  if (repairedShip || rechargedCapacitor || repairedModules.length > 0) {
    persistDynamicEntity(entity);
  }
  if (repairedShip) {
    if (entity.session) {
      notifyShipHealthAttributesToSession(
        entity.session,
        entity,
        {
          success: true,
          data: {
            beforeConditionState: previousConditionState,
            afterConditionState: {
              ...entity.conditionState,
            },
          },
        },
        whenMs,
      );
    }
    broadcastDamageStateChange(scene, entity, whenMs);
  }
  if (rechargedCapacitor && entity.session) {
    notifyCapacitorChangeToSession(
      entity.session,
      entity,
      whenMs,
      previousCapacitorAmount,
    );
  }

  return {
    repairedShip,
    repairedModules,
    rechargedCapacitor,
  };
}

function breakEntityStructureTether(scene, entity, options = {}) {
  if (!scene || !structureTethering.isEntityStructureTethered(entity)) {
    return false;
  }

  const structureID = toInt(entity.structureTether && entity.structureTether.structureID, 0);
  const cleared = structureTethering.clearEntityStructureTether(
    entity,
    options.nowMs || scene.getCurrentSimTimeMs(),
    options.reason || null,
  );
  if (!cleared) {
    return false;
  }

  broadcastStructureTetherFx(scene, entity, structureID, false, {
    useCurrentVisibleStamp: true,
  });
  return true;
}

function breakStructureTethersForStructure(scene, structureID, options = {}) {
  if (!scene) {
    return 0;
  }

  const targetStructureID = toInt(structureID, 0);
  if (targetStructureID <= 0) {
    return 0;
  }

  let brokenCount = 0;
  for (const entity of scene.dynamicEntities.values()) {
    if (
      !structureTethering.isEntityStructureTethered(entity) ||
      toInt(entity.structureTether && entity.structureTether.structureID, 0) !== targetStructureID
    ) {
      continue;
    }
    if (breakEntityStructureTether(scene, entity, options)) {
      brokenCount += 1;
    }
  }
  return brokenCount;
}

function resolveSceneStructureTetherCandidate(scene, entity, nowMs) {
  return structureTethering.resolveEligibleTetherStructure(
    scene,
    entity,
    nowMs,
    {
      getLockedTargetCount(targetEntity) {
        return ensureEntityTargetingState(targetEntity).lockedTargets.size;
      },
      getPendingTargetLockCount(targetEntity) {
        return ensureEntityTargetingState(targetEntity).pendingTargetLocks.size;
      },
      getTargetedByCount(targetEntity) {
        return ensureEntityTargetingState(targetEntity).targetedBy.size;
      },
      getSurfaceDistance: getEntitySurfaceDistance,
    },
  );
}

function resolveStructureTetherFxEntity(scene, structureOrID) {
  if (structureOrID && typeof structureOrID === "object") {
    return structureOrID;
  }
  return scene && typeof scene.getEntityByID === "function"
    ? scene.getEntityByID(toInt(structureOrID, 0))
    : null;
}

function getStructureTetherFxTargetID(structureOrID) {
  return toInt(
    structureOrID && typeof structureOrID === "object"
      ? structureOrID.itemID || structureOrID.structureID
      : structureOrID,
    0,
  );
}

function buildStructureTetherGraphicInfo(structureOrID, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "graphicInfo")) {
    return options.graphicInfo;
  }

  const structureRadius = toFiniteNumber(
    options.targetRadius,
    toFiniteNumber(structureOrID && structureOrID.radius, 0),
  );
  const tetherRange = toFiniteNumber(
    options.tetheringRange,
    toFiniteNumber(structureOrID && structureOrID.tetheringRange, 0),
  );
  const linkBarrier = toFiniteNumber(
    options.linkBarrier,
    structureRadius + tetherRange,
  );
  const entries = [];
  if (structureRadius > 0) {
    entries.push(["targetRadius", structureRadius]);
  }
  if (linkBarrier > 0) {
    entries.push(["linkBarrier", linkBarrier]);
  }
  return destiny.buildGraphicInfoDict(entries);
}

function buildStructureTetherFxOptions(structureOrID, active, options = {}) {
  const fxOptions = { ...options };
  delete fxOptions.targetRadius;
  delete fxOptions.tetheringRange;
  delete fxOptions.linkBarrier;
  delete fxOptions.graphicInfo;

  return {
    targetID: getStructureTetherFxTargetID(structureOrID) || null,
    start: active === true,
    active: active === true,
    duration: active === true ? structureTethering.TETHER_LINK_DURATION_MS : -1,
    graphicInfo: buildStructureTetherGraphicInfo(structureOrID, options),
    ...fxOptions,
  };
}

function buildStructureTetherRepairFxOptions(active, options = {}) {
  const fxOptions = { ...options };
  delete fxOptions.targetID;
  delete fxOptions.graphicInfo;
  delete fxOptions.repairEffectMode;
  delete fxOptions.tetherRepairEffectMode;

  return {
    targetID: null,
    start: active === true,
    active: active === true,
    duration:
      active === true ? structureTethering.TETHER_REPAIR_DURATION_MS : -1,
    repeat: active === true ? structureTethering.TETHER_REPAIR_REPEAT : null,
    graphicInfo: destiny.buildGraphicInfoDict([]),
    ...fxOptions,
  };
}

function getStructureTetherRepairFxGuids(structureOrID, options = {}) {
  const mode =
    options.repairEffectMode ||
    options.tetherRepairEffectMode ||
    (
      structureOrID &&
      typeof structureOrID === "object" &&
      (
        structureOrID.tetherRepairEffectMode ||
        structureOrID.tetherRepairEffect ||
        structureOrID.repairEffectMode
      )
    ) ||
    structureTethering.TETHER_REPAIR_EFFECT_MODE.GENERIC;
  return structureTethering.getTetherRepairFxGuids(mode);
}

function broadcastStructureTetherFx(
  scene,
  entity,
  structureOrID,
  active,
  options = {},
) {
  if (!scene || !entity) {
    return {
      deliveredCount: 0,
      stamp: null,
    };
  }

  const structureEntity =
    resolveStructureTetherFxEntity(scene, structureOrID) || structureOrID;
  const repairResults = getStructureTetherRepairFxGuids(
    structureEntity,
    options,
  ).map((repairGuid) =>
    scene.broadcastSpecialFx(
      entity.itemID,
      repairGuid,
      buildStructureTetherRepairFxOptions(active, options),
      entity,
    ),
  );
  const linkResult = scene.broadcastSpecialFx(
    entity.itemID,
    structureTethering.TETHER_FX_GUID,
    buildStructureTetherFxOptions(structureEntity, active, options),
    entity,
  );

  return {
    deliveredCount:
      repairResults.reduce(
        (total, result) =>
          total + toInt(result && result.deliveredCount, 0),
        0,
      ) + toInt(linkResult && linkResult.deliveredCount, 0),
    stamp:
      (linkResult && linkResult.stamp) ||
      (repairResults.find((result) => result && result.stamp) || {}).stamp ||
      null,
  };
}

function sendStructureTetherFxToSession(
  scene,
  session,
  entity,
  structureOrID,
  active,
  options = {},
) {
  if (!scene || !session || !entity) {
    return {
      delivered: false,
      stamp: null,
    };
  }

  const structureEntity =
    resolveStructureTetherFxEntity(scene, structureOrID) || structureOrID;
  const repairResults = getStructureTetherRepairFxGuids(
    structureEntity,
    options,
  ).map((repairGuid) =>
    scene.sendSpecialFxToSession(
      session,
      entity.itemID,
      repairGuid,
      buildStructureTetherRepairFxOptions(active, options),
      entity,
    ),
  );
  const linkResult = scene.sendSpecialFxToSession(
    session,
    entity.itemID,
    structureTethering.TETHER_FX_GUID,
    buildStructureTetherFxOptions(structureEntity, active, options),
    entity,
  );

  return {
    delivered:
      repairResults.some((result) => result && result.delivered) ||
      Boolean(linkResult && linkResult.delivered),
    stamp:
      (linkResult && linkResult.stamp) ||
      (repairResults.find((result) => result && result.stamp) || {}).stamp ||
      null,
  };
}

function syncEntityStructureTetherState(scene, entity, options = {}) {
  if (!scene || !entity || entity.kind !== "ship" || !entity.session) {
    return {
      active: false,
      changed: false,
      fxReplayed: false,
      repaired: null,
      structureID: 0,
      reason: "ENTITY_NOT_ELIGIBLE",
    };
  }

  const now = Math.max(
    0,
    toFiniteNumber(
      options.nowMs,
      scene.getCurrentSimTimeMs(),
    ),
  );
  const candidate = resolveSceneStructureTetherCandidate(scene, entity, now);
  const currentTetherStructureID = toInt(
    entity.structureTether && entity.structureTether.structureID,
    0,
  );
  let changed = false;
  let fxReplayed = false;
  let repaired = null;

  if (
    structureTethering.isEntityStructureTethered(entity) &&
    (
      !candidate.eligible ||
      toInt(candidate.structure && candidate.structure.itemID, 0) !== currentTetherStructureID
    )
  ) {
    changed = breakEntityStructureTether(scene, entity, {
      nowMs: now,
      reason: candidate.reason || "TETHER_INVALID",
    }) || changed;
  }

  if (
    !structureTethering.isEntityStructureTethered(entity) &&
    candidate.eligible &&
    candidate.structure
  ) {
    structureTethering.startEntityStructureTether(entity, candidate.structure, now);
    changed = true;
    if (options.repairOnEngage !== false) {
      repaired = repairEntityOnTetherEngage(scene, entity, now);
    }
    if (options.broadcastFx !== false) {
      broadcastStructureTetherFx(scene, entity, candidate.structure, true, {
        useCurrentVisibleStamp: true,
      });
    }
  }

  if (
    options.replaySession &&
    structureTethering.isEntityStructureTethered(entity) &&
    (
      options.forceReplayFx === true ||
      changed
    )
  ) {
    const replayStructureID = toInt(
      entity.structureTether && entity.structureTether.structureID,
      toInt(candidate.structure && candidate.structure.itemID, 0),
    );
    const replayStructure =
      resolveStructureTetherFxEntity(scene, replayStructureID) ||
      candidate.structure ||
      replayStructureID;
    const replayResult = sendStructureTetherFxToSession(
      scene,
      options.replaySession,
      entity,
      replayStructure,
      true,
      {
        useCurrentVisibleStamp: true,
      },
    );
    fxReplayed = replayResult.delivered === true;
  }

  return {
    active: structureTethering.isEntityStructureTethered(entity),
    changed,
    fxReplayed,
    repaired,
    structureID: toInt(entity.structureTether && entity.structureTether.structureID, 0),
    reason: candidate.reason || null,
  };
}

function tickSceneStructureTethers(scene, nowMs = null) {
  if (!scene) {
    return [];
  }

  const now = Math.max(0, toFiniteNumber(nowMs, scene.getCurrentSimTimeMs()));
  const structureTetherRestrictionState = require(path.join(
    __dirname,
    "../services/structure/structureTetherRestrictionState",
  ));
  structureTetherRestrictionState.pruneExpiredCharacterTetherRestrictions(now);
  const tethered = [];
  for (const entity of scene.dynamicEntities.values()) {
    if (!entity || entity.kind !== "ship" || !entity.session) {
      continue;
    }
    const tetherResult = syncEntityStructureTetherState(scene, entity, {
      nowMs: now,
      broadcastFx: true,
      repairOnEngage: true,
    });
    if (tetherResult.active) {
      tethered.push(entity.itemID);
    }
  }

  return tethered;
}

function hasActivePropulsionEffect(entity, effectName, excludeModuleID = 0) {
  if (!entity || !(entity.activeModuleEffects instanceof Map)) {
    return false;
  }

  for (const effectState of entity.activeModuleEffects.values()) {
    if (!effectState || effectState.effectName !== effectName) {
      continue;
    }
    if (
      excludeModuleID > 0 &&
      toInt(effectState.moduleID, 0) === toInt(excludeModuleID, 0)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function applyPropulsionEffectStateToEntity(entity, effectState) {
  if (!entity || !effectState) {
    return entity;
  }

  const passiveState = entity.passiveDerivedState || null;
  const passiveMass =
    toFiniteNumber(passiveState && passiveState.mass, toFiniteNumber(entity.mass, 0));
  const passiveMaxVelocity =
    toFiniteNumber(
      passiveState && passiveState.maxVelocity,
      toFiniteNumber(entity.maxVelocity, 0),
    );
  const passiveSignatureRadius =
    toFiniteNumber(
      passiveState && passiveState.signatureRadius,
      toFiniteNumber(entity.signatureRadius, 0),
    );
  const massAfterAddition = passiveMass + toFiniteNumber(effectState.massAddition, 0);
  const speedMultiplier =
    1 +
    (0.01 *
      toFiniteNumber(effectState.speedFactor, 0) *
      toFiniteNumber(effectState.speedBoostFactor, 0) /
      Math.max(massAfterAddition, 1));

  entity.mass = roundNumber(massAfterAddition, 6);
  entity.maxVelocity = roundNumber(
    passiveMaxVelocity * Math.max(speedMultiplier, 0),
    6,
  );
  if (effectState.effectName === PROPULSION_EFFECT_MICROWARPDRIVE) {
    entity.signatureRadius = roundNumber(
      passiveSignatureRadius *
        (1 + (toFiniteNumber(effectState.signatureRadiusBonus, 0) / 100)),
      6,
    );
  }
  entity.alignTime = calculateAlignTimeSecondsFromMassInertia(
    entity.mass,
    entity.inertia,
    entity.alignTime,
  );
  entity.agilitySeconds = deriveAgilitySeconds(
    entity.alignTime,
    entity.maxAccelerationTime,
    entity.mass,
    entity.inertia,
  );
  return entity;
}

function getPropulsionEffectID(effectName) {
  if (effectName === PROPULSION_EFFECT_AFTERBURNER) {
    return EFFECT_ID_AFTERBURNER;
  }
  if (effectName === PROPULSION_EFFECT_MICROWARPDRIVE) {
    return EFFECT_ID_MICROWARPDRIVE;
  }
  return 0;
}

function resolveSessionNotificationFileTime(session, whenMs = null) {
  const scene =
    runtimeExports &&
    typeof runtimeExports.getSceneForSession === "function"
      ? runtimeExports.getSceneForSession(session)
      : null;
  if (whenMs != null) {
    if (scene) {
      return scene.getCurrentSessionFileTime(session, whenMs);
    }
    return toFileTimeFromMs(whenMs);
  }
  if (scene) {
    return scene.getCurrentSessionFileTime(session);
  }
  if (session && session._space && session._space.simFileTime) {
    return session._space.simFileTime;
  }
  return currentFileTime();
}

function resolveVisibleSessionNotificationFileTime(session, whenMs = null) {
  const scene =
    runtimeExports &&
    typeof runtimeExports.getSceneForSession === "function"
      ? runtimeExports.getSceneForSession(session)
      : null;
  if (scene) {
    if (whenMs != null) {
      return scene.getCurrentClampedSessionFileTime(session, whenMs);
    }
    return scene.getCurrentClampedSessionFileTime(session);
  }
  return resolveSessionNotificationFileTime(session, whenMs);
}

function hasAssistanceJamState(effectState) {
  return Boolean(
    effectState &&
      effectState.assistanceModuleEffect === true &&
      typeof effectState.assistanceJammingType === "string" &&
      effectState.assistanceJammingType.trim() !== "" &&
      toInt(effectState.targetID, 0) > 0,
  );
}

function resolveAssistanceJamDurationMs(effectState, nowMs = null) {
  const fallbackDurationMs =
    Math.max(1, toInt(effectState && effectState.durationMs, 1000)) +
    ASSISTANCE_JAM_REFRESH_GRACE_MS;
  if (nowMs === null || nowMs === undefined) {
    return fallbackDurationMs;
  }

  const remainingCycleMs = Math.max(
    1,
    toInt(effectState && effectState.nextCycleAtMs, 0) - toInt(nowMs, 0),
  );
  return remainingCycleMs + ASSISTANCE_JAM_REFRESH_GRACE_MS;
}

function buildAssistanceHudState(targetEntity, sourceEntity, effectState, nowMs) {
  return hudIconRuntime.buildAssistanceHudIconState(
    targetEntity,
    sourceEntity,
    effectState,
    nowMs,
  );
}

function hasHostileJamState(effectState) {
  return Boolean(
    effectState &&
      effectState.hostileModuleEffect === true &&
      typeof effectState.hostileJammingType === "string" &&
      effectState.hostileJammingType.trim() !== "" &&
      toInt(effectState.targetID, 0) > 0,
  );
}

function resolveHostileJamDurationMs(effectState, nowMs = null) {
  const fallbackDurationMs =
    Math.max(1, toInt(effectState && effectState.durationMs, 1000)) +
    HOSTILE_JAM_REFRESH_GRACE_MS;
  if (nowMs === null || nowMs === undefined) {
    return fallbackDurationMs;
  }

  const remainingCycleMs = Math.max(
    1,
    toInt(effectState && effectState.nextCycleAtMs, 0) - toInt(nowMs, 0),
  );
  return remainingCycleMs + HOSTILE_JAM_REFRESH_GRACE_MS;
}

function resolveHostileJamRefreshDurationMs(effectState) {
  return (
    Math.max(1, toInt(effectState && effectState.durationMs, 1000)) +
    HOSTILE_JAM_REFRESH_GRACE_MS
  );
}

function buildHostileHudState(targetEntity, sourceEntity, effectState, nowMs) {
  return hudIconRuntime.buildHostileHudIconState(
    targetEntity,
    sourceEntity,
    effectState,
    nowMs,
  );
}

function hasJammerHudState(effectState) {
  return Boolean(
    effectState &&
      effectState.jammerModuleEffect === true &&
      typeof effectState.hostileJammingType === "string" &&
      effectState.hostileJammingType.trim() !== "" &&
      toInt(effectState.targetID, 0) > 0,
  );
}

function resolveJammerJamDurationMs(effectState, nowMs = null) {
  const explicitJamDurationMs = Math.max(
    0,
    toInt(effectState && effectState.jamDurationMs, 0),
  );
  const fallbackDurationMs = Math.max(
    1,
    explicitJamDurationMs || toInt(effectState && effectState.durationMs, 1000),
  );
  if (nowMs === null || nowMs === undefined) {
    return fallbackDurationMs;
  }

  if (explicitJamDurationMs > 0) {
    return explicitJamDurationMs;
  }

  return Math.max(
    1,
    toInt(effectState && effectState.nextCycleAtMs, 0) - toInt(nowMs, 0),
  );
}

function buildJammerHudState(targetEntity, sourceEntity, effectState, nowMs) {
  return hudIconRuntime.buildJammerHudIconState(
    targetEntity,
    sourceEntity,
    effectState,
    nowMs,
  );
}

function applyJammerCyclePresentation(
  scene,
  sourceEntity,
  effectState,
  nowMs,
  cycleResult,
) {
  if (!scene || !sourceEntity || !effectState || !cycleResult || !cycleResult.data) {
    return {
      targetEntity: null,
      targetSession: null,
      jamApplied: false,
      previousJamApplied: false,
    };
  }

  const targetEntity =
    cycleResult.data.targetEntity
      ? cycleResult.data.targetEntity
      : scene.getEntityByID(toInt(effectState.targetID, 0));
  const targetSession =
    targetEntity && targetEntity.session
      ? targetEntity.session
      : null;
  const previousJamApplied = Boolean(cycleResult.data.previousJamApplied === true);
  const jamApplied = Boolean(cycleResult.data.jamApplied === true);
  const hudSyncResult =
    targetEntity && jamApplied
      ? hudIconRuntime.upsertHudIconState(
        targetEntity,
        buildJammerHudState(targetEntity, sourceEntity, effectState, nowMs),
      )
      : { state: null };

  if (targetSession && isReadyForDestiny(targetSession)) {
    if (jamApplied && hudSyncResult.state) {
      notifyHostileHudStateToSession(targetSession, hudSyncResult.state, true, {
        startTimeMs: nowMs,
        durationMs: resolveJammerJamDurationMs(effectState, nowMs),
        refreshTimerOnly: previousJamApplied,
      });
    } else if (previousJamApplied && hasJammerHudState(effectState) && targetEntity) {
      notifyHostileHudStateToSession(
        targetSession,
        buildJammerHudState(targetEntity, sourceEntity, effectState, nowMs),
        false,
        {
          startTimeMs: nowMs,
        },
      );
    }
  }

  return {
    targetEntity,
    targetSession,
    jamApplied,
    previousJamApplied,
  };
}

function removeJammerCyclePresentation(
  scene,
  sourceEntity,
  effectState,
  nowMs,
) {
  if (!scene || !sourceEntity || !effectState) {
    return {
      targetEntity: null,
      targetSession: null,
      removedHudState: null,
      removalResult: null,
    };
  }

  const targetEntity = scene.getEntityByID(toInt(effectState.targetID, 0));
  const targetSession = targetEntity && targetEntity.session ? targetEntity.session : null;
  const removalResult = jammerModuleRuntime.removeJammerModuleState({
    targetEntity,
    sourceEntity,
    effectState,
    nowMs,
  });
  const removedHudState = targetEntity
    ? hudIconRuntime.removeHudIconState(
      targetEntity,
      buildJammerHudState(targetEntity, sourceEntity, effectState, nowMs),
    )
    : null;
  if (targetSession && isReadyForDestiny(targetSession) && removedHudState) {
    notifyHostileHudStateToSession(targetSession, removedHudState, false, {
      startTimeMs: nowMs,
    });
  }
  return {
    targetEntity,
    targetSession,
    removedHudState,
    removalResult,
  };
}

function resolveHudStateDurationMs(hudState, nowMs = null) {
  const resolvedNowMs =
    nowMs === null || nowMs === undefined
      ? Date.now()
      : toFiniteNumber(nowMs, Date.now());
  return Math.max(
    1,
    toInt(
      toFiniteNumber(hudState && hudState.expiresAtMs, 0) - resolvedNowMs,
      1,
    ),
  );
}

function notifyRefreshBuffBarToSession(session) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    (session.socket && session.socket.destroyed)
  ) {
    return false;
  }

  session.sendNotification("OnRefreshBuffBar", "clientID", []);
  return true;
}

function notifyHudJamStateToSession(
  session,
  hudState,
  active,
  options = {},
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !hudState ||
    (session.socket && session.socket.destroyed)
  ) {
    return false;
  }

  const sourceBallID = toInt(hudState.sourceBallID, 0);
  const moduleID = toInt(hudState.moduleID, 0);
  const targetBallID = toInt(hudState.targetBallID, 0);
  const jammingType = String(hudState.jammingType || "").trim();
  if (sourceBallID <= 0 || moduleID <= 0 || targetBallID <= 0 || jammingType === "") {
    return false;
  }

  if (active === true) {
    const startTimeMs =
      options.startTimeMs === undefined || options.startTimeMs === null
        ? toFiniteNumber(hudState.startedAtMs, Date.now())
        : toFiniteNumber(options.startTimeMs, Date.now());
    session.sendNotification("OnJamStart", "clientID", [
      sourceBallID,
      moduleID,
      targetBallID,
      jammingType,
      resolveVisibleSessionNotificationFileTime(session, startTimeMs),
      Math.max(
        1,
        toInt(
          options.durationMs,
          resolveHudStateDurationMs(hudState, startTimeMs),
        ),
      ),
    ]);
    return true;
  }

  session.sendNotification("OnJamEnd", "clientID", [
    sourceBallID,
    moduleID,
    targetBallID,
    jammingType,
  ]);
  return true;
}

function notifyHudEwarStateToSession(session, hudState, active) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !hudState ||
    (session.socket && session.socket.destroyed)
  ) {
    return false;
  }

  if (
    !hudState.deliveryProfile ||
    hudState.deliveryProfile.usesTacticalEwar !== true
  ) {
    return false;
  }

  const sourceBallID = toInt(hudState.sourceBallID, 0);
  const moduleID = toInt(hudState.moduleID, 0);
  const targetBallID = toInt(hudState.targetBallID, 0);
  const jammingType = String(hudState.jammingType || "").trim();
  if (sourceBallID <= 0 || moduleID <= 0 || targetBallID <= 0 || jammingType === "") {
    return false;
  }

  session.sendNotification(active === true ? "OnEwarStart" : "OnEwarEnd", "clientID", [
    sourceBallID,
    moduleID,
    targetBallID,
    jammingType,
  ]);
  return true;
}

function notifyHudIconStateToSession(
  session,
  hudState,
  active,
  options = {},
) {
  if (!hudState) {
    return false;
  }

  let delivered = false;
  if (hudState.deliveryProfile && hudState.deliveryProfile.usesJamTimer === true) {
    delivered = notifyHudJamStateToSession(session, hudState, active, options) || delivered;
  }
  if (
    hudState.deliveryProfile &&
    hudState.deliveryProfile.usesTacticalEwar === true &&
    options.refreshTimerOnly !== true
  ) {
    delivered = notifyHudEwarStateToSession(session, hudState, active) || delivered;
  }
  if (delivered && options.refreshBuffBar !== false) {
    notifyRefreshBuffBarToSession(session);
  }
  return delivered;
}

function notifyHudIconStatesToSession(
  scene,
  session,
  egoEntity,
  options = {},
) {
  if (!scene || !session || !egoEntity || !isReadyForDestiny(session)) {
    return 0;
  }

  const deliveryTimeMs =
    options.nowMs === null || options.nowMs === undefined
      ? scene.getCurrentSimTimeMs()
      : toFiniteNumber(options.nowMs, scene.getCurrentSimTimeMs());
  const kind = options.kind ? String(options.kind) : null;
  let delivered = 0;
  for (const hudState of hudIconRuntime.listActiveHudIconStates(
    egoEntity,
    deliveryTimeMs,
    kind ? { kind } : {},
  )) {
    if (notifyHudIconStateToSession(session, hudState, true, {
      startTimeMs: deliveryTimeMs,
      durationMs: resolveHudStateDurationMs(hudState, deliveryTimeMs),
    })) {
      delivered += 1;
    }
  }
  return delivered;
}

function notifyAssistanceHudStateToSession(
  session,
  hudState,
  active,
  options = {},
) {
  return notifyHudIconStateToSession(session, hudState, active, {
    ...options,
    refreshBuffBar:
      options.refreshBuffBar === undefined ? false : options.refreshBuffBar,
  });
}

function notifyHostileHudStateToSession(
  session,
  hudState,
  active,
  options = {},
) {
  return notifyHudIconStateToSession(session, hudState, active, {
    ...options,
    refreshBuffBar:
      options.refreshBuffBar === undefined ? false : options.refreshBuffBar,
  });
}

function notifyActiveAssistanceJamStatesToSession(
  scene,
  session,
  egoEntity,
  _visibleEntities = [],
  nowMs = null,
) {
  return notifyHudIconStatesToSession(scene, session, egoEntity, {
    nowMs,
    kind: hudIconRuntime.HUD_ICON_KIND_ASSISTANCE,
  });
}

function notifyActiveHostileJamStatesToSession(
  scene,
  session,
  egoEntity,
  _visibleEntities = [],
  nowMs = null,
) {
  return notifyHudIconStatesToSession(scene, session, egoEntity, {
    nowMs,
    kind: hudIconRuntime.HUD_ICON_KIND_HOSTILE,
  });
}

function tickHudIconStateExpiries(scene, nowMs) {
  if (!scene || !(scene.sessions instanceof Map) || scene.sessions.size <= 0) {
    return 0;
  }

  let delivered = 0;
  const resolvedNowMs = Math.max(0, toFiniteNumber(nowMs, Date.now()));
  for (const session of scene.sessions.values()) {
    if (!session || !isReadyForDestiny(session)) {
      continue;
    }
    const egoEntity = scene.getShipEntityForSession(session);
    if (!egoEntity) {
      continue;
    }
    const pruneResult = hudIconRuntime.pruneExpiredHudIconStates(
      egoEntity,
      resolvedNowMs,
    );
    for (const removedHudState of pruneResult.removed) {
      if (
        String(removedHudState && removedHudState.jammingType || "") ===
          jammerModuleRuntime.ECM_JAMMING_TYPE
      ) {
        jammerModuleRuntime.recomputeEntityJammedState(egoEntity, resolvedNowMs);
      }
      if (notifyHudIconStateToSession(session, removedHudState, false, {
        startTimeMs: resolvedNowMs,
      })) {
        delivered += 1;
      }
    }
  }
  return delivered;
}

function buildCommandBurstDbuffStateSignature(entries = []) {
  return JSON.stringify(
    (Array.isArray(entries) ? entries : []).map((entry) => {
      const collectionID = toInt(Array.isArray(entry) ? entry[0] : 0, 0);
      const stateEntry = Array.isArray(entry) ? entry[1] : null;
      const value = Array.isArray(stateEntry)
        ? roundNumber(stateEntry[0], 6)
        : null;
      const expiry =
        Array.isArray(stateEntry) && stateEntry.length > 1
          ? normalizeTraceValue(stateEntry[1])
          : null;
      return [collectionID, value, expiry];
    }),
  );
}

function clearCommandBurstHudRefreshSignature(session) {
  if (!session || !session._space) {
    return false;
  }
  delete session._space.lastCommandBurstHudDbuffSignature;
  delete session._space.lastCommandBurstHudDbuffRawDispatchStamp;
  return true;
}

function requestCommandBurstHudStateRefresh(
  scene,
  session,
  entity,
  whenMs = null,
  options = {},
) {
  if (!scene || !session || !entity || !isReadyForDestiny(session)) {
    return false;
  }

  const rawNowMs =
    whenMs === undefined || whenMs === null
      ? scene.getCurrentSimTimeMs()
      : toFiniteNumber(whenMs, scene.getCurrentSimTimeMs());
  const entries = buildCommandBurstDbuffStateEntriesForSession(
    session,
    entity,
    rawNowMs,
  );
  const signature = buildCommandBurstDbuffStateSignature(entries);
  const rawDispatchStamp =
    typeof scene.getCurrentDestinyStamp === "function"
      ? scene.getCurrentDestinyStamp(rawNowMs)
      : getCurrentDestinyStamp(rawNowMs);
  const stamp =
    typeof scene.getNextDestinyStamp === "function"
      ? scene.getNextDestinyStamp(rawNowMs)
      : getNextStamp(rawNowMs);

  if (session._space && options.force !== true) {
    const previousSignature =
      typeof session._space.lastCommandBurstHudDbuffSignature === "string"
        ? session._space.lastCommandBurstHudDbuffSignature
        : null;
    const previousRawDispatchStamp =
      toInt(session._space.lastCommandBurstHudDbuffRawDispatchStamp, 0) >>> 0;
    if (
      previousSignature === signature &&
      previousRawDispatchStamp === (rawDispatchStamp >>> 0)
    ) {
      return false;
    }
  }

  scene.sendDestinyUpdates(
    session,
    [{
      stamp,
      payload: destiny.buildOnDbuffUpdatedPayload(
        entity.itemID,
        entries,
      ),
    }],
    false,
    {
      destinyAuthorityContract: DESTINY_CONTRACTS.COMBAT_NONCRITICAL,
    },
  );
  if (session._space) {
    session._space.lastCommandBurstHudDbuffSignature = signature;
    session._space.lastCommandBurstHudDbuffRawDispatchStamp = rawDispatchStamp >>> 0;
  }
  return true;
}

function notifyCommandBurstHudStateToSession(
  scene,
  session,
  hudState,
  active,
  options = {},
) {
  void hudState;
  void active;
  return requestCommandBurstHudStateRefresh(
    scene,
    session,
    options.egoEntity || null,
    options.whenMs,
    options,
  );
}

function notifyActiveCommandBurstHudStatesToSession(
  scene,
  session,
  egoEntity,
  nowMs = null,
) {
  if (!scene || !session || !egoEntity || !isReadyForDestiny(session)) {
    return 0;
  }

  const activeHudStates = hudIconRuntime.listActiveHudIconStates(
    egoEntity,
    nowMs === undefined || nowMs === null
      ? scene.getCurrentSimTimeMs()
      : toFiniteNumber(nowMs, scene.getCurrentSimTimeMs()),
    { kind: hudIconRuntime.HUD_ICON_KIND_COMMAND_BURST },
  );
  if (activeHudStates.length <= 0) {
    clearCommandBurstHudRefreshSignature(session);
    return 0;
  }

  requestCommandBurstHudStateRefresh(
    scene,
    session,
    egoEntity,
    nowMs,
    {
      force: true,
      reason: "command-burst-bootstrap",
    },
  );
  return activeHudStates.length;
}

function buildCommandBurstDbuffStateEntriesForSession(
  session,
  entity,
  whenMs = null,
) {
  if (!session || !entity) {
    return [];
  }

  const nowMs =
    whenMs === undefined || whenMs === null
      ? session && session._space && Number.isFinite(Number(session._space.simTimeMs))
        ? Number(session._space.simTimeMs)
        : Date.now()
      : toFiniteNumber(
        whenMs,
        session && session._space && Number.isFinite(Number(session._space.simTimeMs))
          ? Number(session._space.simTimeMs)
          : Date.now(),
      );

  return commandBurstRuntime.buildClientDbuffStateEntries(entity, {
    nowMs,
    buildExpiry(expiryMs) {
      return buildFiletimeLong(resolveSessionNotificationFileTime(session, expiryMs));
    },
  });
}

function notifyCommandBurstDbuffStateToSession(
  scene,
  session,
  entity,
  whenMs = null,
  options = {},
) {
  return requestCommandBurstHudStateRefresh(
    scene,
    session,
    entity,
    whenMs,
    options,
  );
}

function queueCommandBurstReloadState(
  scene,
  session,
  entity,
  moduleItem,
  effectState,
  nowMs,
) {
  if (!scene || !entity || !moduleItem || !effectState) {
    return null;
  }

  const chargeTypeID = toInt(effectState.chargeTypeID, 0);
  if (chargeTypeID <= 0) {
    return null;
  }

  const reloadResult = queueAutomaticLocalModuleReload({
    entity,
    scene,
    session: session || entity.session || null,
    moduleItem,
    chargeTypeID,
    reloadTimeMs: Math.max(
      0,
      toFiniteNumber(effectState.commandBurstReloadTimeMs, 0),
    ),
    startedAtMs: Math.max(0, toFiniteNumber(nowMs, 0)),
    resumeMode: "start",
  });
  if (!reloadResult || reloadResult.success !== true || !reloadResult.data) {
    return null;
  }
  return reloadResult.data.reloadState || null;
}

function queueGenericModuleAutoReloadOnCycleEnd(
  scene,
  session,
  entity,
  moduleItem,
  effectState,
  nowMs,
) {
  const autoReloadState =
    effectState && effectState.autoReloadOnCycleEnd
      ? effectState.autoReloadOnCycleEnd
      : null;
  if (!autoReloadState || !moduleItem) {
    return null;
  }

  effectState.autoReloadOnCycleEnd = null;
  const chargeTypeID = toInt(autoReloadState.chargeTypeID, 0);
  if (chargeTypeID <= 0) {
    return null;
  }

  const reloadResult = queueAutomaticLocalModuleReload({
    scene,
    entity,
    session: session || (entity && entity.session) || null,
    moduleItem,
    chargeTypeID,
    reloadTimeMs: Math.max(
      0,
      Number(autoReloadState.reloadTimeMs) || 0,
    ),
    startedAtMs: Math.max(0, Number(nowMs) || 0),
    shipID: toInt(entity && entity.itemID, 0),
    ammoLocationID: toInt(
      autoReloadState.ammoLocationID,
      toInt(entity && entity.itemID, 0),
    ),
    resumeMode: "start",
  });

  return reloadResult.success && reloadResult.data
    ? reloadResult.data.reloadState || null
    : null;
}

function dispatchCommandBurstPulse(
  scene,
  sourceEntity,
  effectState,
  nowMs,
) {
  if (!scene || !sourceEntity || !effectState) {
    return {
      success: false,
      stopReason: "module",
      data: {
        recipients: [],
      },
    };
  }

  const recipients = commandBurstRuntime.resolveCommandBurstRecipients(
    scene,
    sourceEntity,
    effectState,
    nowMs,
  );
  const commandBurstGraphicInfo =
    Math.max(0, toFiniteNumber(effectState.commandBurstRangeMeters, 0)) > 0
      ? {
          // Retail command burst sphere FX are range-scaled; omitting this
          // falls back to ship-bounds sizing and produces the tiny center-glow
          // symptom instead of the large expanding sphere pulse.
          graphicRadius: Math.max(0, toFiniteNumber(effectState.commandBurstRangeMeters, 0)),
          radius: Math.max(0, toFiniteNumber(effectState.commandBurstRangeMeters, 0)),
        }
      : null;

  if (effectState.commandBurstSourceFxGuid) {
    scene.broadcastSpecialFx(
      sourceEntity.itemID,
      effectState.commandBurstSourceFxGuid,
      {
        moduleID: effectState.moduleID,
        moduleTypeID: effectState.typeID,
        chargeTypeID: effectState.chargeTypeID || null,
        start: true,
        active: false,
        // Let the client use the burst effect's authored duration. Forcing
        // `duration: 1` collapses the activation to ~1 ms and makes the pulse
        // effectively invisible even though the correct asset loads.
        useCurrentVisibleStamp: true,
        graphicInfo: commandBurstGraphicInfo,
      },
      sourceEntity,
    );
  }

  for (const recipient of recipients) {
    const applyResult = commandBurstRuntime.applyTimedCommandBurstToEntity(
      recipient,
      effectState.commandBurstDbuffValues,
      effectState.commandBurstBuffDurationMs,
      nowMs,
    );
    if (effectState.commandBurstTargetFxGuid) {
      scene.broadcastSpecialFx(
        recipient.itemID,
        effectState.commandBurstTargetFxGuid,
        {
          moduleID: effectState.moduleID,
          moduleTypeID: effectState.typeID,
          targetID: sourceEntity.itemID,
          chargeTypeID: effectState.chargeTypeID || null,
          start: true,
          active: false,
          // Same client-side pulse timing rule as the source burst sphere.
          useCurrentVisibleStamp: true,
        },
        recipient,
      );
    }

    if (applyResult.changed && recipient && recipient.kind === "ship") {
      scene.refreshShipEntityDerivedState(recipient, {
        session: recipient.session || null,
        broadcast: true,
        notifyTargeting: true,
      });
    }

    if (
      applyResult.changed &&
      recipient.session &&
      typeof recipient.session.sendNotification === "function"
    ) {
      notifyCommandBurstDbuffStateToSession(
        scene,
        recipient.session,
        recipient,
        nowMs,
        {
          reason: "command-burst-apply",
        },
      );
    }
  }

  return {
    success: true,
    data: {
      recipients,
    },
  };
}

function executeCommandBurstCycle(
  scene,
  session,
  entity,
  moduleItem,
  effectState,
  nowMs,
) {
  if (!scene || !entity || !moduleItem || !effectState) {
    return { success: false, stopReason: "module" };
  }

  const chargeItem = getEntityRuntimeLoadedCharge(entity, moduleItem);
  if (!chargeItem) {
    return { success: false, stopReason: "ammo" };
  }

  const consumeResult = consumeTurretAmmoCharge(
    entity,
    moduleItem,
    chargeItem,
    nowMs,
  );
  if (!consumeResult.success) {
    return {
      success: false,
      stopReason: consumeResult.stopReason || "ammo",
    };
  }

  const pulseResult = dispatchCommandBurstPulse(
    scene,
    entity,
    effectState,
    nowMs,
  );
  if (!pulseResult.success) {
    return pulseResult;
  }

  let reloadState = null;
  let stopReason = null;
  if (
    consumeResult.data &&
    consumeResult.data.depleted === true
  ) {
    reloadState = queueCommandBurstReloadState(
      scene,
      session,
      entity,
      moduleItem,
      effectState,
      nowMs,
    );
    if (!reloadState) {
      stopReason = "ammo";
    }
  }

  return {
    success: true,
    data: {
      recipients:
        pulseResult.data && Array.isArray(pulseResult.data.recipients)
          ? pulseResult.data.recipients
          : [],
      reloadState,
      stopReason,
    },
  };
}

function resolveModuleEffectChargeContext(session, entity, effectState) {
  const shipID = toInt(entity && entity.itemID, 0);
  const moduleFlagID = toInt(effectState && effectState.moduleFlagID, 0);
  let chargeTypeID = toInt(effectState && effectState.chargeTypeID, 0);

  if (
    chargeTypeID <= 0 &&
    shipID > 0 &&
    moduleFlagID > 0
  ) {
    const loadedCharge = getEntityRuntimeLoadedCharge(
      entity,
      null,
      moduleFlagID,
    );
    chargeTypeID = toInt(loadedCharge && loadedCharge.typeID, 0);
  }

  return {
    moduleFlagID,
    chargeTypeID,
    subLocation:
      shipID > 0 && moduleFlagID > 0 && chargeTypeID > 0
        ? buildChargeTupleItemID(shipID, moduleFlagID, chargeTypeID)
        : null,
  };
}

function buildModuleEffectEnvironment(session, entity, effectState, effectID) {
  const chargeContext = resolveModuleEffectChargeContext(
    session,
    entity,
    effectState,
  );
  return {
    environment: [
      toInt(effectState && effectState.moduleID, 0),
      toInt(entity && entity.ownerID, 0),
      toInt(entity && entity.itemID, 0),
      toInt(effectState && effectState.targetID, 0) > 0
        ? toInt(effectState && effectState.targetID, 0)
        : null,
      chargeContext.subLocation,
      [],
      effectID,
    ],
    chargeContext,
  };
}

function resolveGroupedTurretBankModuleIDs(entity, moduleID, expectedTypeID = 0) {
  const shipID = toInt(entity && entity.itemID, 0);
  const normalizedModuleID = toInt(moduleID, 0);
  if (shipID <= 0 || normalizedModuleID <= 0) {
    return [];
  }

  const resolvedModuleIDs = [];
  const seenModuleIDs = new Set();
  for (const rawModuleID of getGroupedWeaponBankModuleIDs(shipID, normalizedModuleID)) {
    const numericModuleID = toInt(rawModuleID, 0);
    if (numericModuleID <= 0 || seenModuleIDs.has(numericModuleID)) {
      continue;
    }
    const moduleItem = getEntityRuntimeModuleItem(entity, numericModuleID);
    if (!moduleItem) {
      continue;
    }
    if (
      expectedTypeID > 0 &&
      toInt(moduleItem.typeID, 0) !== expectedTypeID
    ) {
      continue;
    }
    seenModuleIDs.add(numericModuleID);
    resolvedModuleIDs.push(numericModuleID);
  }
  return resolvedModuleIDs;
}

function buildGroupedTurretBankPresentationEffectStates(entity, effectState) {
  if (
    !entity ||
    !effectState ||
    !isTurretWeaponFamily(effectState.weaponFamily)
  ) {
    return [effectState];
  }

  const effectModuleID = toInt(effectState.moduleID, 0);
  const effectTypeID = toInt(effectState.typeID, 0);
  const rawBankModuleIDs =
    Array.isArray(effectState.bankModuleIDs) && effectState.bankModuleIDs.length > 1
      ? effectState.bankModuleIDs
      : resolveGroupedTurretBankModuleIDs(entity, effectModuleID, effectTypeID);
  const normalizedBankModuleIDs = [...new Set(
    rawBankModuleIDs
      .map((moduleID) => toInt(moduleID, 0))
      .filter((moduleID) => moduleID > 0),
  )];
  if (normalizedBankModuleIDs.length <= 1) {
    return [effectState];
  }

  const presentationEffectStates = [];
  const seenModuleIDs = new Set();
  for (const bankModuleID of normalizedBankModuleIDs) {
    if (seenModuleIDs.has(bankModuleID)) {
      continue;
    }
    seenModuleIDs.add(bankModuleID);
    if (bankModuleID === effectModuleID) {
      presentationEffectStates.push(effectState);
      continue;
    }
    const moduleItem = getEntityRuntimeModuleItem(entity, bankModuleID);
    const chargeItem = moduleItem
      ? getEntityRuntimeLoadedCharge(entity, moduleItem)
      : null;
    presentationEffectStates.push({
      ...effectState,
      moduleID: bankModuleID,
      moduleFlagID: toInt(
        moduleItem && moduleItem.flagID,
        effectState.moduleFlagID,
      ),
      typeID: toInt(
        moduleItem && moduleItem.typeID,
        effectState.typeID,
      ),
      chargeTypeID: toInt(
        (chargeItem && chargeItem.typeID) || effectState.chargeTypeID,
        0,
      ),
    });
  }

  if (!seenModuleIDs.has(effectModuleID)) {
    presentationEffectStates.unshift(effectState);
  }

  return presentationEffectStates.length > 0
    ? presentationEffectStates
    : [effectState];
}

function cloneEffectStateForRuntimeModule(entity, effectState, moduleID, bankModuleIDs = null) {
  const moduleItem = getEntityRuntimeModuleItem(entity, moduleID);
  const chargeItem = moduleItem
    ? getEntityRuntimeLoadedCharge(entity, moduleItem)
    : null;
  const normalizedBankModuleIDs = Array.isArray(bankModuleIDs)
    ? [...new Set(
      bankModuleIDs
        .map((candidateModuleID) => toInt(candidateModuleID, 0))
        .filter((candidateModuleID) => candidateModuleID > 0),
    )]
    : null;

  return {
    ...effectState,
    moduleID: toInt(moduleID, 0),
    moduleFlagID: toInt(
      moduleItem && moduleItem.flagID,
      effectState && effectState.moduleFlagID,
    ),
    typeID: toInt(
      moduleItem && moduleItem.typeID,
      effectState && effectState.typeID,
    ),
    chargeTypeID: toInt(
      (chargeItem && chargeItem.typeID) ||
        (effectState && effectState.chargeTypeID),
      0,
    ),
    moduleItemSnapshot:
      moduleItem && typeof moduleItem === "object" ? { ...moduleItem } : null,
    chargeItemSnapshot:
      chargeItem && typeof chargeItem === "object" ? { ...chargeItem } : null,
    bankModuleIDs:
      normalizedBankModuleIDs && normalizedBankModuleIDs.length > 1
        ? normalizedBankModuleIDs
        : null,
    missileBankCycleContext: null,
    pendingMissileBankReloads: null,
  };
}

function getStoredTurretEffectBankModuleIDs(effectState) {
  const moduleIDs = Array.isArray(effectState && effectState.bankModuleIDs)
    ? effectState.bankModuleIDs
    : [];
  const normalizedModuleIDs = [...new Set(
    [
      toInt(effectState && effectState.moduleID, 0),
      ...moduleIDs,
    ]
      .map((moduleID) => toInt(moduleID, 0))
      .filter((moduleID) => moduleID > 0),
  )];
  return normalizedModuleIDs;
}

function reconcileActiveTurretWeaponBankEffectStates(entity, touchedModuleIDs = []) {
  if (!entity || !(entity.activeModuleEffects instanceof Map)) {
    return { changed: false, activeModuleIDs: [] };
  }

  const shipID = toInt(entity.itemID, 0);
  const touchedSet = new Set(
    (Array.isArray(touchedModuleIDs) ? touchedModuleIDs : [touchedModuleIDs])
      .map((moduleID) => toInt(moduleID, 0))
      .filter((moduleID) => moduleID > 0),
  );
  if (shipID <= 0 || touchedSet.size <= 0) {
    return { changed: false, activeModuleIDs: [] };
  }

  let changed = false;
  const activeModuleIDs = [];
  const consumedModuleIDs = new Set();
  const originalEffectStates = [...entity.activeModuleEffects.values()];

  for (const effectState of originalEffectStates) {
    if (
      !effectState ||
      effectState.isGeneric !== true ||
      !isTurretWeaponFamily(effectState.weaponFamily)
    ) {
      continue;
    }

    const previousModuleIDs = getStoredTurretEffectBankModuleIDs(effectState)
      .filter((moduleID) => !consumedModuleIDs.has(moduleID));
    if (
      previousModuleIDs.length <= 0 ||
      !previousModuleIDs.some((moduleID) => touchedSet.has(moduleID))
    ) {
      continue;
    }

    for (const moduleID of previousModuleIDs) {
      consumedModuleIDs.add(moduleID);
    }

    const groupsByKey = new Map();
    for (const moduleID of previousModuleIDs) {
      const currentMasterID = getGroupedWeaponBankMasterID(shipID, moduleID);
      const currentBankModuleIDs =
        currentMasterID > 0
          ? getGroupedWeaponBankModuleIDs(shipID, currentMasterID)
            .map((candidateModuleID) => toInt(candidateModuleID, 0))
            .filter((candidateModuleID) => candidateModuleID > 0)
          : [];
      const activeCurrentBankModuleIDs = previousModuleIDs.filter(
        (candidateModuleID) => currentBankModuleIDs.includes(candidateModuleID),
      );
      const shouldRemainBanked =
        currentMasterID > 0 &&
        activeCurrentBankModuleIDs.length > 1 &&
        activeCurrentBankModuleIDs.includes(currentMasterID);
      const key = shouldRemainBanked
        ? `bank:${currentMasterID}`
        : `module:${moduleID}`;
      if (!groupsByKey.has(key)) {
        groupsByKey.set(key, {
          masterModuleID: shouldRemainBanked ? currentMasterID : moduleID,
          moduleIDs: shouldRemainBanked ? activeCurrentBankModuleIDs : [moduleID],
        });
      }
    }

    for (const moduleID of previousModuleIDs) {
      entity.activeModuleEffects.delete(moduleID);
    }

    for (const group of groupsByKey.values()) {
      const moduleIDs = [...new Set(
        (group.moduleIDs || [])
          .map((moduleID) => toInt(moduleID, 0))
          .filter((moduleID) => moduleID > 0),
      )].sort((left, right) => left - right);
      const masterModuleID = toInt(group.masterModuleID, moduleIDs[0]);
      if (masterModuleID <= 0 || moduleIDs.length <= 0) {
        continue;
      }
      entity.activeModuleEffects.set(
        masterModuleID,
        cloneEffectStateForRuntimeModule(
          entity,
          effectState,
          masterModuleID,
          moduleIDs.length > 1 ? moduleIDs : null,
        ),
      );
      activeModuleIDs.push(masterModuleID);
      changed = true;
    }
  }

  return {
    changed,
    activeModuleIDs: [...new Set(activeModuleIDs)].sort((left, right) => left - right),
  };
}

function logModuleEffectNotification(kind, active, effectState, effectID, chargeContext, environment) {
  const normalizedSubLocation = Array.isArray(chargeContext.subLocation)
    ? `(${chargeContext.subLocation.join(",")})`
    : "null";
  log.debug(
    [
      `[module-fx:${kind}]`,
      `active=${active ? 1 : 0}`,
      `moduleID=${toInt(effectState && effectState.moduleID, 0)}`,
      `moduleFlagID=${toInt(chargeContext && chargeContext.moduleFlagID, 0)}`,
      `chargeTypeID=${toInt(chargeContext && chargeContext.chargeTypeID, 0)}`,
      `targetID=${toInt(effectState && effectState.targetID, 0)}`,
      `effectID=${toInt(effectID, 0)}`,
      `subLoc=${normalizedSubLocation}`,
      `environment=${JSON.stringify(environment)}`,
    ].join(" "),
  );
}

function notifyModuleEffectState(
  session,
  entity,
  effectState,
  active,
  options = {},
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !entity ||
    !effectState
  ) {
    return false;
  }

  const effectID = getPropulsionEffectID(effectState.effectName);
  if (effectID <= 0) {
    return false;
  }

  const resolveNotificationFileTime =
    options.clampToVisibleStamp === true
      ? resolveVisibleSessionNotificationFileTime
      : resolveSessionNotificationFileTime;

  let when;
  if (options.whenMs != null) {
    when = resolveNotificationFileTime(session, options.whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    when = resolveNotificationFileTime(session);
  } else {
    log.warn("notifyModuleEffectState: no sim time source, using wallclock fallback");
    when = currentFileTime();
  }
  const resolvedStartedAt = resolveNotificationFileTime(
    session,
    options.startTimeMs === undefined || options.startTimeMs === null
      ? effectState.startedAtMs
      : options.startTimeMs,
  );
  const durationMs = Number.isFinite(Number(effectState.durationMs))
    ? Math.max(Number(effectState.durationMs), -1)
    : -1;
  const duration = marshalModuleDurationWireValue(durationMs);
  const repeat = normalizeEffectRepeatCount(effectState.repeat, -1);
  const { environment, chargeContext } = buildModuleEffectEnvironment(
    session,
    entity,
    effectState,
    effectID,
  );
  session.sendNotification("OnGodmaShipEffect", "clientID", [
    toInt(effectState.moduleID, 0),
    effectID,
    when,
    active ? 1 : 0,
    active ? 1 : 0,
    environment,
    resolvedStartedAt,
    duration,
    repeat,
    null,
    options.actualStopTimeMs === undefined || options.actualStopTimeMs === null
      ? null
      : resolveNotificationFileTime(session, options.actualStopTimeMs),
  ]);
  logModuleEffectNotification(
    "propulsion",
    active,
    effectState,
    effectID,
    chargeContext,
    environment,
  );
  recordSessionJumpTimingTrace(session, "module-effect-state", {
    moduleID: toInt(effectState.moduleID, 0),
    moduleFlagID: toInt(chargeContext.moduleFlagID, 0),
    chargeTypeID: toInt(chargeContext.chargeTypeID, 0),
    chargeSubLocation: chargeContext.subLocation,
    effectName: effectState.effectName || null,
    effectID,
    active: active === true,
    when,
    startedAt: resolvedStartedAt,
    durationMs,
    repeat,
    sessionSimTimeMs: session && session._space ? session._space.simTimeMs : null,
    sessionTimeDilation:
      session && session._space ? session._space.timeDilation : null,
  });
  return true;
}

// -----------------------------------------------------------------------
// Generic module activation — supports any module with an activatable
// effect (effectCategoryID 1=activation, 2=targeted, 3=area).  This gives
// all modules proper cycle timing so the HUD radial ring works.
// -----------------------------------------------------------------------

const ACTIVATABLE_EFFECT_CATEGORIES = new Set([1, 2, 3]);
const PASSIVE_SLOT_EFFECTS = new Set(["online", "hipower", "medpower", "lopower",
  "rigslot", "subsystem", "turretfitted", "launcherfitted"]);

function resolveDefaultActivationEffect(typeID) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return null;
  }

  const effectIDs = getTypeDogmaEffects(numericTypeID);
  for (const effectID of effectIDs) {
    const record = getEffectTypeRecord(effectID);
    if (
      !record ||
      !ACTIVATABLE_EFFECT_CATEGORIES.has(record.effectCategoryID)
    ) {
      continue;
    }
    const normalizedName = String(record.name || "").toLowerCase();
    if (PASSIVE_SLOT_EFFECTS.has(normalizedName)) {
      continue;
    }
    return record;
  }
  return null;
}

function resolveEffectByName(typeID, effectName) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0 || !effectName) {
    return null;
  }

  const normalized = String(effectName).toLowerCase()
    .replace(/^effects\./, "").replace(/^dogmaxp\./, "");
  const effectIDs = getTypeDogmaEffects(numericTypeID);
  for (const effectID of effectIDs) {
    const record = getEffectTypeRecord(effectID);
    if (!record) {
      continue;
    }
    const recordName = String(record.name || "").toLowerCase();
    if (recordName === normalized) {
      return record;
    }
    const guidSuffix = String(record.guid || "").toLowerCase()
      .replace(/^effects\./, "");
    if (guidSuffix && guidSuffix === normalized) {
      return record;
    }
  }
  return null;
}

function getBaseGenericModuleRuntimeAttributes(moduleItem) {
  if (!moduleItem || !moduleItem.typeID) {
    return null;
  }
  const activationEffect = resolveDefaultActivationEffect(moduleItem.typeID);
  if (!activationEffect) {
    return null;
  }

  const capNeed = toFiniteNumber(
    getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_CAPACITOR_NEED),
    0,
  );
  const rawDuration = getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_DURATION);
  const rawSpeed = getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_SPEED);
  const isScanProbeLauncher =
    toInt(moduleItem && moduleItem.groupID, 0) === GROUP_SCAN_PROBE_LAUNCHER;
  // Scan probe launchers are a special case on the live client contract:
  // their effect record advertises useMissiles on speed (51), but the HUD
  // cycle that keeps the launcher button stable follows the probe scan-time
  // duration lane instead. Earlier server logs that matched the client best
  // used the duration attribute here (for example 5625ms on the probe hull),
  // while the newer speed-based 1500ms contract is what left the launcher
  // cycling oddly and sticking red.
  const effectDurationAttributeID = toInt(
    activationEffect.durationAttributeID,
    0,
  );
  const durationAttributeID =
    isScanProbeLauncher && toFiniteNumber(rawDuration, 0) > 0
      ? MODULE_ATTRIBUTE_DURATION
      : effectDurationAttributeID > 0
      ? effectDurationAttributeID
      : toFiniteNumber(rawDuration, 0) > 0
        ? MODULE_ATTRIBUTE_DURATION
        : MODULE_ATTRIBUTE_SPEED;
  const durationAttributeValue = toFiniteNumber(
    getTypeDogmaAttributeValueByID(moduleItem.typeID, durationAttributeID),
    durationAttributeID === MODULE_ATTRIBUTE_SPEED
      ? toFiniteNumber(rawSpeed, 10000)
      : toFiniteNumber(rawDuration, 10000),
  );
  const durationMs = Math.max(
    1,
    durationAttributeValue,
  );
  const speedMs = Math.max(
    1,
    isScanProbeLauncher
      ? durationMs
      : toFiniteNumber(rawSpeed, 10000),
  );
  const reactivationDelayMs = Math.max(
    0,
    toFiniteNumber(
      getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_REACTIVATION_DELAY),
      0,
    ),
  );
  const maxGroupActive = toInt(
    getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_MAX_GROUP_ACTIVE),
    0,
  );
  const fuelTypeID = toInt(
    getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_CONSUMPTION_TYPE),
    0,
  );
  const fuelPerActivation = Math.max(
    0,
    toInt(
      getTypeDogmaAttributeValueByID(
        moduleItem.typeID,
        MODULE_ATTRIBUTE_CONSUMPTION_QUANTITY,
      ),
      0,
    ),
  );

  return {
    capNeed: Math.max(0, roundNumber(capNeed, 6)),
    durationMs: Math.max(1, roundNumber(durationMs, 3)),
    durationAttributeID,
    reactivationDelayMs,
    maxGroupActive,
    fuelTypeID,
    fuelPerActivation,
    speedMs,
  };
}

function consumeShipModuleFuelForSession(
  session,
  entity,
  fuelTypeID,
  fuelPerActivation,
) {
  const normalizedFuelTypeID = Math.max(0, toInt(fuelTypeID, 0));
  const normalizedFuelPerActivation = Math.max(0, toInt(fuelPerActivation, 0));
  if (normalizedFuelTypeID <= 0 || normalizedFuelPerActivation <= 0) {
    return {
      success: true,
      changes: [],
      consumedQuantity: 0,
    };
  }

  const fuelResult = genericModuleFuelRuntime.consumeShipModuleFuel(
    entity,
    normalizedFuelTypeID,
    normalizedFuelPerActivation,
    {
      resolveCharacterID(targetEntity) {
        return getShipEntityInventoryCharacterID(
          targetEntity,
          toInt(session && session.characterID, 0),
        );
      },
    },
  );
  if (!fuelResult.success) {
    return {
      success: false,
      errorMsg: fuelResult.errorMsg || "NO_FUEL",
      changes: Array.isArray(fuelResult.changes) ? fuelResult.changes : [],
    };
  }

  if (session) {
    syncInventoryChangesToSession(session, fuelResult.changes);
  }

  return {
    success: true,
    changes: Array.isArray(fuelResult.changes) ? fuelResult.changes : [],
    consumedQuantity: Math.max(0, toInt(fuelResult.consumedQuantity, 0)),
  };
}

function normalizeLiveModuleAttributeOverrides(attributeMap) {
  if (!attributeMap || typeof attributeMap !== "object") {
    return null;
  }

  const overrides = {};
  for (const [attributeID, rawValue] of Object.entries(attributeMap)) {
    const numericAttributeID = toInt(attributeID, 0);
    const numericValue = Number(rawValue);
    if (
      numericAttributeID <= 0 ||
      !Number.isFinite(numericValue)
    ) {
      continue;
    }
    overrides[numericAttributeID] = numericValue;
  }

  return Object.keys(overrides).length > 0 ? overrides : null;
}

function resolveGenericModuleAttributeOverrides(
  characterID,
  shipItem,
  moduleItem,
  chargeItem = null,
  options = {},
) {
  if (!shipItem || !moduleItem) {
    return null;
  }

  const resolvedSkillMap = options.skillMap instanceof Map
    ? options.skillMap
    : getCharacterSkillMap(toInt(characterID, 0));
  const resolvedFittedItems = Array.isArray(options.fittedItems)
    ? options.fittedItems
    : getFittedModuleItems(toInt(shipItem && shipItem.itemID, 0));
  const resolvedActiveModuleContexts = Array.isArray(options.activeModuleContexts)
    ? options.activeModuleContexts
    : [];
  const additionalLocationModifierSources = Array.isArray(
    options.additionalLocationModifierSources,
  )
    ? options.additionalLocationModifierSources
    : [];

  return normalizeLiveModuleAttributeOverrides(buildLiveModuleAttributeMap(
    shipItem,
    moduleItem,
    chargeItem,
    resolvedSkillMap,
    resolvedFittedItems,
    resolvedActiveModuleContexts,
    {
      additionalLocationModifierSources,
    },
  ));
}

function getGenericModuleRuntimeAttributes(
  characterID,
  shipItem,
  moduleItem,
  chargeItem = null,
  weaponSnapshot = null,
  options = {},
) {
  const baseRuntimeAttributes = getBaseGenericModuleRuntimeAttributes(moduleItem);
  if (!baseRuntimeAttributes) {
    return null;
  }

  const syntheticHullSuperweapon = Boolean(
    moduleItem &&
    moduleItem.npcSyntheticHullModule === true &&
    moduleItem.npcSyntheticHullSuperweapon === true,
  );

  const attributeOverrides = resolveGenericModuleAttributeOverrides(
    characterID,
    shipItem,
    moduleItem,
    chargeItem,
    options,
  );

  const weaponFamily = resolveWeaponFamily(moduleItem, chargeItem);
  if (!isSnapshotWeaponFamily(weaponFamily)) {
    const durationAttributeID = toInt(
      baseRuntimeAttributes.durationAttributeID,
      MODULE_ATTRIBUTE_DURATION,
    );
    const isScanProbeLauncher =
      toInt(moduleItem && moduleItem.groupID, 0) === GROUP_SCAN_PROBE_LAUNCHER;
    const resolvedDurationMs = roundNumber(
      toFiniteNumber(
        attributeOverrides && attributeOverrides[durationAttributeID],
        baseRuntimeAttributes.durationMs,
      ),
      3,
    );
    const resolvedSpeedMs = roundNumber(
      isScanProbeLauncher
        ? resolvedDurationMs
        : toFiniteNumber(
          attributeOverrides && attributeOverrides[MODULE_ATTRIBUTE_SPEED],
          baseRuntimeAttributes.speedMs,
        ),
      3,
    );
    const mergedAttributeOverrides =
      attributeOverrides && typeof attributeOverrides === "object"
        ? {
          ...attributeOverrides,
          ...(isScanProbeLauncher
            ? {
              [MODULE_ATTRIBUTE_SPEED]: resolvedSpeedMs,
            }
            : {}),
        }
        : (
          isScanProbeLauncher
            ? {
              [MODULE_ATTRIBUTE_SPEED]: resolvedSpeedMs,
            }
            : null
        );
    return {
      ...baseRuntimeAttributes,
      capNeed: syntheticHullSuperweapon
        ? 0
        : roundNumber(
          toFiniteNumber(
            attributeOverrides && attributeOverrides[MODULE_ATTRIBUTE_CAPACITOR_NEED],
            baseRuntimeAttributes.capNeed,
          ),
          6,
        ),
      durationMs: roundNumber(
        resolvedDurationMs,
      ),
      reactivationDelayMs: Math.max(
        0,
        roundNumber(
          toFiniteNumber(
            attributeOverrides && attributeOverrides[MODULE_ATTRIBUTE_REACTIVATION_DELAY],
            baseRuntimeAttributes.reactivationDelayMs,
          ),
          3,
        ),
      ),
      maxGroupActive: Math.max(
        0,
        toInt(
          attributeOverrides && attributeOverrides[MODULE_ATTRIBUTE_MAX_GROUP_ACTIVE],
          baseRuntimeAttributes.maxGroupActive,
        ),
      ),
      fuelTypeID: syntheticHullSuperweapon
        ? 0
        : Math.max(
          0,
          toInt(
            attributeOverrides && attributeOverrides[MODULE_ATTRIBUTE_CONSUMPTION_TYPE],
            baseRuntimeAttributes.fuelTypeID,
          ),
        ),
      fuelPerActivation: syntheticHullSuperweapon
        ? 0
        : Math.max(
          0,
          toInt(
            attributeOverrides && attributeOverrides[MODULE_ATTRIBUTE_CONSUMPTION_QUANTITY],
            baseRuntimeAttributes.fuelPerActivation,
          ),
        ),
      weaponFamily: weaponFamily || null,
      weaponSnapshot: null,
      attributeOverrides: mergedAttributeOverrides,
    };
  }

  const resolvedWeaponSnapshot =
    weaponSnapshot ||
    (
      shipItem &&
      (
        chargeItem ||
        isChargeOptionalTurretWeapon(moduleItem, chargeItem)
      )
        ? buildWeaponModuleSnapshot({
          characterID,
          shipItem,
          moduleItem,
          chargeItem,
        })
        : null
    );
  if (!resolvedWeaponSnapshot) {
    return {
      ...baseRuntimeAttributes,
      durationAttributeID: MODULE_ATTRIBUTE_SPEED,
      weaponFamily,
      weaponSnapshot: null,
      attributeOverrides,
    };
  }

  return {
    ...baseRuntimeAttributes,
    capNeed: resolvedWeaponSnapshot.capNeed,
    durationMs: resolvedWeaponSnapshot.durationMs,
    durationAttributeID: MODULE_ATTRIBUTE_SPEED,
    fuelTypeID: Math.max(
      0,
      toInt(
        attributeOverrides && attributeOverrides[MODULE_ATTRIBUTE_CONSUMPTION_TYPE],
        baseRuntimeAttributes.fuelTypeID,
      ),
    ),
    fuelPerActivation: Math.max(
      0,
      toInt(
        attributeOverrides && attributeOverrides[MODULE_ATTRIBUTE_CONSUMPTION_QUANTITY],
        baseRuntimeAttributes.fuelPerActivation,
      ),
    ),
    weaponFamily,
    weaponSnapshot: resolvedWeaponSnapshot,
    attributeOverrides,
  };
}

function notifyGenericModuleEffectState(
  session,
  entity,
  effectState,
  active,
  options = {},
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !entity ||
    !effectState
  ) {
    return false;
  }

  const effectID = toInt(effectState.effectID, 0);
  if (effectID <= 0) {
    return false;
  }

  const resolveNotificationFileTime =
    options.clampToVisibleStamp === true
      ? resolveVisibleSessionNotificationFileTime
      : resolveSessionNotificationFileTime;

  let when;
  if (options.whenMs != null) {
    when = resolveNotificationFileTime(session, options.whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    when = resolveNotificationFileTime(session);
  } else {
    log.warn("notifyGenericModuleEffectState: no sim time source, using wallclock fallback");
    when = currentFileTime();
  }
  const startedAt = resolveNotificationFileTime(
    session,
    options.startTimeMs === undefined || options.startTimeMs === null
      ? effectState.startedAtMs
      : options.startTimeMs,
  );
  const durationMs = Number.isFinite(Number(effectState.durationMs))
    ? Math.max(Number(effectState.durationMs), -1)
    : -1;
  const duration = marshalModuleDurationWireValue(durationMs);
  const repeat = normalizeEffectRepeatCount(effectState.repeat, -1);
  const { environment, chargeContext } = buildModuleEffectEnvironment(
    session,
    entity,
    effectState,
    effectID,
  );
  session.sendNotification("OnGodmaShipEffect", "clientID", [
    toInt(effectState.moduleID, 0),
    effectID,
    when,
    active ? 1 : 0,
    active ? 1 : 0,
    environment,
    startedAt,
    duration,
    repeat,
    null,
    options.actualStopTimeMs === undefined || options.actualStopTimeMs === null
      ? null
      : resolveNotificationFileTime(session, options.actualStopTimeMs),
  ]);
  logModuleEffectNotification(
    "generic",
    active,
    effectState,
    effectID,
    chargeContext,
    environment,
  );
  recordSessionJumpTimingTrace(session, "generic-module-effect-state", {
    moduleID: toInt(effectState.moduleID, 0),
    moduleFlagID: toInt(chargeContext.moduleFlagID, 0),
    chargeTypeID: toInt(chargeContext.chargeTypeID, 0),
    chargeSubLocation: chargeContext.subLocation,
    effectName: effectState.effectName || null,
    effectID,
    active: active === true,
    when,
    startedAt,
    durationMs,
    repeat,
    sessionSimTimeMs: session && session._space ? session._space.simTimeMs : null,
    sessionTimeDilation:
      session && session._space ? session._space.timeDilation : null,
  });
  return true;
}

function getEffectCycleBoundaryMs(effectState, fallbackNow = Date.now()) {
  if (!effectState) {
    return Math.max(toFiniteNumber(fallbackNow, Date.now()), 0);
  }

  const durationMs = Math.max(1, toFiniteNumber(effectState.durationMs, 1000));
  const nextCycleAtMs = toFiniteNumber(effectState.nextCycleAtMs, 0);
  if (nextCycleAtMs > 0) {
    return nextCycleAtMs;
  }

  const startedAtMs = toFiniteNumber(effectState.startedAtMs, 0);
  if (startedAtMs > 0) {
    return startedAtMs + durationMs;
  }

  return Math.max(toFiniteNumber(fallbackNow, Date.now()), 0);
}

function normalizeEffectRepeatCount(rawRepeat, fallbackRepeat = null) {
  if (
    rawRepeat === undefined ||
    rawRepeat === null ||
    rawRepeat === true ||
    rawRepeat === false
  ) {
    return fallbackRepeat;
  }

  const normalizedRepeat = Math.trunc(Number(rawRepeat));
  if (!Number.isFinite(normalizedRepeat)) {
    return fallbackRepeat;
  }

  if (normalizedRepeat === 0) {
    return 0;
  }

  if (normalizedRepeat < 0) {
    return fallbackRepeat;
  }

  return normalizedRepeat;
}

function resolveSpecialFxRepeatCount(effectState, fallbackRepeat = null) {
  if (effectState && effectState.miningEffect === true) {
    // The activate verb often carries repeat=1 for mining modules, but the
    // beam presentation is continuous. If we honor that explicit repeat on the
    // FX payload, observers see exactly one cycle of beam and then it expires
    // even though the server keeps mining. Mining beams therefore always use a
    // long replay window instead of the client-supplied repeat count.
    const durationMs = Math.max(1, toFiniteNumber(effectState.durationMs, 1000));
    return Math.max(1, Math.ceil(SPECIAL_FX_REPEAT_WINDOW_MS / durationMs));
  }

  const explicitRepeat = normalizeEffectRepeatCount(
    effectState && effectState.repeat,
    null,
  );
  if (explicitRepeat !== null) {
    return explicitRepeat;
  }

  if (
    !effectState ||
    (
      !isTurretWeaponFamily(effectState.weaponFamily) &&
      !isMissileWeaponFamily(effectState.weaponFamily)
    )
  ) {
    return fallbackRepeat;
  }

  const durationMs = Math.max(1, toFiniteNumber(effectState.durationMs, 1000));
  return Math.max(1, Math.ceil(SPECIAL_FX_REPEAT_WINDOW_MS / durationMs));
}

function buildMiningSpecialFxTimingOptions(
  effectState,
  nowMs,
  options = {},
) {
  if (!effectState || effectState.miningEffect !== true) {
    return {};
  }

  const startedAtMs = toFiniteNumber(effectState.startedAtMs, nowMs);
  const elapsedTicks = Math.max(
    0,
    Math.round(
      (toFiniteNumber(nowMs, startedAtMs) - startedAtMs) *
        Number(FILETIME_TICKS_PER_MS),
    ),
  );
  return {
    repeat: resolveSpecialFxRepeatCount(effectState),
    startTime: toFileTimeFromMs(startedAtMs, currentFileTime()),
    timeFromStart: options.includeElapsed === true ? elapsedTicks : 0,
  };
}

function shouldReplayActiveSpecialFxForFreshAcquire(effectState, nowMs = Date.now()) {
  if (!effectState || !effectState.guid) {
    return false;
  }
  if (effectState.disableFreshAcquireSpecialFxReplay === true) {
    return false;
  }
  if (effectState.superweaponEffect === true) {
    return isSuperweaponFxReplayWindowActive(effectState, nowMs);
  }
  if (effectState.forceFreshAcquireSpecialFxReplay === true) {
    return true;
  }
  const replayableMiningFx = effectState.miningEffect === true;
  const replayableOffensiveFx =
    effectState.isGeneric === true &&
    isOffensiveWeaponFamily(effectState.weaponFamily);
  const replayableHostileFx =
    effectState.hostileModuleEffect === true &&
    typeof effectState.guid === "string" &&
    effectState.guid.trim() !== "";
  const replayableStatefulSelfBuffFx =
    FRESH_ACQUIRE_REPLAYABLE_STATEFUL_SELF_BUFF_GUIDS.has(
      String(effectState.guid || ""),
    );
  if (
    !replayableMiningFx &&
    !replayableOffensiveFx &&
    !replayableHostileFx &&
    !replayableStatefulSelfBuffFx
  ) {
    return false;
  }
  if (toFiniteNumber(effectState.deactivatedAtMs, 0) > 0) {
    return false;
  }

  const startedAtMs = toFiniteNumber(effectState.startedAtMs, 0);
  if (startedAtMs > 0 && startedAtMs > toFiniteNumber(nowMs, 0) + 1) {
    return false;
  }

  const deactivateAtMs = toFiniteNumber(effectState.deactivateAtMs, 0);
  if (deactivateAtMs > 0 && deactivateAtMs <= toFiniteNumber(nowMs, 0)) {
    return false;
  }

  return true;
}

function finalizePropulsionModuleDeactivationWithoutSession(
  scene,
  entity,
  effectState,
  options = {},
) {
  if (
    !scene ||
    !entity ||
    !effectState ||
    !(entity.activeModuleEffects instanceof Map)
  ) {
    return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
  }

  const normalizedModuleID = toInt(effectState.moduleID, 0);
  if (normalizedModuleID <= 0) {
    return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
  }

  const stopTimeMs = Math.max(
    0,
    toFiniteNumber(
      options.nowMs,
      getEffectCycleBoundaryMs(effectState, Date.now()),
    ),
  );

  entity.activeModuleEffects.delete(normalizedModuleID);
  if (!(entity.moduleReactivationLocks instanceof Map)) {
    entity.moduleReactivationLocks = new Map();
  }
  entity.moduleReactivationLocks.set(
    normalizedModuleID,
    stopTimeMs + Math.max(0, toFiniteNumber(effectState.reactivationDelayMs, 0)),
  );

  effectState.deactivatedAtMs = stopTimeMs;
  effectState.deactivationRequestedAtMs = 0;
  effectState.deactivateAtMs = 0;
  effectState.stopReason = options.reason || effectState.stopReason || null;
  if (isPrecursorTurretFamily(effectState.weaponFamily)) {
    resetPrecursorTurretSpool(effectState);
  }

  scene.refreshShipEntityDerivedState(entity, {
    broadcast: true,
    broadcastOptions: buildObserverPropulsionShipPrimeBroadcastOptions(),
  });
  scene.broadcastSpecialFx(
    entity.itemID,
    effectState.guid,
    buildObserverPropulsionSpecialFxOptions({
      moduleID: effectState.moduleID,
      moduleTypeID: effectState.typeID,
      targetID: effectState.targetID || null,
      chargeTypeID: effectState.chargeTypeID || null,
      isOffensive: isOffensiveWeaponFamily(effectState.weaponFamily),
      start: false,
      active: false,
      duration: effectState.durationMs,
    }),
    entity,
  );

  const potentialSessionProp = entity.session || null;
  if (potentialSessionProp) {
    if (!Array.isArray(entity.pendingModuleStopNotifications)) {
      entity.pendingModuleStopNotifications = [];
    }
    if (entity.pendingModuleStopNotifications.length < 32) {
      entity.pendingModuleStopNotifications.push({
        effectState: { ...effectState },
        stopTimeMs,
        isPropulsion: true,
      });
    }
  }

  return {
    success: true,
    data: {
      entity,
      effectState,
      stoppedAtMs: stopTimeMs,
    },
  };
}

function finalizeGenericModuleDeactivationWithoutSession(
  scene,
  entity,
  effectState,
  options = {},
) {
  if (
    !scene ||
    !entity ||
    !effectState ||
    !(entity.activeModuleEffects instanceof Map)
  ) {
    return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
  }

  const normalizedModuleID = toInt(effectState.moduleID, 0);
  if (normalizedModuleID <= 0) {
    return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
  }

  const stopTimeMs = Math.max(
    0,
    toFiniteNumber(
      options.nowMs,
      getEffectCycleBoundaryMs(effectState, Date.now()),
    ),
  );

  entity.activeModuleEffects.delete(normalizedModuleID);
  if (!(entity.moduleReactivationLocks instanceof Map)) {
    entity.moduleReactivationLocks = new Map();
  }
  entity.moduleReactivationLocks.set(
    normalizedModuleID,
    stopTimeMs + Math.max(0, toFiniteNumber(effectState.reactivationDelayMs, 0)),
  );

  effectState.deactivatedAtMs = stopTimeMs;
  effectState.deactivationRequestedAtMs = 0;
  effectState.deactivateAtMs = 0;
  effectState.stopReason = options.reason || effectState.stopReason || null;
  if (isPrecursorTurretFamily(effectState.weaponFamily)) {
    resetPrecursorTurretSpool(effectState);
  }
  const dependentIndustrialModuleIDs = isIndustrialCoreEffectName(effectState.effectName)
    ? getIndustrialCoreDependentModuleIDs(entity, normalizedModuleID)
    : [];
  if (effectState.tractorBeamEffect === true) {
    tractorBeamRuntime.handleTractorBeamDeactivation(scene, effectState, stopTimeMs, {
      persistDynamicEntity,
    });
  }
  if (effectState.superweaponEffect === true) {
    finalizeSuperweaponDeactivation({
      scene,
      entity,
      effectState,
      nowMs: stopTimeMs,
    });
  }
  if (effectState.affectsShipDerivedState) {
    scene.refreshShipEntityDerivedState(entity, {
      broadcast: false,
      notifyTargeting: true,
    });
  }
  if (effectState.assistanceModuleEffect === true) {
    const targetEntity = scene.getEntityByID(toInt(effectState.targetID, 0));
    const targetSession = targetEntity && targetEntity.session ? targetEntity.session : null;
    const removedHudState = targetEntity
      ? hudIconRuntime.removeHudIconState(
        targetEntity,
        buildAssistanceHudState(targetEntity, entity, effectState, stopTimeMs),
      )
      : null;
    if (targetSession && isReadyForDestiny(targetSession) && removedHudState) {
      notifyAssistanceHudStateToSession(targetSession, removedHudState, false, {
        startTimeMs: stopTimeMs,
      });
    }
  }
  if (effectState.jammerModuleEffect === true) {
    removeJammerCyclePresentation(scene, entity, effectState, stopTimeMs);
  }
  if (effectState.hostileModuleEffect === true) {
    const targetEntity = scene.getEntityByID(toInt(effectState.targetID, 0));
    const targetSession = targetEntity && targetEntity.session ? targetEntity.session : null;
    const hostileRemovalResult = hostileModuleRuntime.removeHostileModuleState({
      targetEntity,
      sourceEntity: entity,
      effectState,
    });
    if (
      hostileRemovalResult &&
      hostileRemovalResult.success &&
      hostileRemovalResult.data &&
      hostileRemovalResult.data.aggregateChanged &&
      targetEntity
    ) {
      scene.refreshShipEntityDerivedState(targetEntity, {
        session: targetSession,
        broadcast: true,
        notifyTargeting: true,
      });
    }
    const removedHudState = targetEntity
      ? hudIconRuntime.removeHudIconState(
        targetEntity,
        buildHostileHudState(targetEntity, entity, effectState, stopTimeMs),
      )
      : null;
    if (targetSession && isReadyForDestiny(targetSession) && removedHudState) {
      notifyHostileHudStateToSession(targetSession, removedHudState, false, {
        startTimeMs: stopTimeMs,
      });
    }
  }

  if (effectState.guid && effectState.suppressStopSpecialFx !== true) {
    const isOffensiveFx = isOffensiveWeaponFamily(effectState.weaponFamily);
    const stopFxOptions =
      entity.nativeNpc === true && isOffensiveFx
        ? buildNpcOffensiveSpecialFxOptions({
          moduleID: effectState.moduleID,
          moduleTypeID: effectState.typeID,
          targetID: effectState.targetID || null,
          chargeTypeID: effectState.chargeTypeID || null,
          isOffensive: isOffensiveFx,
          start: false,
          active: false,
          duration: effectState.durationMs,
        })
        : {
          moduleID: effectState.moduleID,
          moduleTypeID: effectState.typeID,
          targetID: effectState.targetID || null,
          chargeTypeID: effectState.chargeTypeID || null,
          isOffensive: isOffensiveFx,
          start: false,
          active: false,
          duration: effectState.durationMs,
          useCurrentVisibleStamp: true,
        };
    scene.broadcastSpecialFx(
      entity.itemID,
      effectState.guid,
      stopFxOptions,
      entity,
    );
  }

  if (dependentIndustrialModuleIDs.length > 0) {
    for (const dependentModuleID of dependentIndustrialModuleIDs) {
      const dependentEffectState =
        entity.activeModuleEffects.get(toInt(dependentModuleID, 0)) || null;
      if (!dependentEffectState) {
        continue;
      }
      finalizeGenericModuleDeactivationWithoutSession(
        scene,
        entity,
        dependentEffectState,
        {
          reason: "industrialCore",
          nowMs: stopTimeMs,
          suppressCompressionSlimBroadcast: true,
        },
      );
    }
  }
  const compressionSlimChanged =
    refreshShipCompressionFacilityState(entity) ||
    dependentIndustrialModuleIDs.length > 0;
  if (
    compressionSlimChanged &&
    options.suppressCompressionSlimBroadcast !== true
  ) {
    scene.broadcastSlimItemChanges([entity]);
  }

  const potentialSession = entity.session || null;
  if (potentialSession) {
    if (!Array.isArray(entity.pendingModuleStopNotifications)) {
      entity.pendingModuleStopNotifications = [];
    }
    if (entity.pendingModuleStopNotifications.length < 32) {
      entity.pendingModuleStopNotifications.push({
        effectState: { ...effectState },
        stopTimeMs,
        isPropulsion: false,
      });
    }
  }

  return {
    success: true,
    data: { entity, effectState, stoppedAtMs: stopTimeMs },
  };
}

function forceDeactivateBlockedMovementEffects(
  scene,
  targetEntity,
  nowMs = null,
  reason = "scram",
) {
  if (!scene || !targetEntity || !(targetEntity.activeModuleEffects instanceof Map)) {
    return 0;
  }

  const stopTimeMs = Math.max(
    0,
    toFiniteNumber(
      nowMs,
      scene && typeof scene.getCurrentSimTimeMs === "function"
        ? scene.getCurrentSimTimeMs()
        : Date.now(),
    ),
  );
  let deactivatedCount = 0;

  for (const effectState of [...targetEntity.activeModuleEffects.values()]) {
    if (!effectState) {
      continue;
    }

    if (effectState.effectName === PROPULSION_EFFECT_MICROWARPDRIVE) {
      if (targetEntity.session && isReadyForDestiny(targetEntity.session)) {
        scene.finalizePropulsionModuleDeactivation(targetEntity.session, effectState.moduleID, {
          reason,
          nowMs: stopTimeMs,
        });
      } else {
        finalizePropulsionModuleDeactivationWithoutSession(
          scene,
          targetEntity,
          effectState,
          {
            reason,
            nowMs: stopTimeMs,
          },
        );
      }
      deactivatedCount += 1;
      continue;
    }

    if (effectState.microJumpDriveEffect === true) {
      if (targetEntity.session && isReadyForDestiny(targetEntity.session)) {
        scene.finalizeGenericModuleDeactivation(targetEntity.session, effectState.moduleID, {
          reason,
          nowMs: stopTimeMs,
        });
      } else {
        finalizeGenericModuleDeactivationWithoutSession(
          scene,
          targetEntity,
          effectState,
          {
            reason,
            nowMs: stopTimeMs,
          },
        );
      }
      deactivatedCount += 1;
    }
  }

  if (
    hostileModuleRuntime.isEntityWarpScrambled(targetEntity) &&
    targetEntity.pendingWarp
  ) {
    scene.stopShipEntity(targetEntity, {
      nowMs: stopTimeMs,
      useCurrentVisibleStamp: true,
    });
  }

  return deactivatedCount;
}

function buildFreshAcquireActiveSpecialFxReplayUpdates(
  entities,
  stamp,
  nowMs = Date.now(),
  options = {},
) {
  if (!Array.isArray(entities) || entities.length === 0) {
    return [];
  }

  const freshAcquireEntityIDs = new Set(
    entities
      .map((entity) => toInt(entity && entity.itemID, 0))
      .filter((entityID) => entityID > 0),
  );
  const updates = [];
  for (const entity of entities) {
    if (!entity || !(entity.activeModuleEffects instanceof Map)) {
      continue;
    }

    for (const effectState of entity.activeModuleEffects.values()) {
      if (!shouldReplayActiveSpecialFxForFreshAcquire(effectState, nowMs)) {
        continue;
      }

      if (
        effectState.superweaponEffect === true &&
        String(effectState.superweaponFamily || "").toLowerCase() === "lance"
      ) {
        const replayTargetID = Math.max(
          0,
          toInt(
            effectState.superweaponFxTargetID ||
              effectState.superweaponBeaconID ||
              effectState.superweaponPrimaryTargetID ||
              effectState.targetID,
            0,
          ),
        );
        const targetIsFreshlyAcquired = replayTargetID > 0 && freshAcquireEntityIDs.has(replayTargetID);
        if (!targetIsFreshlyAcquired) {
          continue;
        }
      }

      const superweaponReplayOptions =
        effectState.superweaponEffect === true
          ? buildSuperweaponFreshAcquireFxOptions(effectState, nowMs, this)
          : null;
      const { payloads } = buildSpecialFxPayloadsForEntity(
        entity.itemID,
        effectState.guid,
        superweaponReplayOptions || {
          moduleID: effectState.moduleID,
          moduleTypeID: effectState.typeID,
          targetID: effectState.targetID || null,
          chargeTypeID: effectState.chargeTypeID || null,
          weaponFamily: String(effectState.weaponFamily || ""),
          isOffensive: isOffensiveWeaponFamily(effectState.weaponFamily),
          start: true,
          active: true,
          duration: effectState.durationMs,
          repeat: resolveSpecialFxRepeatCount(effectState),
        },
        entity,
      );
      for (const payload of payloads) {
        updates.push({
          stamp,
          payload,
        });
      }
    }
  }

  return updates;
}

function resolvePreservedSimTimeMs(
  preservedPreviousSimTimeMs,
  previousTimeDilation,
  capturedAtWallclockMs,
  fallbackMs = null,
) {
  const normalizedPreservedPreviousSimTimeMs =
    preservedPreviousSimTimeMs === undefined || preservedPreviousSimTimeMs === null
      ? null
      : toFiniteNumber(preservedPreviousSimTimeMs, fallbackMs);
  if (normalizedPreservedPreviousSimTimeMs === null) {
    return fallbackMs;
  }

  const normalizedCapturedAtWallclockMs =
    capturedAtWallclockMs === undefined || capturedAtWallclockMs === null
      ? null
      : toFiniteNumber(capturedAtWallclockMs, null);
  const normalizedPreviousTimeDilation =
    previousTimeDilation === undefined || previousTimeDilation === null
      ? null
      : clampTimeDilationFactor(previousTimeDilation);
  if (
    normalizedCapturedAtWallclockMs === null ||
    normalizedPreviousTimeDilation === null
  ) {
    return normalizedPreservedPreviousSimTimeMs;
  }

  const elapsedWallclockMs = Math.max(
    0,
    toFiniteNumber(Date.now(), normalizedCapturedAtWallclockMs) -
      normalizedCapturedAtWallclockMs,
  );
  return roundNumber(
    normalizedPreservedPreviousSimTimeMs +
      (elapsedWallclockMs * normalizedPreviousTimeDilation),
    3,
  );
}

function resolveBootstrapPreviousSimTimeMs(session, fallbackMs = null) {
  if (!session) {
    return fallbackMs;
  }

  return resolvePreservedSimTimeMs(
    session._nextInitialBallparkPreviousSimTimeMs,
    session._nextInitialBallparkPreviousTimeDilation,
    session._nextInitialBallparkPreviousCapturedAtWallclockMs,
    fallbackMs,
  );
}

// CCP parity: After consuming capacitor, notify the owning session so the
// client's HUD gauge updates in real-time.  Attribute 18 ("charge") is the
// current capacitor energy in GJ.
const ATTRIBUTE_CHARGE = 18;
const ATTRIBUTE_ITEM_DAMAGE = 3;
const ATTRIBUTE_SHIP_DAMAGE = getAttributeIDByNames("damage") || 3;
const ATTRIBUTE_SHIP_SHIELD_CHARGE =
  getAttributeIDByNames("shieldCharge") || 264;
const ATTRIBUTE_SHIP_ARMOR_DAMAGE =
  getAttributeIDByNames("armorDamage") || 266;
const ATTRIBUTE_QUANTITY = getAttributeIDByNames("quantity") || 805;
const ATTRIBUTE_CRYSTAL_VOLATILITY_CHANCE =
  getAttributeIDByNames("crystalVolatilityChance") || 783;
const ATTRIBUTE_CRYSTAL_VOLATILITY_DAMAGE =
  getAttributeIDByNames("crystalVolatilityDamage") || 784;
const ATTRIBUTE_EM_DAMAGE = getAttributeIDByNames("emDamage") || 114;
const ATTRIBUTE_EXPLOSIVE_DAMAGE =
  getAttributeIDByNames("explosiveDamage") || 116;
const ATTRIBUTE_KINETIC_DAMAGE = getAttributeIDByNames("kineticDamage") || 117;
const ATTRIBUTE_THERMAL_DAMAGE = getAttributeIDByNames("thermalDamage") || 118;
const ATTRIBUTE_MASS = getAttributeIDByNames("mass") || 4;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_MAX_TARGET_RANGE = getAttributeIDByNames("maxTargetRange") || 76;
const ATTRIBUTE_MAX_LOCKED_TARGETS =
  getAttributeIDByNames("maxLockedTargets") || 192;
const ATTRIBUTE_CLOAKING_TARGETING_DELAY =
  getAttributeIDByNames("cloakingTargetingDelay") || 560;
const ATTRIBUTE_SCAN_RESOLUTION = getAttributeIDByNames("scanResolution") || 564;
const ATTRIBUTE_SIGNATURE_RADIUS =
  getAttributeIDByNames("signatureRadius") || 552;
const TARGETING_MAX_LOCK_MS = 180000;
const TARGETING_CLIENT_FALLBACK_LOCK_MS = 2000;
const TARGET_LOSS_REASON_ATTEMPT_CANCELLED = "TargetingAttemptCancelled";
const TARGET_LOSS_REASON_EXPLODING = "Exploding";
const DESTRUCTION_EFFECT_EXPLOSION = 3;

function notifyAttributeChanges(session, changes = []) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !Array.isArray(changes) ||
    changes.length === 0
  ) {
    return false;
  }

  session.sendNotification("OnModuleAttributeChanges", "clientID", [{
    type: "list",
    items: changes,
  }]);
  return true;
}

function isModuleTimingAttribute(attributeID) {
  const normalizedAttributeID = toInt(attributeID, 0);
  return (
    normalizedAttributeID === MODULE_ATTRIBUTE_DURATION ||
    normalizedAttributeID === MODULE_ATTRIBUTE_SPEED
  );
}

function isDogmaFileTimeAttribute(attributeID) {
  return toInt(attributeID, 0) === ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP_RUNTIME;
}

function marshalRuntimeAttributeChangeValue(session, attributeID, value) {
  const normalizedAttributeID = toInt(attributeID, 0);
  if (isModuleTimingAttribute(normalizedAttributeID)) {
    return marshalModuleDurationWireValue(value);
  }
  if (isDogmaFileTimeAttribute(normalizedAttributeID)) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return 0;
    }
    return resolveSessionNotificationFileTime(session, numericValue);
  }
  return Number.isFinite(Number(value))
    ? Number(value)
    : value;
}

function buildAttributeChange(
  session,
  itemID,
  attributeID,
  newValue,
  oldValue = null,
  when = null,
) {
  let resolvedWhen;
  if (when != null) {
    resolvedWhen = when;
  } else if (session && session._space && session._space.simFileTime) {
    // Use the live session clock when a scene is available instead of the
    // last cached _space.simFileTime snapshot so HUD timers do not drift when
    // notifications are emitted between scene ticks.
    resolvedWhen = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("buildAttributeChange: no sim time source, using wallclock fallback");
    resolvedWhen = currentFileTime();
  }
  const normalizedAttributeID = toInt(attributeID, 0);
  return [
    "OnModuleAttributeChanges",
    toInt(session && session.characterID, 0),
    itemID,
    normalizedAttributeID,
    resolvedWhen,
    marshalRuntimeAttributeChangeValue(session, normalizedAttributeID, newValue),
    oldValue == null
      ? oldValue
      : marshalRuntimeAttributeChangeValue(session, normalizedAttributeID, oldValue),
    null,
  ];
}

function notifyCapacitorChangeToSession(
  session,
  entity,
  whenMs = null,
  previousChargeAmount = null,
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !entity
  ) {
    return;
  }

  const capacitorCapacity = Math.max(
    toFiniteNumber(entity.capacitorCapacity, 0),
    0,
  );
  const chargeAmount = Number(
    (capacitorCapacity * getEntityCapacitorRatio(entity)).toFixed(6),
  );
  const shipID = toInt(entity.itemID, 0);
  let when;
  if (whenMs != null) {
    when = resolveSessionNotificationFileTime(session, whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    when = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyCapacitorChangeToSession: no sim time source, using wallclock fallback");
    when = currentFileTime();
  }
  const hasExplicitPreviousChargeAmount =
    previousChargeAmount !== null &&
    previousChargeAmount !== undefined &&
    Number.isFinite(Number(previousChargeAmount));
  const normalizedPreviousChargeAmount = hasExplicitPreviousChargeAmount
    ? Number(Number(previousChargeAmount).toFixed(6))
    : Number.isFinite(Number(entity._lastCapNotifiedAmount))
      ? Number(Number(entity._lastCapNotifiedAmount).toFixed(6))
      : chargeAmount;

  notifyAttributeChanges(session, [buildAttributeChange(
    session,
    shipID,
    ATTRIBUTE_CHARGE,
    chargeAmount,
    normalizedPreviousChargeAmount,
    when,
  )]);
  entity._lastCapNotifiedAmount = chargeAmount;
}

function ensureChargeTupleDogmaPrimeForSession(
  session,
  shipID,
  moduleFlagID,
  chargeItem,
  options = {},
) {
  const numericShipID = toInt(shipID, 0);
  const numericFlagID = toInt(moduleFlagID, 0);
  const numericChargeTypeID = toInt(chargeItem && chargeItem.typeID, 0);
  const hasQuantityOverride =
    options.quantityOverride !== undefined &&
    options.quantityOverride !== null;
  const quantity = hasQuantityOverride
    ? Math.max(0, toInt(options.quantityOverride, 0))
    : getChargeItemQuantity(chargeItem);
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !session._space ||
    numericShipID <= 0 ||
    numericFlagID <= 0 ||
    numericChargeTypeID <= 0 ||
    (!hasQuantityOverride && quantity <= 0)
  ) {
    return false;
  }

  if (!(session._space.primedChargeTupleKeys instanceof Set)) {
    session._space.primedChargeTupleKeys = new Set();
  }
  if (!(session._space.recentlyPrimedChargeTupleKeys instanceof Map)) {
    session._space.recentlyPrimedChargeTupleKeys = new Map();
  }

  const tupleKey = `${numericShipID}:${numericFlagID}:${numericChargeTypeID}`;
  if (session._space.primedChargeTupleKeys.has(tupleKey)) {
    return false;
  }

  session._space.primedChargeTupleKeys.add(tupleKey);
  const when =
    options.when != null
      ? options.when
      : resolveSessionNotificationFileTime(session);
  const ownerID = toInt(
    options.ownerID,
    toInt(chargeItem && chargeItem.ownerID, toInt(session.characterID, 0)),
  );
  const tupleItemID = buildChargeTupleItemID(
    numericShipID,
    numericFlagID,
    numericChargeTypeID,
  );
  const tupleChargeItem = {
    ...(chargeItem && typeof chargeItem === "object" ? chargeItem : {}),
    itemID: tupleItemID,
    ownerID: ownerID || null,
    locationID: numericShipID,
    flagID: numericFlagID,
    typeID: numericChargeTypeID,
    quantity,
    stacksize: quantity,
    singleton: 0,
    groupID: toInt(chargeItem && chargeItem.groupID, 0),
    categoryID: toInt(chargeItem && chargeItem.categoryID, 0),
    customInfo: String((chargeItem && chargeItem.customInfo) || ""),
  };

  session.sendNotification("OnGodmaPrimeItem", "clientID", [
    numericShipID,
    resolveChargeDogmaPrimeEntry(tupleChargeItem, {
      description: "charge",
      now: when,
    }),
  ]);
  const clearTimer = setTimeout(() => {
    const recentPrimeMap =
      session &&
      session._space &&
      session._space.recentlyPrimedChargeTupleKeys instanceof Map
        ? session._space.recentlyPrimedChargeTupleKeys
        : null;
    if (!recentPrimeMap) {
      return;
    }
    const currentTimer = recentPrimeMap.get(tupleKey);
    if (currentTimer === clearTimer) {
      recentPrimeMap.delete(tupleKey);
    }
  }, CHARGE_TUPLE_PRIME_GRACE_WINDOW_MS);
  if (typeof clearTimer.unref === "function") {
    clearTimer.unref();
  }
  session._space.recentlyPrimedChargeTupleKeys.set(tupleKey, clearTimer);
  return true;
}

function scheduleChargeDamageChangeForFreshTuplePrime(
  session,
  shipID,
  moduleFlagID,
  chargeTypeID,
  nextDamage,
  previousDamage,
  when = null,
) {
  const numericShipID = toInt(shipID, 0);
  const numericFlagID = toInt(moduleFlagID, 0);
  const numericChargeTypeID = toInt(chargeTypeID, 0);
  if (
    !session ||
    !session._space ||
    typeof session.sendNotification !== "function" ||
    numericShipID <= 0 ||
    numericFlagID <= 0 ||
    numericChargeTypeID <= 0
  ) {
    return false;
  }

  if (!(session._space.deferredChargeDamageChangeTimers instanceof Map)) {
    session._space.deferredChargeDamageChangeTimers = new Map();
  }
  const tupleKey = `${numericShipID}:${numericFlagID}:${numericChargeTypeID}`;
  const activeTimer = session._space.deferredChargeDamageChangeTimers.get(tupleKey);
  if (activeTimer) {
    clearTimeout(activeTimer);
  }

  const deferredTimer = setTimeout(() => {
    const timerMap =
      session &&
      session._space &&
      session._space.deferredChargeDamageChangeTimers instanceof Map
        ? session._space.deferredChargeDamageChangeTimers
        : null;
    if (timerMap) {
      timerMap.delete(tupleKey);
    }
    const recentPrimeMap =
      session &&
      session._space &&
      session._space.recentlyPrimedChargeTupleKeys instanceof Map
        ? session._space.recentlyPrimedChargeTupleKeys
        : null;
    if (recentPrimeMap && recentPrimeMap.has(tupleKey)) {
      clearTimeout(recentPrimeMap.get(tupleKey));
      recentPrimeMap.delete(tupleKey);
    }
    if (
      !session ||
      !session._space ||
      typeof session.sendNotification !== "function" ||
      (session.socket && session.socket.destroyed)
    ) {
      return;
    }
    notifyAttributeChanges(session, [buildAttributeChange(
      session,
      buildChargeTupleItemID(numericShipID, numericFlagID, numericChargeTypeID),
      ATTRIBUTE_ITEM_DAMAGE,
      roundNumber(toFiniteNumber(nextDamage, 0), 6),
      roundNumber(toFiniteNumber(previousDamage, 0), 6),
      when,
    )]);
  }, CHARGE_TUPLE_PRIME_SETTLE_DELAY_MS);
  if (typeof deferredTimer.unref === "function") {
    deferredTimer.unref();
  }
  session._space.deferredChargeDamageChangeTimers.set(tupleKey, deferredTimer);
  return true;
}

function isEntityLockedTarget(entity, targetID) {
  const normalizedTargetID = toInt(targetID, 0);
  if (!entity || normalizedTargetID <= 0) {
    return false;
  }

  return ensureEntityTargetingState(entity).lockedTargets.has(normalizedTargetID);
}

function notifyChargeDamageChangeToSession(
  session,
  shipID,
  moduleFlagID,
  chargeTypeID,
  nextDamage,
  previousDamage,
  when = null,
) {
  const numericShipID = toInt(shipID, 0);
  const numericFlagID = toInt(moduleFlagID, 0);
  const numericChargeTypeID = toInt(chargeTypeID, 0);
  if (
    !session ||
    numericShipID <= 0 ||
    numericFlagID <= 0 ||
    numericChargeTypeID <= 0
  ) {
    return false;
  }

  return notifyAttributeChanges(session, [buildAttributeChange(
    session,
    buildChargeTupleItemID(numericShipID, numericFlagID, numericChargeTypeID),
    ATTRIBUTE_ITEM_DAMAGE,
    roundNumber(toFiniteNumber(nextDamage, 0), 6),
    roundNumber(toFiniteNumber(previousDamage, 0), 6),
    when,
  )]);
}

function notifyChargeQuantityChangeToSession(
  session,
  shipID,
  moduleFlagID,
  chargeTypeID,
  nextQuantity,
  previousQuantity,
  when = null,
) {
  const numericShipID = toInt(shipID, 0);
  const numericFlagID = toInt(moduleFlagID, 0);
  const numericChargeTypeID = toInt(chargeTypeID, 0);
  if (
    !session ||
    numericShipID <= 0 ||
    numericFlagID <= 0 ||
    numericChargeTypeID <= 0
  ) {
    return false;
  }

  return notifyAttributeChanges(session, [buildAttributeChange(
    session,
    buildChargeTupleItemID(numericShipID, numericFlagID, numericChargeTypeID),
    ATTRIBUTE_QUANTITY,
    Math.max(0, toInt(nextQuantity, 0)),
    Math.max(0, toInt(previousQuantity, 0)),
    when,
  )]);
}

function getChargeItemQuantity(chargeItem) {
  return Math.max(
    0,
    toInt(chargeItem && (chargeItem.stacksize ?? chargeItem.quantity), 0),
  );
}

function notifyRuntimeChargeTransitionToSession(
  session,
  shipID,
  moduleFlagID,
  previousState = null,
  nextState = null,
  ownerID = 0,
  options = {},
) {
  const previousTypeID = toInt(previousState && previousState.typeID, 0);
  const nextTypeID = toInt(nextState && nextState.typeID, 0);
  const previousQuantity = Math.max(0, toInt(previousState && previousState.quantity, 0));
  const nextQuantity = Math.max(0, toInt(nextState && nextState.quantity, 0));

  if (previousTypeID === nextTypeID && previousQuantity === nextQuantity) {
    return false;
  }

  let notified = false;
  const when = options.when != null ? options.when : null;
  if (previousTypeID > 0) {
    notified =
      notifyChargeQuantityChangeToSession(
        session,
        shipID,
        moduleFlagID,
        previousTypeID,
        previousTypeID === nextTypeID ? nextQuantity : 0,
        previousQuantity,
        when,
      ) || notified;
  }
  if (nextTypeID > 0 && nextTypeID !== previousTypeID) {
    const nextChargeItem =
      options.nextChargeItem && typeof options.nextChargeItem === "object"
        ? options.nextChargeItem
        : {
            typeID: nextTypeID,
            ownerID,
            quantity: 0,
            stacksize: 0,
          };
    ensureChargeTupleDogmaPrimeForSession(
      session,
      shipID,
      moduleFlagID,
      {
        ...nextChargeItem,
        typeID: nextTypeID,
        quantity: 0,
        stacksize: 0,
      },
      {
        ownerID,
        quantityOverride: 0,
        when,
      },
    );
    notified =
      notifyChargeQuantityChangeToSession(
        session,
        shipID,
        moduleFlagID,
        nextTypeID,
        nextQuantity,
        0,
        when,
      ) || notified;
  }

  return notified;
}

function consumeTurretAmmoCharge(
  attackerEntity,
  moduleItem,
  chargeItem,
  whenMs = null,
) {
  if (!attackerEntity || !moduleItem || !chargeItem) {
    return {
      success: false,
      errorMsg: "NO_AMMO",
      stopReason: "ammo",
    };
  }

  const previousQuantity = getChargeItemQuantity(chargeItem);
  if (previousQuantity <= 0) {
    return {
      success: false,
      errorMsg: "NO_AMMO",
      stopReason: "ammo",
    };
  }

  const nextQuantity = Math.max(0, previousQuantity - 1);
  let updatedChargeItem = null;
  const previousChargeItemSnapshot =
    chargeItem && typeof chargeItem === "object"
      ? {
          ...chargeItem,
          quantity: previousQuantity,
          stacksize: previousQuantity,
        }
      : null;

  if (isNativeNpcEntity(attackerEntity)) {
    const entityID = toInt(attackerEntity.itemID, 0);
    const chargeItemID = toInt(chargeItem.itemID, 0);
    const moduleID = toInt(moduleItem.itemID, 0);
    const cargoRecord = nativeNpcStore
      .listNativeCargoForEntity(entityID)
      .find((entry) => (
        toInt(entry && entry.cargoID, 0) === chargeItemID ||
        (
          chargeItemID <= 0 &&
          moduleID > 0 &&
          toInt(entry && entry.moduleID, 0) === moduleID
        )
      )) || null;

    if (cargoRecord) {
      const persistResult = nextQuantity > 0
        ? nativeNpcStore.upsertNativeCargo({
          ...cargoRecord,
          quantity: nextQuantity,
        }, {
          transient: cargoRecord.transient === true,
        })
        : nativeNpcStore.removeNativeCargo(cargoRecord.cargoID);
      if (!persistResult.success) {
        return {
          success: false,
          errorMsg: persistResult.errorMsg || "AMMO_UPDATE_FAILED",
          stopReason: "ammo",
        };
      }
    }

    if (Array.isArray(attackerEntity.nativeCargoItems)) {
      attackerEntity.nativeCargoItems = attackerEntity.nativeCargoItems.flatMap((cargoItem) => {
        const matchesCharge = (
          toInt(cargoItem && cargoItem.itemID, 0) === chargeItemID ||
          (
            chargeItemID <= 0 &&
            moduleID > 0 &&
            toInt(cargoItem && cargoItem.moduleID, 0) === moduleID
          )
        );
        if (!matchesCharge) {
          return [cargoItem];
        }
        if (nextQuantity <= 0) {
          return [];
        }
        return [{
          ...cargoItem,
          quantity: nextQuantity,
          stacksize: nextQuantity,
        }];
      });
    }

    updatedChargeItem = nextQuantity > 0
      ? getEntityRuntimeLoadedCharge(attackerEntity, moduleItem) || {
        ...chargeItem,
        quantity: nextQuantity,
        stacksize: nextQuantity,
      }
      : null;
  } else {
    const chargeItemID = toInt(chargeItem.itemID, 0);
    if (chargeItemID <= 0) {
      return {
        success: false,
        errorMsg: "AMMO_NOT_FOUND",
        stopReason: "ammo",
      };
    }

    const persistResult = nextQuantity > 0
      ? updateInventoryItem(chargeItemID, (currentItem) => ({
        ...currentItem,
        quantity: nextQuantity,
        stacksize: nextQuantity,
      }))
      : removeInventoryItem(chargeItemID);
    if (!persistResult.success) {
      return {
        success: false,
        errorMsg: persistResult.errorMsg || "AMMO_UPDATE_FAILED",
        stopReason: "ammo",
      };
    }

    updatedChargeItem = nextQuantity > 0
      ? findItemById(chargeItemID) || {
        ...chargeItem,
        quantity: nextQuantity,
        stacksize: nextQuantity,
      }
      : null;
  }

  if (attackerEntity.session) {
    notifyRuntimeChargeTransitionToSession(
      attackerEntity.session,
      attackerEntity.itemID,
      moduleItem.flagID,
      {
        typeID: chargeItem.typeID,
        quantity: previousQuantity,
      },
      {
        typeID: chargeItem.typeID,
        quantity: nextQuantity,
      },
      getShipEntityInventoryCharacterID(attackerEntity, 0),
      {
        previousChargeItem: previousChargeItemSnapshot,
        nextChargeItem:
          updatedChargeItem && typeof updatedChargeItem === "object"
            ? {
                ...updatedChargeItem,
              }
            : null,
      },
    );
  }

  return {
    success: true,
    data: {
      chargeItem: updatedChargeItem,
      previousQuantity,
      nextQuantity,
      depleted: nextQuantity <= 0,
    },
    stopReason: nextQuantity <= 0 ? "ammo" : null,
  };
}

function buildShipHealthAttributeSnapshotFromDamageResult(damageResult) {
  const damageData =
    damageResult && damageResult.success === true && damageResult.data
      ? damageResult.data
      : null;
  if (!damageData) {
    return null;
  }

  const maxLayers = damageData.maxLayers || {};
  const beforeLayers = damageData.beforeLayers || {};
  const afterLayers = damageData.afterLayers || {};
  return {
    shieldCharge: {
      previous: roundNumber(toFiniteNumber(beforeLayers.shield, 0), 6),
      next: roundNumber(toFiniteNumber(afterLayers.shield, 0), 6),
    },
    armorDamage: {
      previous: roundNumber(
        Math.max(
          0,
          toFiniteNumber(maxLayers.armor, 0) - toFiniteNumber(beforeLayers.armor, 0),
        ),
        6,
      ),
      next: roundNumber(
        Math.max(
          0,
          toFiniteNumber(maxLayers.armor, 0) - toFiniteNumber(afterLayers.armor, 0),
        ),
        6,
      ),
    },
    structureDamage: {
      previous: roundNumber(
        Math.max(
          0,
          toFiniteNumber(maxLayers.structure, 0) - toFiniteNumber(beforeLayers.structure, 0),
        ),
        6,
      ),
      next: roundNumber(
        Math.max(
          0,
          toFiniteNumber(maxLayers.structure, 0) - toFiniteNumber(afterLayers.structure, 0),
        ),
        6,
      ),
    },
  };
}

function buildShipHealthTransitionResult(entity, previousConditionState = null) {
  if (!entity) {
    return null;
  }

  const normalizedPreviousConditionState = normalizeShipConditionState(
    previousConditionState === null || previousConditionState === undefined
      ? entity.conditionState
      : previousConditionState,
  );
  const maxLayers = getEntityMaxHealthLayers(entity);
  const beforeLayers = getEntityCurrentHealthLayers(
    {
      ...entity,
      conditionState: normalizedPreviousConditionState,
    },
    maxLayers,
  );
  const afterLayers = getEntityCurrentHealthLayers(entity, maxLayers);

  return {
    success: true,
    data: {
      maxLayers: {
        shield: roundNumber(toFiniteNumber(maxLayers.shield, 0), 6),
        armor: roundNumber(toFiniteNumber(maxLayers.armor, 0), 6),
        structure: roundNumber(toFiniteNumber(maxLayers.structure, 0), 6),
      },
      beforeLayers: {
        shield: roundNumber(toFiniteNumber(beforeLayers.shield, 0), 6),
        armor: roundNumber(toFiniteNumber(beforeLayers.armor, 0), 6),
        structure: roundNumber(toFiniteNumber(beforeLayers.structure, 0), 6),
      },
      afterLayers: {
        shield: roundNumber(toFiniteNumber(afterLayers.shield, 0), 6),
        armor: roundNumber(toFiniteNumber(afterLayers.armor, 0), 6),
        structure: roundNumber(toFiniteNumber(afterLayers.structure, 0), 6),
      },
      beforeConditionState: {
        ...normalizedPreviousConditionState,
      },
      afterConditionState: {
        ...normalizeShipConditionState(entity.conditionState),
      },
      destroyed: false,
    },
  };
}

function notifyShipHealthAttributesToSession(
  session,
  entity,
  damageResult,
  whenMs = null,
) {
  if (!session || !entity) {
    return false;
  }

  const shipID = toInt(entity.itemID, 0);
  const snapshot = buildShipHealthAttributeSnapshotFromDamageResult(damageResult);
  if (shipID <= 0 || !snapshot) {
    return false;
  }

  let timestamp;
  if (whenMs != null) {
    timestamp = resolveSessionNotificationFileTime(session, whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    timestamp = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyShipHealthAttributesToSession: no sim time source, using wallclock fallback");
    timestamp = currentFileTime();
  }

  const changes = [];
  const candidates = [
    [
      ATTRIBUTE_SHIP_SHIELD_CHARGE,
      snapshot.shieldCharge.next,
      snapshot.shieldCharge.previous,
    ],
    [
      ATTRIBUTE_SHIP_ARMOR_DAMAGE,
      snapshot.armorDamage.next,
      snapshot.armorDamage.previous,
    ],
    [
      ATTRIBUTE_SHIP_DAMAGE,
      snapshot.structureDamage.next,
      snapshot.structureDamage.previous,
    ],
  ];

  for (const [attributeID, nextValue, previousValue] of candidates) {
    if (attributeID <= 0 || Number(nextValue) === Number(previousValue)) {
      continue;
    }
    changes.push(
      buildAttributeChange(
        session,
        shipID,
        attributeID,
        nextValue,
        previousValue,
        timestamp,
      ),
    );
  }

  return notifyAttributeChanges(session, changes);
}

function healShipResourcesForSession(session, scene, entity, options = {}) {
  if (!entity || entity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const ownerSession = session || entity.session || null;
  const previousConditionState = normalizeShipConditionState(entity.conditionState);
  const previousChargeAmount = getEntityCapacitorAmount(entity);
  const healedConditionState = normalizeShipConditionState({
    ...previousConditionState,
    damage: 0,
    charge: 1,
    armorDamage: 0,
    shieldCharge: 1,
  });

  entity.conditionState = healedConditionState;
  setEntityCapacitorRatio(entity, healedConditionState.charge);
  persistDynamicEntity(entity);

  const nextConditionState = normalizeShipConditionState(entity.conditionState);
  const healthTransitionResult = buildShipHealthTransitionResult(
    entity,
    previousConditionState,
  );
  const healthChanged =
    Math.abs(
      toFiniteNumber(previousConditionState.shieldCharge, 0) -
        toFiniteNumber(nextConditionState.shieldCharge, 0),
    ) > 1e-6 ||
    Math.abs(
      toFiniteNumber(previousConditionState.armorDamage, 0) -
        toFiniteNumber(nextConditionState.armorDamage, 0),
    ) > 1e-6 ||
    Math.abs(
      toFiniteNumber(previousConditionState.damage, 0) -
        toFiniteNumber(nextConditionState.damage, 0),
    ) > 1e-6;
  const resolvedWhenMs =
    options.whenMs !== undefined && options.whenMs !== null
      ? toFiniteNumber(options.whenMs, Date.now())
      : scene
        ? scene.getCurrentSimTimeMs()
        : Date.now();

  if (ownerSession) {
    notifyShipHealthAttributesToSession(
      ownerSession,
      entity,
      healthTransitionResult,
      resolvedWhenMs,
    );
    notifyCapacitorChangeToSession(
      ownerSession,
      entity,
      resolvedWhenMs,
      previousChargeAmount,
    );
  }

  const deliveredCount =
    scene && healthChanged
      ? broadcastDamageStateChange(scene, entity, resolvedWhenMs)
      : 0;

  const canRefreshOwnerDamagePresentation =
    scene &&
    healthChanged &&
    ownerSession &&
    isReadyForDestiny(ownerSession) &&
    (
      !entity.session ||
      sessionMatchesIdentity(ownerSession, entity.session)
    );
  const shouldRefreshOwnerDamagePresentation =
    options.refreshOwnerDamagePresentation !== false &&
    canRefreshOwnerDamagePresentation;
  if (shouldRefreshOwnerDamagePresentation) {
    // Pilot HUD health already rides dogma attribute updates, but the ego ship's
    // in-space impact visuals can still need a fresh SetState re-read of the
    // authoritative damage-state map. Keep this owner-only because observers
    // already update from OnDamageStateChange. Callers can disable it for
    // live operator/debug actions like /heal where a full SetState rebase is
    // riskier than leaving stale impact visuals until the next normal refresh.
    const refreshStamp = ((scene.getCurrentDestinyStamp(resolvedWhenMs) + 1) >>> 0);
    scene.sendStateRefresh(ownerSession, entity, refreshStamp, {
      reason: "damage-presentation",
    });
  }

  return {
    success: true,
    data: {
      entity,
      whenMs: resolvedWhenMs,
      previousChargeAmount: roundNumber(previousChargeAmount, 6),
      currentChargeAmount: roundNumber(getEntityCapacitorAmount(entity), 6),
      previousConditionState,
      currentConditionState: nextConditionState,
      healthChanged,
      deliveredCount,
    },
  };
}

function broadcastDamageStateChange(scene, entity, whenMs = null, options = {}) {
  if (!scene || !entity) {
    return 0;
  }

  const sceneNowMs = scene.getCurrentSimTimeMs();
  const requestedWhenMs =
    whenMs === null || whenMs === undefined
      ? sceneNowMs
      : toFiniteNumber(whenMs, sceneNowMs);
  const maxPresentationStaleMs = Math.max(
    0,
    toFiniteNumber(
      options.maxPresentationStaleMs,
      Math.max(200, toFiniteNumber(scene._tickIntervalMs, 100) * 2),
    ),
  );
  const presentationWhenMs =
    options.allowHistoricalPresentationStamp === true
      ? requestedWhenMs
      : Math.max(requestedWhenMs, sceneNowMs - maxPresentationStaleMs);
  const entityID = toInt(entity && entity.itemID, 0);
  const isStaticSceneEntity =
    entityID > 0 &&
    scene.staticEntitiesByID instanceof Map &&
    scene.staticEntitiesByID.has(entityID);
  const rawBaseStamp = scene.getCurrentDestinyStamp(presentationWhenMs);
  const resolveSessionAlignedStamp =
    options && typeof options.resolveSessionAlignedStamp === "function"
      ? options.resolveSessionAlignedStamp
      : null;
  let deliveredCount = 0;
  const recipientSessions = new Set();

  for (const session of scene.sessions.values()) {
    if (!isReadyForDestiny(session)) {
      continue;
    }
    if (isStaticSceneEntity) {
      const egoEntity = scene.getShipEntityForSession(session);
      if (!egoEntity) {
        continue;
      }
      if (!scene.canSessionSeeStaticEntityForSession(session, entity)) {
        continue;
      }
    } else if (!scene.canSessionSeeDynamicEntity(session, entity)) {
      continue;
    }
    recipientSessions.add(session);
  }

  if (entity.session && isReadyForDestiny(entity.session)) {
    recipientSessions.add(entity.session);
  }

  const targetingState = ensureEntityTargetingState(entity);
  if (targetingState && targetingState.targetedBy instanceof Set) {
    for (const sourceID of targetingState.targetedBy) {
      const sourceEntity = scene.getEntityByID(sourceID);
      if (
        !sourceEntity ||
        !sourceEntity.session ||
        !isReadyForDestiny(sourceEntity.session)
      ) {
        continue;
      }
      recipientSessions.add(sourceEntity.session);
    }
  }

  for (const session of recipientSessions) {
    const visibleStamp = scene.getCurrentVisibleDestinyStampForSession(
      session,
      rawBaseStamp,
    );
    const isOwnerRecipient =
      entity.session &&
      isReadyForDestiny(entity.session) &&
      sessionMatchesIdentity(session, entity.session);
    const ownerSessionStamp = isOwnerRecipient
      ? scene.getCurrentSessionDestinyStamp(
          session,
          presentationWhenMs,
        )
      : 0;
    const recipientCurrentPresentedStamp =
      typeof scene.getCurrentPresentedSessionDestinyStamp === "function"
        ? scene.getCurrentPresentedSessionDestinyStamp(
            session,
            presentationWhenMs,
            MICHELLE_HELD_FUTURE_DESTINY_LEAD,
          )
        : 0;
    const ownerCurrentPresentedStamp = isOwnerRecipient
      ? recipientCurrentPresentedStamp
      : 0;
    const damageStateStampState = resolveDamageStateDispatchStamp({
      visibleStamp,
      currentPresentedStamp: recipientCurrentPresentedStamp,
      previousLastSentDestinyStamp: toInt(
        session && session._space && session._space.lastSentDestinyStamp,
        0,
      ),
      previousLastSentDestinyRawDispatchStamp: toInt(
        session &&
          session._space &&
          session._space.lastSentDestinyRawDispatchStamp,
        0,
      ),
      currentRawDispatchStamp: rawBaseStamp,
    });
    const alignedStamp =
      resolveSessionAlignedStamp !== null
        ? (toInt(
            resolveSessionAlignedStamp(session, {
              entity,
              nowMs: presentationWhenMs,
              rawBaseStamp,
              visibleStamp,
              isOwnerRecipient,
              currentPresentedStamp: recipientCurrentPresentedStamp,
              finalDamageStamp: damageStateStampState.finalStamp >>> 0,
            }),
            0,
          ) >>> 0)
        : 0;
    const stamp =
      alignedStamp > 0
        ? Math.min(
            damageStateStampState.finalStamp >>> 0,
            alignedStamp,
          ) >>> 0
        : damageStateStampState.finalStamp >>> 0;
    const sendOptions = isOwnerRecipient
      ? buildOwnerDamageStateSendOptions({
          translateStamps: false,
        })
      : buildObserverDamageStateSendOptions({
          translateStamps: false,
        });
    const damageStateFileTime =
      typeof scene.getCurrentClampedSessionFileTime === "function"
        ? scene.getCurrentClampedSessionFileTime(
          session,
          presentationWhenMs,
        )
        : scene.toFileTimeFromSimMs(
          presentationWhenMs,
          scene.getCurrentFileTime(),
        );
    const damageState = buildLiveDamageState(entity, damageStateFileTime);
    const updates = [{
      stamp,
      payload: destiny.buildOnDamageStateChangePayload(
        entity.itemID,
        damageState,
      ),
    }];
    logMissileDebug("damage-state.dispatch", {
      sceneSystemID: scene.systemID,
      requestedWhenMs: roundNumber(requestedWhenMs, 3),
      presentationWhenMs: roundNumber(presentationWhenMs, 3),
      presentationDelayMs: roundNumber(sceneNowMs - requestedWhenMs, 3),
      entity: summarizeRuntimeEntityForMissileDebug(entity),
      rawBaseStamp,
      visibleStamp,
      isOwnerRecipient,
      ownerSessionStamp,
      recipientCurrentPresentedStamp,
      ownerCurrentPresentedStamp,
      directCriticalEchoStamp: damageStateStampState.directCriticalEchoStamp,
      presentedDamageClearFloor:
        damageStateStampState.presentedDamageClearFloor || 0,
      sameRawPresentedDamageReuseClearFloor:
        damageStateStampState.sameRawPresentedDamageReuseClearFloor || 0,
      alignedStamp,
      finalStamp: stamp,
      damageStateFileTime,
      session: buildMissileSessionSnapshot(
        scene,
        session,
        presentationWhenMs,
      ),
      updates: summarizeMissileUpdatesForLog(updates),
    });
    if (scene.hasActiveTickDestinyPresentationBatch()) {
      scene.queueTickDestinyPresentationUpdates(session, updates, {
        getDedupeKey: (update) => (
          update && update.payload && Array.isArray(update.payload)
            ? `damage:${toInt(update.payload[1] && update.payload[1][0], entity.itemID)}`
            : null
        ),
        sendOptions,
      });
    } else {
      scene.sendDestinyUpdates(session, updates, false, sendOptions);
    }
    deliveredCount += 1;
  }

  return deliveredCount;
}

function getCombatMessageHitQuality(shotResult) {
  if (!shotResult || shotResult.hit !== true) {
    return 0;
  }

  const quality = toFiniteNumber(shotResult.quality, 0);
  if (quality >= 3) {
    return 6;
  }
  if (quality >= 1.2) {
    return 5;
  }
  if (quality >= 1.0) {
    return 4;
  }
  if (quality >= 0.85) {
    return 3;
  }
  if (quality >= 0.65) {
    return 2;
  }
  return 1;
}

function getAppliedDamageAmount(damageResult) {
  if (!damageResult || damageResult.success !== true || !damageResult.data) {
    return 0;
  }

  const perLayer = Array.isArray(damageResult.data.perLayer)
    ? damageResult.data.perLayer
    : [];
  return roundNumber(
    perLayer.reduce(
      (sum, layerEntry) => sum + toFiniteNumber(layerEntry && layerEntry.appliedEffective, 0),
      0,
    ),
    6,
  );
}

function buildMarshalDict(entries = []) {
  return {
    type: "dict",
    entries,
  };
}

function buildCombatMessageDamageDict(damageVector = {}) {
  return buildMarshalDict([
    [
      ATTRIBUTE_EM_DAMAGE,
      roundNumber(toFiniteNumber(damageVector && damageVector.em, 0), 6),
    ],
    [
      ATTRIBUTE_THERMAL_DAMAGE,
      roundNumber(toFiniteNumber(damageVector && damageVector.thermal, 0), 6),
    ],
    [
      ATTRIBUTE_KINETIC_DAMAGE,
      roundNumber(toFiniteNumber(damageVector && damageVector.kinetic, 0), 6),
    ],
    [
      ATTRIBUTE_EXPLOSIVE_DAMAGE,
      roundNumber(toFiniteNumber(damageVector && damageVector.explosive, 0), 6),
    ],
  ]);
}

function getCombatNotificationSession(entity) {
  return entity && entity.session && typeof entity.session.sendNotification === "function"
    ? entity.session
    : null;
}

function resolveCombatMessageOwnerID(entity, moduleItem = null) {
  const entityCharacterID = toInt(
    entity && (
      entity.pilotCharacterID ??
      entity.characterID
    ),
    0,
  );
  if (entityCharacterID > 0) {
    return entityCharacterID;
  }

  const entityOwnerID = toInt(
    entity && (
      entity.ownerID ??
      entity.corporationID
    ),
    0,
  );
  if (entityOwnerID > 0) {
    return entityOwnerID;
  }

  return toInt(moduleItem && moduleItem.ownerID, 0);
}

function getOwningSessionForEntity(scene, entity) {
  if (
    entity &&
    entity.session &&
    typeof entity.session.sendNotification === "function"
  ) {
    return entity.session;
  }
  if (!scene || !(scene.sessions instanceof Map) || !entity) {
    return null;
  }

  const shipID = toInt(entity.itemID, 0);
  if (shipID <= 0) {
    return null;
  }

  for (const session of scene.sessions.values()) {
    if (toInt(session && session._space && session._space.shipID, 0) === shipID) {
      return session;
    }
  }
  return null;
}

function buildLaserDamageMessagePayload({
  attackType = "me",
  attackerEntity = null,
  targetEntity = null,
  moduleItem = null,
  shotDamage = null,
  totalDamage = 0,
  hitQuality = 0,
  includeAttackerID = false,
  isBanked = false,
} = {}) {
  const resolvedShotDamage =
    shotDamage && typeof shotDamage === "object"
      ? shotDamage
      : {};
  const attackerID = (() => {
    const entityItemID = toInt(attackerEntity && attackerEntity.itemID, 0);
    if (entityItemID > 0) {
      return entityItemID;
    }
    return toInt(moduleItem && moduleItem.locationID, 0);
  })();
  const targetID = toInt(targetEntity && targetEntity.itemID, 0);
  const sourceOwnerID = resolveCombatMessageOwnerID(attackerEntity, moduleItem);
  const targetOwnerID = resolveCombatMessageOwnerID(targetEntity, null);
  const weaponTypeID = (() => {
    const moduleTypeID = toInt(moduleItem && moduleItem.typeID, 0);
    if (moduleTypeID > 0) {
      return moduleTypeID;
    }
    return toInt(attackerEntity && attackerEntity.typeID, 0);
  })();
  const entries = [
    ["attackType", String(attackType || "me")],
    ["source", attackerID],
    ["target", targetID],
    ["weapon", weaponTypeID],
    ["damage", roundNumber(toFiniteNumber(totalDamage, 0), 6)],
    ["damageAttributes", buildCombatMessageDamageDict(resolvedShotDamage)],
    ["damageTypes", buildMarshalDict([
      ["em", roundNumber(toFiniteNumber(resolvedShotDamage.em, 0), 6)],
      ["thermal", roundNumber(toFiniteNumber(resolvedShotDamage.thermal, 0), 6)],
      ["kinetic", roundNumber(toFiniteNumber(resolvedShotDamage.kinetic, 0), 6)],
      ["explosive", roundNumber(toFiniteNumber(resolvedShotDamage.explosive, 0), 6)],
    ])],
    ["hitQuality", toInt(hitQuality, 0)],
    ["isBanked", isBanked === true],
  ];

  if (sourceOwnerID > 0) {
    entries.push(["sourceCharID", sourceOwnerID]);
  }
  if (targetOwnerID > 0) {
    entries.push(["targetOwnerID", targetOwnerID]);
  }
  if (includeAttackerID && attackerID > 0) {
    entries.push(["attackerID", attackerID]);
  }

  return buildMarshalDict(entries);
}

function notifyWeaponDamageMessages(
  attackerEntity,
  targetEntity,
  moduleItem,
  shotDamage,
  totalDamage,
  hitQuality = 0,
  options = {},
) {
  if (!targetEntity || !moduleItem) {
    return false;
  }

  try {
    const droneRuntime = require(path.join(
      __dirname,
      "../services/drone/droneRuntime",
    ));
    if (droneRuntime && typeof droneRuntime.noteIncomingAggression === "function") {
      droneRuntime.noteIncomingAggression(
        attackerEntity,
        targetEntity,
        Date.now(),
      );
    }
  } catch (error) {
    log.warn(`[SpaceRuntime] Drone aggression note failed: ${error.message}`);
  }

  const resolvedShotDamage =
    shotDamage && typeof shotDamage === "object"
      ? shotDamage
      : {};
  const resolvedTotalDamage = roundNumber(toFiniteNumber(totalDamage, 0), 6);
  let notified = false;

  const attackerSession = getCombatNotificationSession(attackerEntity);
  if (attackerSession) {
    attackerSession.sendNotification("OnDamageMessage", "clientID", [
      buildLaserDamageMessagePayload({
        attackType: "me",
        attackerEntity,
        targetEntity,
        moduleItem,
        shotDamage: resolvedShotDamage,
        totalDamage: resolvedTotalDamage,
        hitQuality,
        isBanked: options && options.isBanked === true,
      }),
    ]);
    notified = true;
  }

  const targetSession = getCombatNotificationSession(targetEntity);
  if (targetSession && targetSession !== attackerSession) {
    targetSession.sendNotification("OnDamageMessage", "clientID", [
      buildLaserDamageMessagePayload({
        attackType: "otherPlayerWeapons",
        attackerEntity,
        targetEntity,
        moduleItem,
        shotDamage: resolvedShotDamage,
        totalDamage: resolvedTotalDamage,
        hitQuality,
        includeAttackerID: true,
        isBanked: options && options.isBanked === true,
      }),
    ]);
    notified = true;
  }

  return notified;
}

function applyWeaponDamageToTarget(
  scene,
  attackerEntity,
  targetEntity,
  shotDamage,
  whenMs,
  options = {},
) {
  const resolvedShotDamage =
    shotDamage && typeof shotDamage === "object"
      ? shotDamage
      : {};
  if (!targetEntity || !hasDamageableHealth(targetEntity)) {
    return {
      damageResult: null,
      destroyResult: null,
    };
  }
  if (structureTethering.isEntityStructureTethered(targetEntity)) {
    return {
      damageResult: null,
      destroyResult: null,
    };
  }
  if (sumDamageVector(resolvedShotDamage) <= 0) {
    return {
      damageResult: null,
      destroyResult: null,
    };
  }

  const fighterDamageContext =
    targetEntity.kind === "fighter" &&
    typeof applyDamageToFighterSquadronSafe === "function"
      ? applyDamageToFighterSquadronSafe(
        scene,
        targetEntity,
        resolvedShotDamage,
        whenMs,
      )
      : null;
  const damageResult = fighterDamageContext && fighterDamageContext.damageResult
    ? fighterDamageContext.damageResult
    : applyDamageToEntity(targetEntity, resolvedShotDamage);
  let destroyResult = null;
  if (damageResult.success) {
    try {
      const droneRuntime = require(path.join(
        __dirname,
        "../services/drone/droneRuntime",
      ));
      if (droneRuntime && typeof droneRuntime.noteIncomingAggression === "function") {
        droneRuntime.noteIncomingAggression(
          attackerEntity,
          targetEntity,
          whenMs,
        );
      }
    } catch (error) {
      log.warn(`[SpaceRuntime] Drone aggression note failed: ${error.message}`);
    }
    if (targetEntity.kind === "structure") {
      const structureDamageResult = structureState.applyRuntimeStructureDamage(
        targetEntity.itemID,
        damageResult,
        whenMs,
      );
      if (structureDamageResult.success && structureDamageResult.data) {
        const updatedStructure = structureDamageResult.data.structure;
        targetEntity.state = updatedStructure.state;
        targetEntity.stateStartedAt = updatedStructure.stateStartedAt || null;
        targetEntity.stateEndsAt = updatedStructure.stateEndsAt || null;
        targetEntity.upkeepState = updatedStructure.upkeepState;
        targetEntity.deedState = updatedStructure.hasQuantumCore === true ? 1 : 0;
        targetEntity.serviceStates = updatedStructure.serviceStates || {};
        targetEntity.unanchoring = updatedStructure.unanchoring || null;
        targetEntity.conditionState = normalizeShipConditionState(updatedStructure.conditionState);
        if (structureDamageResult.data.preventDestroy === true && damageResult.data) {
          damageResult.data.destroyed = false;
          damageResult.data.afterConditionState = {
            ...targetEntity.conditionState,
          };
        }
      }
    }
    try {
      const npcService = require(path.join(__dirname, "./npc"));
      if (npcService && typeof npcService.noteNpcIncomingAggression === "function") {
        npcService.noteNpcIncomingAggression(
          targetEntity,
          attackerEntity,
          whenMs,
        );
      }
    } catch (error) {
      log.warn(`[SpaceRuntime] NPC aggression note failed: ${error.message}`);
    }
    persistDynamicEntity(targetEntity);
    if (
      fighterDamageContext &&
      typeof handleFighterPostDamageSafe === "function"
    ) {
      handleFighterPostDamageSafe(scene, targetEntity, damageResult, {
        beforeSquadronSize: fighterDamageContext.beforeSquadronSize,
      });
    }
    if (targetEntity.session) {
      notifyShipHealthAttributesToSession(
        targetEntity.session,
        targetEntity,
        damageResult,
        whenMs,
      );
    }
    if (damageResult.data && damageResult.data.destroyed) {
      const resolveSessionAlignedStamp =
        options && options.alignLethalDamageToDestruction === true
          ? (session, context = {}) => resolveExplodingNonMissileDestructionSessionStamp(
              scene,
              session,
              context.nowMs,
              context.rawBaseStamp,
            )
          : null;
      broadcastDamageStateChange(scene, targetEntity, whenMs, {
        resolveSessionAlignedStamp,
      });
      destroyResult = destroyCombatEntity(scene, targetEntity);
      if (
        destroyResult &&
        destroyResult.success === true &&
        targetEntity.kind === "drone" &&
        typeof handleDroneDestroyedSafe === "function"
      ) {
        handleDroneDestroyedSafe(scene, targetEntity);
      }
      if (
        destroyResult &&
        destroyResult.success === true &&
        targetEntity.kind === "fighter" &&
        typeof handleFighterDestroyedSafe === "function"
      ) {
        handleFighterDestroyedSafe(scene, targetEntity);
      }
    } else {
      broadcastDamageStateChange(scene, targetEntity, whenMs);
    }
  }

  return {
    damageResult,
    destroyResult,
  };
}

function applyCrystalVolatilityDamage(
  scene,
  attackerEntity,
  moduleItem,
  chargeItem,
  whenMs = null,
) {
  if (!scene || !attackerEntity || !moduleItem || !chargeItem) {
    return {
      success: false,
      errorMsg: "CRYSTAL_NOT_FOUND",
    };
  }

  const chargeAttributes = getTypeDogmaAttributes(chargeItem.typeID);
  const volatilityChance = clamp(
    toFiniteNumber(
      chargeAttributes && chargeAttributes[String(ATTRIBUTE_CRYSTAL_VOLATILITY_CHANCE)],
      0,
    ),
    0,
    1,
  );
  const volatilityDamage = Math.max(
    0,
    toFiniteNumber(
      chargeAttributes && chargeAttributes[String(ATTRIBUTE_CRYSTAL_VOLATILITY_DAMAGE)],
      0,
    ),
  );
  if (volatilityChance <= 0 || volatilityDamage <= 0) {
    return {
      success: true,
      data: {
        chargeItem,
        damaged: false,
        burnedOut: false,
      },
    };
  }
  if (Math.random() > volatilityChance) {
    return {
      success: true,
      data: {
        chargeItem,
        damaged: false,
        burnedOut: false,
      },
    };
  }

  const previousDamage = clamp(
    toFiniteNumber(
      chargeItem && chargeItem.moduleState && chargeItem.moduleState.damage,
      0,
    ),
    0,
    1,
  );
  const nextDamage = clamp(previousDamage + volatilityDamage, 0, 1);
  const when = resolveSessionNotificationFileTime(attackerEntity.session, whenMs);
  let updatedChargeItem = chargeItem;
  if (isNativeNpcEntity(attackerEntity)) {
    const cargoRecord = nativeNpcStore
      .listNativeCargoForEntity(attackerEntity.itemID)
      .find((entry) => toInt(entry && entry.cargoID, 0) === toInt(chargeItem && chargeItem.itemID, 0));
    if (!cargoRecord) {
      return {
        success: false,
        errorMsg: "CRYSTAL_NOT_FOUND",
      };
    }

    const updateResult = nativeNpcStore.upsertNativeCargo({
      ...cargoRecord,
      moduleState: {
        ...(cargoRecord && cargoRecord.moduleState ? cargoRecord.moduleState : {}),
        damage: nextDamage,
      },
    }, {
      transient: cargoRecord.transient === true,
    });
    if (!updateResult.success) {
      return updateResult;
    }

    if (Array.isArray(attackerEntity.nativeCargoItems)) {
      attackerEntity.nativeCargoItems = attackerEntity.nativeCargoItems.map((cargoItem) => (
        toInt(cargoItem && cargoItem.itemID, 0) === toInt(chargeItem && chargeItem.itemID, 0)
          ? {
              ...cargoItem,
              moduleState: {
                ...(cargoItem && cargoItem.moduleState ? cargoItem.moduleState : {}),
                damage: nextDamage,
              },
            }
          : cargoItem
      ));
    }
    updatedChargeItem = getEntityRuntimeLoadedCharge(attackerEntity, moduleItem) || {
      ...chargeItem,
      moduleState: {
        ...(chargeItem && chargeItem.moduleState ? chargeItem.moduleState : {}),
        damage: nextDamage,
      },
    };
  } else {
    const updateResult = updateInventoryItem(chargeItem.itemID, (currentItem) => ({
      ...currentItem,
      moduleState: {
        ...(currentItem && currentItem.moduleState ? currentItem.moduleState : {}),
        damage: nextDamage,
      },
    }));
    if (!updateResult.success) {
      return updateResult;
    }
    updatedChargeItem = findItemById(chargeItem.itemID) || chargeItem;
  }

  if (attackerEntity.session) {
    notifyChargeDamageChangeToSession(
      attackerEntity.session,
      attackerEntity.itemID,
      moduleItem.flagID,
      chargeItem.typeID,
      nextDamage,
      previousDamage,
      when,
    );
  }

  if (nextDamage < 1 - 1e-9) {
    return {
      success: true,
      data: {
        chargeItem: updatedChargeItem,
        damaged: true,
        burnedOut: false,
        previousDamage,
        nextDamage,
      },
    };
  }

  let removeResult = null;
  if (isNativeNpcEntity(attackerEntity)) {
    const cargoRecord = nativeNpcStore
      .listNativeCargoForEntity(attackerEntity.itemID)
      .find((entry) => toInt(entry && entry.cargoID, 0) === toInt(chargeItem && chargeItem.itemID, 0))
      || null;
    if (cargoRecord) {
      removeResult = nativeNpcStore.removeNativeCargo(cargoRecord.cargoID);
    } else if (Array.isArray(attackerEntity.nativeCargoItems)) {
      removeResult = { success: true };
    } else {
      removeResult = {
        success: false,
        errorMsg: "CRYSTAL_NOT_FOUND",
      };
    }
    if (removeResult.success && Array.isArray(attackerEntity.nativeCargoItems)) {
      attackerEntity.nativeCargoItems = attackerEntity.nativeCargoItems.filter(
        (cargoItem) => toInt(cargoItem && cargoItem.itemID, 0) !== toInt(chargeItem && chargeItem.itemID, 0),
      );
    }
  } else {
    removeResult = removeInventoryItem(chargeItem.itemID);
  }
  if (removeResult.success && attackerEntity.session) {
    notifyRuntimeChargeTransitionToSession(
      attackerEntity.session,
      attackerEntity.itemID,
      moduleItem.flagID,
      {
        typeID: chargeItem.typeID,
        quantity: 1,
      },
      {
        typeID: chargeItem.typeID,
        quantity: 0,
      },
      getShipEntityInventoryCharacterID(attackerEntity, 0),
      {
        previousChargeItem:
          chargeItem && typeof chargeItem === "object"
            ? {
                ...chargeItem,
                quantity: 1,
                stacksize: 1,
              }
            : null,
        nextChargeItem: null,
      },
    );
  }

  return {
    success: removeResult.success,
    errorMsg: removeResult.success ? null : removeResult.errorMsg,
    data: {
      chargeItem: removeResult.success ? null : updatedChargeItem,
      damaged: true,
      burnedOut: removeResult.success,
      previousDamage,
      nextDamage,
    },
  };
}

function destroyCombatEntity(scene, entity) {
  if (!scene || !entity) {
    return {
      success: false,
      errorMsg: "ENTITY_NOT_FOUND",
    };
  }

  if (entity.kind === "ship") {
    const {
      destroySessionShip,
      destroyShipEntityWithWreck,
    } = require(path.join(__dirname, "./shipDestruction"));
    if (entity.session) {
      return destroySessionShip(entity.session, {
        sessionChangeReason: "combat",
      });
    }
    const destroyResult = destroyShipEntityWithWreck(scene.systemID, entity, {
      ownerCharacterID: toInt(
        getShipEntityInventoryCharacterID(entity, 0) || entity.ownerID,
        0,
      ),
      shipRecord: findShipItemById(entity.itemID) || null,
    });
    if (destroyResult && destroyResult.success === true) {
      return destroyResult;
    }

    const canUseTransientFallback =
      entity.session == null &&
      entity.persistSpaceState !== true &&
      !findShipItemById(entity.itemID) &&
      (
        !destroyResult ||
        destroyResult.errorMsg === "OWNER_CHARACTER_REQUIRED" ||
        destroyResult.errorMsg === "WRECK_CREATE_FAILED"
      );
    if (canUseTransientFallback) {
      const fallbackResult = scene.removeDynamicEntity(entity.itemID, {
        allowSessionOwned: false,
        terminalDestructionEffectID: DESTRUCTION_EFFECT_EXPLOSION,
      });
      if (fallbackResult && fallbackResult.success === true) {
        log.warn(
          `[SpaceRuntime] Falling back to transient ship destruction without wreck for ship=${entity.itemID} type=${entity.typeID} error=${destroyResult && destroyResult.errorMsg ? destroyResult.errorMsg : "UNKNOWN"}`,
        );
        return {
          success: true,
          data: {
            shipID: entity.itemID,
            wreck: null,
            transientFallback: true,
            lootOutcome: {
              items: [],
            },
            changes: [],
          },
        };
      }
    }

    return destroyResult;
  }

  if (isInventoryBackedDynamicEntity(entity)) {
    return scene.destroyInventoryBackedDynamicEntity(entity.itemID, {
      terminalDestructionEffectID: DESTRUCTION_EFFECT_EXPLOSION,
    });
  }

  if (entity.kind === "structure") {
    breakStructureTethersForStructure(scene, entity.itemID, {
      nowMs: scene.getCurrentSimTimeMs(),
      reason: "STRUCTURE_DESTROYED",
    });
    const destroyResult = structureState.destroyStructure(entity.itemID);
    if (!destroyResult.success) {
      return destroyResult;
    }
    scene.removeStaticEntity(entity.itemID, {
      terminalDestructionEffectID: DESTRUCTION_EFFECT_EXPLOSION,
    });
    const spawnLootResult = spawnDeferredStructureLootEntities(scene, entity.itemID);
    if (!spawnLootResult.success) {
      return spawnLootResult;
    }
    return {
      success: true,
      data: {
        structureID: entity.itemID,
        loot:
          destroyResult && destroyResult.data && destroyResult.data.loot
            ? destroyResult.data.loot
            : null,
        lootItemIDs:
          spawnLootResult.data && Array.isArray(spawnLootResult.data.itemIDs)
            ? spawnLootResult.data.itemIDs
            : [],
      },
    };
  }

  return {
    success: false,
    errorMsg: "ENTITY_NOT_DAMAGEABLE",
  };
}

function executeTurretCycle(scene, attackerEntity, effectState, cycleBoundaryMs) {
  const moduleItem = getEntityRuntimeModuleItem(
    attackerEntity,
    toInt(effectState && effectState.moduleID, 0),
    toInt(effectState && effectState.moduleFlagID, 0),
  );
  if (!attackerEntity || !effectState || !moduleItem) {
    return {
      success: false,
      errorMsg: "MODULE_NOT_FOUND",
      stopReason: "module",
    };
  }

  const chargeItem = getEntityRuntimeLoadedCharge(attackerEntity, moduleItem);
  const family = resolveWeaponFamily(moduleItem, chargeItem);
  const chargeOptionalTurretWeapon = isChargeOptionalTurretWeapon(
    moduleItem,
    chargeItem,
  );
  if (!isTurretWeaponFamily(family)) {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_WEAPON",
      stopReason: "weapon",
    };
  }
  const bankContext = resolveGroupedWeaponBankContext(
    attackerEntity,
    effectState,
    moduleItem,
    {
      family,
    },
  );
  const armedEntries = bankContext.contributingEntries.filter(
    (entry) => entry && entry.chargeItem,
  );
  if (
    !chargeOptionalTurretWeapon &&
    (armedEntries.length <= 0 || !chargeItem)
  ) {
    const reloadState = queueAutomaticNpcTurretReload(
      scene,
      attackerEntity,
      moduleItem,
      toInt(effectState && effectState.chargeTypeID, 0),
      cycleBoundaryMs,
    );
    return {
      success: true,
      data: {
        moduleItem,
        chargeItem: null,
        targetEntity: null,
        weaponSnapshot: null,
        shotResult: null,
        damageResult: null,
        destroyResult: null,
        crystalResult: null,
        ammoResult: null,
        reloadState,
      stopReason: reloadState ? null : "ammo",
      },
    };
  }
  const activeTurretEntries =
    armedEntries.length > 0
      ? armedEntries
      : [{
        moduleItem,
        chargeItem: null,
      }];

  const targetEntity = scene.getEntityByID(effectState.targetID);
  if (
    !targetEntity ||
    !hasDamageableHealth(targetEntity) ||
    !isEntityLockedTarget(attackerEntity, effectState.targetID)
  ) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
      stopReason: "target",
    };
  }

  const shipRecord = getEntityRuntimeShipItem(attackerEntity);
  if (!shipRecord) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
      stopReason: "ship",
    };
  }

  const weaponSnapshot = buildWeaponSnapshotForEntity(
    attackerEntity,
    bankContext.primaryEntry && bankContext.primaryEntry.moduleItem
      ? bankContext.primaryEntry.moduleItem
      : moduleItem,
    bankContext.primaryEntry && bankContext.primaryEntry.chargeItem
      ? bankContext.primaryEntry.chargeItem
      : chargeItem,
    {
      shipItem: shipRecord,
    },
  );
  if (!weaponSnapshot) {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_WEAPON",
      stopReason: "weapon",
    };
  }
  const resolvedWeaponSnapshot = buildBankedWeaponSnapshot(
    weaponSnapshot,
    bankContext,
  );
  if (isPrecursorTurretFamily(resolvedWeaponSnapshot.family)) {
    synchronizePrecursorTurretEffectState(
      effectState,
      resolvedWeaponSnapshot,
      cycleBoundaryMs,
    );
    const surfaceDistance = getEntitySurfaceDistance(attackerEntity, targetEntity);
    if (surfaceDistance > toFiniteNumber(resolvedWeaponSnapshot.optimalRange, 0) + 1e-6) {
      return {
        success: true,
        data: {
          moduleItem,
          chargeItem,
          targetEntity,
          weaponSnapshot: resolvedWeaponSnapshot,
          shotResult: null,
          damageResult: null,
          destroyResult: null,
          crystalResult: null,
          ammoResult: null,
          reloadState: null,
          stopReason: "range",
        },
      };
    }
  }
  const presentedWeaponSnapshot = isPrecursorTurretFamily(resolvedWeaponSnapshot.family)
    ? applyPrecursorTurretSpoolToSnapshot(resolvedWeaponSnapshot, effectState)
    : resolvedWeaponSnapshot;

  const shotResult = resolveTurretShot({
    attackerEntity,
    targetEntity,
    weaponSnapshot: presentedWeaponSnapshot,
  });
  let damageResult = null;
  let destroyResult = null;

  if (shotResult.hit && hasDamageableHealth(targetEntity)) {
    const weaponDamageResult = applyWeaponDamageToTarget(
      scene,
      attackerEntity,
      targetEntity,
      shotResult.shotDamage,
      cycleBoundaryMs,
    );
    damageResult = weaponDamageResult.damageResult;
    destroyResult = weaponDamageResult.destroyResult;
    const appliedDamageAmount = getAppliedDamageAmount(damageResult);
    if (appliedDamageAmount > 0) {
      noteKillmailDamage(attackerEntity, targetEntity, appliedDamageAmount, {
        whenMs: cycleBoundaryMs,
        weaponSnapshot: presentedWeaponSnapshot,
        moduleItem,
        chargeItem,
      });
    }
    if (destroyResult && destroyResult.success) {
      recordKillmailFromDestruction(targetEntity, destroyResult, {
        attackerEntity,
        whenMs: cycleBoundaryMs,
        weaponSnapshot: presentedWeaponSnapshot,
        moduleItem,
        chargeItem,
      });
    }
  }

  notifyWeaponDamageMessages(
    attackerEntity,
    targetEntity,
    moduleItem,
    shotResult && shotResult.shotDamage,
    getAppliedDamageAmount(damageResult),
    getCombatMessageHitQuality(shotResult),
    {
      isBanked: bankContext.banked,
    },
  );
  if (isPrecursorTurretFamily(resolvedWeaponSnapshot.family)) {
    advancePrecursorTurretSpool(effectState, resolvedWeaponSnapshot, cycleBoundaryMs);
  }

  const chargeResults = [];
  let resolvedChargeItem = chargeItem;
  let reloadState = null;
  let groupedAmmoFailure = false;
  let groupedAmmoStopReason = null;
  for (const entry of activeTurretEntries) {
    const currentModuleItem = entry.moduleItem;
    const currentChargeItem = entry.chargeItem;
    if (!currentChargeItem && chargeOptionalTurretWeapon) {
      chargeResults.push({
        success: true,
        data: {
          chargeItem: null,
          depleted: false,
          burnedOut: false,
          stopReason: null,
        },
      });
      if (
        !reloadState &&
        currentModuleItem &&
        toInt(currentModuleItem.itemID, 0) === toInt(moduleItem.itemID, 0)
      ) {
        resolvedChargeItem = null;
      }
      continue;
    }
    const chargeResult = resolvedWeaponSnapshot.chargeMode === "crystal"
      ? applyCrystalVolatilityDamage(
        scene,
        attackerEntity,
        currentModuleItem,
        currentChargeItem,
        cycleBoundaryMs,
      )
      : consumeTurretAmmoCharge(
        attackerEntity,
        currentModuleItem,
        currentChargeItem,
        cycleBoundaryMs,
      );
    chargeResults.push(chargeResult);
    if (
      !reloadState &&
      currentModuleItem &&
      toInt(currentModuleItem.itemID, 0) === toInt(moduleItem.itemID, 0)
    ) {
      resolvedChargeItem =
        chargeResult && chargeResult.success === true && chargeResult.data
          ? (
            Object.prototype.hasOwnProperty.call(chargeResult.data, "chargeItem")
              ? chargeResult.data.chargeItem
              : currentChargeItem
          )
          : currentChargeItem;
    }
    if (!chargeResult.success) {
      groupedAmmoFailure = true;
      groupedAmmoStopReason = groupedAmmoStopReason || "ammo";
      continue;
    }
    if (
      !reloadState &&
      attackerEntity.nativeNpc === true &&
      chargeResult.data &&
      chargeResult.data.depleted
    ) {
      reloadState = queueAutomaticNpcTurretReload(
        scene,
        attackerEntity,
        currentModuleItem,
        toInt(currentChargeItem && currentChargeItem.typeID, 0),
        cycleBoundaryMs,
      );
    }
    if (
      chargeResult.data &&
      (
        chargeResult.data.burnedOut ||
        chargeResult.data.depleted
      ) &&
      !reloadState
    ) {
      groupedAmmoStopReason = groupedAmmoStopReason || "ammo";
    }
  }
  if (!reloadState && !resolvedChargeItem) {
    resolvedChargeItem =
      chargeResults[0] && chargeResults[0].success && chargeResults[0].data
        ? (
          Object.prototype.hasOwnProperty.call(chargeResults[0].data, "chargeItem")
            ? chargeResults[0].data.chargeItem
            : chargeItem
        )
        : chargeItem;
  }

  return {
    success: true,
    data: {
      moduleItem,
      chargeItem: resolvedChargeItem,
      targetEntity,
      weaponSnapshot: presentedWeaponSnapshot,
      shotResult,
      damageResult,
      destroyResult,
      crystalResult: resolvedWeaponSnapshot.chargeMode === "crystal" ? chargeResults : null,
      ammoResult: resolvedWeaponSnapshot.chargeMode === "stack" ? chargeResults : null,
      reloadState,
      stopReason:
        groupedAmmoFailure
          ? "ammo"
          : (
            groupedAmmoStopReason ||
            (
              chargeResults.some(
                (chargeResult) =>
                  chargeResult &&
                  chargeResult.success === true &&
                  chargeResult.data &&
                  (
                    chargeResult.data.burnedOut ||
                    chargeResult.data.depleted
                  ),
              )
                ? (reloadState ? null : "ammo")
                : null
            ) ||
            (
              chargeResults[0] &&
              chargeResults[0].data &&
              chargeResults[0].stopReason
            ) ||
            null
          ),
    },
  };
}

function queueAutomaticNpcTurretReload(
  scene,
  attackerEntity,
  moduleItem,
  chargeTypeID,
  startedAtMs,
) {
  if (
    !scene ||
    !attackerEntity ||
    attackerEntity.nativeNpc !== true ||
    !moduleItem ||
    toInt(chargeTypeID, 0) <= 0
  ) {
    return null;
  }

  const ownerSession = getOwningSessionForEntity(scene, attackerEntity);
  const reloadResult = queueAutomaticLocalModuleReload({
    session: ownerSession,
    entity: attackerEntity,
    moduleItem,
    chargeTypeID: toInt(chargeTypeID, 0),
    reloadTimeMs: Math.max(
      0,
      Math.round(Number(getTypeAttributeValue(moduleItem.typeID, "reloadTime")) || 0),
    ),
    startedAtMs,
    shipID: toInt(attackerEntity.itemID, 0),
    ammoLocationID: toInt(attackerEntity.itemID, 0),
    resumeMode: "start",
  });
  return reloadResult.success && reloadResult.data
    ? reloadResult.data.reloadState || null
    : null;
}

function executeMissileCycle(
  scene,
  attackerEntity,
  effectState,
  cycleBoundaryMs,
  options = {},
) {
  const moduleItem = getEntityRuntimeModuleItem(
    attackerEntity,
    toInt(effectState && effectState.moduleID, 0),
    toInt(effectState && effectState.moduleFlagID, 0),
  );
  if (!attackerEntity || !effectState || !moduleItem) {
    return {
      success: false,
      errorMsg: "MODULE_NOT_FOUND",
      stopReason: "module",
    };
  }

  const chargeItem = getEntityRuntimeLoadedCharge(attackerEntity, moduleItem);
  const family = resolveWeaponFamily(moduleItem, chargeItem);
  if (!isMissileWeaponFamily(family) || !chargeItem) {
    return {
      success: false,
      errorMsg: "NO_AMMO",
      stopReason: "ammo",
    };
  }
  const bankContext = resolveGroupedWeaponBankContext(
    attackerEntity,
    effectState,
    moduleItem,
    {
      family,
    },
  );
  const armedEntries = bankContext.contributingEntries.filter(
    (entry) => entry && entry.chargeItem,
  );
  if (armedEntries.length <= 0) {
    const reloadStates = queueGroupedMissileReloadStates(
      scene,
      attackerEntity,
      effectState,
      bankContext.allEntries,
      cycleBoundaryMs,
    );
    if (reloadStates.length > 0) {
      return {
        success: true,
        data: {
          moduleItem,
          chargeItem: null,
          targetEntity: null,
          weaponSnapshot: null,
          missileEntity: null,
          ammoResult: [],
          reloadState: reloadStates[0] || null,
          bankReloadStates: reloadStates.length > 1 ? reloadStates : null,
          stopReason: null,
        },
      };
    }
    return {
      success: false,
      errorMsg: "NO_AMMO",
      stopReason: "ammo",
    };
  }
  const primaryEntry = bankContext.primaryEntry && bankContext.primaryEntry.chargeItem
    ? bankContext.primaryEntry
    : armedEntries[0];

  const targetEntity = scene.getEntityByID(effectState.targetID);
  if (
    !targetEntity ||
    !hasDamageableHealth(targetEntity) ||
    !isEntityLockedTarget(attackerEntity, effectState.targetID)
  ) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
      stopReason: "target",
    };
  }

  const shipRecord = getEntityRuntimeShipItem(attackerEntity);
  if (!shipRecord) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
      stopReason: "ship",
    };
  }

  const weaponSnapshot = buildWeaponSnapshotForEntity(
    attackerEntity,
    primaryEntry.moduleItem,
    primaryEntry.chargeItem,
    {
      shipItem: shipRecord,
    },
  );
  if (!weaponSnapshot || !isMissileWeaponFamily(weaponSnapshot.family)) {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_WEAPON",
      stopReason: "weapon",
    };
  }
  const resolvedWeaponSnapshot = buildBankedWeaponSnapshot(
    weaponSnapshot,
    bankContext,
  );

  logMissileDebug("missile.cycle.context", {
    sceneSystemID: scene.systemID,
    cycleBoundaryMs: roundNumber(toFiniteNumber(cycleBoundaryMs, 0), 3),
    attacker: summarizeRuntimeEntityForMissileDebug(attackerEntity),
    target: summarizeRuntimeEntityForMissileDebug(targetEntity),
    effectState: normalizeTraceValue({
      moduleID: effectState.moduleID,
      moduleFlagID: effectState.moduleFlagID,
      effectName: effectState.effectName,
      targetID: effectState.targetID,
      chargeTypeID: effectState.chargeTypeID,
    }),
    rangeContext: buildMissileLaunchRangeDebugContext(
      attackerEntity,
      targetEntity,
      resolvedWeaponSnapshot,
      moduleItem,
      primaryEntry.chargeItem,
    ),
  });

  const chargeResults = [];
  let groupedAmmoFailure = false;
  const depletedEntries = [];
  for (const entry of armedEntries) {
    const chargeResult = consumeTurretAmmoCharge(
      attackerEntity,
      entry.moduleItem,
      entry.chargeItem,
      cycleBoundaryMs,
    );
    chargeResults.push({
      moduleItem: entry.moduleItem,
      chargeItem: entry.chargeItem,
      result: chargeResult,
    });
    if (!chargeResult.success) {
      groupedAmmoFailure = true;
      continue;
    }
    if (chargeResult.data && chargeResult.data.depleted) {
      depletedEntries.push(entry);
    }
  }
  if (groupedAmmoFailure && chargeResults.every((entry) => !entry.result || !entry.result.success)) {
    return {
      success: false,
      errorMsg: "NO_AMMO",
      stopReason: "ammo",
    };
  }

  logMissileDebug("missile.cycle.consume", {
    sceneSystemID: scene.systemID,
    cycleBoundaryMs: roundNumber(toFiniteNumber(cycleBoundaryMs, 0), 3),
    banked: bankContext.banked,
    moduleIDs: bankContext.launchModuleIDs,
    consumeResults: normalizeTraceValue(
      chargeResults.map((entry) => ({
        moduleID: toInt(entry && entry.moduleItem && entry.moduleItem.itemID, 0),
        chargeTypeID: toInt(entry && entry.chargeItem && entry.chargeItem.typeID, 0),
        result: entry && entry.result ? entry.result : null,
      })),
    ),
  });

  const launchResult = scene.launchMissile(
    attackerEntity,
    targetEntity.itemID,
    resolvedWeaponSnapshot,
    {
      launchTimeMs: cycleBoundaryMs,
      chargeItem: primaryEntry.chargeItem,
      moduleItem: primaryEntry.moduleItem,
      launchModules: bankContext.launchModuleIDs,
      // CCP parity: once a missile module is actively cycling, missiles are
      // always launched regardless of current distance to target.  Range is
      // validated once on initial Activate; after that the module keeps
      // firing.  The missile flies toward the target and expires after its
      // flightTime if it cannot reach.  Without this, an NPC orbiting at
      // high speed can temporarily drift outside approxRange, causing
      // launchMissile to fail with TARGET_OUT_OF_RANGE, which cascades to
      // module deactivation — breaking the cycle prematurely.
      skipRangeCheck: true,
      broadcastOptions:
        options && options.deferUntilVisibilitySync === true
          ? {
              deferUntilVisibilitySync: true,
            }
          : null,
    },
  );
  if (!launchResult.success || !launchResult.data) {
    return {
      success: false,
      errorMsg: launchResult.errorMsg || "MISSILE_SPAWN_FAILED",
      stopReason:
        launchResult.errorMsg === "TARGET_OUT_OF_RANGE"
          ? "target"
        : "weapon",
    };
  }

  const reloadStates =
    depletedEntries.length > 0
      ? queueGroupedMissileReloadStates(
        scene,
        attackerEntity,
        effectState,
        depletedEntries,
        cycleBoundaryMs,
      )
      : [];
  const primaryChargeResult = chargeResults.find(
    (entry) =>
      toInt(entry && entry.moduleItem && entry.moduleItem.itemID, 0) ===
      toInt(primaryEntry && primaryEntry.moduleItem && primaryEntry.moduleItem.itemID, 0),
  );

  return {
    success: true,
    data: {
      moduleItem: primaryEntry.moduleItem,
      chargeItem:
        primaryChargeResult &&
        primaryChargeResult.result &&
        primaryChargeResult.result.success === true &&
        primaryChargeResult.result.data
          ? primaryChargeResult.result.data.chargeItem
          : primaryEntry.chargeItem,
      targetEntity,
      weaponSnapshot: resolvedWeaponSnapshot,
      missileEntity: launchResult.data.entity,
      ammoResult: chargeResults,
      reloadState: reloadStates[0] || null,
      bankReloadStates: reloadStates.length > 1 ? reloadStates : null,
      stopReason:
        groupedAmmoFailure && reloadStates.length <= 0
          ? "ammo"
          : (
            chargeResults.some(
              (entry) =>
                entry &&
                entry.result &&
                entry.result.data &&
                entry.result.data.depleted,
            ) &&
            reloadStates.length <= 0
          )
            ? "ammo"
            : null,
    },
  };
}

function resolveMissileLifecycle(scene, missileEntity, nowMs) {
  if (!scene || !missileEntity || missileEntity.kind !== "missile") {
    return {
      removed: false,
      impact: false,
      timeout: false,
      targetLost: false,
      damageResult: null,
      destroyResult: null,
    };
  }

  const targetEntity = scene.getEntityByID(missileEntity.targetEntityID);
  const targetLostToWarp = Boolean(
    targetEntity &&
    (
      targetEntity.mode === "WARP" ||
      targetEntity.warpState
    ),
  );
  const hasLiveTarget = Boolean(
    targetEntity &&
    hasDamageableHealth(targetEntity) &&
    !targetLostToWarp,
  );
  const expiresAtMs = toFiniteNumber(missileEntity.expiresAtMs, 0);
  const liveImpactDelayMs =
    hasLiveTarget && toFiniteNumber(missileEntity.maxVelocity, 0) > 0
      ? estimateMissileClientImpactTimeMs(
        missileEntity.position,
        targetEntity.position,
        Math.max(0, toFiniteNumber(targetEntity.radius, 0)),
        Math.max(0, toFiniteNumber(missileEntity.maxVelocity, 0)),
      )
      : 0;
  missileEntity.liveImpactAtMs =
    hasLiveTarget && liveImpactDelayMs > 0
      ? nowMs + liveImpactDelayMs
      : nowMs;
  const visualImpactAtMs = Math.max(
    0,
    toFiniteNumber(missileEntity.impactAtMs, 0),
  );
  const pendingGeometryImpact =
    missileEntity.pendingGeometryImpact === true;
  const pendingGeometryImpactAtMs = Math.max(
    0,
    toFiniteNumber(missileEntity.pendingGeometryImpactAtMs, 0),
  );
  const clientVisualReleaseAtMs = Math.max(
    0,
    toFiniteNumber(missileEntity.clientVisualReleaseAtMs, 0),
  );
  const impactResolved = clientVisualReleaseAtMs > 0;
  const clientVisualReleaseElapsed =
    impactResolved &&
    (
      clientVisualReleaseAtMs <= 0 ||
      nowMs + 0.001 >= clientVisualReleaseAtMs
    );
  const pendingGeometryImpactReady =
    pendingGeometryImpact &&
    (
      pendingGeometryImpactAtMs <= 0 ||
      nowMs + 0.001 >= pendingGeometryImpactAtMs
    );
  const clientReleaseGraceMs =
    missileEntity.clientDoSpread === true
      ? MISSILE_CLIENT_RELEASE_GRACE_MS
      : 0;
  const impactReleaseFloorAtMs = Math.max(
    visualImpactAtMs,
    pendingGeometryImpactAtMs,
  );
  const visualFlightElapsed =
    visualImpactAtMs <= 0 ||
    nowMs + 0.001 >= visualImpactAtMs;
  const impactReleaseElapsed =
    impactReleaseFloorAtMs <= 0 ||
    nowMs + 0.001 >= (impactReleaseFloorAtMs + clientReleaseGraceMs);
  const hasReachedImpactRadius =
    hasLiveTarget &&
    getMissileImpactDistance(missileEntity, targetEntity) <= 0.001;
  const timeoutSuppressedByResolvedImpact =
    pendingGeometryImpact ||
    hasReachedImpactRadius;
  const timeoutExpiryAtMs = timeoutSuppressedByResolvedImpact
    ? Math.max(
        expiresAtMs,
        impactReleaseFloorAtMs + clientReleaseGraceMs,
      )
    : expiresAtMs;
  const hasExpired = timeoutExpiryAtMs > 0 && nowMs >= timeoutExpiryAtMs;
  const canImpactByGeometry =
    hasLiveTarget &&
    impactReleaseElapsed &&
    (
      hasReachedImpactRadius ||
      pendingGeometryImpactReady
    );
  const logLifecycle = (outcome, extra = {}) => {
    logMissileDebug("missile.lifecycle", {
      sceneSystemID: scene.systemID,
      outcome,
      missile: summarizeMissileEntity(missileEntity),
      target: summarizeRuntimeEntityForMissileDebug(targetEntity),
      nowMs: roundNumber(toFiniteNumber(nowMs, 0), 3),
      hasLiveTarget,
      targetLostToWarp,
      hasExpired,
      liveImpactDelayMs: roundNumber(liveImpactDelayMs, 3),
      visualImpactAtMs: roundNumber(visualImpactAtMs, 3),
      visualFlightElapsed,
      clientReleaseGraceMs,
      impactReleaseFloorAtMs: roundNumber(impactReleaseFloorAtMs, 3),
      impactReleaseElapsed,
      timeoutSuppressedByResolvedImpact,
      timeoutExpiryAtMs: roundNumber(timeoutExpiryAtMs, 3),
      pendingGeometryImpact,
      pendingGeometryImpactAtMs: roundNumber(pendingGeometryImpactAtMs, 3),
      pendingGeometryImpactReady,
      pendingGeometryImpactReason: pendingGeometryImpact
        ? String(missileEntity.pendingGeometryImpactReason || "")
        : "",
      pendingGeometryImpactPosition: summarizeVector(
        missileEntity.pendingGeometryImpactPosition,
      ),
      impactResolved,
      clientVisualReleaseAtMs: roundNumber(clientVisualReleaseAtMs, 3),
      clientVisualReleaseElapsed,
      hasReachedImpactRadius,
      canImpactByGeometry,
      flight: buildMissileFlightSnapshot(scene, missileEntity, nowMs),
      ...extra,
    });
  };
  if (impactResolved) {
    if (!clientVisualReleaseElapsed) {
      logLifecycle("impact-resolved");
      return {
        removed: false,
        impact: false,
        timeout: false,
        targetLost: false,
        damageResult: null,
        destroyResult: null,
      };
    }
    logLifecycle("impact-release");
    scene.unregisterDynamicEntity(missileEntity, {
      terminalDestructionEffectID:
        missileEntity.clientDoSpread === true
          ? 0
          : DESTRUCTION_EFFECT_EXPLOSION,
      clampToVisibleStamp: true,
      nowMs,
    });
    return {
      removed: true,
      impact: false,
      timeout: false,
      targetLost: false,
      damageResult: null,
      destroyResult: null,
    };
  }
  if (canImpactByGeometry) {
    const attackerEntity = scene.getEntityByID(missileEntity.sourceShipID);
    const moduleItem =
      attackerEntity &&
      toInt(missileEntity.sourceModuleID, 0) > 0
        ? getEntityRuntimeModuleItem(
          attackerEntity,
          toInt(missileEntity.sourceModuleID, 0),
        )
        : {
            itemID: toInt(missileEntity.sourceModuleID, 0),
            typeID: toInt(
              missileEntity.sourceModuleTypeID,
              toInt(missileEntity.typeID, 0),
            ),
          };
    const impactResult = resolveMissileAppliedDamage(
      missileEntity.missileSnapshot,
      targetEntity,
    );
    const weaponDamageResult = applyWeaponDamageToTarget(
      scene,
      attackerEntity,
      targetEntity,
      impactResult.appliedDamage,
      nowMs,
    );
    const appliedDamageAmount = getAppliedDamageAmount(weaponDamageResult.damageResult);
    if (appliedDamageAmount > 0) {
      noteKillmailDamage(attackerEntity, targetEntity, appliedDamageAmount, {
        whenMs: nowMs,
        weaponSnapshot: missileEntity.missileSnapshot,
        moduleItem,
      });
    }
    if (weaponDamageResult.destroyResult && weaponDamageResult.destroyResult.success) {
      recordKillmailFromDestruction(targetEntity, weaponDamageResult.destroyResult, {
        attackerEntity,
        whenMs: nowMs,
        weaponSnapshot: missileEntity.missileSnapshot,
        moduleItem,
      });
    }
    notifyWeaponDamageMessages(
      attackerEntity,
      targetEntity,
      moduleItem,
      impactResult.appliedDamage,
      getAppliedDamageAmount(weaponDamageResult.damageResult),
      sumDamageVector(impactResult.appliedDamage) > 0 ? 3 : 0,
      {
        isBanked:
          missileEntity &&
          missileEntity.missileSnapshot &&
          missileEntity.missileSnapshot.isBanked === true,
      },
    );
    logLifecycle("impact", {
      impactTrigger: pendingGeometryImpactReady
        ? "pending-geometry-impact"
        : hasReachedImpactRadius
          ? "radius-overlap"
          : "unknown",
      attacker: summarizeRuntimeEntityForMissileDebug(attackerEntity),
      moduleItem: normalizeTraceValue(moduleItem),
      appliedDamage: normalizeTraceValue(impactResult.appliedDamage),
      appliedDamageAmount: roundNumber(appliedDamageAmount, 6),
      damageResult: normalizeTraceValue(weaponDamageResult.damageResult),
      destroyResult: normalizeTraceValue(weaponDamageResult.destroyResult),
    });
    if (missileEntity.clientDoSpread === true) {
      // Keep the live ball around after impact for doSpread missiles. The
      // client warhead is still finishing on its own local delayed ball, and a
      // RemoveBalls during that window still cuts the visual short even with a
      // NONE destruction effect.
      missileEntity.clientVisualReleaseAtMs = roundNumber(
        Math.max(
          toFiniteNumber(missileEntity.expiresAtMs, 0),
          nowMs + MISSILE_CLIENT_RELEASE_GRACE_MS,
        ),
        3,
      );
      return {
        removed: false,
        impact: true,
        timeout: false,
        targetLost: false,
        damageResult: weaponDamageResult.damageResult,
        destroyResult: weaponDamageResult.destroyResult,
      };
    }
    // CCP parity: for doSpread missiles, the client's Missile.Release() checks
    // `isExplosionOrOverride(self.destructionEffectId)`. If we send
    // TerminalPlayDestructionEffect(EXPLOSION), Release calls ReleaseAll() which
    // clears the Trinity warhead model mid-flight. By omitting the terminal
    // destruction effect for doSpread missiles, Release() sees the default
    // destructionEffectId (NONE) and skips the warhead clear, letting the
    // compiled gfxmissile visual complete its flight to the target naturally.
    // For doSpread=false missiles, DoCollision() already set collided=true in
    // Prepare(), so Release() is a no-op regardless of destructionEffectId.
    scene.unregisterDynamicEntity(missileEntity, {
      terminalDestructionEffectID:
        missileEntity.clientDoSpread === true
          ? 0
          : DESTRUCTION_EFFECT_EXPLOSION,
      clampToVisibleStamp: true,
      nowMs,
    });
    return {
      removed: true,
      impact: true,
      timeout: false,
      targetLost: false,
      damageResult: weaponDamageResult.damageResult,
      destroyResult: weaponDamageResult.destroyResult,
    };
  }

  if (!hasLiveTarget) {
    logLifecycle("target-lost");
    scene.unregisterDynamicEntity(missileEntity, {
      clampToVisibleStamp: true,
      nowMs,
    });
    return {
      removed: true,
      impact: false,
      timeout: false,
      targetLost: true,
      damageResult: null,
      destroyResult: null,
    };
  }

  if (hasExpired) {
    // In real EVE, the server applies damage at flight-time expiry regardless
    // of whether the server-side position simulation placed the missile inside
    // the target's radius. The damage formula (explosion velocity vs target
    // speed) handles "near misses" by reducing damage, NOT by missing entirely.
    // The server-side pursuit curve + discrete tick stepping can leave the
    // missile a few km short at long range, but the CCP client never sees a
    // "fizzle" — the missile always detonates.
    const attackerEntity = scene.getEntityByID(missileEntity.sourceShipID);
    const moduleItem =
      attackerEntity &&
      toInt(missileEntity.sourceModuleID, 0) > 0
        ? getEntityRuntimeModuleItem(
          attackerEntity,
          toInt(missileEntity.sourceModuleID, 0),
        )
        : {
            itemID: toInt(missileEntity.sourceModuleID, 0),
            typeID: toInt(
              missileEntity.sourceModuleTypeID,
              toInt(missileEntity.typeID, 0),
            ),
          };
    const impactResult = resolveMissileAppliedDamage(
      missileEntity.missileSnapshot,
      targetEntity,
    );
    const weaponDamageResult = applyWeaponDamageToTarget(
      scene,
      attackerEntity,
      targetEntity,
      impactResult.appliedDamage,
      nowMs,
    );
    const appliedDamageAmount = getAppliedDamageAmount(weaponDamageResult.damageResult);
    if (appliedDamageAmount > 0) {
      noteKillmailDamage(attackerEntity, targetEntity, appliedDamageAmount, {
        whenMs: nowMs,
        weaponSnapshot: missileEntity.missileSnapshot,
        moduleItem,
      });
    }
    if (weaponDamageResult.destroyResult && weaponDamageResult.destroyResult.success) {
      recordKillmailFromDestruction(targetEntity, weaponDamageResult.destroyResult, {
        attackerEntity,
        whenMs: nowMs,
        weaponSnapshot: missileEntity.missileSnapshot,
        moduleItem,
      });
    }
    notifyWeaponDamageMessages(
      attackerEntity,
      targetEntity,
      moduleItem,
      impactResult.appliedDamage,
      getAppliedDamageAmount(weaponDamageResult.damageResult),
      sumDamageVector(impactResult.appliedDamage) > 0 ? 3 : 0,
      {
        isBanked:
          missileEntity &&
          missileEntity.missileSnapshot &&
          missileEntity.missileSnapshot.isBanked === true,
      },
    );
    logLifecycle("timeout-forced-impact", {
      impactTrigger: "flight-expiry-forced",
      attacker: summarizeRuntimeEntityForMissileDebug(attackerEntity),
      moduleItem: normalizeTraceValue(moduleItem),
      appliedDamage: normalizeTraceValue(impactResult.appliedDamage),
      appliedDamageAmount: roundNumber(appliedDamageAmount, 6),
      damageResult: normalizeTraceValue(weaponDamageResult.damageResult),
      destroyResult: normalizeTraceValue(weaponDamageResult.destroyResult),
    });
    if (missileEntity.clientDoSpread === true) {
      missileEntity.clientVisualReleaseAtMs = roundNumber(
        Math.max(
          nowMs + MISSILE_CLIENT_RELEASE_GRACE_MS,
          toFiniteNumber(missileEntity.expiresAtMs, 0),
        ),
        3,
      );
      return {
        removed: false,
        impact: true,
        timeout: true,
        targetLost: false,
        damageResult: weaponDamageResult.damageResult,
        destroyResult: weaponDamageResult.destroyResult,
      };
    }
    scene.unregisterDynamicEntity(missileEntity, {
      terminalDestructionEffectID:
        missileEntity.clientDoSpread === true
          ? 0
          : DESTRUCTION_EFFECT_EXPLOSION,
      clampToVisibleStamp: true,
      nowMs,
    });
    return {
      removed: true,
      impact: true,
      timeout: false,
      targetLost: false,
      damageResult: weaponDamageResult.damageResult,
      destroyResult: weaponDamageResult.destroyResult,
    };
  }

  logLifecycle("active");

  return {
    removed: false,
    impact: false,
    timeout: false,
    targetLost: false,
    damageResult: null,
    destroyResult: null,
  };
}

function notifyPropulsionDerivedAttributesToSession(
  session,
  entity,
  effectState,
  whenMs = null,
) {
  if (
    !session ||
    !entity ||
    !effectState
  ) {
    return false;
  }

  const changes = [];
  let timestamp;
  if (whenMs != null) {
    timestamp = resolveSessionNotificationFileTime(session, whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    timestamp = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyPropulsionDerivedAttributesToSession: no sim time source, using wallclock fallback");
    timestamp = currentFileTime();
  }
  const moduleID = toInt(effectState.moduleID, 0);
  const shipID = toInt(entity.itemID, 0);

  if (moduleID > 0) {
    changes.push(
      buildAttributeChange(
        session,
        moduleID,
        MODULE_ATTRIBUTE_SPEED_FACTOR,
        roundNumber(toFiniteNumber(effectState.speedFactor, 0), 6),
        null,
        timestamp,
      ),
      buildAttributeChange(
        session,
        moduleID,
        MODULE_ATTRIBUTE_CAPACITOR_NEED,
        roundNumber(toFiniteNumber(effectState.capNeed, 0), 6),
        null,
        timestamp,
      ),
      buildAttributeChange(
        session,
        moduleID,
        MODULE_ATTRIBUTE_DURATION,
        roundNumber(toFiniteNumber(effectState.durationMs, 0), 3),
        null,
        timestamp,
      ),
    );
  }

  if (shipID > 0) {
    changes.push(
      buildAttributeChange(
        session,
        shipID,
        ATTRIBUTE_MASS,
        roundNumber(toFiniteNumber(entity.mass, 0), 6),
        null,
        timestamp,
      ),
      buildAttributeChange(
        session,
        shipID,
        ATTRIBUTE_MAX_VELOCITY,
        roundNumber(toFiniteNumber(entity.maxVelocity, 0), 6),
        null,
        timestamp,
      ),
      buildAttributeChange(
        session,
        shipID,
        ATTRIBUTE_SIGNATURE_RADIUS,
        roundNumber(toFiniteNumber(entity.signatureRadius, 0), 6),
        null,
        timestamp,
      ),
    );
  }

  return notifyAttributeChanges(session, changes);
}

function notifyGenericDerivedAttributesToSession(
  session,
  effectState,
  whenMs = null,
) {
  if (!session || !effectState) {
    return false;
  }

  const moduleID = toInt(effectState.moduleID, 0);
  const durationAttributeID = toInt(
    effectState.durationAttributeID,
    MODULE_ATTRIBUTE_DURATION,
  );
  if (moduleID <= 0) {
    return false;
  }

  let timestamp;
  if (whenMs != null) {
    timestamp = resolveSessionNotificationFileTime(session, whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    timestamp = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyGenericDerivedAttributesToSession: no sim time source, using wallclock fallback");
    timestamp = currentFileTime();
  }

  const changes = [
    buildAttributeChange(
      session,
      moduleID,
      MODULE_ATTRIBUTE_CAPACITOR_NEED,
      roundNumber(toFiniteNumber(effectState.capNeed, 0), 6),
      null,
      timestamp,
    ),
  ];

  if (durationAttributeID > 0) {
    changes.push(
      buildAttributeChange(
        session,
        moduleID,
        durationAttributeID,
        roundNumber(toFiniteNumber(effectState.durationMs, 0), 3),
        null,
        timestamp,
      ),
    );
  }

  const maxRangeValue = toFiniteNumber(
    effectState.genericAttributeOverrides &&
      effectState.genericAttributeOverrides[ATTRIBUTE_MAX_RANGE],
    Number.NaN,
  );
  if (Number.isFinite(maxRangeValue)) {
    changes.push(
      buildAttributeChange(
        session,
        moduleID,
        ATTRIBUTE_MAX_RANGE,
        roundNumber(maxRangeValue, 6),
        null,
        timestamp,
      ),
    );
  }

  const currentSpoolBonus = toFiniteNumber(
    effectState.genericAttributeOverrides &&
      effectState.genericAttributeOverrides[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_CURRENT],
    Number.NaN,
  );
  if (Number.isFinite(currentSpoolBonus)) {
    changes.push(
      buildAttributeChange(
        session,
        moduleID,
        ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_CURRENT,
        roundNumber(currentSpoolBonus, 6),
        null,
        timestamp,
      ),
    );
  }

  const maxTimestampMs = toFiniteNumber(
    effectState.genericAttributeOverrides &&
      effectState.genericAttributeOverrides[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP_RUNTIME],
    Number.NaN,
  );
  if (Number.isFinite(maxTimestampMs)) {
    changes.push(
      buildAttributeChange(
        session,
        moduleID,
        ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP_RUNTIME,
        Math.max(0, roundNumber(maxTimestampMs, 3)),
        null,
        timestamp,
      ),
    );
  }

  return notifyAttributeChanges(session, changes);
}

function notifyFittedGenericModuleRangeAttributesToSession(
  session,
  entity,
  whenMs = null,
) {
  if (!session || !entity || entity.kind !== "ship") {
    return false;
  }

  const shipItem = getEntityRuntimeShipItem(entity);
  if (!shipItem) {
    return false;
  }

  let timestamp;
  if (whenMs != null) {
    timestamp = resolveSessionNotificationFileTime(session, whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    timestamp = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyFittedGenericModuleRangeAttributesToSession: no sim time source, using wallclock fallback");
    timestamp = currentFileTime();
  }

  const characterID = getShipEntityInventoryCharacterID(entity, toInt(session.characterID, 0));
  const fittedItems = getEntityRuntimeFittedItems(entity);
  const skillMap = getEntityRuntimeSkillMap(entity);
  const changes = [];

  for (const moduleItem of fittedItems) {
    if (!moduleItem || !isModuleOnline(moduleItem)) {
      continue;
    }

    const chargeItem = getEntityRuntimeLoadedCharge(entity, moduleItem);
    const weaponFamily = resolveWeaponFamily(moduleItem, chargeItem);
    if (isSnapshotWeaponFamily(weaponFamily)) {
      continue;
    }

    const runtimeAttrs = getGenericModuleRuntimeAttributes(
      characterID,
      shipItem,
      moduleItem,
      chargeItem,
      null,
      {
        skillMap,
        fittedItems,
        activeModuleContexts: getEntityRuntimeActiveModuleContexts(entity, {
          excludeModuleID: toInt(moduleItem.itemID, 0),
        }),
        additionalLocationModifierSources: collectEntityWormholeLocationModifierSources(entity),
      },
    );
    const maxRangeValue = toFiniteNumber(
      runtimeAttrs &&
        runtimeAttrs.attributeOverrides &&
        runtimeAttrs.attributeOverrides[ATTRIBUTE_MAX_RANGE],
      Number.NaN,
    );
    if (!Number.isFinite(maxRangeValue)) {
      continue;
    }

    changes.push(buildAttributeChange(
      session,
      toInt(moduleItem.itemID, 0),
      ATTRIBUTE_MAX_RANGE,
      roundNumber(maxRangeValue, 6),
      null,
      timestamp,
    ));
  }

  return notifyAttributeChanges(session, changes);
}

function notifyTargetingDerivedAttributesToSession(
  session,
  entity,
  previousSnapshot,
  whenMs = null,
) {
  if (!session || !entity || !previousSnapshot) {
    return false;
  }

  let timestamp;
  if (whenMs != null) {
    timestamp = resolveSessionNotificationFileTime(session, whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    timestamp = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyTargetingDerivedAttributesToSession: no sim time source, using wallclock fallback");
    timestamp = currentFileTime();
  }

  const shipID = toInt(entity.itemID, 0);
  if (shipID <= 0) {
    return false;
  }

  const currentSnapshot = buildEntityTargetingAttributeSnapshot(entity);
  const attributeChanges = [];
  const candidates = [
    [ATTRIBUTE_MAX_TARGET_RANGE, currentSnapshot.maxTargetRange, previousSnapshot.maxTargetRange],
    [ATTRIBUTE_MAX_LOCKED_TARGETS, currentSnapshot.maxLockedTargets, previousSnapshot.maxLockedTargets],
    [ATTRIBUTE_SIGNATURE_RADIUS, currentSnapshot.signatureRadius, previousSnapshot.signatureRadius],
    [ATTRIBUTE_CLOAKING_TARGETING_DELAY, currentSnapshot.cloakingTargetingDelay, previousSnapshot.cloakingTargetingDelay],
    [ATTRIBUTE_SCAN_RESOLUTION, currentSnapshot.scanResolution, previousSnapshot.scanResolution],
  ];

  for (const [attributeID, nextValue, previousValue] of candidates) {
    if (Number(nextValue) === Number(previousValue)) {
      continue;
    }

    attributeChanges.push(
      buildAttributeChange(
        session,
        shipID,
        attributeID,
        nextValue,
        previousValue,
        timestamp,
      ),
    );
  }

  return notifyAttributeChanges(session, attributeChanges);
}

function buildShipEntityCore(source, systemID, options = {}) {
  const movement =
    worldData.getMovementAttributesForType(source.typeID) || null;
  const passiveResourceState = source.passiveResourceState || null;
  const spaceState = buildShipSpaceState(source);
  const position = cloneVector(spaceState.position);
  const direction = normalizeVector(
    cloneVector(spaceState.direction, DEFAULT_RIGHT),
    DEFAULT_RIGHT,
  );
  const velocity = cloneVector(spaceState.velocity);
  const targetPoint = cloneVector(
    spaceState.targetPoint,
    addVectors(position, scaleVector(direction, 1.0e16)),
  );
  const maxVelocity =
    toFiniteNumber(passiveResourceState && passiveResourceState.maxVelocity, 0) > 0
      ? toFiniteNumber(passiveResourceState.maxVelocity, 0)
      : toFiniteNumber(movement && movement.maxVelocity, 0) > 0
        ? toFiniteNumber(movement.maxVelocity, 0)
        : 200;
  const warpSpeedAU =
    toFiniteNumber(movement && movement.warpSpeedMultiplier, 0) > 0
      ? toFiniteNumber(movement.warpSpeedMultiplier, 0)
      : 3;
  const resolvedMass =
    toFiniteNumber(passiveResourceState && passiveResourceState.mass, 0) > 0
      ? toFiniteNumber(passiveResourceState.mass, 0)
      : toFiniteNumber(movement && movement.mass, 0) > 0
        ? toFiniteNumber(movement.mass, 0)
        : 1_000_000;
  const resolvedInertia =
    toFiniteNumber(passiveResourceState && passiveResourceState.agility, 0) > 0
      ? toFiniteNumber(passiveResourceState.agility, 0)
      : toFiniteNumber(movement && movement.inertia, 0) > 0
        ? toFiniteNumber(movement.inertia, 0)
        : 1;
  const alignTime = calculateAlignTimeSecondsFromMassInertia(
    resolvedMass,
    resolvedInertia,
    toFiniteNumber(movement && movement.alignTime, 0) > 0
      ? toFiniteNumber(movement.alignTime, 0)
      : 3,
  );
  const maxAccelerationTime =
    toFiniteNumber(movement && movement.maxAccelerationTime, 0) > 0
      ? toFiniteNumber(movement.maxAccelerationTime, 0)
      : 6;
  const speedFraction = clamp(
    toFiniteNumber(spaceState.speedFraction, magnitude(velocity) > 0 ? 1 : 0),
    0,
    MAX_SUBWARP_SPEED_FRACTION,
  );
  const mode = normalizeMode(
    spaceState.mode,
    magnitude(velocity) > 0 ? "GOTO" : "STOP",
  );
  const orbitNormal = normalizeVector(
    cloneVector(spaceState.orbitNormal, buildPerpendicular(direction)),
    buildPerpendicular(direction),
  );
  const pendingWarp = buildPendingWarp(spaceState.pendingWarp, position);
  const pilotCharacterID = toInt(
    source.pilotCharacterID,
    toInt(source.characterID, 0),
  );

  const entity = {
    kind: "ship",
    systemID,
    itemID: allocateRuntimeEntityID(source.itemID),
    typeID: source.typeID,
    groupID: toInt(source.groupID, 25),
    categoryID: toInt(source.categoryID, 6),
    itemName: String(source.itemName || source.name || "Ship"),
    ownerID: toInt(
      source.ownerID,
      toInt(source.characterID, toInt(source.corporationID, 0)),
    ),
    slimTypeID: toInt(source.slimTypeID, toInt(source.typeID, 0)),
    slimGroupID: toInt(source.slimGroupID, toInt(source.groupID, 25)),
    slimCategoryID: toInt(source.slimCategoryID, toInt(source.categoryID, 6)),
    slimName: String(
      source.slimName ||
        source.itemName ||
        source.name ||
        "Ship",
    ),
    characterID: toInt(source.characterID, 0),
    pilotCharacterID,
    npcEntityType: source.npcEntityType || null,
    corporationID: toInt(source.corporationID, 0),
    allianceID: toInt(source.allianceID, 0),
    warFactionID: toInt(source.warFactionID, 0),
    nativeNpc: source && source.nativeNpc === true,
    nativeNpcOccupied: source && source.nativeNpcOccupied === true,
    transient: source && source.transient === true,
    skinMaterialSetID:
      options.skinMaterialSetID !== undefined
        ? options.skinMaterialSetID
        : source.skinMaterialSetID ?? null,
    cosmeticsItems: getEnabledCosmeticsEntries(source.itemID)
      .map((entry) => Number(entry.cosmeticType || 0))
      .filter((entry) => entry > 0)
      .sort((left, right) => left - right),
    modules: normalizeSlimShipModules(source.modules),
    securityStatus: toFiniteNumber(
      source.securityStatus ?? source.securityRating,
      0,
    ),
    bounty: toFiniteNumber(source.bounty, 0),
    position,
    velocity,
    direction,
    targetPoint,
    mode,
    speedFraction,
    mass: resolvedMass,
    inertia: resolvedInertia,
    radius:
      toFiniteNumber(source && source.radius, 0) > 0
        ? toFiniteNumber(source.radius, 0)
        : toFiniteNumber(movement && movement.radius, 0) > 0
          ? toFiniteNumber(movement.radius, 0)
        : 50,
    maxVelocity,
    alignTime,
    maxAccelerationTime,
    agilitySeconds: deriveAgilitySeconds(
      alignTime,
      maxAccelerationTime,
      resolvedMass,
      resolvedInertia,
    ),
    passiveDerivedState: passiveResourceState,
    maxTargetRange: toFiniteNumber(
      passiveResourceState && passiveResourceState.maxTargetRange,
      0,
    ),
    maxLockedTargets: toFiniteNumber(
      passiveResourceState && passiveResourceState.maxLockedTargets,
      0,
    ),
    signatureRadius: toFiniteNumber(
      passiveResourceState && passiveResourceState.signatureRadius,
      0,
    ),
    cloakingTargetingDelay: toFiniteNumber(
      passiveResourceState && passiveResourceState.cloakingTargetingDelay,
      0,
    ),
    scanResolution: toFiniteNumber(
      passiveResourceState && passiveResourceState.scanResolution,
      0,
    ),
    capacitorCapacity: toFiniteNumber(
      passiveResourceState && passiveResourceState.capacitorCapacity,
      0,
    ),
    capacitorRechargeRate: toFiniteNumber(
      passiveResourceState && passiveResourceState.capacitorRechargeRate,
      0,
    ),
    shieldCapacity: toFiniteNumber(
      passiveResourceState && passiveResourceState.shieldCapacity,
      0,
    ),
    shieldRechargeRate: toFiniteNumber(
      passiveResourceState && passiveResourceState.shieldRechargeRate,
      0,
    ),
    armorHP: toFiniteNumber(passiveResourceState && passiveResourceState.armorHP, 0),
    structureHP: toFiniteNumber(
      passiveResourceState && passiveResourceState.structureHP,
      0,
    ),
    conditionState: normalizeShipConditionState(source && source.conditionState),
    fittedItems: Array.isArray(source && source.fittedItems)
      ? source.fittedItems.map((item) => ({ ...item }))
      : undefined,
    nativeCargoItems: Array.isArray(source && source.nativeCargoItems)
      ? source.nativeCargoItems.map((item) => ({ ...item }))
      : undefined,
    skillMap: source && source.skillMap instanceof Map
      ? new Map(source.skillMap)
      : undefined,
    superweaponCycleOverrideMs: Math.max(
      0,
      toInt(source && source.superweaponCycleOverrideMs, 0),
    ) || undefined,
    capacitorChargeRatio: clamp(
      toFiniteNumber(source && source.conditionState && source.conditionState.charge, 1),
      0,
      1,
    ),
    warpSpeedAU,
    targetEntityID: toInt(spaceState.targetEntityID, 0) || null,
    followRange: toFiniteNumber(spaceState.followRange, 0),
    orbitDistance: toFiniteNumber(spaceState.orbitDistance, 0),
    orbitNormal,
    orbitSign: toFiniteNumber(spaceState.orbitSign, 1) < 0 ? -1 : 1,
    bubbleID: null,
    publicGridKey: null,
    departureBubbleID: null,
    departureBubbleVisibleUntilMs: 0,
    warpState: null,
    pendingWarp,
    dockingTargetID: null,
    pendingDock: null,
    session: options.session || null,
    persistSpaceState: options.persistSpaceState === true,
    lastPersistAt: 0,
    lastObserverCorrectionBroadcastAt: 0,
    lastObserverCorrectionBroadcastStamp: -1,
    lastObserverPositionBroadcastAt: 0,
    lastObserverPositionBroadcastStamp: -1,
    lastWarpCorrectionBroadcastAt: 0,
    lastWarpPositionBroadcastStamp: -1,
    lastPilotWarpStartupGuidanceStamp: 0,
    lastPilotWarpVelocityStamp: 0,
    lastPilotWarpEffectStamp: 0,
    lastPilotWarpCruiseBumpStamp: 0,
    lastPilotWarpMaxSpeedRampIndex: -1,
    lastWarpDiagnosticStamp: 0,
    lastMovementDebugAt: 0,
    lastMotionDebug: null,
    movementTrace: null,
    lockedTargets: new Map(),
    pendingTargetLocks: new Map(),
    targetedBy: new Set(),
    activeModuleEffects: new Map(),
    moduleReactivationLocks: new Map(),
  };

  if (mode === "WARP") {
    entity.warpState =
      buildWarpState(spaceState.warpState, position, warpSpeedAU) ||
      buildPreparingWarpState(entity, pendingWarp);
  }

  return entity;
}

function buildShipEntity(session, shipItem, systemID) {
  const characterData = resolveCharacterRecord(session && session.characterID) || {};
  const passiveResourceState = buildPassiveShipResourceState(
    session && session.characterID,
    shipItem,
    {
      additionalAttributeModifierEntries:
        wormholeEnvironmentRuntime.collectShipAttributeModifierEntriesForSystem(
          systemID,
        ),
    },
  );
  const initialModules = resolveShipSlimModules({
    kind: "ship",
    itemID: shipItem && shipItem.itemID,
    characterID: session && session.characterID,
    pilotCharacterID: session && session.characterID,
    modules: shipItem && shipItem.modules,
  });
  return buildShipEntityCore({
    itemID: shipItem.itemID,
    typeID: shipItem.typeID,
    groupID: shipItem.groupID,
    categoryID: shipItem.categoryID,
    itemName: shipItem.itemName || session.shipName || "Ship",
    ownerID: shipItem.ownerID || session.characterID,
    characterID: session.characterID || 0,
    pilotCharacterID: session.characterID || 0,
    corporationID: session.corporationID || 0,
    allianceID: session.allianceID || 0,
    warFactionID: session.warFactionID || 0,
    radius: shipItem.radius,
    conditionState: shipItem.conditionState || {},
    passiveResourceState,
    spaceState: shipItem.spaceState || {},
    modules: initialModules,
    securityStatus:
      characterData.securityStatus ?? characterData.securityRating ?? 0,
    bounty: characterData.bounty ?? 0,
  }, systemID, {
    session,
    persistSpaceState: true,
    skinMaterialSetID: resolveShipSkinMaterialSetID(shipItem),
  });
}

function buildRuntimeShipEntity(shipSpec, systemID, options = {}) {
  const source = shipSpec || {};
  const passiveResourceState =
    source.passiveResourceState ||
    buildPassiveShipResourceState(
      source.pilotCharacterID ?? source.characterID,
      {
        itemID: source.itemID,
        typeID: source.typeID,
        groupID: source.groupID,
        categoryID: source.categoryID,
        itemName: source.itemName,
        radius: source.radius,
      },
      {
        fittedItems: Array.isArray(source.fittedItems) ? source.fittedItems : [],
        skillMap: source.skillMap instanceof Map ? source.skillMap : undefined,
        additionalAttributeModifierEntries:
          wormholeEnvironmentRuntime.collectShipAttributeModifierEntriesForSystem(
            systemID,
          ),
      },
    );

  return buildShipEntityCore({
    ...source,
    passiveResourceState,
  }, systemID, {
    session: options.session || null,
    persistSpaceState: options.persistSpaceState === true,
  });
}

function isPlayerOwnedActiveSpaceShipRecord(shipItem, characterData) {
  if (!shipItem || toInt(shipItem.categoryID, 0) !== 6 || !shipItem.spaceState) {
    return false;
  }
  if (!characterData) {
    return false;
  }

  const accountID = toInt(characterData.accountId ?? characterData.accountID, 0);
  if (accountID <= 0) {
    return false;
  }

  return toInt(characterData.shipID, 0) === toInt(shipItem.itemID, 0);
}

function isPlayerOwnedPersistedSpaceShipRecord(shipItem, characterData) {
  if (!shipItem || toInt(shipItem.categoryID, 0) !== 6 || !shipItem.spaceState) {
    return false;
  }
  if (!characterData) {
    return false;
  }

  return toInt(characterData.accountId ?? characterData.accountID, 0) > 0;
}

function buildRuntimePersistedSpaceShipEntity(shipItem, systemID, options = {}) {
  if (!shipItem || toInt(shipItem.categoryID, 0) !== 6 || !shipItem.spaceState) {
    return null;
  }

  const inventoryCharacterID = toInt(shipItem.ownerID, 0);
  const resolveCharacterRecordFn =
    typeof options.resolveCharacterRecord === "function"
      ? options.resolveCharacterRecord
      : resolveCharacterRecord;
  const characterData =
    inventoryCharacterID > 0
      ? resolveCharacterRecordFn(inventoryCharacterID, shipItem) || null
      : null;
  if (
    options.includeOfflinePlayerShips === false &&
    isPlayerOwnedPersistedSpaceShipRecord(shipItem, characterData)
  ) {
    return null;
  }
  const entity = buildRuntimeShipEntity({
    itemID: shipItem.itemID,
    typeID: shipItem.typeID,
    groupID: shipItem.groupID,
    categoryID: shipItem.categoryID,
    itemName: shipItem.itemName,
    ownerID: shipItem.ownerID,
    characterID: 0,
    pilotCharacterID: inventoryCharacterID,
    corporationID: toInt(characterData && characterData.corporationID, 0),
    allianceID: toInt(characterData && characterData.allianceID, 0),
    warFactionID: toInt(
      characterData && (characterData.factionID ?? characterData.warFactionID),
      0,
    ),
    conditionState: shipItem.conditionState || {},
    spaceState: shipItem.spaceState || {},
    securityStatus:
      characterData && (characterData.securityStatus ?? characterData.securityRating),
    bounty: characterData && characterData.bounty,
  }, systemID, {
    persistSpaceState: true,
  });

  return refreshShipPresentationFields(entity);
}

function isInventoryWreckMarkedSalvaged(item) {
  const rawCustomInfo = String(item && item.customInfo || "").trim();
  if (!rawCustomInfo) {
    return false;
  }
  try {
    const parsed = JSON.parse(rawCustomInfo);
    return Boolean(parsed && parsed.evejsSalvage && parsed.evejsSalvage.salvaged);
  } catch (_) {
    return false;
  }
}

function getRuntimeInventoryEntityKind(item) {
  if (!item) {
    return null;
  }

  if (toInt(item.categoryID, 0) === getDroneCategoryID()) {
    return "drone";
  }
  if (toInt(item.categoryID, 0) === getFighterCategoryID()) {
    return "fighter";
  }
  if (toInt(item.categoryID, 0) === planetOrbitalState.CATEGORY_ORBITAL) {
    return "orbital";
  }

  const metadata = getItemMetadata(item.typeID, item.itemName);
  const groupName = String(metadata && metadata.groupName || "").trim().toLowerCase();
  if (groupName === "wreck") {
    if (isInventoryWreckMarkedSalvaged(item)) {
      return "container";
    }
    return "wreck";
  }
  if (
    groupName.includes("container") ||
    groupName === "spawn container"
  ) {
    return "container";
  }
  return null;
}

function resolveRuntimeInventoryEntityRadius(kind, item, metadata, fallback = 40) {
  const staticRadius =
    toFiniteNumber(item && item.radius, 0) > 0
      ? toFiniteNumber(item && item.radius, 0)
      : toFiniteNumber(metadata && metadata.radius, 0);
  const explicitSpaceRadius = toFiniteNumber(item && item.spaceRadius, 0);
  if (explicitSpaceRadius > 0) {
    return explicitSpaceRadius;
  }
  if (kind === "wreck") {
    return resolveRuntimeWreckRadius(
      {
        ...metadata,
        itemName: item && item.itemName,
        name: String(item && item.itemName || metadata && metadata.name || "Wreck"),
        radius: staticRadius,
      },
      staticRadius,
    );
  }
  return staticRadius > 0 ? staticRadius : fallback;
}

function resolveRuntimeInventoryEntitySignatureRadius(item, metadata, ballRadius = 0) {
  const typeID = toInt(
    item && item.typeID,
    toInt(metadata && metadata.typeID, 0),
  );
  const typeSignatureRadius = getTypeAttributeValue(typeID, "signatureRadius");
  if (typeSignatureRadius !== null && typeSignatureRadius !== undefined) {
    const resolvedTypeSignatureRadius = toFiniteNumber(typeSignatureRadius, 0);
    if (resolvedTypeSignatureRadius > 0) {
      return resolvedTypeSignatureRadius;
    }
  }

  const runtimeBallRadius = toFiniteNumber(ballRadius, 0);
  if (runtimeBallRadius > 0) {
    return runtimeBallRadius;
  }

  const staticTypeRadius = toFiniteNumber(metadata && metadata.radius, 0);
  if (staticTypeRadius > 0) {
    return staticTypeRadius;
  }

  return 1;
}

function buildRuntimeInventoryEntity(item, systemID, nowMs) {
  if (nowMs === undefined || nowMs === null) {
    log.warn("buildRuntimeInventoryEntity: nowMs not provided, using wallclock fallback — caller should pass scene sim time");
    nowMs = Date.now();
  }
  if (!item || !item.itemID) {
    return null;
  }
  if (
    Number.isFinite(Number(item.expiresAtMs)) &&
    Number(item.expiresAtMs) > 0 &&
    Number(item.expiresAtMs) <= nowMs
  ) {
    return null;
  }

  const kind = getRuntimeInventoryEntityKind(item);
  if (!kind) {
    return null;
  }

  const metadata = getItemMetadata(item.typeID, item.itemName);
  const spaceState = item.spaceState || {};
  const position = cloneVector(spaceState.position);
  const direction = normalizeVector(
    cloneVector(spaceState.direction, DEFAULT_RIGHT),
    DEFAULT_RIGHT,
  );
  const resolvedRadius = resolveRuntimeInventoryEntityRadius(
    kind,
    item,
    metadata,
    40,
  );
  const resolvedSignatureRadius = resolveRuntimeInventoryEntitySignatureRadius(
    item,
    metadata,
    resolvedRadius,
  );
  const resolvedMass = Math.max(0, toFiniteNumber(
    getTypeAttributeValue(item.typeID, "mass"),
    0,
  ));
  const resolvedInertia = Math.max(0, toFiniteNumber(
    getTypeAttributeValue(item.typeID, "agility"),
    0,
  ));
  const resolvedMaxVelocity = Math.max(0, toFiniteNumber(
    getTypeAttributeValue(item.typeID, "maxVelocity"),
    toFiniteNumber(spaceState.maxVelocity, 0),
  ));
  const staticStructureHP = Math.max(0, toFiniteNumber(
    getTypeAttributeValue(item.typeID, "hp", "structureHP"),
    0,
  ));
  const resolvedStructureHP =
    kind === "wreck" && staticStructureHP <= 0
      // Some scenery / event wreck rows carry no HP dogma at all, but the
      // client still lets pilots lock and shoot them. Fall back to the live
      // wreck radius so those targets participate in the normal weapon path.
      ? resolveRuntimeWreckStructureFallbackHP({
          ...metadata,
          itemName: item.itemName,
          name: item.itemName,
          radius: resolvedRadius,
        }, resolvedRadius)
      : staticStructureHP;

  const entity = {
    kind,
    systemID,
    itemID: allocateRuntimeEntityID(item.itemID),
    typeID: toInt(item.typeID, 0),
    groupID: toInt(item.groupID, toInt(metadata.groupID, 0)),
    categoryID: toInt(item.categoryID, toInt(metadata.categoryID, 0)),
    itemName: String(item.itemName || metadata.name || "Container"),
    ownerID: toInt(item.ownerID, 0),
    position,
    velocity: cloneVector(spaceState.velocity),
    direction,
    targetPoint: cloneVector(spaceState.targetPoint, position),
    mode: normalizeMode(spaceState.mode, "STOP"),
    speedFraction: clamp(toFiniteNumber(spaceState.speedFraction, 0), 0, 1),
    mass: resolvedMass > 0 ? resolvedMass : 10_000,
    inertia: resolvedInertia > 0 ? resolvedInertia : 1,
    maxVelocity: resolvedMaxVelocity,
    radius: resolvedRadius,
    // Retail lock timing prefers the type dogma signature radius and only
    // falls back to the ball/static radius when that attribute is absent.
    signatureRadius: resolvedSignatureRadius,
    passiveDerivedState: {
      attributes: getTypeDogmaAttributes(item.typeID),
    },
    shieldCapacity: Math.max(0, toFiniteNumber(
      getTypeAttributeValue(item.typeID, "shieldCapacity"),
      0,
    )),
    shieldRechargeRate: Math.max(0, toFiniteNumber(
      getTypeAttributeValue(item.typeID, "shieldRechargeRate"),
      0,
    )),
    armorHP: Math.max(0, toFiniteNumber(
      getTypeAttributeValue(item.typeID, "armorHP"),
      0,
    )),
    structureHP: resolvedStructureHP,
    bubbleID: null,
    publicGridKey: null,
    departureBubbleID: null,
    departureBubbleVisibleUntilMs: 0,
    persistSpaceState: true,
    lastPersistAt: 0,
    spaceState: item.spaceState || null,
    conditionState: normalizeShipConditionState(item.conditionState),
    createdAtMs: toFiniteNumber(item.createdAtMs, 0) || null,
    expiresAtMs: toFiniteNumber(item.expiresAtMs, 0) || null,
    isEmpty: listContainerItems(null, item.itemID).length === 0,
    launcherID: toInt(item.launcherID, 0) || null,
    dunRotation: coerceDunRotationTuple(item.dunRotation),
  };

  if (kind === "drone") {
    entity.targetEntityID = toInt(spaceState.targetEntityID, 0) || null;
    entity.followRange = toFiniteNumber(spaceState.followRange, 0);
    entity.orbitDistance = toFiniteNumber(spaceState.orbitDistance, 0);
    entity.orbitNormal = cloneVector(
      spaceState.orbitNormal,
      buildPerpendicular(direction),
    );
    entity.orbitSign = toFiniteNumber(spaceState.orbitSign, 1) < 0 ? -1 : 1;
    entity.lockedTargets = new Map();
    entity.pendingTargetLocks = new Map();
    entity.targetedBy = new Set();
    entity.activeModuleEffects = new Map();
    entity.moduleReactivationLocks = new Map();
    hydrateDroneEntityFromInventoryItem(entity, item);
  }
  if (kind === "fighter") {
    entity.targetEntityID = toInt(spaceState.targetEntityID, 0) || null;
    entity.followRange = toFiniteNumber(spaceState.followRange, 0);
    entity.orbitDistance = toFiniteNumber(spaceState.orbitDistance, 0);
    entity.orbitNormal = cloneVector(
      spaceState.orbitNormal,
      buildPerpendicular(direction),
    );
    entity.orbitSign = toFiniteNumber(spaceState.orbitSign, 1) < 0 ? -1 : 1;
    entity.lockedTargets = new Map();
    entity.pendingTargetLocks = new Map();
    entity.targetedBy = new Set();
    entity.activeModuleEffects = new Map();
    entity.moduleReactivationLocks = new Map();
    hydrateFighterEntityFromInventoryItem(entity, item);
  }
  if (kind === "orbital") {
    planetOrbitalState.hydrateOrbitalEntityFromInventoryItem(entity, item, {
      solarSystemID: systemID,
    });
  }

  return entity;
}

function buildRuntimeSpaceEntityFromItem(item, systemID, nowMs, options = {}) {
  if (toInt(item && item.categoryID, 0) === 6 && item && item.spaceState) {
    return buildRuntimePersistedSpaceShipEntity(item, systemID, options);
  }
  return buildRuntimeInventoryEntity(item, systemID, nowMs);
}

function spawnDeferredStructureLootEntities(scene, structureID, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const numericStructureID = toInt(structureID, 0);
  if (!numericStructureID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const spawnedItemIDs = [];
  const spaceItems = listSystemSpaceItems(scene.systemID)
    .filter((item) => toInt(item && item.launcherID, 0) === numericStructureID)
    .sort((left, right) => toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0));

  for (const item of spaceItems) {
    const itemID = toInt(item && item.itemID, 0);
    if (!itemID || scene.getEntityByID(itemID)) {
      continue;
    }

    const entity = buildRuntimeSpaceEntityFromItem(
      item,
      scene.systemID,
      scene.getCurrentSimTimeMs(),
    );
    if (!entity) {
      continue;
    }

    const spawnResult = scene.spawnDynamicEntity(entity, {
      broadcast: options.broadcast !== false,
      excludedSession: options.excludedSession || null,
    });
    if (!spawnResult.success) {
      return spawnResult;
    }
    spawnedItemIDs.push(itemID);
  }

  return {
    success: true,
    data: {
      itemIDs: spawnedItemIDs,
    },
  };
}

function persistShipEntity(entity) {
  if (!entity || entity.kind !== "ship" || entity.persistSpaceState !== true) {
    return;
  }

  const result = updateShipItem(entity.itemID, (currentItem) => ({
    ...currentItem,
    locationID: entity.systemID,
    flagID: 0,
    spaceState: serializeSpaceState(entity),
    conditionState: normalizeShipConditionState(entity.conditionState),
  }));

  if (!result.success) {
    log.warn(
      `[SpaceRuntime] Failed to persist ship ${entity.itemID}: ${result.errorMsg}`,
    );
  }

  entity.lastPersistAt = Date.now();
}

function persistInventoryBackedEntity(entity) {
  if (!isInventoryBackedDynamicEntity(entity) || entity.persistSpaceState !== true) {
    return;
  }

  const result = updateInventoryItem(entity.itemID, (currentItem) => ({
    ...currentItem,
    locationID: entity.systemID,
    flagID: 0,
    spaceState: serializeSpaceState(entity),
    conditionState: normalizeShipConditionState(entity.conditionState),
    createdAtMs: toFiniteNumber(entity.createdAtMs, 0) || null,
    expiresAtMs: toFiniteNumber(entity.expiresAtMs, 0) || null,
    launcherID: toInt(entity.launcherID, 0) || null,
    dunRotation: coerceDunRotationTuple(entity.dunRotation),
  }));

  if (!result.success) {
    log.warn(
      `[SpaceRuntime] Failed to persist ${entity.kind} ${entity.itemID}: ${result.errorMsg}`,
    );
    return;
  }

  entity.lastPersistAt = Date.now();
}

function persistDynamicEntity(entity) {
  if (!entity) {
    return;
  }
  if (entity.kind === "ship") {
    persistShipEntity(entity);
    return;
  }
  persistInventoryBackedEntity(entity);
}

function clearTrackingState(entity) {
  entity.targetEntityID = null;
  entity.followRange = 0;
  entity.orbitDistance = 0;
  entity.warpState = null;
  entity.pendingWarp = null;
  entity.dockingTargetID = null;
  entity.lastPilotWarpStartupGuidanceStamp = 0;
  entity.lastPilotWarpVelocityStamp = 0;
  entity.lastPilotWarpEffectStamp = 0;
  entity.lastPilotWarpCruiseBumpStamp = 0;
  entity.lastPilotWarpMaxSpeedRampIndex = -1;
  entity.lastWarpDiagnosticStamp = 0;
}

function resetEntityMotion(entity) {
  clearTrackingState(entity);
  entity.mode = "STOP";
  entity.speedFraction = 0;
  entity.velocity = { x: 0, y: 0, z: 0 };
  entity.targetPoint = cloneVector(entity.position);
}

function buildUndockMovement(entity, direction, speedFraction = 1) {
  clearTrackingState(entity);
  entity.direction = normalizeVector(direction, entity.direction);
  entity.targetPoint = addVectors(
    cloneVector(entity.position),
    scaleVector(entity.direction, 1.0e16),
  );
  entity.speedFraction = clamp(speedFraction, 0, MAX_SUBWARP_SPEED_FRACTION);
  entity.mode = "GOTO";
  entity.velocity = { x: 0, y: 0, z: 0 };
}

function rotateDirectionToward(
  currentDirection,
  targetDirection,
  deltaSeconds,
  agilitySeconds,
  currentSpeedFraction = 0,
) {
  const current = normalizeVector(currentDirection, targetDirection);
  const target = normalizeVector(targetDirection, current);
  const turnMetrics = getTurnMetrics(current, target);
  const degrees = (turnMetrics.radians * 180) / Math.PI;

  if (!Number.isFinite(turnMetrics.radians) || turnMetrics.radians <= TURN_ALIGNMENT_RADIANS) {
    return {
      direction: target,
      degrees,
      turnFraction: turnMetrics.turnFraction,
      turnPercent: 1,
      degPerTick: 0,
      maxStepDegrees: 0,
      turnSeconds: 0,
      snapped: true,
    };
  }

  // Destiny turns much faster than it changes speed, and from near-rest the
  // client effectively snaps to the requested heading before accelerating.
  if (currentSpeedFraction <= 0.1) {
    return {
      direction: target,
      degrees,
      turnFraction: turnMetrics.turnFraction,
      turnPercent: 1,
      degPerTick: 0,
      maxStepDegrees: 0,
      turnSeconds: 0,
      snapped: true,
    };
  }

  // Match the classic destiny turn shape more closely than a slow exponential
  // blend: heading changes in noticeable per-tick steps and large turns begin
  // by shedding speed while the nose swings through the arc.
  const degPerTick = deriveTurnDegreesPerTick(agilitySeconds);
  const tickScale = Math.max(deltaSeconds / 0.1, 0.05);
  const maxStepDegrees = degPerTick * tickScale;
  const turnPercent = clamp(maxStepDegrees / Math.max(degrees, 0.001), 0.001, 1);
  const turnSeconds = Math.max(agilitySeconds / 2.2, 0.05);
  return {
    direction: slerpDirection(current, target, turnPercent, turnMetrics.radians),
    degrees,
    turnFraction: turnMetrics.turnFraction,
    turnPercent,
    degPerTick,
    maxStepDegrees,
    turnSeconds,
    snapped: false,
  };
}

function deriveTurnSpeedCap(turnMetrics) {
  const baseCap = clamp(toFiniteNumber(turnMetrics && turnMetrics.turnFraction, 1), 0.1, 1);
  const radians = Math.max(0, toFiniteNumber(turnMetrics && turnMetrics.radians, 0));

  if (radians >= (2 * Math.PI) / 3) {
    return Math.max(0.12, baseCap ** 3);
  }
  if (radians >= Math.PI / 4) {
    return Math.max(0.15, baseCap ** 2);
  }

  return baseCap;
}

function applyDesiredVelocity(entity, desiredDirection, desiredSpeed, deltaSeconds) {
  const previousPosition = cloneVector(entity.position);
  const previousVelocity = cloneVector(entity.velocity);
  const headingSource = normalizeVector(entity.direction, desiredDirection);
  const targetDirection = normalizeVector(desiredDirection, headingSource);
  const agilitySeconds = Math.max(
    toFiniteNumber(entity.agilitySeconds, 0) ||
      deriveAgilitySeconds(
        entity.alignTime,
        entity.maxAccelerationTime,
        entity.mass,
        entity.inertia,
      ),
    0.05,
  );
  const currentSpeedFraction =
    entity.maxVelocity > 0
      ? Math.max(0, magnitude(entity.velocity) / entity.maxVelocity)
      : 0;
  const targetSpeedFraction =
    entity.maxVelocity > 0
      ? Math.max(0, desiredSpeed / entity.maxVelocity)
      : 0;
  const currentAlignmentDirection = getCurrentAlignmentDirection(
    entity,
    targetDirection,
  );
  const turnMetrics = getTurnMetrics(currentAlignmentDirection, targetDirection);
  const desiredVelocity = scaleVector(targetDirection, Math.max(0, desiredSpeed));
  const integration = integrateVelocityTowardTarget(
    previousVelocity,
    desiredVelocity,
    agilitySeconds,
    deltaSeconds,
  );
  const nextSpeed = magnitude(integration.nextVelocity);
  const nextSpeedFraction =
    entity.maxVelocity > 0 ? Math.max(0, nextSpeed / entity.maxVelocity) : 0;

  const turnStep = rotateDirectionToward(
    headingSource,
    targetDirection,
    deltaSeconds,
    agilitySeconds,
    currentSpeedFraction,
  );
  entity.direction =
    nextSpeed > 0.05
      ? normalizeVector(integration.nextVelocity, turnStep.direction)
      : turnStep.direction;
  entity.velocity =
    nextSpeed <= 0.05
      ? { x: 0, y: 0, z: 0 }
      : integration.nextVelocity;
  if (desiredSpeed <= 0.001 && magnitude(entity.velocity) < 0.1) {
    entity.velocity = { x: 0, y: 0, z: 0 };
  }

  entity.position = addVectors(entity.position, integration.positionDelta);
  const positionDelta = subtractVectors(entity.position, previousPosition);
  const velocityDelta = subtractVectors(entity.velocity, previousVelocity);
  const appliedTurnMetrics = getTurnMetrics(currentAlignmentDirection, entity.direction);
  entity.lastTurnMetrics = {
    degrees: roundNumber(turnStep.degrees, 2),
    appliedDegrees: roundNumber((appliedTurnMetrics.radians * 180) / Math.PI, 2),
    turnFraction: roundNumber(turnMetrics.turnFraction, 3),
    currentSpeedFraction: roundNumber(currentSpeedFraction, 3),
    targetSpeedFraction: roundNumber(targetSpeedFraction, 3),
    effectiveTargetSpeedFraction: roundNumber(targetSpeedFraction, 3),
    turnSpeedCap: roundNumber(targetSpeedFraction, 3),
    speedDeltaFraction: roundNumber(
      Math.abs(currentSpeedFraction - targetSpeedFraction),
      3,
    ),
    speedResponseSeconds: roundNumber(agilitySeconds, 3),
    agilitySeconds: roundNumber(agilitySeconds, 3),
    exponentialDecay: roundNumber(integration.decay, 6),
    degPerTick: roundNumber(turnStep.degPerTick, 3),
    maxStepDegrees: roundNumber(turnStep.maxStepDegrees, 3),
    turnPercent: roundNumber(turnStep.turnPercent, 3),
    turnSeconds: roundNumber(turnStep.turnSeconds, 3),
    snapped: Boolean(turnStep.snapped),
  };
  entity.lastMotionDebug = {
    deltaSeconds: roundNumber(deltaSeconds, 4),
    previousPosition: summarizeVector(previousPosition),
    positionDelta: summarizeVector(positionDelta),
    previousVelocity: summarizeVector(previousVelocity),
    velocityDelta: summarizeVector(velocityDelta),
    headingSource: summarizeVector(currentAlignmentDirection),
    desiredDirection: summarizeVector(targetDirection),
    currentSpeed: roundNumber(magnitude(previousVelocity), 3),
    desiredSpeed: roundNumber(desiredSpeed, 3),
    nextSpeed: roundNumber(magnitude(entity.velocity), 3),
    turnAngleDegrees: roundNumber((turnMetrics.radians * 180) / Math.PI, 2),
    remainingTurnDegrees: roundNumber(turnStep.degrees, 2),
  };

  return {
    changed:
      distance(previousPosition, entity.position) > 1 ||
      distance(previousVelocity, entity.velocity) > 0.5,
  };
}

function advanceGotoMovement(entity, deltaSeconds) {
  const desiredDirection = getCommandDirection(entity, entity.direction);
  const desiredSpeed =
    entity.maxVelocity * clamp(entity.speedFraction, 0, MAX_SUBWARP_SPEED_FRACTION);
  return applyDesiredVelocity(entity, desiredDirection, desiredSpeed, deltaSeconds);
}

function getMissileImpactDistance(entity, target) {
  // CCP's client missile ETA/collision presentation uses the target ball's
  // radius only. The missile ball radius affects visuals/torque, but tearing
  // the missile down on missileRadius + targetRadius removes it a tick early
  // and produces the visible "fizzle short of target" the client logs show.
  return Math.max(
    0,
    distance(entity && entity.position, target && target.position) - Math.max(
      1,
      toFiniteNumber(target && target.radius, 0),
    ),
  );
}

function resolveMissileTargetStepStartPosition(target, deltaSeconds) {
  const currentTargetPosition = cloneVector(target && target.position);
  if (!target || Math.max(0, toFiniteNumber(deltaSeconds, 0)) <= 0.000001) {
    return currentTargetPosition;
  }

  const motionDebug =
    target.lastMotionDebug &&
    typeof target.lastMotionDebug === "object"
      ? target.lastMotionDebug
      : null;
  if (motionDebug && motionDebug.previousPosition) {
    return cloneVector(motionDebug.previousPosition, currentTargetPosition);
  }

  return subtractVectors(
    currentTargetPosition,
    scaleVector(target.velocity || { x: 0, y: 0, z: 0 }, deltaSeconds),
  );
}

function resolveMissileSweptImpact(
  missileStartPosition,
  missileVelocity,
  targetStartPosition,
  targetEndPosition,
  targetRadius,
  deltaSeconds,
) {
  const stepSeconds = Math.max(0, toFiniteNumber(deltaSeconds, 0));
  const impactRadius = Math.max(1, toFiniteNumber(targetRadius, 0));
  const normalizedMissileStart = cloneVector(missileStartPosition);
  const normalizedTargetStart = cloneVector(targetStartPosition);
  const normalizedTargetEnd = cloneVector(targetEndPosition);
  const missileStepVelocity = cloneVector(missileVelocity);
  const targetStepVelocity =
    stepSeconds > 0.000001
      ? scaleVector(
          subtractVectors(normalizedTargetEnd, normalizedTargetStart),
          1 / stepSeconds,
        )
      : { x: 0, y: 0, z: 0 };
  const relativeStart = subtractVectors(
    normalizedMissileStart,
    normalizedTargetStart,
  );
  const relativeVelocity = subtractVectors(
    missileStepVelocity,
    targetStepVelocity,
  );
  const relativeVelocityMagnitudeSquared = dotProduct(
    relativeVelocity,
    relativeVelocity,
  );
  const startCenterDistance = magnitude(relativeStart);
  const startSurfaceDistance = Math.max(0, startCenterDistance - impactRadius);
  let closestTimeSeconds = 0;
  if (relativeVelocityMagnitudeSquared > 0.000001) {
    closestTimeSeconds = clamp(
      -dotProduct(relativeStart, relativeVelocity) /
        relativeVelocityMagnitudeSquared,
      0,
      stepSeconds,
    );
  }
  const relativeClosestVector = addVectors(
    relativeStart,
    scaleVector(relativeVelocity, closestTimeSeconds),
  );
  const closestCenterDistance = magnitude(relativeClosestVector);
  const closestSurfaceDistance = Math.max(
    0,
    closestCenterDistance - impactRadius,
  );
  const quadraticB = 2 * dotProduct(relativeStart, relativeVelocity);
  const quadraticC =
    dotProduct(relativeStart, relativeStart) - (impactRadius * impactRadius);
  let impactTimeSeconds = null;
  let collisionReason = null;
  if (quadraticC <= 0) {
    impactTimeSeconds = 0;
    collisionReason = "already-inside-radius";
  } else if (relativeVelocityMagnitudeSquared > 0.000001) {
    const discriminant =
      (quadraticB * quadraticB) -
      (4 * relativeVelocityMagnitudeSquared * quadraticC);
    if (discriminant >= 0) {
      const sqrtDiscriminant = Math.sqrt(discriminant);
      const candidateTimes = [
        (-quadraticB - sqrtDiscriminant) / (2 * relativeVelocityMagnitudeSquared),
        (-quadraticB + sqrtDiscriminant) / (2 * relativeVelocityMagnitudeSquared),
      ].filter((candidate) =>
        Number.isFinite(candidate) &&
        candidate >= -0.000001 &&
        candidate <= stepSeconds + 0.000001
      );
      if (candidateTimes.length > 0) {
        impactTimeSeconds = clamp(
          Math.min(...candidateTimes),
          0,
          stepSeconds,
        );
        collisionReason = "relative-sweep";
      }
    }
  }

  if (!Number.isFinite(impactTimeSeconds)) {
    impactTimeSeconds = null;
    collisionReason = null;
  }

  const resolvedImpactTimeSeconds =
    impactTimeSeconds === null
      ? closestTimeSeconds
      : impactTimeSeconds;
  const missileImpactPosition = addVectors(
    normalizedMissileStart,
    scaleVector(missileStepVelocity, resolvedImpactTimeSeconds),
  );
  const targetImpactPosition = addVectors(
    normalizedTargetStart,
    scaleVector(targetStepVelocity, resolvedImpactTimeSeconds),
  );

  return {
    impactOccurred: impactTimeSeconds !== null,
    collisionReason,
    impactTimeSeconds:
      impactTimeSeconds === null
        ? null
        : roundNumber(impactTimeSeconds, 6),
    impactTimeMs:
      impactTimeSeconds === null
        ? null
        : roundNumber(impactTimeSeconds * 1000, 3),
    closestTimeSeconds: roundNumber(closestTimeSeconds, 6),
    startSurfaceDistance: roundNumber(startSurfaceDistance, 6),
    closestSurfaceDistance: roundNumber(closestSurfaceDistance, 6),
    missileImpactPosition: summarizeVector(missileImpactPosition),
    targetImpactPosition: summarizeVector(targetImpactPosition),
    targetStepStartPosition: summarizeVector(normalizedTargetStart),
    targetStepVelocity: summarizeVector(targetStepVelocity),
  };
}

function advanceMissileMovement(entity, target, deltaSeconds, nowMs) {
  const previousPosition = cloneVector(entity.position);
  const previousVelocity = cloneVector(entity.velocity);
  if (entity.pendingGeometryImpact === true) {
    const frozenPosition = cloneVector(
      entity.pendingGeometryImpactPosition,
      entity.position,
    );
    entity.position = frozenPosition;
    entity.targetPoint = cloneVector(frozenPosition);
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.speedFraction = 0;
    entity.lastMissileStep = {
      previousPosition,
      targetPosition: target ? cloneVector(target.position) : null,
      deltaSeconds: roundNumber(Math.max(0, deltaSeconds), 6),
      stepDistance: 0,
      surfaceDistanceBefore: target
        ? roundNumber(getMissileImpactDistance(entity, target), 6)
        : Number.POSITIVE_INFINITY,
      surfaceDistanceAfter: target
        ? roundNumber(getMissileImpactDistance(entity, target), 6)
        : Number.POSITIVE_INFINITY,
      reachedImpactSurface: true,
      frozenAtGeometryImpact: true,
      legacyHeuristicImpactSurface: false,
      pendingGeometryImpactAtMs: roundNumber(
        toFiniteNumber(entity.pendingGeometryImpactAtMs, 0),
        3,
      ),
      impactPosition: summarizeVector(frozenPosition),
      sweptImpact: {
        impactOccurred: true,
        collisionReason: String(entity.pendingGeometryImpactReason || "pending-impact"),
        impactTimeSeconds: 0,
        impactTimeMs: 0,
        closestTimeSeconds: 0,
        startSurfaceDistance: target
          ? roundNumber(getMissileImpactDistance(entity, target), 6)
          : null,
        closestSurfaceDistance: target
          ? roundNumber(getMissileImpactDistance(entity, target), 6)
          : null,
        missileImpactPosition: summarizeVector(frozenPosition),
        targetImpactPosition: target ? summarizeVector(target.position) : null,
        targetStepStartPosition: target ? summarizeVector(target.position) : null,
        targetStepVelocity: target ? summarizeVector(target.velocity) : null,
      },
    };
    return { changed: false };
  }
  if (!target) {
    entity.lastMissileStep = {
      previousPosition,
      targetPosition: null,
      deltaSeconds: roundNumber(deltaSeconds, 6),
      stepDistance: 0,
      surfaceDistanceBefore: Number.POSITIVE_INFINITY,
      surfaceDistanceAfter: Number.POSITIVE_INFINITY,
      reachedImpactSurface: false,
      frozenAtGeometryImpact: false,
      legacyHeuristicImpactSurface: false,
      sweptImpact: null,
    };
    return { changed: false };
  }

  const targetPosition = cloneVector(target.position);
  const targetStepStartPosition = resolveMissileTargetStepStartPosition(
    target,
    deltaSeconds,
  );
  const desiredDirection = normalizeVector(
    subtractVectors(targetPosition, previousPosition),
    entity.direction,
  );
  const stepStartMs = Math.max(
    0,
    toFiniteNumber(nowMs, 0) - (Math.max(0, deltaSeconds) * 1000),
  );
  const launchAtMs = Math.max(
    0,
    toFiniteNumber(entity.launchedAtMs, stepStartMs),
  );
  // Missile cycles can resolve partway through the current scene tick. Do not
  // let a newly launched missile consume the whole tick's delta as if it had
  // already existed at step start, or short flights will overshoot and fizzle
  // before the client ever sees the proper launch arc.
  const activeStepStartMs = Math.max(stepStartMs, launchAtMs);
  const activeDeltaSeconds = Math.max(
    0,
    (Math.max(activeStepStartMs, toFiniteNumber(nowMs, 0)) - activeStepStartMs) /
      1000,
  );
  const remainingFlightSeconds =
    toFiniteNumber(entity.expiresAtMs, 0) > 0
      ? Math.max(
          0,
          (toFiniteNumber(entity.expiresAtMs, 0) - activeStepStartMs) / 1000,
        )
      : Math.max(0, deltaSeconds);
  const effectiveDeltaSeconds = Math.min(
    Math.max(0, deltaSeconds),
    activeDeltaSeconds,
    remainingFlightSeconds,
  );
  const surfaceDistanceBefore = getMissileImpactDistance(entity, target);
  const desiredSpeed = Math.max(0, toFiniteNumber(entity.maxVelocity, 0));
  const desiredVelocity = scaleVector(desiredDirection, desiredSpeed);
  entity.targetPoint = targetPosition;
  entity.followRange = 0;
  entity.speedFraction = desiredSpeed > 0 ? 1 : 0;
  // Missile charges carry extremely small authored agility values on the live
  // Destiny ball. The client therefore flies them as near-instant homing
  // projectiles. Reusing the ship-style turn cap here left the server missile
  // path materially behind the client's local collision path, which is exactly
  // how we ended up with "damage applied but visual fizzle" outcomes.
  // CCP's missile model applies source-ship velocity in the launcher/warhead
  // animation path, but the live Destiny missile ball still flies at its own
  // max speed. Injecting the source ship's world velocity here made missile
  // balls outrun `maxVelocity` and visibly rebase the whole launch relative to
  // the ship on active volleys.
  entity.direction = desiredSpeed > 0
    ? desiredDirection
    : normalizeVector(entity.direction, desiredDirection);
  entity.velocity = desiredSpeed > 0
    ? desiredVelocity
    : { x: 0, y: 0, z: 0 };
  entity.position = addVectors(
    previousPosition,
    scaleVector(entity.velocity, effectiveDeltaSeconds),
  );
  const stepDistance = distance(previousPosition, entity.position);
  let surfaceDistanceAfter = getMissileImpactDistance(entity, target);
  const sweptImpact = resolveMissileSweptImpact(
    previousPosition,
    entity.velocity,
    targetStepStartPosition,
    targetPosition,
    Math.max(1, toFiniteNumber(target.radius, 0)),
    effectiveDeltaSeconds,
  );
  const rawSurfaceDistanceAfter = surfaceDistanceAfter;
  const legacyHeuristicImpactSurface =
    rawSurfaceDistanceAfter <= 0.001 ||
    surfaceDistanceBefore <= (stepDistance + 0.001);
  if (sweptImpact.impactOccurred) {
    const impactPosition = cloneVector(
      sweptImpact.missileImpactPosition,
      entity.position,
    );
    entity.pendingGeometryImpact = true;
    entity.pendingGeometryImpactReason = sweptImpact.collisionReason || "relative-sweep";
    entity.pendingGeometryImpactAtMs = roundNumber(
      Math.max(
        stepStartMs,
        activeStepStartMs + (toFiniteNumber(sweptImpact.impactTimeMs, 0)),
      ),
      3,
    );
    entity.pendingGeometryImpactPosition = impactPosition;
    entity.position = impactPosition;
    entity.targetPoint = cloneVector(
      sweptImpact.targetImpactPosition,
      targetPosition,
    );
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.speedFraction = 0;
    surfaceDistanceAfter = getMissileImpactDistance(entity, target);
    logMissileDebug("missile.geometry-impact-detected", {
      atMs: roundNumber(toFiniteNumber(nowMs, 0), 3),
      missile: summarizeMissileEntity(entity),
      target: summarizeRuntimeEntityForMissileDebug(target),
      previousPosition: summarizeVector(previousPosition),
      deltaSeconds: roundNumber(effectiveDeltaSeconds, 6),
      unclampedSurfaceDistanceAfter: roundNumber(rawSurfaceDistanceAfter, 6),
      clampedSurfaceDistanceAfter: roundNumber(surfaceDistanceAfter, 6),
      sweptImpact: normalizeTraceValue(sweptImpact),
    });
  }
  entity.lastMissileStep = {
    previousPosition,
    targetStepStartPosition,
    targetPosition,
    deltaSeconds: roundNumber(effectiveDeltaSeconds, 6),
    stepDistance: roundNumber(stepDistance, 6),
    surfaceDistanceBefore: roundNumber(surfaceDistanceBefore, 6),
    surfaceDistanceAfter: roundNumber(surfaceDistanceAfter, 6),
    rawSurfaceDistanceAfter: roundNumber(rawSurfaceDistanceAfter, 6),
    reachedImpactSurface:
      surfaceDistanceAfter <= 0.001 ||
      sweptImpact.impactOccurred,
    frozenAtGeometryImpact: sweptImpact.impactOccurred,
    legacyHeuristicImpactSurface,
    pendingGeometryImpactAtMs: roundNumber(
      toFiniteNumber(entity.pendingGeometryImpactAtMs, 0),
      3,
    ),
    impactPosition: sweptImpact.impactOccurred
      ? summarizeVector(entity.position)
      : null,
    sweptImpact,
  };

  return {
    changed:
      distance(previousPosition, entity.position) > 1 ||
      distance(previousVelocity, entity.velocity) > 0.5,
  };
}

function advanceFollowMovement(entity, target, deltaSeconds) {
  if (!target) {
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.targetPoint = cloneVector(entity.position);
    entity.dockingTargetID = null;
    return { changed: true };
  }

  const motionProfile = getFollowMotionProfile(entity, target);
  const targetPoint = motionProfile.targetPoint;
  const separation = subtractVectors(targetPoint, entity.position);
  const currentDistance = magnitude(separation);
  const desiredRange = Math.max(
    0,
    toFiniteNumber(entity.followRange, 0) +
      entity.radius +
      motionProfile.rangeRadius,
  );
  const gap = currentDistance - desiredRange;
  const targetSpeed = magnitude(target.velocity || { x: 0, y: 0, z: 0 });
  const desiredDirection =
    gap > 50
      ? normalizeVector(separation, entity.direction)
      : normalizeVector(target.velocity, normalizeVector(separation, entity.direction));
  const desiredSpeed =
    gap > 50
      ? Math.min(
          entity.maxVelocity,
          Math.max(targetSpeed, Math.max(gap * 0.5, entity.maxVelocity * 0.25)),
        )
      : Math.min(entity.maxVelocity, targetSpeed);

  entity.targetPoint = targetPoint;
  const movementResult = applyDesiredVelocity(
    entity,
    desiredDirection,
    desiredSpeed,
    deltaSeconds,
  );

  return movementResult;
}

function advanceOrbitMovement(entity, target, deltaSeconds) {
  if (!target) {
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.targetPoint = cloneVector(entity.position);
    return { changed: true };
  }

  const radialVector = subtractVectors(entity.position, target.position);
  const radialDirection = normalizeVector(radialVector, buildPerpendicular(entity.direction));
  let orbitNormal = normalizeVector(entity.orbitNormal, buildPerpendicular(radialDirection));
  if (Math.abs(dotProduct(orbitNormal, radialDirection)) > 0.95) {
    orbitNormal = buildPerpendicular(radialDirection);
  }

  const tangentDirection = normalizeVector(
    scaleVector(crossProduct(orbitNormal, radialDirection), entity.orbitSign || 1),
    entity.direction,
  );
  const currentDistance = magnitude(radialVector);
  const desiredDistance = Math.max(
    toFiniteNumber(entity.orbitDistance, 0) + entity.radius + (target.radius || 0),
    entity.radius + (target.radius || 0) + 500,
  );
  const radialError = currentDistance - desiredDistance;
  const correction = scaleVector(
    radialDirection,
    clamp(-radialError / Math.max(desiredDistance, 1), -0.75, 0.75),
  );
  const desiredDirection = normalizeVector(
    addVectors(tangentDirection, correction),
    tangentDirection,
  );
  const desiredSpeed = clamp(
    Math.max(entity.maxVelocity * 0.35, Math.abs(radialError) * 0.5),
    0,
    entity.maxVelocity,
  );

  entity.orbitNormal = orbitNormal;
  entity.targetPoint = addVectors(
    target.position,
    scaleVector(radialDirection, desiredDistance),
  );
  return applyDesiredVelocity(entity, desiredDirection, desiredSpeed, deltaSeconds);
}

function advanceMovement(entity, scene, deltaSeconds, now) {
  switch (entity.mode) {
    case "STOP":
      return applyDesiredVelocity(entity, entity.direction, 0, deltaSeconds);
    case "GOTO":
      return advanceGotoMovement(entity, deltaSeconds);
    case "FOLLOW":
      if (entity.kind === "missile") {
        return advanceMissileMovement(
          entity,
          scene.getEntityByID(entity.targetEntityID),
          deltaSeconds,
          now,
        );
      }
      return advanceFollowMovement(
        entity,
        scene.getEntityByID(entity.targetEntityID),
        deltaSeconds,
      );
    case "ORBIT":
      return advanceOrbitMovement(
        entity,
        scene.getEntityByID(entity.targetEntityID),
        deltaSeconds,
      );
    case "WARP": {
      if (entity.pendingWarp) {
        const result = advanceGotoMovement(entity, deltaSeconds);
        refreshPreparingWarpState(entity);
        return result;
      }
      if (entity.sessionlessWarpIngress) {
        return advanceSessionlessWarpIngress(entity, now);
      }
      if (!entity.warpState) {
        entity.mode = "STOP";
        entity.speedFraction = 0;
        entity.velocity = { x: 0, y: 0, z: 0 };
        entity.targetPoint = cloneVector(entity.position);
        return { changed: false };
      }

      const previousPosition = cloneVector(entity.position);
      const previousVelocity = cloneVector(entity.velocity);
      const progress = getWarpProgress(entity.warpState, now);
      const direction = normalizeVector(
        subtractVectors(entity.warpState.targetPoint, entity.warpState.origin),
        entity.direction,
      );
      entity.direction = direction;
      entity.position = progress.complete
        ? cloneVector(entity.warpState.targetPoint)
        : addVectors(
            entity.warpState.origin,
            scaleVector(direction, progress.traveled),
          );
      entity.velocity = progress.complete
        ? { x: 0, y: 0, z: 0 }
        : scaleVector(direction, progress.speed);

      if (progress.complete) {
        const completedWarpState = serializeWarpState({
          warpState: entity.warpState,
          position: entity.position,
        });
        const _warpCompleteTargetEntity = entity.targetEntityID
          ? scene.getEntityByID(entity.targetEntityID)
          : null;
        const _warpCompleteTargetRadius = Math.max(
          0,
          toFiniteNumber(_warpCompleteTargetEntity && _warpCompleteTargetEntity.radius, 0),
        );
        const _warpCompleteDistCenter = _warpCompleteTargetEntity
          ? distance(entity.position, _warpCompleteTargetEntity.position)
          : null;
        const _warpCompleteDistEdge = _warpCompleteDistCenter !== null
          ? _warpCompleteDistCenter - _warpCompleteTargetRadius
          : null;
        log.info(
          `[WarpComplete] itemID=${entity.itemID} typeID=${entity.typeID} targetEntityID=${entity.targetEntityID || "none"}` +
          ` serverPos=(${Math.round(entity.position.x)},${Math.round(entity.position.y)},${Math.round(entity.position.z)})` +
          ` distToTargetCenter=${_warpCompleteDistCenter !== null ? Math.round(_warpCompleteDistCenter) : "n/a"}` +
          ` distToTargetEdge=${_warpCompleteDistEdge !== null ? Math.round(_warpCompleteDistEdge) : "n/a"}` +
          ` targetRadius=${_warpCompleteTargetRadius}`,
        );
        entity.mode = "STOP";
        entity.speedFraction = 0;
        entity.targetPoint = cloneVector(entity.position);
        entity.warpState = null;
        return {
          changed:
            distance(previousPosition, entity.position) > 1 ||
            distance(previousVelocity, entity.velocity) > 0.5,
          warpCompleted: true,
          completedWarpState,
        };
      }

      return {
        changed:
          distance(previousPosition, entity.position) > 1 ||
          distance(previousVelocity, entity.velocity) > 0.5,
      };
    }
    default:
      return { changed: false };
  }
}

const movementWarpBuilders = createMovementWarpBuilders({
  clamp,
  cloneVector,
  getCurrentDestinyStamp,
  getNextStamp,
  magnitude,
  normalizeVector,
  scaleVector,
  subtractVectors,
  toFiniteNumber,
  toInt,
  DEFAULT_RIGHT,
  DESTINY_STAMP_INTERVAL_MS,
  ENABLE_PILOT_WARP_FACTOR_OPTION_A,
  ENABLE_PILOT_WARP_MAX_SPEED_RAMP,
  ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B,
  MAX_SUBWARP_SPEED_FRACTION,
  PILOT_WARP_FACTOR_OPTION_A_SCALE,
  PILOT_WARP_SOLVER_ASSIST_LEAD_MS,
  PILOT_WARP_SOLVER_ASSIST_SCALE,
  PILOT_WARP_SPEED_RAMP_FRACTIONS,
  PILOT_WARP_SPEED_RAMP_SCALES,
  WARP_NATIVE_ACTIVATION_SPEED_FRACTION,
  WARP_NATIVE_ACTIVATION_SPEED_MARGIN_MS,
  WARP_START_ACTIVATION_SEED_SCALE,
});

const {
  buildPilotPreWarpAddBallUpdate,
  buildPilotPreWarpRebaselineUpdates,
  buildPilotWarpEgoStateRefreshUpdates,
  buildPilotWarpActivationStateRefreshUpdates,
  getNominalWarpFactor,
  getPilotWarpFactorOptionA,
  buildWarpStartCommandUpdate,
  buildWarpPrepareCommandUpdate,
  getPilotWarpPeakSpeed,
  shouldSchedulePilotWarpCruiseBump,
  getPilotWarpStartupGuidanceAtMs,
  getPilotWarpStartupGuidanceStamp,
  getPilotWarpCruiseBumpAtMs,
  getPilotWarpEffectAtMs,
  getPilotWarpCruiseBumpStamp,
  getPilotWarpEffectStamp,
  getPilotWarpActivationSeedSpeed,
  getPilotWarpActivationKickoffSpeed,
  buildPilotWarpMaxSpeedRamp,
  buildPilotWarpSeedUpdate,
  buildPilotWarpActivationKickoffUpdate,
  buildEntityWarpInUpdate,
  getPilotWarpNativeActivationSpeedFloor,
  buildWarpActivationVelocityUpdate,
  buildWarpStartVelocityCarryoverUpdate,
  primePilotWarpActivationState,
  getWatcherWarpStartStamp,
  buildWarpStartEffectUpdate,
  buildWarpPrepareDispatch,
  buildPilotWarpActivationUpdates,
  buildWarpCompletionUpdates,
  buildPilotWarpCompletionUpdates,
  buildWarpStartUpdates,
  buildPlayerWarpInFlightAcquireUpdates,
  buildSessionlessWarpInFlightAcquireUpdates,
} = movementWarpBuilders;

const movementWarpStateHelpers = createMovementWarpStateHelpers({
  addVectors,
  clamp,
  clonePilotWarpMaxSpeedRamp,
  cloneVector,
  distance,
  getActualSpeedFraction,
  getCurrentAlignmentDirection,
  getTurnMetrics,
  magnitude,
  normalizeVector,
  scaleVector,
  serializeWarpState,
  subtractVectors,
  toFiniteNumber,
  toInt,
  DESTINY_STAMP_INTERVAL_MS,
  MIN_WARP_DISTANCE_METERS,
  ONE_AU_IN_METERS,
  SESSIONLESS_WARP_INGRESS_DURATION_MS,
  WARP_ALIGNMENT_RADIANS,
  WARP_COMPLETION_DISTANCE_MAX_METERS,
  WARP_COMPLETION_DISTANCE_MIN_METERS,
  WARP_COMPLETION_DISTANCE_RATIO,
  WARP_DECEL_RATE_MAX,
  WARP_DROPOUT_SPEED_MAX_MS,
  WARP_ENTRY_SPEED_FRACTION,
  WARP_NATIVE_DECEL_GRACE_MS,
});

const {
  getWarpAccelRate,
  getWarpDecelRate,
  getWarpDropoutSpeedMs,
  getWarpCompletionDistance,
  buildWarpProfile,
  buildPendingWarp,
  buildPendingWarpRequest,
  buildPreparingWarpState,
  refreshPreparingWarpState,
  evaluatePendingWarp,
  getPilotWarpActivationVelocity,
  activatePendingWarp,
  buildSessionlessWarpIngressState,
  advanceSessionlessWarpIngress,
  getWarpProgress,
  getWarpStopDistanceForTarget,
} = movementWarpStateHelpers;

const movementSceneRefresh = createMovementSceneRefresh({
  buildMissileSessionSnapshot,
  buildDbuffStateEntriesForSession: buildCommandBurstDbuffStateEntriesForSession,
  notifyActiveAssistanceJamStatesToSession,
  notifyActiveHostileJamStatesToSession,
  notifyActiveCommandBurstHudStatesToSession,
  isReadyForDestiny,
  logMissileDebug,
  logMovementDebug,
  refreshEntitiesForSlimPayload,
  refreshShipPresentationFields,
  roundNumber,
  summarizeRuntimeEntityForMissileDebug,
  toInt,
  MICHELLE_HELD_FUTURE_DESTINY_LEAD,
});

const movementContractDispatch = createMovementContractDispatch({
  cloneVector,
  directionsNearlyMatch,
  isReadyForDestiny,
  logMissileDebug,
  normalizeVector,
  roundNumber,
  sessionMatchesIdentity,
  summarizeRuntimeEntityForMissileDebug,
  buildMissileSessionSnapshot,
  toFiniteNumber,
  toInt,
  DEFAULT_RIGHT,
  MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
  MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
  MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
});

const movementOwnerDispatch = createMovementOwnerDispatch({
  buildMissileSessionMutation,
  buildMissileSessionSnapshot,
  cloneDynamicEntityForDestinyPresentation,
  cloneVector,
  directionsNearlyMatch,
  destiny,
  isReadyForDestiny,
  logMissileDebug,
  normalizeVector,
  roundNumber,
  sessionMatchesIdentity,
  summarizeMissileUpdatesForLog,
  summarizeVector,
  tagUpdatesRequireExistingVisibility,
  toFiniteNumber,
  toInt,
  advanceMovement,
  DEFAULT_RIGHT,
  MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
});

const movementDestinyDispatch = createMovementDestinyDispatch({
  buildMissileSessionMutation,
  buildMissileSessionSnapshot,
  clamp,
  destiny,
  getPayloadPrimaryEntityID,
  getNextMissileDebugTraceID: () => nextMissileDebugTraceID++,
  isMovementContractPayload,
  isReadyForDestiny,
  logDestinyDispatch,
  logMissileDebug,
  normalizeTraceValue,
  resolveDestinyLifecycleRestampState,
  resolveOwnerMonotonicState,
  resolvePreviousLastSentDestinyWasOwnerCritical,
  roundNumber,
  shouldLogMissilePayloadGroup,
  summarizeMissileUpdatesForLog,
  toInt,
  updatesContainMovementContractPayload,
  MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
  MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
  PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
});

const movementWatcherCorrections = createMovementWatcherCorrections({
  destiny,
  isReadyForDestiny,
  toInt,
  ACTIVE_SUBWARP_WATCHER_CORRECTION_INTERVAL_MS,
  ACTIVE_SUBWARP_WATCHER_POSITION_CORRECTION_INTERVAL_MS,
  ENABLE_PILOT_WARP_ACTIVE_CORRECTIONS,
  PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
  WATCHER_CORRECTION_INTERVAL_MS,
  WATCHER_POSITION_CORRECTION_INTERVAL_MS,
});

const movementSubwarpCommands = createMovementSubwarpCommands({
  addVectors,
  armMovementTrace,
  buildDirectedMovementUpdates,
  buildPointMovementUpdates,
  buildPerpendicular,
  clearTrackingState,
  cloneVector,
  crossProduct,
  directionsNearlyMatch,
  getShipDockingDistanceToStation,
  getTargetMotionPosition,
  logMovementDebug,
  normalizeVector,
  persistShipEntity,
  roundNumber,
  scaleVector,
  subtractVectors,
  summarizeVector,
  toFiniteNumber,
  toInt,
  DEFAULT_UP,
  OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
});

const {
  gotoDirection: dispatchGotoDirection,
  gotoPoint: dispatchGotoPoint,
  alignTo: dispatchAlignTo,
  followShipEntity: dispatchFollowShipEntity,
  followBall: dispatchFollowBall,
  orbitShipEntity: dispatchOrbitShipEntity,
  orbit: dispatchOrbit,
} = movementSubwarpCommands;

const movementWarpCommands = createMovementWarpCommands({
  activatePendingWarp,
  armMovementTrace,
  buildPilotWarpActivationUpdates,
  buildDirectedMovementUpdates,
  buildOfficialWarpReferenceProfile,
  buildPendingWarpRequest,
  buildPreparingWarpState,
  buildSessionlessWarpIngressState,
  buildWarpPrepareDispatch,
  buildWarpStartUpdates,
  clearTrackingState,
  cloneVector,
  getClientParityWarpInPoint,
  getStargateWarpLandingPoint,
  getStationWarpTargetPosition,
  getTargetMotionPosition,
  getWatcherWarpStartStamp,
  getWarpStopDistanceForTarget,
  isReadyForDestiny,
  logMovementDebug,
  logWarpDebug,
  normalizeVector,
  prewarmStartupControllersForWarpDestination,
  primePilotWarpActivationState,
  persistShipEntity,
  resolveStargateWarpTarget,
  subtractVectors,
  summarizePendingWarp,
  tagUpdatesRequireExistingVisibility,
  toFiniteNumber,
  toInt,
  DESTINY_STAMP_INTERVAL_MS,
  PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
  MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
});

const {
  warpToEntity: dispatchWarpToEntity,
  warpToPoint: dispatchWarpToPoint,
  warpDynamicEntityToPoint: dispatchWarpDynamicEntityToPoint,
  forceStartPendingWarp: dispatchForceStartPendingWarp,
  sendSessionlessWarpStartToVisibleSessions:
    dispatchSendSessionlessWarpStartToVisibleSessions,
  startSessionlessWarpIngress: dispatchStartSessionlessWarpIngress,
} = movementWarpCommands;

const movementStopSpeedCommands = createMovementStopSpeedCommands({
  addVectors,
  armMovementTrace,
  buildWarpCompletionUpdates,
  clamp,
  clearTrackingState,
  cloneVector,
  logMovementDebug,
  magnitude,
  normalizeVector,
  persistShipEntity,
  roundNumber,
  scaleVector,
  subtractVectors,
  MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  advanceMovement,
  cloneDynamicEntityForDestinyPresentation,
  MAX_SUBWARP_SPEED_FRACTION,
});

const {
  setSpeedFraction: dispatchSetSpeedFraction,
  stopShipEntity: dispatchStopShipEntity,
  stop: dispatchStop,
} = movementStopSpeedCommands;

class SolarSystemScene {
  constructor(systemID) {
    this.systemID = Number(systemID);
    this.system = worldData.getSolarSystemByID(this.systemID);
    this.sessions = new Map();
    this.dynamicEntities = new Map();
    this.droneEntityIDs = new Set();
    this.fighterEntityIDs = new Set();
    this.publicGridClustersByBoxKey = new Map();
    this.publicGridOccupiedBoxes = new Map();
    this.publicGridCompositionDirty = true;
    this.bubbles = new Map();
    this.nextBubbleID = 1;
    this.nextTargetSequence = 1;
    this.lastWallclockTickAt = Date.now();
    this.simTimeMs = this.lastWallclockTickAt;
    this.timeDilation = 1;
    this.lastTimeDilationRecoveryAtMs = 0;
    this.nextStamp = getCurrentDestinyStamp(this.simTimeMs);
    this.lastSimClockBroadcastWallclockAt = this.lastWallclockTickAt;
    this.pendingSubwarpMovementContracts = new Map();
    this._tickDestinyPresentation = null;
    this._directDestinyNotificationBatch = null;
    this._tickTargetingStatsCache = null;
    this.staticEntities = [];
    this.staticEntitiesByID = new Map();

    for (const station of worldData.getStationsForSystem(this.systemID)) {
      const entity = buildStaticStationEntity(station);
      this.addStaticEntity(entity);
    }
    for (const structure of worldData.getStructuresForSystem(this.systemID)) {
      const entity = buildStaticStructureEntity(structure);
      this.addStaticEntity(entity);
    }
    for (const asteroidBelt of worldData.getAsteroidBeltsForSystem(this.systemID)) {
      const entity = buildStaticAsteroidBeltEntity(asteroidBelt);
      this.addStaticEntity(entity);
    }
    for (const celestial of worldData.getCelestialsForSystem(this.systemID)) {
      const entity = buildStaticCelestialEntity(celestial);
      this.addStaticEntity(entity);
    }
    if (INCLUDE_STARGATES_IN_SCENE) {
      for (const stargate of worldData.getStargatesForSystem(this.systemID)) {
        const entity = buildStaticStargateEntity(stargate);
        this.addStaticEntity(entity);
      }
    }
    for (const entity of defaultEmpireScenery.getConfiguredStaticEntitiesForSystem(this.systemID)) {
      this.addStaticEntity(entity);
    }
    for (const entity of authoredSpaceProps.getConfiguredStaticEntitiesForSystem(this.systemID)) {
      this.addStaticEntity(entity);
    }

    for (const item of listSystemSpaceItems(this.systemID)) {
      const entity = buildRuntimeSpaceEntityFromItem(
        item,
        this.systemID,
        this.getCurrentSimTimeMs(),
        {
          // Fresh scenes should not resurrect persisted player-owned ships for
          // bystanders. The owning pilot is reattached explicitly on login,
          // and other player hulls should not leak back into space on restart.
          includeOfflinePlayerShips: false,
        },
      );
      if (!entity) {
        continue;
      }
      this.dynamicEntities.set(entity.itemID, entity);
      if (entity.kind === "drone") {
        this.droneEntityIDs.add(entity.itemID);
      }
      if (entity.kind === "fighter") {
        this.fighterEntityIDs.add(entity.itemID);
      }
      this.reconcileEntityPublicGrid(entity);
      this.reconcileEntityBubble(entity);
    }
    this.ensurePublicGridComposition();
  }

  addStaticEntity(entity) {
    if (!entity || !entity.itemID) {
      return false;
    }

    const normalizedItemID = Number(entity.itemID);
    if (!Number.isInteger(normalizedItemID) || normalizedItemID <= 0) {
      return false;
    }

    if (this.staticEntitiesByID.has(normalizedItemID)) {
      return false;
    }

    this.staticEntities.push(entity);
    this.staticEntitiesByID.set(normalizedItemID, entity);
    this.reconcileEntityPublicGrid(entity);
    if (isBubbleScopedStaticEntity(entity)) {
      this.reconcileEntityBubble(entity);
    }
    this.publicGridCompositionDirty = true;
    return true;
  }

  removeStaticEntity(entityID, options = {}) {
    const numericEntityID = Number(entityID);
    const entity = this.staticEntitiesByID.get(numericEntityID) || null;
    if (!entity) {
      return {
        success: false,
        errorMsg: "STATIC_ENTITY_NOT_FOUND",
      };
    }

    this.staticEntitiesByID.delete(numericEntityID);
    this.staticEntities = this.staticEntities.filter(
      (candidate) => Number(candidate && candidate.itemID) !== numericEntityID,
    );
    this.publicGridCompositionDirty = true;
    if (options.broadcast !== false) {
      this.broadcastRemoveStaticEntity(numericEntityID, options.excludedSession || null, {
        terminalDestructionEffectID: options.terminalDestructionEffectID,
        nowMs: options.nowMs,
      });
    }
    return {
      success: true,
      data: {
        entity,
      },
    };
  }

  syncStructureEntitiesFromState(options = {}) {
    const structures = worldData.getStructuresForSystem(this.systemID);
    const byStructureID = new Map(
      structures.map((structure) => [Number(structure.structureID), structure]),
    );
    const added = [];
    const updated = [];
    const damageStateChanged = [];

    for (const entity of [...this.staticEntities]) {
      if (!entity || entity.kind !== "structure") {
        continue;
      }

      const structure = byStructureID.get(Number(entity.itemID)) || null;
      if (!structure) {
        const destroyedStructure = structureState.getStructureByID(entity.itemID, {
          refresh: false,
        });
        const terminalDestructionEffectID =
          toInt(entity && entity.destroyedAt, 0) > 0 ||
          toInt(destroyedStructure && destroyedStructure.destroyedAt, 0) > 0
            ? DESTRUCTION_EFFECT_EXPLOSION
            : 0;
        this.removeStaticEntity(entity.itemID, {
          excludedSession: options.excludedSession || null,
          broadcast: options.broadcast !== false,
          terminalDestructionEffectID,
        });
        if (terminalDestructionEffectID > 0) {
          const spawnLootResult = spawnDeferredStructureLootEntities(this, entity.itemID, {
            excludedSession: options.excludedSession || null,
            broadcast: options.broadcast !== false,
          });
          if (!spawnLootResult.success) {
            log.warn(
              `[SpaceRuntime] Failed to spawn deferred structure loot for ${entity.itemID} in system ${this.systemID}: ${spawnLootResult.errorMsg}`,
            );
          }
        }
        continue;
      }

      const nextEntity = buildStaticStructureEntity(structure);
      const previousEntitySignature = getStructureStaticEntitySignature(entity);
      const previousConditionSignature = JSON.stringify(
        normalizeShipConditionState(entity && entity.conditionState),
      );
      const nextConditionSignature = JSON.stringify(
        normalizeShipConditionState(nextEntity && nextEntity.conditionState),
      );
      const nextEntitySignature = getStructureStaticEntitySignature(nextEntity);
      if (previousEntitySignature !== nextEntitySignature) {
        const previousSlimSignature = getStructureSlimItemSignature(entity);
        const nextSlimSignature = getStructureSlimItemSignature(nextEntity);
        Object.assign(entity, nextEntity);
        if (previousConditionSignature !== nextConditionSignature) {
          damageStateChanged.push(entity);
        }
        if (previousSlimSignature !== nextSlimSignature) {
          updated.push(entity);
        }
      }
      byStructureID.delete(Number(entity.itemID));
    }

    for (const structure of byStructureID.values()) {
      const entity = buildStaticStructureEntity(structure);
      if (this.addStaticEntity(entity)) {
        added.push(entity);
      }
    }

    if (options.broadcast !== false) {
      if (updated.length > 0) {
        this.broadcastSlimItemChanges(updated, options.excludedSession || null);
      }
      if (added.length > 0) {
        this.broadcastAddBalls(added, options.excludedSession || null);
      }
      if (damageStateChanged.length > 0) {
        for (const entity of damageStateChanged) {
          broadcastDamageStateChange(this, entity);
        }
      }
    }

    return {
      added,
      updated,
    };
  }

  getCurrentWallclockMs() {
    return Date.now();
  }

  getCurrentSimTimeMs() {
    return this.peekSimTimeForWallclock();
  }

  getCommandTimeEntitySurfaceDistance(
    sourceEntity,
    targetEntity,
    nowMs = this.getCurrentSimTimeMs(),
  ) {
    return getCommandTimeEntitySurfaceDistance(
      this,
      sourceEntity,
      targetEntity,
      nowMs,
    );
  }

  peekSimTimeForWallclock(wallclockNow = this.getCurrentWallclockMs()) {
    const normalizedWallclockNow = toFiniteNumber(
      wallclockNow,
      this.getCurrentWallclockMs(),
    );
    const lastWallclockTickAt = toFiniteNumber(
      this.lastWallclockTickAt,
      normalizedWallclockNow,
    );
    const wallclockDeltaMs = Math.max(0, normalizedWallclockNow - lastWallclockTickAt);
    return Math.max(
      0,
      toFiniteNumber(this.simTimeMs, normalizedWallclockNow) +
        (wallclockDeltaMs * clampTimeDilationFactor(this.timeDilation)),
    );
  }

  advanceClock(wallclockNow = this.getCurrentWallclockMs()) {
    const normalizedWallclockNow = toFiniteNumber(
      wallclockNow,
      this.getCurrentWallclockMs(),
    );
    const nextSimTimeMs = this.peekSimTimeForWallclock(normalizedWallclockNow);
    const previousSimTimeMs = Math.max(0, toFiniteNumber(this.simTimeMs, normalizedWallclockNow));
    const previousWallclockTickAt = toFiniteNumber(
      this.lastWallclockTickAt,
      normalizedWallclockNow,
    );
    this.lastWallclockTickAt = normalizedWallclockNow;
    this.simTimeMs = nextSimTimeMs;
    return {
      wallclockNowMs: normalizedWallclockNow,
      wallclockDeltaMs: Math.max(0, normalizedWallclockNow - previousWallclockTickAt),
      simNowMs: nextSimTimeMs,
      simDeltaMs: Math.max(0, nextSimTimeMs - previousSimTimeMs),
    };
  }

  getCurrentFileTime() {
    return toFileTimeFromMs(this.getCurrentSimTimeMs(), currentFileTime());
  }

  toFileTimeFromSimMs(value, fallback = this.getCurrentFileTime()) {
    return toFileTimeFromMs(value, fallback);
  }

  getSessionClockOffsetMs(session) {
    if (!session || !session._space) {
      return 0;
    }
    return toFiniteNumber(session._space.clockOffsetMs, 0);
  }

  getLastSentDestinyStampForSession(
    session,
    fallbackStamp = this.getCurrentDestinyStamp(),
  ) {
    if (!session || !session._space) {
      return toInt(fallbackStamp, 0) >>> 0;
    }
    const fallback = toInt(fallbackStamp, 0) >>> 0;
    const authorityState = snapshotDestinyAuthorityState(session);
    const lastSentStamp = toInt(
      authorityState && authorityState.lastPresentedStamp,
      session._space.lastSentDestinyStamp,
      fallback,
    ) >>> 0;
    return lastSentStamp;
  }

  getHistoryFloorDestinyStampForSession(
    session,
    fallbackStamp = this.getCurrentDestinyStamp(),
  ) {
    if (!session || !session._space) {
      return toInt(fallbackStamp, 0) >>> 0;
    }
    const fallback = toInt(fallbackStamp, 0) >>> 0;
    const historyFloorStamp = toInt(
      session._space.historyFloorDestinyStamp,
      fallback,
    ) >>> 0;
    return historyFloorStamp;
  }

  getImmediateDestinyStampForSession(
    session,
    fallbackStamp = this.getCurrentDestinyStamp(),
  ) {
    const currentStamp = toInt(fallbackStamp, this.getCurrentDestinyStamp()) >>> 0;
    const previousStamp = currentStamp > 0 ? ((currentStamp - 1) >>> 0) : currentStamp;
    if (!session || !session._space) {
      return previousStamp;
    }
    const lastVisibleStamp = toInt(
      session._space.historyFloorDestinyStamp,
      previousStamp,
    ) >>> 0;
    const maximumTrustedVisibleStamp = (
      previousStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD
    ) >>> 0;
    return (
      lastVisibleStamp > previousStamp &&
      lastVisibleStamp <= maximumTrustedVisibleStamp
    )
      ? lastVisibleStamp
      : previousStamp;
  }

  translateSimTimeForSession(session, rawSimTimeMs) {
    const normalizedRawSimTimeMs = toFiniteNumber(
      rawSimTimeMs,
      this.getCurrentSimTimeMs(),
    );
    return roundNumber(
      normalizedRawSimTimeMs + this.getSessionClockOffsetMs(session),
      3,
    );
  }

  getCurrentSessionSimTimeMs(session, rawSimTimeMs = this.getCurrentSimTimeMs()) {
    return this.translateSimTimeForSession(session, rawSimTimeMs);
  }

  getCurrentSessionDestinyStamp(
    session,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
  ) {
    return getCurrentDestinyStamp(
      this.getCurrentSessionSimTimeMs(session, rawSimTimeMs),
    );
  }

  getCurrentSessionFileTime(session, rawSimTimeMs = this.getCurrentSimTimeMs()) {
    const currentSessionSimTimeMs = this.getCurrentSessionSimTimeMs(
      session,
      rawSimTimeMs,
    );
    return toFileTimeFromMs(currentSessionSimTimeMs, this.getCurrentFileTime());
  }

  getCurrentVisibleSessionSimTimeMs(
    session,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
  ) {
    const currentSessionSimTimeMs = this.getCurrentSessionSimTimeMs(
      session,
      rawSimTimeMs,
    );
    const currentVisibleStamp = this.getCurrentVisibleSessionDestinyStamp(
      session,
      rawSimTimeMs,
    );
    return Math.max(
      currentSessionSimTimeMs,
      (toInt(currentVisibleStamp, 0) * 1000),
    );
  }

  getCurrentVisibleSessionDestinyStamp(
    session,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
  ) {
    return this.getCurrentVisibleDestinyStampForSession(
      session,
      this.getCurrentSessionDestinyStamp(session, rawSimTimeMs),
    );
  }

  getCurrentPresentedSessionDestinyStamp(
    session,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
    maximumFutureLead = MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  ) {
    const currentVisibleStamp = this.getCurrentVisibleSessionDestinyStamp(
      session,
      rawSimTimeMs,
    );
    return resolvePresentedSessionDestinyStamp({
      currentVisibleStamp,
      hasSessionSpace: Boolean(session && session._space),
      lastSentStamp:
        session && session._space
          ? session._space.lastSentDestinyStamp
          : currentVisibleStamp,
      maximumFutureLead,
      defaultMaximumFutureLead: MICHELLE_HELD_FUTURE_DESTINY_LEAD,
      maximumTrustedLead: Math.max(
        MICHELLE_HELD_FUTURE_DESTINY_LEAD,
        PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
      ),
    });
  }

  getOwnerPropulsionTogglePresentationStamp(
    session,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
  ) {
    const currentSessionStamp = this.getCurrentSessionDestinyStamp(
      session,
      rawSimTimeMs,
    ) >>> 0;
    const currentPresentedStamp = this.getCurrentPresentedSessionDestinyStamp(
      session,
      rawSimTimeMs,
      PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
    ) >>> 0;
    // `client/jolt222.txt` showed that reusing the current presented owner
    // lane for self propulsion ship-prime/FX lets the client consume a steer
    // on that lane first and then rewind when the propulsion setters land one
    // tick later. Clear exactly one tick past the presented lane, but never
    // beyond Michelle's held-future owner window.
    return Math.min(
      (
        currentSessionStamp +
        MICHELLE_HELD_FUTURE_DESTINY_LEAD
      ) >>> 0,
      Math.max(
        ((currentSessionStamp + 1) >>> 0),
        ((currentPresentedStamp + 1) >>> 0),
      ) >>> 0,
    ) >>> 0;
  }

  getCurrentClampedDestinyStampForSession(
    session,
    fallbackStamp = this.getCurrentDestinyStamp(),
  ) {
    const currentStamp = toInt(
      fallbackStamp,
      this.getCurrentDestinyStamp(),
    ) >>> 0;
    return this.getCurrentVisibleDestinyStampForSession(
      session,
      currentStamp,
    );
  }

  getCurrentClampedSessionSimTimeMs(
    session,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
  ) {
    const currentSessionSimTimeMs = this.getCurrentSessionSimTimeMs(
      session,
      rawSimTimeMs,
    );
    const currentClampedStamp = this.getCurrentVisibleSessionDestinyStamp(
      session,
      rawSimTimeMs,
    );
    return Math.max(
      currentSessionSimTimeMs,
      (toInt(currentClampedStamp, 0) * 1000),
    );
  }

  getCurrentClampedSessionFileTime(
    session,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
  ) {
    const currentClampedSessionSimTimeMs = this.getCurrentClampedSessionSimTimeMs(
      session,
      rawSimTimeMs,
    );
    return toFileTimeFromMs(
      currentClampedSessionSimTimeMs,
      this.getCurrentFileTime(),
    );
  }

  getCurrentVisibleSessionFileTime(
    session,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
  ) {
    const currentVisibleSessionSimTimeMs = this.getCurrentVisibleSessionSimTimeMs(
      session,
      rawSimTimeMs,
    );
    return toFileTimeFromMs(
      currentVisibleSessionSimTimeMs,
      this.getCurrentFileTime(),
    );
  }

  translateDestinyStampForSession(session, rawStamp) {
    const normalizedRawStamp = toInt(rawStamp, 0) >>> 0;
    const clockOffsetMs = this.getSessionClockOffsetMs(session);
    if (Math.abs(clockOffsetMs) < 0.000001) {
      return normalizedRawStamp;
    }
    return getCurrentDestinyStamp((normalizedRawStamp * 1000) + clockOffsetMs);
  }

  refreshSessionClockSnapshot(
    session,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (!session || !session._space) {
      return null;
    }

    const currentSessionSimTimeMs =
      options.currentSimTimeMs === undefined || options.currentSimTimeMs === null
        ? this.getCurrentSessionSimTimeMs(session, rawSimTimeMs)
        : toFiniteNumber(options.currentSimTimeMs, this.getCurrentSessionSimTimeMs(session, rawSimTimeMs));
    const currentSessionSimFileTime = toFileTimeFromMs(
      currentSessionSimTimeMs,
      this.getCurrentFileTime(),
    );
    session._space.timeDilation = this.getTimeDilation();
    session._space.simTimeMs = currentSessionSimTimeMs;
    session._space.simFileTime = currentSessionSimFileTime;
    return {
      currentSimTimeMs: currentSessionSimTimeMs,
      currentSimFileTime: currentSessionSimFileTime,
      timeDilation: this.getTimeDilation(),
    };
  }

  getCurrentDestinyStamp(nowMs = this.getCurrentSimTimeMs()) {
    return getCurrentDestinyStamp(nowMs);
  }

  getMovementStamp(nowMs = this.getCurrentSimTimeMs()) {
    return getMovementStamp(nowMs);
  }

  getNextDestinyStamp(nowMs = this.getCurrentSimTimeMs()) {
    const currentStamp = this.getCurrentDestinyStamp(nowMs);
    const maxAllowedStamp = (currentStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0;
    if (this.nextStamp < currentStamp) {
      this.nextStamp = currentStamp;
      return this.nextStamp;
    }
    if (this.nextStamp >= maxAllowedStamp) {
      this.nextStamp = maxAllowedStamp;
      return this.nextStamp;
    }
    this.nextStamp = (this.nextStamp + 1) >>> 0;
    return this.nextStamp;
  }

  getHistorySafeDestinyStamp(
    nowMs = this.getCurrentSimTimeMs(),
    minimumLead = 1,
    maximumLead = MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  ) {
    const currentStamp = this.getCurrentDestinyStamp(nowMs);
    const normalizedLead = clamp(
      toInt(minimumLead, 1),
      0,
      Math.max(0, toInt(maximumLead, MICHELLE_HELD_FUTURE_DESTINY_LEAD)),
    );
    const minimumStamp = (currentStamp + normalizedLead) >>> 0;
    const maxAllowedStamp = (
      currentStamp +
      clamp(
        toInt(maximumLead, MICHELLE_HELD_FUTURE_DESTINY_LEAD),
        0,
        16,
      )
    ) >>> 0;
    const baseStamp = this.nextStamp < currentStamp ? currentStamp : this.nextStamp;
    this.nextStamp = Math.min(
      maxAllowedStamp,
      Math.max(baseStamp, minimumStamp),
    ) >>> 0;
    return this.nextStamp;
  }

  getCurrentVisibleDestinyStampForSession(
    session,
    fallbackStamp = this.getCurrentDestinyStamp(),
  ) {
    const currentStamp = toInt(fallbackStamp, this.getCurrentDestinyStamp()) >>> 0;
    const lastVisibleStamp = this.getHistoryFloorDestinyStampForSession(
      session,
      currentStamp,
    );
    return lastVisibleStamp > currentStamp
      ? lastVisibleStamp
      : currentStamp;
  }

  getHistorySafeSessionDestinyStamp(
    session,
    nowMs = this.getCurrentSimTimeMs(),
    minimumLead = 1,
    maximumLead = MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  ) {
    const rawStamp = this.getHistorySafeDestinyStamp(
      nowMs,
      minimumLead,
      maximumLead,
    );
    return this.getPendingHistorySafeSessionDestinyStamp(
      session,
      rawStamp,
      nowMs,
      minimumLead,
    );
  }

  getPendingHistorySafeSessionDestinyStamp(
    session,
    rawStamp,
    nowMs = this.getCurrentSimTimeMs(),
    minimumLead = 1,
  ) {
    if (!session || !session._space) {
      return resolvePendingHistorySafeSessionDestinyStamp({
        hasSessionSpace: false,
        rawStamp,
      });
    }
    const currentSessionStamp = this.getCurrentSessionDestinyStamp(session, nowMs);
    return resolvePendingHistorySafeSessionDestinyStamp({
      hasSessionSpace: true,
      rawStamp,
      translatedStamp: this.translateDestinyStampForSession(
        session,
        rawStamp,
      ),
      currentSessionStamp,
      lastVisibleSessionStamp: this.getHistoryFloorDestinyStampForSession(
        session,
        currentSessionStamp,
      ),
      minimumLead,
    });
  }

  getDestinyHistoryAnchorStampForSession(
    session,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    return movementDestinyDispatch.getDestinyHistoryAnchorStampForSession(
      this,
      session,
      rawSimTimeMs,
      options,
    );
  }

  resolveDestinyDeliveryStampForSession(
    session,
    authoredStamp,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    return movementDestinyDispatch.resolveDestinyDeliveryStampForSession(
      this,
      session,
      authoredStamp,
      rawSimTimeMs,
      options,
    );
  }

  prepareDestinyUpdateForSession(
    session,
    rawPayload,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    return movementDestinyDispatch.prepareDestinyUpdateForSession(
      this,
      session,
      rawPayload,
      rawSimTimeMs,
      options,
    );
  }

  isSessionInPilotWarpQuietWindow(
    session,
    now = this.getCurrentSimTimeMs(),
  ) {
    if (!session || !session._space) {
      return false;
    }
    const quietUntilStamp = toInt(session._space.pilotWarpQuietUntilStamp, 0) >>> 0;
    if (quietUntilStamp > 0) {
      const currentSessionStamp = this.translateDestinyStampForSession(
        session,
        this.getCurrentDestinyStamp(now),
      );
      if (currentSessionStamp < quietUntilStamp) {
        return true;
      }
      session._space.pilotWarpQuietUntilStamp = 0;
    }
    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return false;
    }
    if (egoEntity.itemID !== toInt(session._space.shipID, 0)) {
      return false;
    }
    if (egoEntity.mode !== "WARP" || !egoEntity.warpState) {
      return false;
    }
    return true;
  }

  beginTickDestinyPresentationBatch() {
    return movementDestinyDispatch.beginTickDestinyPresentationBatch(this);
  }

  hasActiveTickDestinyPresentationBatch() {
    return movementDestinyDispatch.hasActiveTickDestinyPresentationBatch(
      this,
    );
  }

  shouldDeferPilotMovementForMissilePressure(
    session,
    nowMs = this.getCurrentSimTimeMs(),
  ) {
    return movementDestinyDispatch.shouldDeferPilotMovementForMissilePressure(
      this,
      session,
      nowMs,
    );
  }

  queueTickDestinyPresentationUpdates(session, updates, options = {}) {
    return movementDestinyDispatch.queueTickDestinyPresentationUpdates(
      this,
      session,
      updates,
      options,
    );
  }

  flushTickDestinyPresentationBatch() {
    return movementDestinyDispatch.flushTickDestinyPresentationBatch(this);
  }

  flushDirectDestinyNotificationBatch() {
    return movementDestinyDispatch.flushDirectDestinyNotificationBatch(this);
  }

  flushDirectDestinyNotificationBatchIfIdle() {
    if (this.hasActiveTickDestinyPresentationBatch()) {
      return 0;
    }
    return this.flushDirectDestinyNotificationBatch();
  }

  getTimeDilation() {
    return clampTimeDilationFactor(this.timeDilation);
  }

  buildTimeStateSnapshot() {
    return {
      systemID: this.systemID,
      timeDilation: this.getTimeDilation(),
      simTimeMs: this.getCurrentSimTimeMs(),
      simFileTime: this.getCurrentFileTime(),
      destinyStamp: this.getCurrentDestinyStamp(),
    };
  }

  syncSessionSimClock(session, options = {}) {
    if (!session || !session._space) {
      return null;
    }

    const rawSceneSimTimeMs = this.getCurrentSimTimeMs();
    const previousSimTimeMs =
      options.previousSimTimeMs === undefined || options.previousSimTimeMs === null
        ? fileTimeToMs(session._space.simFileTime, rawSceneSimTimeMs)
        : toFiniteNumber(options.previousSimTimeMs, rawSceneSimTimeMs);
    const currentSimTimeMs =
      options.currentSimTimeMs === undefined || options.currentSimTimeMs === null
        ? this.getCurrentSessionSimTimeMs(session, rawSceneSimTimeMs)
        : toFiniteNumber(
            options.currentSimTimeMs,
            this.getCurrentSessionSimTimeMs(session, rawSceneSimTimeMs),
          );
    const previousSimFileTime = toFileTimeFromMs(
      previousSimTimeMs,
      this.getCurrentFileTime(),
    );
    const currentSimFileTime = toFileTimeFromMs(
      currentSimTimeMs,
      this.getCurrentFileTime(),
    );
    const currentSessionStamp = getCurrentDestinyStamp(currentSimTimeMs);
    const shouldEmitRebase =
      options.emit !== false &&
      typeof session.sendNotification === "function" &&
      (options.forceRebase === true || previousSimFileTime !== currentSimFileTime);

    const preserveBootstrapClockOffset =
      session._space.initialStateSent !== true &&
      session._space.deferInitialBallparkStateUntilBind === true;
    if (!preserveBootstrapClockOffset) {
      session._space.clockOffsetMs = roundNumber(
        currentSimTimeMs - rawSceneSimTimeMs,
        3,
      );
    }
    this.refreshSessionClockSnapshot(session, currentSimTimeMs, {
      currentSimTimeMs,
    });

    if (shouldEmitRebase) {
      session.sendNotification("DoSimClockRebase", "clientID", [[
        { type: "long", value: previousSimFileTime },
        { type: "long", value: currentSimFileTime },
      ]]);
      // Once the client rebases Michelle onto the new session clock, treat
      // that stamp as the consumed-history floor for later clamps. A freshly
      // sent future packet is not the same thing as visible client history.
      session._space.historyFloorDestinyStamp = currentSessionStamp;
    }

    const result = {
      previousSimTimeMs,
      currentSimTimeMs,
      previousSimFileTime,
      currentSimFileTime,
      timeDilation: this.getTimeDilation(),
    };
    recordSessionJumpTimingTrace(session, "sync-session-sim-clock", {
      emit: options.emit !== false,
      forceRebase: options.forceRebase === true,
      deltaMs: roundNumber(currentSimTimeMs - previousSimTimeMs, 3),
      result,
    });
    return result;
  }

  syncAllSessionSimClocks(options = {}) {
    const synced = [];
    for (const session of this.sessions.values()) {
      const result = this.syncSessionSimClock(session, options);
      if (result) {
        synced.push({
          clientID: session.clientID,
          characterID: session.characterID,
          ...result,
        });
      }
    }
    return synced;
  }

  maybeBroadcastSimClockUpdate(clockState) {
    if (!clockState || this.sessions.size === 0) {
      return [];
    }

    const wallclockNowMs = toFiniteNumber(
      clockState.wallclockNowMs,
      this.getCurrentWallclockMs(),
    );
    const minimumIntervalMs =
      this.getTimeDilation() < 1
        ? SIM_CLOCK_REBASE_INTERVAL_MS
        : DESTINY_STAMP_INTERVAL_MS;
    if (
      wallclockNowMs - toFiniteNumber(
        this.lastSimClockBroadcastWallclockAt,
        0,
      ) < minimumIntervalMs
    ) {
      return [];
    }

    this.lastSimClockBroadcastWallclockAt = wallclockNowMs;
    return this.syncAllSessionSimClocks({
      emit: true,
      forceRebase: true,
      currentSimTimeMs: clockState.simNowMs,
    });
  }

  //testing: Sets the server-side time dilation factor for this scene.
  //testing: Affects sim clock advancement (warp, movement, destiny stamps).
  //testing: Client-side TiDi HUD notification is sent separately by the /tidi command
  //testing: and autoscaler via synchronizedTimeDilation.js.
  setTimeDilation(value, options = {}) {
    const previousFactor = this.getTimeDilation();
    const nextFactor = clampTimeDilationFactor(value, previousFactor);

    const clockState = this.advanceClock(options.wallclockNowMs);
    const previousSimTimeMs = clockState.simNowMs;
    this.timeDilation = nextFactor;
    this.lastTimeDilationRecoveryAtMs =
      previousFactor < 1 && nextFactor >= 1
        ? previousSimTimeMs
        : 0;

    this.lastSimClockBroadcastWallclockAt = clockState.wallclockNowMs;
    if (options.syncSessions !== false) {
      this.syncAllSessionSimClocks({
        ...options,
        previousSimTimeMs,
        currentSimTimeMs: this.getCurrentSimTimeMs(),
        forceRebase: options.forceRebase === true,
      });
    }

    return {
      systemID: this.systemID,
      previousFactor,
      factor: nextFactor,
      simTimeMs: this.getCurrentSimTimeMs(),
      simFileTime: this.getCurrentFileTime(),
      syncedSessionCount: this.sessions.size,
    };
  }

  getAllVisibleEntities() {
    return [...this.staticEntities, ...this.dynamicEntities.values()];
  }

  resolveBubbleCenter(center) {
    let resolvedCenter = cloneVector(center);
    for (let index = 0; index < 8; index += 1) {
      let overlappingBubble = null;
      for (const bubble of this.bubbles.values()) {
        if (
          distanceSquared(resolvedCenter, bubble.center) <
          BUBBLE_CENTER_MIN_DISTANCE_SQUARED
        ) {
          overlappingBubble = bubble;
          break;
        }
      }
      if (!overlappingBubble) {
        return resolvedCenter;
      }

      const offset = subtractVectors(resolvedCenter, overlappingBubble.center);
      const direction = normalizeVector(
        magnitude(offset) > 0 ? offset : DEFAULT_RIGHT,
        DEFAULT_RIGHT,
      );
      resolvedCenter = addVectors(
        cloneVector(overlappingBubble.center),
        scaleVector(direction, BUBBLE_CENTER_MIN_DISTANCE_METERS),
      );
    }

    return resolvedCenter;
  }

  createBubble(center) {
    const bubble = {
      id: this.nextBubbleID,
      uuid: crypto.randomUUID(),
      center: this.resolveBubbleCenter(center),
      entityIDs: new Set(),
    };
    this.nextBubbleID += 1;
    this.bubbles.set(bubble.id, bubble);
    logBubbleDebug("bubble.created", {
      systemID: this.systemID,
      bubble: summarizeBubbleState(bubble),
      radiusMeters: BUBBLE_RADIUS_METERS,
      hysteresisMeters: BUBBLE_HYSTERESIS_METERS,
    });
    return bubble;
  }

  getBubbleByID(bubbleID) {
    const numericBubbleID = toInt(bubbleID, 0);
    if (!numericBubbleID) {
      return null;
    }
    return this.bubbles.get(numericBubbleID) || null;
  }

  removeBubbleIfEmpty(bubbleID) {
    const bubble = this.getBubbleByID(bubbleID);
    if (!bubble || bubble.entityIDs.size > 0) {
      return;
    }
    logBubbleDebug("bubble.removed", {
      systemID: this.systemID,
      bubble: summarizeBubbleState(bubble),
    });
    this.bubbles.delete(bubble.id);
  }

  getDynamicEntitiesInBubble(bubbleID) {
    const bubble = this.getBubbleByID(bubbleID);
    if (!bubble) {
      return [];
    }

    const entities = [];
    for (const entityID of bubble.entityIDs.values()) {
      const entity = this.dynamicEntities.get(entityID);
      if (entity) {
        entities.push(entity);
      }
    }
    return entities;
  }

  getShipsInBubble(bubbleID) {
    return this.getDynamicEntitiesInBubble(bubbleID).filter(
      (entity) => entity && entity.kind === "ship",
    );
  }

  getBubbleForSession(session) {
    const egoEntity = this.getShipEntityForSession(session);
    return egoEntity ? this.getBubbleByID(egoEntity.bubbleID) : null;
  }

  getPublicGridKeyForEntity(entity) {
    if (!entity) {
      return null;
    }
    return String(entity.publicGridKey || buildPublicGridKey(entity.position || null));
  }

  getPublicGridClusterKeyForEntity(entity) {
    if (!entity) {
      return null;
    }
    this.ensurePublicGridComposition();
    const publicGridKey = this.getPublicGridKeyForEntity(entity);
    if (!publicGridKey) {
      return null;
    }
    const clusterKey = String(
      entity.publicGridClusterKey ||
      this.publicGridClustersByBoxKey.get(publicGridKey) ||
      publicGridKey
    );
    entity.publicGridClusterKey = clusterKey;
    return clusterKey;
  }

  getPublicGridClusterKeyForPosition(position) {
    const publicGridKey = buildPublicGridKey(position || null);
    if (!publicGridKey) {
      return null;
    }
    this.ensurePublicGridComposition();
    return String(
      this.publicGridClustersByBoxKey.get(publicGridKey) ||
      publicGridKey
    );
  }

  getPublicGridKeyForSession(session) {
    const egoEntity = this.getShipEntityForSession(session);
    return egoEntity ? this.getPublicGridKeyForEntity(egoEntity) : null;
  }

  getPublicGridClusterKeyForSession(session) {
    const egoEntity = this.getShipEntityForSession(session);
    return egoEntity ? this.getPublicGridClusterKeyForEntity(egoEntity) : null;
  }

  resolveVisibilityClusterKeyForSession(
    session,
    options = {},
    egoEntity = this.getShipEntityForSession(session),
  ) {
    const overrideClusterKey = String(
      options && options.visibilityClusterKeyOverride || "",
    ).trim();
    if (overrideClusterKey) {
      return overrideClusterKey;
    }
    return egoEntity ? this.getPublicGridClusterKeyForEntity(egoEntity) : null;
  }

  getSessionsInBubble(bubbleID) {
    const numericBubbleID = toInt(bubbleID, 0);
    if (!numericBubbleID) {
      return [];
    }

    const sessions = [];
    for (const session of this.sessions.values()) {
      const egoEntity = this.getShipEntityForSession(session);
      if (egoEntity && toInt(egoEntity.bubbleID, 0) === numericBubbleID) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  buildBubbleCenterForEntity(entity, position = entity && entity.position) {
    const numericPosition = cloneVector(position, { x: 0, y: 0, z: 0 });
    const velocity = cloneVector(entity && entity.velocity, { x: 0, y: 0, z: 0 });
    const direction = cloneVector(entity && entity.direction, DEFAULT_RIGHT);
    const motionDirection = normalizeVector(
      magnitude(velocity) > 1 ? velocity : direction,
      DEFAULT_RIGHT,
    );
    return addVectors(
      numericPosition,
      scaleVector(motionDirection, BUBBLE_RADIUS_METERS / 2),
    );
  }

  findBestBubbleForPosition(position, radiusSquared = BUBBLE_RADIUS_SQUARED) {
    let bestBubble = null;
    let bestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const bubble of this.bubbles.values()) {
      const currentDistanceSquared = distanceSquared(position, bubble.center);
      if (
        currentDistanceSquared <= radiusSquared &&
        currentDistanceSquared < bestDistanceSquared
      ) {
        bestBubble = bubble;
        bestDistanceSquared = currentDistanceSquared;
      }
    }
    return bestBubble;
  }

  selectBubbleForEntity(entity, position = entity && entity.position) {
    if (!entity) {
      return null;
    }
    const numericPosition = cloneVector(position, entity.position);
    const currentBubble = this.getBubbleByID(entity.bubbleID);
    if (
      currentBubble &&
      distanceSquared(numericPosition, currentBubble.center) <=
        BUBBLE_RETENTION_RADIUS_SQUARED
    ) {
      return currentBubble;
    }
    const existingBubble = this.findBestBubbleForPosition(
      numericPosition,
      BUBBLE_RADIUS_SQUARED,
    );
    if (existingBubble) {
      return existingBubble;
    }
    return this.createBubble(this.buildBubbleCenterForEntity(entity, numericPosition));
  }

  moveEntityToBubble(entity, bubble) {
    if (!entity || !bubble) {
      return null;
    }
    const previousBubbleID = toInt(entity.bubbleID, 0);
    if (previousBubbleID && previousBubbleID === bubble.id) {
      bubble.entityIDs.add(entity.itemID);
      return bubble;
    }
    if (previousBubbleID) {
      const previousBubble = this.getBubbleByID(previousBubbleID);
      if (previousBubble) {
        previousBubble.entityIDs.delete(entity.itemID);
      }
      this.removeBubbleIfEmpty(previousBubbleID);
    }
    bubble.entityIDs.add(entity.itemID);
    entity.bubbleID = bubble.id;
    logBubbleDebug("bubble.entity_entered", {
      systemID: this.systemID,
      entity: summarizeBubbleEntity(entity),
      previousBubbleID,
      bubble: summarizeBubbleState(bubble),
    });
    return bubble;
  }

  removeEntityFromBubble(entity) {
    if (!entity) {
      return 0;
    }
    const previousBubbleID = toInt(entity.bubbleID, 0);
    if (!previousBubbleID) {
      entity.bubbleID = null;
      return 0;
    }
    const previousBubble = this.getBubbleByID(previousBubbleID);
    if (previousBubble) {
      previousBubble.entityIDs.delete(entity.itemID);
    }
    entity.bubbleID = null;
    logBubbleDebug("bubble.entity_removed", {
      systemID: this.systemID,
      entity: summarizeBubbleEntity(entity),
      previousBubbleID,
      bubble: summarizeBubbleState(previousBubble),
    });
    this.removeBubbleIfEmpty(previousBubbleID);
    return previousBubbleID;
  }

  reconcileEntityBubble(entity) {
    if (!entity || entity.mode === "WARP") {
      return null;
    }
    this.reconcileEntityPublicGrid(entity);
    const bubble = this.selectBubbleForEntity(entity);
    this.moveEntityToBubble(entity, bubble);
    if (entity.departureBubbleID) {
      entity.departureBubbleID = null;
      entity.departureBubbleVisibleUntilMs = 0;
    }
    return bubble;
  }

  reconcileEntityPublicGrid(entity) {
    if (!entity) {
      return null;
    }

    const previousPublicGridKey = String(entity.publicGridKey || "");
    const nextPublicGridKey = buildPublicGridKey(entity.position || null);
    entity.publicGridKey = nextPublicGridKey;
    entity.publicGridClusterKey = null;
    if (previousPublicGridKey !== nextPublicGridKey) {
      this.publicGridCompositionDirty = true;
    }
    if (previousPublicGridKey && previousPublicGridKey !== nextPublicGridKey) {
      logBubbleDebug("public_grid.entity_moved", {
        systemID: this.systemID,
        entity: summarizeBubbleEntity(entity),
        previousPublicGridKey,
        publicGrid: summarizePublicGrid(entity.position),
      });
    }
    return nextPublicGridKey;
  }

  collectOccupiedPublicGridBoxes() {
    const occupiedBoxes = new Map();
    const noteEntity = (entity, source) => {
      if (!entity || !entity.position) {
        return;
      }
      const parsed = parsePublicGridKey(this.reconcileEntityPublicGrid(entity));
      let entry = occupiedBoxes.get(parsed.key);
      if (!entry) {
        entry = {
          key: parsed.key,
          xIndex: parsed.xIndex,
          yIndex: parsed.yIndex,
          zIndex: parsed.zIndex,
          staticEntityIDs: new Set(),
          dynamicEntityIDs: new Set(),
        };
        occupiedBoxes.set(parsed.key, entry);
      }
      if (source === "static") {
        entry.staticEntityIDs.add(toInt(entity.itemID, 0));
      } else {
        entry.dynamicEntityIDs.add(toInt(entity.itemID, 0));
      }
    };

    for (const entity of this.staticEntities) {
      noteEntity(entity, "static");
    }
    for (const entity of this.dynamicEntities.values()) {
      noteEntity(entity, "dynamic");
    }

    return occupiedBoxes;
  }

  rebuildPublicGridComposition() {
    const occupiedBoxes = this.collectOccupiedPublicGridBoxes();
    const clusterByBoxKey = new Map();
    const visited = new Set();
    const sortedBoxKeys = [...occupiedBoxes.keys()].sort();

    const visitNeighborKeys = (entry) => {
      // Treat giant-grid composition as face-connected box occupancy.
      // Diagonal/corner joins over-compose dense systems like Jita and cause
      // login/bootstrap visibility to leak across nearby but distinct gates.
      return [
        buildPublicGridKeyFromIndices(entry.xIndex - 1, entry.yIndex, entry.zIndex),
        buildPublicGridKeyFromIndices(entry.xIndex + 1, entry.yIndex, entry.zIndex),
        buildPublicGridKeyFromIndices(entry.xIndex, entry.yIndex - 1, entry.zIndex),
        buildPublicGridKeyFromIndices(entry.xIndex, entry.yIndex + 1, entry.zIndex),
        buildPublicGridKeyFromIndices(entry.xIndex, entry.yIndex, entry.zIndex - 1),
        buildPublicGridKeyFromIndices(entry.xIndex, entry.yIndex, entry.zIndex + 1),
      ];
    };

    for (const boxKey of sortedBoxKeys) {
      if (visited.has(boxKey)) {
        continue;
      }
      const seed = occupiedBoxes.get(boxKey);
      if (!seed) {
        continue;
      }
      const stack = [seed];
      const clusterKeys = [];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || visited.has(current.key)) {
          continue;
        }
        visited.add(current.key);
        clusterKeys.push(current.key);
        for (const neighborKey of visitNeighborKeys(current)) {
          if (visited.has(neighborKey) || !occupiedBoxes.has(neighborKey)) {
            continue;
          }
          stack.push(occupiedBoxes.get(neighborKey));
        }
      }
      clusterKeys.sort();
      const clusterKey = `cluster:${clusterKeys[0]}`;
      for (const clusterBoxKey of clusterKeys) {
        clusterByBoxKey.set(clusterBoxKey, clusterKey);
      }
    }

    this.publicGridOccupiedBoxes = occupiedBoxes;
    this.publicGridClustersByBoxKey = clusterByBoxKey;
    this.publicGridCompositionDirty = false;

    for (const entity of this.staticEntities) {
      const publicGridKey = this.getPublicGridKeyForEntity(entity);
      entity.publicGridClusterKey = publicGridKey
        ? String(clusterByBoxKey.get(publicGridKey) || publicGridKey)
        : null;
    }
    for (const entity of this.dynamicEntities.values()) {
      const publicGridKey = this.getPublicGridKeyForEntity(entity);
      entity.publicGridClusterKey = publicGridKey
        ? String(clusterByBoxKey.get(publicGridKey) || publicGridKey)
        : null;
    }

    return clusterByBoxKey;
  }

  ensurePublicGridComposition() {
    if (this.publicGridCompositionDirty !== true) {
      return this.publicGridClustersByBoxKey;
    }
    return this.rebuildPublicGridComposition();
  }

  reconcileAllDynamicEntityPublicGrids() {
    let changed = false;
    for (const entity of this.dynamicEntities.values()) {
      const previousKey = this.getPublicGridKeyForEntity(entity);
      const nextKey = this.reconcileEntityPublicGrid(entity);
      if (previousKey !== nextKey) {
        changed = true;
      }
    }
    if (changed) {
      this.publicGridCompositionDirty = true;
    }
    return changed;
  }

  reconcileAllDynamicEntityBubbles() {
    for (const entity of this.dynamicEntities.values()) {
      if (entity.mode === "WARP") {
        continue;
      }
      this.reconcileEntityBubble(entity);
    }
  }

  beginWarpDepartureOwnership(entity, now = this.getCurrentSimTimeMs()) {
    if (!entity) {
      return;
    }
    entity.departureBubbleID = this.removeEntityFromBubble(entity);
    entity.departureBubbleVisibleUntilMs =
      toFiniteNumber(now, this.getCurrentSimTimeMs()) +
      (DESTINY_STAMP_INTERVAL_MS * 2);
    logBubbleDebug("bubble.warp_departure_ownership_started", {
      systemID: this.systemID,
      entity: summarizeBubbleEntity(entity),
      departureBubbleVisibleUntilMs: roundNumber(
        toFiniteNumber(entity.departureBubbleVisibleUntilMs, 0),
        3,
      ),
      publicGrid: summarizePublicGrid(entity.position),
    });
  }

  clearPilotWarpVisibilityHandoff(session) {
    if (session && session._space) {
      session._space.pilotWarpVisibilityHandoff = null;
    }
  }

  beginPilotWarpVisibilityHandoff(
    entity,
    warpState,
  ) {
    const session = entity && entity.session;
    if (!session || !session._space || !warpState) {
      return;
    }
    const sourceClusterKey = this.getPublicGridClusterKeyForEntity(entity);
    const destinationClusterKey = this.getPublicGridClusterKeyForPosition(
      warpState.targetPoint || warpState.rawDestination || entity.position,
    );
    session._space.pilotWarpVisibilityHandoff = {
      shipID: toInt(entity.itemID, 0),
      sourceClusterKey,
      destinationClusterKey,
      sourceRemoved: false,
      destinationStaticJoined: false,
      destinationJoined: false,
      destinationPrewarmed: false,
    };
  }

  advancePilotWarpVisibilityHandoff(
    entity,
    now,
    sessionOnlyUpdates,
  ) {
    const session = entity && entity.session;
    if (
      !session ||
      !session._space ||
      !entity ||
      entity.mode !== "WARP" ||
      !entity.warpState
    ) {
      return;
    }
    const handoff = session._space.pilotWarpVisibilityHandoff;
    if (
      !handoff ||
      toInt(handoff.shipID, 0) !== toInt(entity.itemID, 0)
    ) {
      return;
    }

    const currentIDs =
      session._space.visibleDynamicEntityIDs instanceof Set
        ? session._space.visibleDynamicEntityIDs
        : new Set();
    const currentStaticIDs =
      session._space.visibleBubbleScopedStaticEntityIDs instanceof Set
        ? session._space.visibleBubbleScopedStaticEntityIDs
        : new Set();
    const freshIDs =
      session._space.freshlyVisibleDynamicEntityIDs instanceof Set
        ? session._space.freshlyVisibleDynamicEntityIDs
        : new Set();
    const elapsedMs = Math.max(
      0,
      toFiniteNumber(now, this.getCurrentSimTimeMs()) -
        toFiniteNumber(entity.warpState && entity.warpState.startTimeMs, now),
    );
    const warpPhase = getWarpPhaseName(entity.warpState, elapsedMs);
    const liveClusterKey = this.getPublicGridClusterKeyForEntity(entity);
    const sessionStamp = this.getHistorySafeSessionDestinyStamp(
      session,
      now,
      PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
      PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
    );
    const stagedUpdates = [];

    if (
      !handoff.sourceRemoved &&
      String(handoff.sourceClusterKey || "").trim() &&
      String(liveClusterKey || "").trim() !== String(handoff.sourceClusterKey || "").trim()
    ) {
      const removedIDs = [...currentIDs].filter((entityID) => entityID > 0);
      if (removedIDs.length > 0) {
        stagedUpdates.push(
          ...this.buildSessionStampedRemoveBallsUpdates(
            removedIDs,
            sessionStamp,
          ),
        );
        session._space.visibleDynamicEntityIDs = new Set();
        for (const entityID of removedIDs) {
          freshIDs.delete(entityID);
        }
        recordVisibilityJournal(session, "warp.source.dynamic-remove", {
          nowMs: now,
          stamp: sessionStamp,
          removedEntityIDs: removedIDs,
          sourceClusterKey: handoff.sourceClusterKey,
          liveClusterKey,
        });
      }
      const removedStaticIDs = [...currentStaticIDs].filter((entityID) => entityID > 0);
      if (removedStaticIDs.length > 0) {
        stagedUpdates.push(
          ...this.buildSessionStampedRemoveBallsUpdates(
            removedStaticIDs,
            sessionStamp,
          ),
        );
        session._space.visibleBubbleScopedStaticEntityIDs = new Set();
        recordVisibilityJournal(session, "warp.source.static-remove", {
          nowMs: now,
          stamp: sessionStamp,
          removedStaticEntityIDs: removedStaticIDs,
          sourceClusterKey: handoff.sourceClusterKey,
          liveClusterKey,
        });
      }
      handoff.sourceRemoved = true;
    }

    if (
      !handoff.destinationPrewarmed &&
      String(handoff.destinationClusterKey || "").trim() &&
      (
        warpPhase === "decel" ||
        String(liveClusterKey || "").trim() === String(handoff.destinationClusterKey || "").trim()
      )
    ) {
      prewarmStartupControllersForWarpDestination(this, {
        excludedSession: session,
        nowMs: now,
        relevantClusterKeys: [handoff.destinationClusterKey],
        dematerializeAmbientStartup: false,
        dematerializeDormantCombat: false,
      });
      handoff.destinationPrewarmed = true;
    }

    if (
      !handoff.destinationStaticJoined &&
      String(handoff.destinationClusterKey || "").trim() &&
      String(liveClusterKey || "").trim() === String(handoff.destinationClusterKey || "").trim()
    ) {
      const destinationStaticPoint =
        (entity.warpState && (
          entity.warpState.targetPoint ||
          entity.warpState.rawDestination
        )) ||
        entity.position;
      const destinationStaticEntities = this.getIncrementalStaticEntitiesForPosition(
        destinationStaticPoint,
        session,
        {
          visibilityClusterKeyOverride: handoff.destinationClusterKey,
        },
      );
      if (destinationStaticEntities.length > 0) {
        const addPresentation = this.buildSessionStampedAddBallsUpdatesForSession(
          session,
          destinationStaticEntities,
          sessionStamp,
          {
            nowMs: now,
          },
        );
        stagedUpdates.push(...addPresentation.updates);
      }
      session._space.visibleBubbleScopedStaticEntityIDs = new Set(
        destinationStaticEntities.map((visibleEntity) => visibleEntity.itemID),
      );
      recordVisibilityJournal(session, "warp.destination.static-add", {
        nowMs: now,
        stamp: sessionStamp,
        addedStaticEntityIDs: destinationStaticEntities.map((entity) => entity.itemID),
        destinationClusterKey: handoff.destinationClusterKey,
        liveClusterKey,
      });
      handoff.destinationStaticJoined = true;
    }

    if (
      !handoff.destinationJoined &&
      String(handoff.destinationClusterKey || "").trim() &&
      String(liveClusterKey || "").trim() === String(handoff.destinationClusterKey || "").trim()
    ) {
      const destinationDelta = this.buildDynamicVisibilityDeltaForSession(
        session,
        now,
        {
          bypassPilotWarpQuietWindow: true,
        },
      );
      if (destinationDelta && destinationDelta.addedEntities.length > 0) {
        const addPresentation = this.buildSessionStampedAddBallsUpdatesForSession(
          session,
          destinationDelta.addedEntities,
          sessionStamp,
          {
            nowMs: now,
          },
        );
        stagedUpdates.push(...addPresentation.updates);
      }
      if (destinationDelta) {
        session._space.visibleDynamicEntityIDs = destinationDelta.desiredIDs;
        freshIDs.clear();
        for (const visibleEntity of destinationDelta.addedEntities) {
          freshIDs.add(visibleEntity.itemID);
        }
        recordVisibilityJournal(session, "warp.destination.dynamic-add", {
          nowMs: now,
          stamp: sessionStamp,
          addedEntityIDs: destinationDelta.addedEntities.map((entity) => entity.itemID),
          desiredVisibleEntityIDs: [...destinationDelta.desiredIDs],
          destinationClusterKey: handoff.destinationClusterKey,
          liveClusterKey,
        });
      }
      handoff.destinationJoined = true;
    }

    session._space.freshlyVisibleDynamicEntityIDs = freshIDs;
    if (stagedUpdates.length > 0) {
      sessionOnlyUpdates.push({
        session,
        updates: stagedUpdates,
        sendOptions: {
          translateStamps: false,
        },
      });
    }
  }

  canSessionSeePlayerWarpingDynamicEntity(
    session,
    entity,
    now = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (!session || !session._space || !entity) {
      return false;
    }
    if (entity.itemID === session._space.shipID) {
      return true;
    }
    if (entity.mode !== "WARP" || !entity.warpState || !entity.session) {
      return false;
    }

    const currentIDs =
      session._space.visibleDynamicEntityIDs instanceof Set
        ? session._space.visibleDynamicEntityIDs
        : new Set();
    const normalizedNow = toFiniteNumber(now, this.getCurrentSimTimeMs());
    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return false;
    }

    if (
      currentIDs.has(entity.itemID) &&
      toFiniteNumber(entity.departureBubbleVisibleUntilMs, 0) > normalizedNow
    ) {
      return true;
    }

    const egoPublicGridClusterKey = this.resolveVisibilityClusterKeyForSession(
      session,
      options,
      egoEntity,
    );
    const liveWarpClusterKey = this.getPublicGridClusterKeyForPosition(
      entity.position,
    );
    if (
      !egoPublicGridClusterKey ||
      egoPublicGridClusterKey !== liveWarpClusterKey
    ) {
      return false;
    }

    const isFreshAcquire = !currentIDs.has(entity.itemID);
    if (
      isFreshAcquire &&
      entity.pendingWarp &&
      toInt(entity.warpState && entity.warpState.effectStamp, 0) < 0
    ) {
      return false;
    }
    if (toFiniteNumber(entity.visibilitySuppressedUntilMs, 0) > normalizedNow) {
      return false;
    }
    return true;
  }

  canSessionSeeSessionlessWarpingDynamicEntity(
    session,
    entity,
    now = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (!session || !session._space || !entity) {
      return false;
    }
    if (entity.itemID === session._space.shipID) {
      return true;
    }
    if (entity.mode !== "WARP" || !entity.warpState) {
      return false;
    }

    const currentIDs =
      session._space.visibleDynamicEntityIDs instanceof Set
        ? session._space.visibleDynamicEntityIDs
        : new Set();
    const normalizedNow = toFiniteNumber(now, this.getCurrentSimTimeMs());
    const sessionlessIngressActive = Boolean(
      entity.sessionlessWarpIngress &&
      !entity.session,
    );
    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return false;
    }

    const egoPublicGridClusterKey = this.resolveVisibilityClusterKeyForSession(
      session,
      options,
      egoEntity,
    );
    const liveWarpClusterKey = this.getPublicGridClusterKeyForPosition(
      entity.position,
    );
    if (
      !egoPublicGridClusterKey ||
      egoPublicGridClusterKey !== liveWarpClusterKey
    ) {
      return false;
    }

    const allowFreshWarpAcquire =
      options.allowFreshWarpAcquire === true || sessionlessIngressActive;
    if (
      !allowFreshWarpAcquire &&
      !currentIDs.has(entity.itemID)
    ) {
      return false;
    }

    const ignoreVisibilitySuppression =
      options.ignoreVisibilitySuppression === true ||
      (sessionlessIngressActive && currentIDs.has(entity.itemID));
    if (
      !ignoreVisibilitySuppression &&
      toFiniteNumber(entity.visibilitySuppressedUntilMs, 0) > normalizedNow
    ) {
      return false;
    }
    return true;
  }

  canSessionSeeWarpingDynamicEntity(
    session,
    entity,
    now = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (!session || !session._space || !entity) {
      return false;
    }
    if (entity.itemID === session._space.shipID) {
      return true;
    }
    if (entity.mode !== "WARP" || !entity.warpState) {
      return false;
    }
    const sessionlessIngressActive = Boolean(
      entity.sessionlessWarpIngress &&
      !entity.session,
    );

    if (entity.session && !sessionlessIngressActive) {
      return this.canSessionSeePlayerWarpingDynamicEntity(
        session,
        entity,
        now,
        options,
      );
    }

    return this.canSessionSeeSessionlessWarpingDynamicEntity(
      session,
      entity,
      now,
      options,
    );
  }

  canSessionSeeDynamicEntity(
    session,
    entity,
    now = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (!session || !session._space || !entity) {
      return false;
    }
    if (entity.itemID === session._space.shipID) {
      return true;
    }
    if (
      options.bypassPilotWarpQuietWindow !== true &&
      this.isSessionInPilotWarpQuietWindow(session, now)
    ) {
      return false;
    }
    if (entity.mode === "WARP" && entity.warpState) {
      return this.canSessionSeeWarpingDynamicEntity(session, entity, now, options);
    }
    if (toFiniteNumber(entity.visibilitySuppressedUntilMs, 0) > now) {
      return false;
    }
    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return false;
    }
    const egoPublicGridClusterKey = this.resolveVisibilityClusterKeyForSession(
      session,
      options,
      egoEntity,
    );
    const entityPublicGridClusterKey = this.getPublicGridClusterKeyForEntity(entity);
    if (!egoPublicGridClusterKey || !entityPublicGridClusterKey) {
      return false;
    }
    return egoPublicGridClusterKey === entityPublicGridClusterKey;
  }

  canSessionSeeStaticEntityForSession(session, entity, options = {}) {
    if (!session || !session._space || !entity) {
      return false;
    }
    if (isBubbleScopedStaticEntity(entity)) {
      const egoEntity = this.getShipEntityForSession(session);
      const egoBubbleID = toInt(egoEntity && egoEntity.bubbleID, 0);
      return egoBubbleID > 0 && egoBubbleID === toInt(entity && entity.bubbleID, 0);
    }
    if (isPublicGridScopedStaticEntity(entity)) {
      const egoEntity = this.getShipEntityForSession(session);
      if (!egoEntity) {
        return false;
      }
      const egoPublicGridClusterKey = this.resolveVisibilityClusterKeyForSession(
        session,
        options,
        egoEntity,
      );
      const entityPublicGridClusterKey = this.getPublicGridClusterKeyForEntity(entity);
      return Boolean(
        egoPublicGridClusterKey &&
        entityPublicGridClusterKey &&
        egoPublicGridClusterKey === entityPublicGridClusterKey
      );
    }
    return true;
  }

  getVisibleDynamicEntitiesForSession(
    session,
    now = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    const visible = [];
    for (const entity of this.dynamicEntities.values()) {
      if (this.canSessionSeeDynamicEntity(session, entity, now, options)) {
        visible.push(entity);
      }
    }
    return this.filterBallparkEntitiesForSession(session, visible);
  }

  filterBallparkEntitiesForSession(session, entities) {
    if (!Array.isArray(entities) || entities.length === 0) {
      return [];
    }

    return entities;
  }

  getVisibleEntitiesForSession(session, now = this.getCurrentSimTimeMs()) {
    const visibleStaticEntities = this.staticEntities.filter((entity) =>
      this.canSessionSeeStaticEntityForSession(session, entity)
    );

    return [
      ...visibleStaticEntities,
      ...this.getVisibleDynamicEntitiesForSession(session, now),
    ];
  }

  getBubbleScopedStaticEntitiesForBubbleID(bubbleID, session = null) {
    const numericBubbleID = toInt(bubbleID, 0);
    if (numericBubbleID <= 0) {
      return [];
    }

    const visibleEntities = this.staticEntities.filter((entity) => (
      isBubbleScopedStaticEntity(entity) &&
      numericBubbleID === toInt(entity.bubbleID, 0)
    ));

    return session
      ? this.filterBallparkEntitiesForSession(session, visibleEntities)
      : visibleEntities;
  }

  getBubbleScopedStaticEntitiesForPosition(position, session = null) {
    const bubble = this.findBestBubbleForPosition(position, BUBBLE_RADIUS_SQUARED);
    if (!bubble) {
      return [];
    }
    return this.getBubbleScopedStaticEntitiesForBubbleID(bubble.id, session);
  }

  getVisibleBubbleScopedStaticEntitiesForSession(session) {
    const egoEntity = this.getShipEntityForSession(session);
    const egoBubbleID = toInt(egoEntity && egoEntity.bubbleID, 0);
    if (egoBubbleID <= 0) {
      return [];
    }

    return this.getBubbleScopedStaticEntitiesForBubbleID(egoBubbleID, session);
  }

  getPublicGridScopedStaticEntitiesForClusterKey(
    clusterKey,
    session = null,
    options = {},
  ) {
    const normalizedClusterKey = String(clusterKey || "").trim();
    if (!normalizedClusterKey) {
      return [];
    }

    this.ensurePublicGridComposition();
    const visibleEntities = this.staticEntities.filter((entity) => (
      isPublicGridScopedStaticEntity(entity) &&
      this.getPublicGridClusterKeyForEntity(entity) === normalizedClusterKey &&
      (
        !session ||
        this.canSessionSeeStaticEntityForSession(session, entity, {
          ...options,
          visibilityClusterKeyOverride: normalizedClusterKey,
        })
      )
    ));
    return session
      ? this.filterBallparkEntitiesForSession(session, visibleEntities)
      : visibleEntities;
  }

  getPublicGridScopedStaticEntitiesForPosition(
    position,
    session = null,
    options = {},
  ) {
    const clusterKey = String(
      options.visibilityClusterKeyOverride ||
      this.getPublicGridClusterKeyForPosition(position) ||
      "",
    ).trim();
    return this.getPublicGridScopedStaticEntitiesForClusterKey(
      clusterKey,
      session,
      {
        ...options,
        visibilityClusterKeyOverride: clusterKey,
      },
    );
  }

  getVisibleIncrementalStaticEntitiesForSession(session, options = {}) {
    return this.filterBallparkEntitiesForSession(
      session,
      this.staticEntities.filter((entity) => (
        isIncrementalStaticVisibilityEntity(entity) &&
        this.canSessionSeeStaticEntityForSession(session, entity, options)
      )),
    );
  }

  getIncrementalStaticEntitiesForPosition(
    position,
    session = null,
    options = {},
  ) {
    const visibleEntities = [];
    const visibleIDs = new Set();
    const addEntity = (entity) => {
      const entityID = toInt(entity && entity.itemID, 0);
      if (entityID <= 0 || visibleIDs.has(entityID)) {
        return;
      }
      visibleIDs.add(entityID);
      visibleEntities.push(entity);
    };

    for (const entity of this.getBubbleScopedStaticEntitiesForPosition(position, session)) {
      addEntity(entity);
    }
    for (const entity of this.getPublicGridScopedStaticEntitiesForPosition(
      position,
      session,
      options,
    )) {
      addEntity(entity);
    }
    return visibleEntities;
  }

  getDynamicEntities() {
    return [...this.dynamicEntities.values()];
  }

  getEntityByID(entityID) {
    const numericID = Number(entityID);
    if (!numericID) {
      return null;
    }

    return (
      this.dynamicEntities.get(numericID) ||
      this.staticEntitiesByID.get(numericID) ||
      null
    );
  }

  refreshInventoryBackedEntityPresentation(entityID, options = {}) {
    const entity = this.getEntityByID(entityID);
    if (!isInventoryBackedDynamicEntity(entity)) {
      return {
        success: false,
        errorMsg: "DYNAMIC_ENTITY_NOT_FOUND",
      };
    }

    refreshInventoryBackedEntityPresentationFields(entity);
    if (options.broadcast !== false) {
      this.broadcastSlimItemChanges([entity], options.excludedSession || null);
    }

    return {
      success: true,
      data: {
        entity,
      },
    };
  }

  getShipEntityForSession(session) {
    if (!session || !session._space) {
      return null;
    }

    const sessionShipID = Number(
      session._space.shipID ||
      session.shipID ||
      session.shipid,
    ) || 0;
    const dynamicEntity = this.dynamicEntities.get(sessionShipID) || null;
    if (dynamicEntity) {
      return dynamicEntity;
    }

    if (session._space.observerKind === "structure") {
      const structureID = Number(
        session._space.shipID ||
        session.structureID ||
        session.structureid ||
        sessionShipID,
      ) || 0;
      return this.staticEntitiesByID.get(structureID) || null;
    }

    return null;
  }

  getActiveModuleEffect(shipID, moduleID) {
    const entity = this.getEntityByID(shipID);
    if (!entity || !(entity.activeModuleEffects instanceof Map)) {
      return null;
    }
    return entity.activeModuleEffects.get(toInt(moduleID, 0)) || null;
  }

  reconcileActiveTurretWeaponBankEffects(shipID, moduleIDs = []) {
    const entity = this.getEntityByID(shipID);
    return reconcileActiveTurretWeaponBankEffectStates(entity, moduleIDs);
  }

  allocateTargetSequence() {
    const sequence = toInt(this.nextTargetSequence, 1);
    this.nextTargetSequence = sequence + 1;
    return sequence;
  }

  getEntityTargetingStats(entity) {
    if (!entity) {
      return null;
    }

    const numericCharID = getShipEntityInventoryCharacterID(entity, 0);
    const normalizedEntityID = toInt(entity.itemID, 0);
    if (normalizedEntityID > 0 && this._tickTargetingStatsCache instanceof Map) {
      const cached = this._tickTargetingStatsCache.get(normalizedEntityID) || null;
      if (cached) {
        return cached;
      }
    }
    const characterTargetingState =
      numericCharID > 0
        ? buildCharacterTargetingState(numericCharID)
        : { maxLockedTargets: toInt(entity.maxLockedTargets, 0) };
    const shipMaxLockedTargets = Math.max(0, toInt(entity.maxLockedTargets, 0));
    const characterMaxLockedTargets = Math.max(
      0,
      toInt(characterTargetingState.maxLockedTargets, shipMaxLockedTargets),
    );
    const effectiveMaxLockedTargets =
      shipMaxLockedTargets > 0 && characterMaxLockedTargets > 0
        ? Math.min(shipMaxLockedTargets, characterMaxLockedTargets)
        : Math.max(shipMaxLockedTargets, characterMaxLockedTargets);

    const targetingStats = {
      maxTargetRange: Math.max(0, toFiniteNumber(entity.maxTargetRange, 0)),
      shipMaxLockedTargets,
      characterMaxLockedTargets,
      effectiveMaxLockedTargets,
      scanResolution: Math.max(0, toFiniteNumber(entity.scanResolution, 0)),
      cloakingTargetingDelay: Math.max(
        0,
        toFiniteNumber(entity.cloakingTargetingDelay, 0),
      ),
    };
    if (normalizedEntityID > 0 && this._tickTargetingStatsCache instanceof Map) {
      this._tickTargetingStatsCache.set(normalizedEntityID, targetingStats);
    }
    return targetingStats;
  }

  getTargetsForEntity(entity) {
    const state = ensureEntityTargetingState(entity);
    if (!state) {
      return [];
    }

    return [...state.lockedTargets.values()]
      .sort(
        (left, right) =>
          toInt(left && left.sequence, 0) - toInt(right && right.sequence, 0) ||
          toInt(left && left.targetID, 0) - toInt(right && right.targetID, 0),
      )
      .map((entry) => toInt(entry && entry.targetID, 0))
      .filter((targetID) => targetID > 0);
  }

  getTargetersForEntity(entity) {
    const state = ensureEntityTargetingState(entity);
    if (!state) {
      return [];
    }

    return [...state.targetedBy]
      .map((sourceID) => toInt(sourceID, 0))
      .filter((sourceID) => sourceID > 0)
      .sort((left, right) => left - right);
  }

  getSortedPendingTargetLocks(entity) {
    const state = ensureEntityTargetingState(entity);
    if (!state) {
      return [];
    }

    return [...state.pendingTargetLocks.values()].sort(
      (left, right) =>
        toFiniteNumber(left && left.completeAtMs, 0) -
          toFiniteNumber(right && right.completeAtMs, 0) ||
        toInt(left && left.sequence, 0) - toInt(right && right.sequence, 0),
    );
  }

  notifyTargetEvent(session, what, targetID = null, reason = null) {
    if (!session || typeof session.sendNotification !== "function") {
      return false;
    }

    const payload = [String(what || "")];
    if (targetID !== null && targetID !== undefined) {
      payload.push(toInt(targetID, 0));
    }
    if (reason !== null && reason !== undefined) {
      payload.push(String(reason));
    }

    session.sendNotification("OnTarget", "clientID", payload);
    return true;
  }

  notifyTargetLockFailure(session, targetID) {
    if (!session) {
      return false;
    }

    const normalizedTargetID = toInt(targetID, 0);
    if (normalizedTargetID <= 0) {
      return false;
    }

    if (typeof session.sendServiceNotification === "function") {
      session.sendServiceNotification("target", "FailLockTarget", [
        normalizedTargetID,
      ]);
      return true;
    }

    return this.notifyTargetEvent(
      session,
      "lost",
      normalizedTargetID,
      TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
    );
  }

  isTargetLockRangeValid(sourceEntity, targetEntity, targetingStats = null) {
    if (!sourceEntity || !targetEntity) {
      return false;
    }

    const resolvedTargetingStats =
      targetingStats || this.getEntityTargetingStats(sourceEntity);
    if (!resolvedTargetingStats || resolvedTargetingStats.maxTargetRange <= 0) {
      return false;
    }

    return (
      getEntitySurfaceDistance(sourceEntity, targetEntity) <
      resolvedTargetingStats.maxTargetRange
    );
  }

  validateTargetLockRequest(session, sourceEntity, targetEntity, options = {}) {
    if ((!session || !session._space) && !sourceEntity) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }
    if (!sourceEntity) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }
    if (!targetEntity) {
      return {
        success: false,
        errorMsg: "TARGET_NOT_FOUND",
      };
    }
    if (structureTethering.isEntityStructureTethered(targetEntity)) {
      return {
        success: false,
        errorMsg: "TARGET_TETHERED",
      };
    }
    if (toInt(sourceEntity.itemID, 0) === toInt(targetEntity.itemID, 0)) {
      return {
        success: false,
        errorMsg: "TARGET_SELF",
      };
    }
    if (
      jammerModuleRuntime.isEntityJammed(
        sourceEntity,
        this.getCurrentSimTimeMs(),
      ) &&
      jammerModuleRuntime.canEntityLockTargetWhileJammed(
        sourceEntity,
        targetEntity.itemID,
        this.getCurrentSimTimeMs(),
      ) !== true
    ) {
      return {
        success: false,
        errorMsg: "TARGET_JAMMED",
      };
    }
    if (
      (sourceEntity.mode === "WARP" && sourceEntity.warpState) ||
      sourceEntity.pendingWarp
    ) {
      return {
        success: false,
        errorMsg: "SOURCE_WARPING",
      };
    }
    if (
      (targetEntity.mode === "WARP" && targetEntity.warpState) ||
      targetEntity.pendingWarp
    ) {
      return {
        success: false,
        errorMsg: "TARGET_WARPING",
      };
    }
    const targetingStats = this.getEntityTargetingStats(sourceEntity);
    if (!this.isTargetLockRangeValid(sourceEntity, targetEntity, targetingStats)) {
      return {
        success: false,
        errorMsg: "TARGET_OUT_OF_RANGE",
      };
    }

    if (!targetingStats || targetingStats.effectiveMaxLockedTargets <= 0) {
      return {
        success: false,
        errorMsg: "TARGET_LOCK_LIMIT_REACHED",
      };
    }

    if (options.ignoreCapacity !== true) {
      const state = ensureEntityTargetingState(sourceEntity);
      const totalTargets =
        state.lockedTargets.size + state.pendingTargetLocks.size;
      if (totalTargets >= targetingStats.effectiveMaxLockedTargets) {
        return {
          success: false,
          errorMsg: "TARGET_LOCK_LIMIT_REACHED",
        };
      }
    }

    return {
      success: true,
      data: {
        targetingStats,
      },
    };
  }

  rebasePendingTargetLock(sourceEntity, pendingLock, targetEntity, now = this.getCurrentSimTimeMs()) {
    if (!sourceEntity || !pendingLock || !targetEntity) {
      return null;
    }

    const oldDurationMs = Math.max(
      1,
      toFiniteNumber(pendingLock.totalDurationMs, TARGETING_CLIENT_FALLBACK_LOCK_MS),
    );
    const nowMs = toFiniteNumber(now, this.getCurrentSimTimeMs());
    const elapsedMs = clamp(
      nowMs - toFiniteNumber(pendingLock.requestedAtMs, nowMs),
      0,
      oldDurationMs,
    );
    const progressRatio = clamp(elapsedMs / oldDurationMs, 0, 1);
    const newDurationMs = computeTargetLockDurationMs(sourceEntity, targetEntity);

    pendingLock.totalDurationMs = newDurationMs;
    pendingLock.requestedAtMs = nowMs - (newDurationMs * progressRatio);
    pendingLock.completeAtMs = pendingLock.requestedAtMs + newDurationMs;
    return pendingLock;
  }

  rebasePendingTargetLocksForSource(sourceEntity, now = this.getCurrentSimTimeMs()) {
    const state = ensureEntityTargetingState(sourceEntity);
    if (!state) {
      return;
    }

    for (const pendingLock of state.pendingTargetLocks.values()) {
      const targetEntity = this.getEntityByID(pendingLock.targetID);
      if (!targetEntity) {
        continue;
      }
      this.rebasePendingTargetLock(sourceEntity, pendingLock, targetEntity, now);
    }
  }

  rebaseIncomingPendingTargetLocksForTarget(targetEntity, now = this.getCurrentSimTimeMs()) {
    if (!targetEntity) {
      return;
    }

    const targetID = toInt(targetEntity.itemID, 0);
    if (targetID <= 0) {
      return;
    }

    for (const sourceEntity of this.dynamicEntities.values()) {
      const sourceState = ensureEntityTargetingState(sourceEntity);
      if (!sourceState) {
        continue;
      }
      const pendingLock = sourceState.pendingTargetLocks.get(targetID) || null;
      if (!pendingLock) {
        continue;
      }
      this.rebasePendingTargetLock(sourceEntity, pendingLock, targetEntity, now);
    }
  }

  cancelPendingTargetLock(sourceEntity, targetEntityID, options = {}) {
    const sourceState = ensureEntityTargetingState(sourceEntity);
    if (!sourceState) {
      return false;
    }

    const normalizedTargetID = toInt(targetEntityID, 0);
    if (!sourceState.pendingTargetLocks.has(normalizedTargetID)) {
      return false;
    }

    sourceState.pendingTargetLocks.delete(normalizedTargetID);
    if (options.notifySelf !== false && sourceEntity && sourceEntity.session) {
      this.notifyTargetLockFailure(sourceEntity.session, normalizedTargetID);
    }
    return true;
  }

  finalizeTargetLock(sourceEntity, targetEntity, options = {}) {
    const sourceState = ensureEntityTargetingState(sourceEntity);
    const targetState = ensureEntityTargetingState(targetEntity);
    if (!sourceState || !targetState) {
      return {
        success: false,
        errorMsg: "TARGET_NOT_FOUND",
      };
    }

    const targetID = toInt(targetEntity.itemID, 0);
    const pendingLock =
      options.pendingLock || sourceState.pendingTargetLocks.get(targetID) || null;
    const validation = this.validateTargetLockRequest(
      sourceEntity && sourceEntity.session,
      sourceEntity,
      targetEntity,
      {
        ignoreCapacity: true,
      },
    );
    if (!validation.success) {
      if (pendingLock) {
        sourceState.pendingTargetLocks.delete(targetID);
      }
      return validation;
    }

    const targetingStats = validation.data.targetingStats;
    if (sourceState.lockedTargets.has(targetID)) {
      if (pendingLock) {
        sourceState.pendingTargetLocks.delete(targetID);
      }
      return {
        success: true,
        data: {
          pending: false,
          targets: this.getTargetsForEntity(sourceEntity),
        },
      };
    }
    if (sourceState.lockedTargets.size >= targetingStats.effectiveMaxLockedTargets) {
      if (pendingLock) {
        sourceState.pendingTargetLocks.delete(targetID);
      }
      return {
        success: false,
        errorMsg: "TARGET_LOCK_LIMIT_REACHED",
      };
    }

    if (pendingLock) {
      sourceState.pendingTargetLocks.delete(targetID);
    }

    const sourceID = toInt(sourceEntity.itemID, 0);
    sourceState.lockedTargets.set(targetID, {
      targetID,
      sequence: toInt(pendingLock && pendingLock.sequence, 0) || this.allocateTargetSequence(),
      acquiredAtMs: toFiniteNumber(options.nowMs, this.getCurrentSimTimeMs()),
    });
    targetState.targetedBy.add(sourceID);

    if (sourceEntity.session) {
      this.notifyTargetEvent(sourceEntity.session, "add", targetID);
      if (targetEntity.kind === "station" || hasDamageableHealth(targetEntity)) {
        broadcastDamageStateChange(
          this,
          targetEntity,
          toFiniteNumber(options.nowMs, this.getCurrentSimTimeMs()),
        );
      }
    }
    if (
      targetEntity.session &&
      targetEntity.session !== sourceEntity.session
    ) {
      this.notifyTargetEvent(targetEntity.session, "otheradd", sourceID);
    }

    return {
      success: true,
      data: {
        pending: false,
        targets: this.getTargetsForEntity(sourceEntity),
      },
    };
  }

  removeLockedTarget(sourceEntity, targetEntityID, options = {}) {
    const sourceState = ensureEntityTargetingState(sourceEntity);
    if (!sourceState) {
      return false;
    }

    const normalizedTargetID = toInt(targetEntityID, 0);
    if (!sourceState.lockedTargets.has(normalizedTargetID)) {
      return false;
    }

    sourceState.lockedTargets.delete(normalizedTargetID);
    this.stopTargetedModuleEffects(sourceEntity, normalizedTargetID, {
      reason: options.reason ?? "target",
      nowMs: options.nowMs,
    });
    const targetEntity = this.getEntityByID(normalizedTargetID);
    if (targetEntity) {
      ensureEntityTargetingState(targetEntity).targetedBy.delete(
        toInt(sourceEntity && sourceEntity.itemID, 0),
      );
    }

    if (options.notifySelf !== false && sourceEntity && sourceEntity.session) {
      this.notifyTargetEvent(
        sourceEntity.session,
        "lost",
        normalizedTargetID,
        options.reason ?? null,
      );
    }
    if (
      options.notifyTarget !== false &&
      targetEntity &&
      targetEntity.session &&
      targetEntity.session !== sourceEntity.session
    ) {
      this.notifyTargetEvent(
        targetEntity.session,
        "otherlost",
        sourceEntity.itemID,
        options.reason ?? null,
      );
    }

    return true;
  }

  stopTargetedModuleEffects(sourceEntity, targetEntityID, options = {}) {
    if (
      !sourceEntity ||
      !(sourceEntity.activeModuleEffects instanceof Map)
    ) {
      return 0;
    }

    const normalizedTargetID = toInt(targetEntityID, 0);
    if (normalizedTargetID <= 0) {
      return 0;
    }

    const stopReason = String(options.reason || "target");
    const stopTimeMs = Math.max(
      0,
      toFiniteNumber(options.nowMs, this.getCurrentSimTimeMs()),
    );
    let stoppedCount = 0;

    for (const effectState of [...sourceEntity.activeModuleEffects.values()]) {
      if (!effectState || toInt(effectState.targetID, 0) !== normalizedTargetID) {
        continue;
      }

      const moduleID = toInt(effectState.moduleID, 0);
      if (moduleID <= 0) {
        continue;
      }

      let stopResult = null;
      if (sourceEntity.session && isReadyForDestiny(sourceEntity.session)) {
        stopResult = effectState.isGeneric
          ? this.finalizeGenericModuleDeactivation(
              sourceEntity.session,
              moduleID,
              {
                clampToVisibleStamp: true,
                reason: stopReason,
                nowMs: stopTimeMs,
              },
            )
          : this.finalizePropulsionModuleDeactivation(
              sourceEntity.session,
              moduleID,
              {
                clampToVisibleStamp: true,
                reason: stopReason,
                nowMs: stopTimeMs,
              },
            );
      } else {
        stopResult = effectState.isGeneric === true
          ? finalizeGenericModuleDeactivationWithoutSession(
              this,
              sourceEntity,
              effectState,
              {
                reason: stopReason,
                nowMs: stopTimeMs,
              },
            )
          : (() => {
              sourceEntity.activeModuleEffects.delete(moduleID);
              if (!(sourceEntity.moduleReactivationLocks instanceof Map)) {
                sourceEntity.moduleReactivationLocks = new Map();
              }
              sourceEntity.moduleReactivationLocks.set(
                moduleID,
                stopTimeMs + Math.max(0, toFiniteNumber(effectState.reactivationDelayMs, 0)),
              );
              effectState.deactivatedAtMs = stopTimeMs;
              effectState.deactivationRequestedAtMs = 0;
              effectState.deactivateAtMs = 0;
              effectState.stopReason = stopReason;

              if (effectState.guid) {
                this.broadcastSpecialFx(
                  sourceEntity.itemID,
                  effectState.guid,
                  {
                    moduleID: effectState.moduleID,
                    moduleTypeID: effectState.typeID,
                    targetID: effectState.targetID || null,
                    chargeTypeID: effectState.chargeTypeID || null,
                    isOffensive: isOffensiveWeaponFamily(effectState.weaponFamily),
                    start: false,
                    active: false,
                    duration: effectState.durationMs,
                    useCurrentStamp: true,
                  },
                  sourceEntity,
                );
              }

              return { success: true };
            })();
      }

      if (stopResult && stopResult.success) {
        stoppedCount += 1;
      }
    }

    return stoppedCount;
  }

  clearOutgoingTargetLocks(sourceEntity, options = {}) {
    const sourceState = ensureEntityTargetingState(sourceEntity);
    if (!sourceState) {
      return {
        clearedTargetIDs: [],
        cancelledPendingIDs: [],
      };
    }

    const notifySelf = options.notifySelf !== false;
    const notifyTarget = options.notifyTarget !== false;
    const cancelledPendingIDs = [...sourceState.pendingTargetLocks.keys()]
      .map((targetID) => toInt(targetID, 0))
      .filter((targetID) => targetID > 0);
    for (const pendingTargetID of cancelledPendingIDs) {
      this.cancelPendingTargetLock(sourceEntity, pendingTargetID, {
        notifySelf,
        reason: options.pendingReason ?? TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
      });
    }

    const clearedTargetIDs = this.getTargetsForEntity(sourceEntity);
    const sourceID = toInt(sourceEntity && sourceEntity.itemID, 0);
    for (const targetID of clearedTargetIDs) {
      sourceState.lockedTargets.delete(targetID);
      this.stopTargetedModuleEffects(sourceEntity, targetID, {
        reason: options.activeReason ?? "target",
        nowMs: options.nowMs,
      });
      const targetEntity = this.getEntityByID(targetID);
      if (!targetEntity) {
        continue;
      }
      ensureEntityTargetingState(targetEntity).targetedBy.delete(sourceID);
      if (
        notifyTarget &&
        targetEntity.session &&
        targetEntity.session !== sourceEntity.session
      ) {
        this.notifyTargetEvent(
          targetEntity.session,
          "otherlost",
          sourceID,
          options.activeReason ?? null,
        );
      }
    }

    if (notifySelf && clearedTargetIDs.length > 0 && sourceEntity && sourceEntity.session) {
      this.notifyTargetEvent(sourceEntity.session, "clear");
    }

    return {
      clearedTargetIDs,
      cancelledPendingIDs,
    };
  }

  clearOutgoingTargetLocksExcept(sourceEntity, allowedTargetIDs, options = {}) {
    const sourceState = ensureEntityTargetingState(sourceEntity);
    if (!sourceState) {
      return {
        clearedTargetIDs: [],
        cancelledPendingIDs: [],
      };
    }

    const allowedTargetIDSet = new Set(
      [...(allowedTargetIDs instanceof Set ? allowedTargetIDs : [])]
        .map((targetID) => toInt(targetID, 0))
        .filter((targetID) => targetID > 0),
    );
    const notifySelf = options.notifySelf !== false;
    const notifyTarget = options.notifyTarget !== false;
    const cancelledPendingIDs = [];
    for (const pendingTargetID of [...sourceState.pendingTargetLocks.keys()]) {
      const normalizedTargetID = toInt(pendingTargetID, 0);
      if (normalizedTargetID <= 0 || allowedTargetIDSet.has(normalizedTargetID)) {
        continue;
      }
      if (this.cancelPendingTargetLock(sourceEntity, normalizedTargetID, {
        notifySelf,
        reason: options.pendingReason ?? TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
      })) {
        cancelledPendingIDs.push(normalizedTargetID);
      }
    }

    const clearedTargetIDs = [];
    for (const targetID of this.getTargetsForEntity(sourceEntity)) {
      const normalizedTargetID = toInt(targetID, 0);
      if (normalizedTargetID <= 0 || allowedTargetIDSet.has(normalizedTargetID)) {
        continue;
      }
      if (this.removeLockedTarget(sourceEntity, normalizedTargetID, {
        notifySelf,
        notifyTarget,
        reason: options.activeReason ?? "target",
        nowMs: options.nowMs,
      })) {
        clearedTargetIDs.push(normalizedTargetID);
      }
    }

    return {
      clearedTargetIDs,
      cancelledPendingIDs,
    };
  }

  clearAllTargetingForEntity(entity, options = {}) {
    if (!entity) {
      return {
        clearedTargetIDs: [],
        cancelledPendingIDs: [],
      };
    }

    const reason = options.reason ?? TARGET_LOSS_REASON_ATTEMPT_CANCELLED;
    const outgoingResult = this.clearOutgoingTargetLocks(entity, {
      notifySelf: options.notifySelf !== false,
      notifyTarget: options.notifyTarget !== false,
      activeReason: reason === TARGET_LOSS_REASON_EXPLODING ? TARGET_LOSS_REASON_EXPLODING : null,
      pendingReason: reason,
      nowMs: options.nowMs,
    });

    const normalizedEntityID = toInt(entity.itemID, 0);
    const activeReason =
      reason === TARGET_LOSS_REASON_EXPLODING
        ? TARGET_LOSS_REASON_EXPLODING
        : null;
    for (const sourceEntity of this.dynamicEntities.values()) {
      if (!sourceEntity || toInt(sourceEntity.itemID, 0) === normalizedEntityID) {
        continue;
      }

      const sourceState = ensureEntityTargetingState(sourceEntity);
      if (!sourceState) {
        continue;
      }

      if (sourceState.pendingTargetLocks.has(normalizedEntityID)) {
        this.cancelPendingTargetLock(sourceEntity, normalizedEntityID, {
          notifySelf: true,
          reason,
        });
      }
      if (sourceState.lockedTargets.has(normalizedEntityID)) {
        this.removeLockedTarget(sourceEntity, normalizedEntityID, {
          notifySelf: true,
          notifyTarget: false,
          reason: activeReason,
          nowMs: options.nowMs,
        });
        continue;
      }

      // Destroyed targets must also stop any targeted module effect that still
      // points at them, even if the targeting map already drifted earlier.
      this.stopTargetedModuleEffects(sourceEntity, normalizedEntityID, {
        reason: activeReason,
        nowMs: options.nowMs,
      });
    }

    ensureEntityTargetingState(entity).targetedBy.clear();
    return outgoingResult;
  }

  enforceEntityTargetCap(entity) {
    const state = ensureEntityTargetingState(entity);
    if (!state) {
      return;
    }
    if (state.lockedTargets.size === 0 && state.pendingTargetLocks.size === 0) {
      return;
    }

    const targetingStats = this.getEntityTargetingStats(entity);
    const maximumTargets = Math.max(
      0,
      toInt(
        targetingStats && targetingStats.effectiveMaxLockedTargets,
        0,
      ),
    );

    const pendingLocksDescending = [...state.pendingTargetLocks.values()].sort(
      (left, right) => toInt(right && right.sequence, 0) - toInt(left && left.sequence, 0),
    );
    while (
      state.lockedTargets.size + state.pendingTargetLocks.size > maximumTargets &&
      pendingLocksDescending.length > 0
    ) {
      const pendingLock = pendingLocksDescending.shift();
      if (!pendingLock || !state.pendingTargetLocks.has(pendingLock.targetID)) {
        continue;
      }
      this.cancelPendingTargetLock(entity, pendingLock.targetID, {
        notifySelf: true,
        reason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
      });
    }

    const activeLocksDescending = [...state.lockedTargets.values()].sort(
      (left, right) => toInt(right && right.sequence, 0) - toInt(left && left.sequence, 0),
    );
    while (
      state.lockedTargets.size > maximumTargets &&
      activeLocksDescending.length > 0
    ) {
      const lockState = activeLocksDescending.shift();
      if (!lockState || !state.lockedTargets.has(lockState.targetID)) {
        continue;
      }
      this.removeLockedTarget(entity, lockState.targetID, {
        notifySelf: true,
        reason: null,
      });
    }
  }

  validateEntityTargetLocks(entity, now = this.getCurrentSimTimeMs()) {
    const state = ensureEntityTargetingState(entity);
    if (!state) {
      return;
    }
    if (state.lockedTargets.size === 0 && state.pendingTargetLocks.size === 0) {
      return;
    }

    if (
      (entity.mode === "WARP" && entity.warpState) ||
      entity.pendingWarp
    ) {
      this.clearOutgoingTargetLocks(entity, {
        notifySelf: true,
        notifyTarget: true,
        activeReason: null,
        pendingReason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
      });
      return;
    }

    this.enforceEntityTargetCap(entity);

    for (const pendingLock of this.getSortedPendingTargetLocks(entity)) {
      if (!state.pendingTargetLocks.has(pendingLock.targetID)) {
        continue;
      }

      const targetEntity = this.getEntityByID(pendingLock.targetID);
      const validation = this.validateTargetLockRequest(
        entity.session,
        entity,
        targetEntity,
        {
          ignoreCapacity: true,
        },
      );
      if (!validation.success) {
        this.cancelPendingTargetLock(entity, pendingLock.targetID, {
          notifySelf: true,
          reason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
        });
        continue;
      }

      const targetingStats = validation.data.targetingStats;
      if (state.lockedTargets.size >= targetingStats.effectiveMaxLockedTargets) {
        this.cancelPendingTargetLock(entity, pendingLock.targetID, {
          notifySelf: true,
          reason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
        });
        continue;
      }

      if (toFiniteNumber(pendingLock.completeAtMs, 0) > now) {
        continue;
      }

      const finalizeResult = this.finalizeTargetLock(entity, targetEntity, {
        pendingLock,
        nowMs: now,
      });
      if (!finalizeResult.success) {
        this.cancelPendingTargetLock(entity, pendingLock.targetID, {
          notifySelf: true,
          reason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
        });
      }
    }

    for (const targetID of this.getTargetsForEntity(entity)) {
      if (!state.lockedTargets.has(targetID)) {
        continue;
      }

      const targetEntity = this.getEntityByID(targetID);
      const validation = this.validateTargetLockRequest(
        entity.session,
        entity,
        targetEntity,
        {
          ignoreCapacity: true,
        },
      );
      if (!validation.success) {
        this.removeLockedTarget(entity, targetID, {
          notifySelf: true,
          reason:
            validation.errorMsg === "TARGET_NOT_FOUND"
              ? TARGET_LOSS_REASON_ATTEMPT_CANCELLED
              : null,
        });
      }
    }

    this.enforceEntityTargetCap(entity);
  }

  validateAllTargetLocks(now = this.getCurrentSimTimeMs()) {
    for (const entity of this.dynamicEntities.values()) {
      if (
        !(entity && entity.lockedTargets instanceof Map && entity.lockedTargets.size > 0) &&
        !(entity && entity.pendingTargetLocks instanceof Map && entity.pendingTargetLocks.size > 0)
      ) {
        continue;
      }
      this.validateEntityTargetLocks(entity, now);
    }
  }

  handleEntityTargetingAttributeChanges(entity, previousSnapshot, now = this.getCurrentSimTimeMs()) {
    if (!entity || !previousSnapshot) {
      return buildEntityTargetingAttributeSnapshot(entity);
    }

    const currentSnapshot = buildEntityTargetingAttributeSnapshot(entity);
    if (currentSnapshot.scanResolution !== previousSnapshot.scanResolution) {
      this.rebasePendingTargetLocksForSource(entity, now);
    }
    if (currentSnapshot.signatureRadius !== previousSnapshot.signatureRadius) {
      this.rebaseIncomingPendingTargetLocksForTarget(entity, now);
    }

    this.enforceEntityTargetCap(entity);
    this.validateEntityTargetLocks(entity, now);
    return currentSnapshot;
  }

  addTarget(session, targetEntityID) {
    const sourceEntity = this.getShipEntityForSession(session);
    const targetEntity = this.getEntityByID(targetEntityID);
    const sourceState = ensureEntityTargetingState(sourceEntity);
    const normalizedTargetID = toInt(targetEntityID, 0);
    if (!sourceEntity || !sourceState) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    if (sourceState.lockedTargets.has(normalizedTargetID)) {
      return {
        success: true,
        data: {
          pending: false,
          targets: this.getTargetsForEntity(sourceEntity),
        },
      };
    }
    if (sourceState.pendingTargetLocks.has(normalizedTargetID)) {
      return {
        success: true,
        data: {
          pending: true,
          targets: this.getTargetsForEntity(sourceEntity),
        },
      };
    }

    breakEntityStructureTether(this, sourceEntity, {
      nowMs: this.getCurrentSimTimeMs(),
      reason: "TARGET_LOCK_ATTEMPT",
    });

    const validation = this.validateTargetLockRequest(session, sourceEntity, targetEntity);
    if (!validation.success) {
      return validation;
    }

    const now = this.getCurrentSimTimeMs();
    const lockDurationMs = computeTargetLockDurationMs(sourceEntity, targetEntity);
    if (lockDurationMs <= 1) {
      return this.finalizeTargetLock(sourceEntity, targetEntity, {
        nowMs: now,
      });
    }

    sourceState.pendingTargetLocks.set(normalizedTargetID, {
      targetID: normalizedTargetID,
      sequence: this.allocateTargetSequence(),
      requestedAtMs: now,
      completeAtMs: now + lockDurationMs,
      totalDurationMs: lockDurationMs,
    });

    return {
      success: true,
      data: {
        pending: true,
        targets: this.getTargetsForEntity(sourceEntity),
        lockDurationMs,
      },
    };
  }

  cancelAddTarget(session, targetEntityID, options = {}) {
    const sourceEntity = this.getShipEntityForSession(session);
    if (!sourceEntity) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    const cancelled = this.cancelPendingTargetLock(sourceEntity, targetEntityID, {
      notifySelf: options.notifySelf === true,
      reason: options.reason ?? TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
    });
    return {
      success: true,
      data: {
        cancelled,
        targets: this.getTargetsForEntity(sourceEntity),
      },
    };
  }

  removeTarget(session, targetEntityID, options = {}) {
    const sourceEntity = this.getShipEntityForSession(session);
    if (!sourceEntity) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    const removed = this.removeLockedTarget(sourceEntity, targetEntityID, {
      notifySelf: options.notifySelf !== false,
      notifyTarget: options.notifyTarget !== false,
      reason: options.reason ?? null,
    });
    return {
      success: true,
      data: {
        removed,
        targets: this.getTargetsForEntity(sourceEntity),
      },
    };
  }

  removeTargets(session, targetEntityIDs = [], options = {}) {
    const removedTargetIDs = [];
    for (const targetEntityID of targetEntityIDs) {
      const result = this.removeTarget(session, targetEntityID, options);
      if (result.success && result.data && result.data.removed) {
        removedTargetIDs.push(toInt(targetEntityID, 0));
      }
    }

    return {
      success: true,
      data: {
        removedTargetIDs,
      },
    };
  }

  clearTargets(session, options = {}) {
    const sourceEntity = this.getShipEntityForSession(session);
    if (!sourceEntity) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    const result = this.clearOutgoingTargetLocks(sourceEntity, {
      notifySelf: options.notifySelf !== false,
      notifyTarget: options.notifyTarget !== false,
      activeReason: options.reason ?? null,
      pendingReason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
    });
    return {
      success: true,
      data: result,
    };
  }

  getTargets(session) {
    return this.getTargetsForEntity(this.getShipEntityForSession(session));
  }

  getTargeters(session) {
    return this.getTargetersForEntity(this.getShipEntityForSession(session));
  }

  refreshShipEntityDerivedState(entityOrID, options = {}) {
    const entity =
      entityOrID && typeof entityOrID === "object"
        ? entityOrID
        : this.getEntityByID(toInt(entityOrID, 0));
    if (!entity || entity.kind !== "ship") {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const shipRecord = getEntityRuntimeShipItem(entity);
    if (!shipRecord) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const previousCommandedSpeedFraction = clamp(
      toFiniteNumber(entity.speedFraction, 0),
      0,
      MAX_SUBWARP_SPEED_FRACTION,
    );
    const previousTargetingSnapshot = buildEntityTargetingAttributeSnapshot(entity);
    const previousMass = toFiniteNumber(entity.mass, 0);
    const previousMaxVelocity = toFiniteNumber(entity.maxVelocity, 0);
    const previousVelocity = cloneVector(entity.velocity);
    hostileModuleRuntime.recomputeTargetAggregateState(entity);
    const fittedItems = getEntityRuntimeFittedItems(entity);
    const skillMap = getEntityRuntimeSkillMap(entity);
    const passiveResourceState = buildPassiveShipResourceState(
      getShipEntityInventoryCharacterID(entity, 0),
      shipRecord,
      {
        fittedItems,
        skillMap,
        additionalAttributeModifierEntries:
          collectEntityActiveShipAttributeModifierEntries(
            entity,
            this.getCurrentSimTimeMs(),
          ),
      },
    );
    applyPassiveResourceStateToEntity(entity, passiveResourceState, {
      recalculateSpeedFraction: false,
    });
    if (entity.activeModuleEffects instanceof Map) {
      for (const effectState of entity.activeModuleEffects.values()) {
        applyPropulsionEffectStateToEntity(entity, effectState);
      }
    }

    entity.speedFraction = previousCommandedSpeedFraction;
    this.handleEntityTargetingAttributeChanges(entity, previousTargetingSnapshot);

    persistDynamicEntity(entity);

    const session = options.session || entity.session || null;
    const shouldBroadcast = options.broadcast !== false;
    const shouldNotifyTargeting =
      options.notifyTargeting === true ||
      (options.notifyTargeting !== false && shouldBroadcast);
    if (shouldBroadcast) {
      const defaultBroadcastStamp = this.getNextDestinyStamp();
      const broadcastStamp =
        options.broadcastStamp === undefined || options.broadcastStamp === null
          ? defaultBroadcastStamp
          : toInt(options.broadcastStamp, defaultBroadcastStamp);
      const broadcastOptions =
        options.broadcastOptions && typeof options.broadcastOptions === "object"
          ? options.broadcastOptions
          : {};
      const ownerSendOptions = buildOwnerShipPrimeSendOptions(broadcastOptions);
      const ownerSession =
        session && isReadyForDestiny(session) ? session : null;
      if (broadcastOptions.useCurrentVisibleStamp === true) {
        if (ownerSession) {
          const ownerUpdates = this.filterMovementUpdatesForSession(
            ownerSession,
            buildShipPrimeUpdates(entity, broadcastStamp),
          );
          if (ownerUpdates.length > 0) {
            this.sendDestinyUpdates(
              ownerSession,
              ownerUpdates,
              false,
              ownerSendOptions,
            );
          }
        }
        this.broadcastShipPrimeUpdates(entity, {
          stampMode: "currentVisible",
          excludedSession: ownerSession,
        });
      } else {
        const updates = buildShipPrimeUpdates(entity, broadcastStamp);
        if (updates.length > 0) {
          if (ownerSession) {
            const ownerUpdates = this.filterMovementUpdatesForSession(
              ownerSession,
              updates,
            );
            if (ownerUpdates.length > 0) {
              this.sendDestinyUpdates(
                ownerSession,
                ownerUpdates,
                false,
                ownerSendOptions,
              );
            }
          }
          this.broadcastMovementUpdates(
            updates,
            ownerSession,
            broadcastOptions,
          );
        }
      }
    }
    if (
      shouldNotifyTargeting &&
      session &&
      isReadyForDestiny(session)
    ) {
      notifyTargetingDerivedAttributesToSession(
        session,
        entity,
        previousTargetingSnapshot,
      );
    }
    if (
      session &&
      isReadyForDestiny(session) &&
      options.notifyGenericModuleAttributes !== false
    ) {
      notifyFittedGenericModuleRangeAttributesToSession(session, entity);
    }

    return {
      success: true,
      data: {
        entity,
        previousMass,
        previousMaxVelocity,
        previousVelocity,
      },
    };
  }

  refreshSessionShipDerivedState(session, options = {}) {
    const entity = this.getShipEntityForSession(session);
    return this.refreshShipEntityDerivedState(entity, {
      ...options,
      session,
    });
  }

  getShipCapacitorState(session) {
    const entity = this.getShipEntityForSession(session);
    if (!entity) {
      return null;
    }

    return {
      capacity: toFiniteNumber(entity.capacitorCapacity, 0),
      amount: getEntityCapacitorAmount(entity),
      ratio: getEntityCapacitorRatio(entity),
    };
  }

  setShipCapacitorRatio(session, nextRatio) {
    const entity = this.getShipEntityForSession(session);
    if (!entity) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    setEntityCapacitorRatio(entity, nextRatio);
    persistEntityCapacitorRatio(entity);
    return {
      success: true,
      data: this.getShipCapacitorState(session),
    };
  }

  activatePropulsionModule(session, moduleItem, effectName, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || !moduleItem) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const normalizedModuleID = toInt(moduleItem.itemID, 0);
    if (
      normalizedModuleID <= 0 ||
      toInt(moduleItem.locationID, 0) !== toInt(entity.itemID, 0)
    ) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }
    if (!isModuleOnline(moduleItem)) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_ONLINE",
      };
    }
    if (!(entity.activeModuleEffects instanceof Map)) {
      entity.activeModuleEffects = new Map();
    }
    if (!(entity.moduleReactivationLocks instanceof Map)) {
      entity.moduleReactivationLocks = new Map();
    }
    if (entity.activeModuleEffects.has(normalizedModuleID)) {
      return {
        success: false,
        errorMsg: "MODULE_ALREADY_ACTIVE",
      };
    }

    const lockUntil = toFiniteNumber(
      entity.moduleReactivationLocks.get(normalizedModuleID),
      0,
    );
    const now = this.getCurrentSimTimeMs();
    if (lockUntil > now) {
      return {
        success: false,
        errorMsg: "MODULE_REACTIVATING",
      };
    }
    if (
      effectName === PROPULSION_EFFECT_MICROWARPDRIVE &&
      hostileModuleRuntime.isMicrowarpdriveBlocked(entity)
    ) {
      return {
        success: false,
        errorMsg: "MICROWARPDRIVE_BLOCKED",
      };
    }

    const runtimeAttributes = getPropulsionModuleRuntimeAttributes(
      getShipEntityInventoryCharacterID(entity, toInt(session && session.characterID, 0)),
      moduleItem,
      {
        skillMap: getEntityRuntimeSkillMap(entity),
      },
    );
    if (!runtimeAttributes) {
      return {
        success: false,
        errorMsg: "UNSUPPORTED_EFFECT",
      };
    }

    const currentSpeed = magnitude(entity.velocity);
    if (
      runtimeAttributes.maxVelocityActivationLimit > 0 &&
      currentSpeed > runtimeAttributes.maxVelocityActivationLimit + 1e-6
    ) {
      return {
        success: false,
        errorMsg: "MAX_VELOCITY_ACTIVATION_LIMIT",
      };
    }

    if (runtimeAttributes.maxGroupActive > 0) {
      const activeCount = [...entity.activeModuleEffects.values()].filter(
        (effectState) => toInt(effectState.groupID, 0) === toInt(moduleItem.groupID, 0),
      ).length;
      if (activeCount >= runtimeAttributes.maxGroupActive) {
        return {
          success: false,
          errorMsg: "MAX_GROUP_ACTIVE",
        };
      }
    }

    const recoveryPresentationStamp = (() => {
      const recoveryAtMs = Math.max(
        0,
        toFiniteNumber(this.lastTimeDilationRecoveryAtMs, 0),
      );
      if (recoveryAtMs <= 0) {
        return null;
      }
      if (this.getCurrentDestinyStamp(recoveryAtMs) < this.getCurrentDestinyStamp(now)) {
        return null;
      }
      return this.getHistorySafeDestinyStamp(now, 1, 1);
    })();

    const restartPresentationStamp = (() => {
      const reactivationDelayMs = Math.max(
        0,
        toFiniteNumber(runtimeAttributes.reactivationDelayMs, 0),
      );
      const lastStopAtMs = Math.max(0, lockUntil - reactivationDelayMs);
      if (lastStopAtMs <= 0) {
        return null;
      }
      if (this.getCurrentDestinyStamp(lastStopAtMs) < this.getCurrentDestinyStamp(now)) {
        return null;
      }
      // When a module is stopped and restarted inside the same presentation tick,
      // replay the ship-prime/FX on the next authored stamp so Michelle does not
      // blend the old stop and new start together on one history entry.
      return this.getHistorySafeDestinyStamp(now, 1, 1);
    })();
    const presentationStampOverride =
      restartPresentationStamp === null
        ? recoveryPresentationStamp
        : restartPresentationStamp;

    const previousChargeAmount = getEntityCapacitorAmount(entity);
    if (!consumeEntityCapacitor(entity, runtimeAttributes.capNeed)) {
      return {
        success: false,
        errorMsg: "NOT_ENOUGH_CAPACITOR",
      };
    }
    // CCP parity: Notify the client that capacitor has been consumed so the
    // HUD gauge updates immediately rather than waiting for the next poll.
    notifyCapacitorChangeToSession(session, entity, now, previousChargeAmount);

    const effectState = {
      moduleID: normalizedModuleID,
      moduleFlagID: toInt(moduleItem.flagID, 0),
      effectName,
      groupID: toInt(moduleItem.groupID, 0),
      typeID: toInt(moduleItem.typeID, 0),
      startedAtMs: now,
      durationMs: runtimeAttributes.durationMs,
      nextCycleAtMs: now + runtimeAttributes.durationMs,
      capNeed: runtimeAttributes.capNeed,
      speedFactor: runtimeAttributes.speedFactor,
      speedBoostFactor: runtimeAttributes.speedBoostFactor,
      massAddition: runtimeAttributes.massAddition,
      signatureRadiusBonus: runtimeAttributes.signatureRadiusBonus,
      reactivationDelayMs: runtimeAttributes.reactivationDelayMs,
      guid: PROPULSION_GUID_BY_EFFECT[effectName] || "",
      repeat: normalizeEffectRepeatCount(options.repeat, null),
      deactivationRequestedAtMs: 0,
      deactivateAtMs: 0,
      stopReason: null,
    };
    entity.activeModuleEffects.set(normalizedModuleID, effectState);
    const hasReadyOwnerSession = isReadyForDestiny(session);
    const propulsionPresentationStamp =
      hasReadyOwnerSession
        ? (
            presentationStampOverride === null
              ? this.getOwnerPropulsionTogglePresentationStamp(session, now)
              : presentationStampOverride
          )
        : null;

    const refreshResult = hasReadyOwnerSession
      ? this.refreshSessionShipDerivedState(session, {
          broadcast: true,
          broadcastStamp: propulsionPresentationStamp,
        })
      : this.refreshShipEntityDerivedState(entity, {
          session,
          broadcast: true,
          broadcastOptions: buildObserverPropulsionShipPrimeBroadcastOptions(),
        });
    if (refreshResult.success) {
      notifyPropulsionDerivedAttributesToSession(session, entity, effectState, now);
      this.broadcastSpecialFx(
        entity.itemID,
        effectState.guid,
        hasReadyOwnerSession
          ? {
              moduleID: effectState.moduleID,
              moduleTypeID: effectState.typeID,
              start: true,
              active: true,
              duration: effectState.durationMs,
              stampOverride: propulsionPresentationStamp,
            }
          : buildObserverPropulsionSpecialFxOptions({
              moduleID: effectState.moduleID,
              moduleTypeID: effectState.typeID,
              start: true,
              active: true,
              duration: effectState.durationMs,
            }),
        entity,
      );
      notifyModuleEffectState(session, entity, effectState, true, {
        whenMs: now,
        startTimeMs: now,
      });
    }

    return {
      success: true,
      data: {
        entity,
        effectState,
      },
    };
  }

  finalizePropulsionModuleDeactivation(session, moduleID, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const normalizedModuleID = toInt(moduleID, 0);
    if (
      !entity ||
      normalizedModuleID <= 0 ||
      !(entity.activeModuleEffects instanceof Map)
    ) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_ACTIVE",
      };
    }

    const effectState = entity.activeModuleEffects.get(normalizedModuleID) || null;
    if (!effectState) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_ACTIVE",
      };
    }

    const stopTimeMs = Math.max(
      0,
      toFiniteNumber(
        options.nowMs,
        getEffectCycleBoundaryMs(effectState, this.getCurrentSimTimeMs()),
      ),
    );

    entity.activeModuleEffects.delete(normalizedModuleID);
    if (!(entity.moduleReactivationLocks instanceof Map)) {
      entity.moduleReactivationLocks = new Map();
    }
    entity.moduleReactivationLocks.set(
      normalizedModuleID,
      stopTimeMs + Math.max(0, toFiniteNumber(effectState.reactivationDelayMs, 0)),
    );

    effectState.deactivatedAtMs = stopTimeMs;
    effectState.deactivationRequestedAtMs = 0;
    effectState.deactivateAtMs = 0;
    effectState.stopReason = options.reason || effectState.stopReason || null;

    const hasReadyOwnerSession = isReadyForDestiny(session);
    const propulsionPresentationStamp =
      hasReadyOwnerSession
        ? this.getOwnerPropulsionTogglePresentationStamp(
            session,
            Math.max(
              this.getCurrentSimTimeMs(),
              stopTimeMs,
            ),
          )
        : null;

    const refreshResult = hasReadyOwnerSession
      ? this.refreshSessionShipDerivedState(session, {
          broadcast: true,
          broadcastStamp: propulsionPresentationStamp,
        })
      : this.refreshShipEntityDerivedState(entity, {
          session,
          broadcast: true,
          broadcastOptions: buildObserverPropulsionShipPrimeBroadcastOptions(),
        });
    if (refreshResult.success) {
      notifyPropulsionDerivedAttributesToSession(session, entity, effectState, stopTimeMs);
      this.broadcastSpecialFx(
        entity.itemID,
        effectState.guid,
        hasReadyOwnerSession
          ? {
              moduleID: effectState.moduleID,
              moduleTypeID: effectState.typeID,
              targetID: effectState.targetID || null,
              chargeTypeID: effectState.chargeTypeID || null,
              isOffensive: isOffensiveWeaponFamily(effectState.weaponFamily),
              start: false,
              active: false,
              duration: effectState.durationMs,
              stampOverride: propulsionPresentationStamp,
            }
          : buildObserverPropulsionSpecialFxOptions({
              moduleID: effectState.moduleID,
              moduleTypeID: effectState.typeID,
              targetID: effectState.targetID || null,
              chargeTypeID: effectState.chargeTypeID || null,
              isOffensive: isOffensiveWeaponFamily(effectState.weaponFamily),
              start: false,
              active: false,
              duration: effectState.durationMs,
            }),
        entity,
      );
      notifyModuleEffectState(session, entity, effectState, false, {
        clampToVisibleStamp: options.clampToVisibleStamp === true,
        whenMs: stopTimeMs,
      });
    }

    return {
      success: true,
      data: {
        entity,
        effectState,
        stoppedAtMs: stopTimeMs,
      },
    };
  }

  deactivatePropulsionModule(session, moduleID, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const normalizedModuleID = toInt(moduleID, 0);
    if (
      !entity ||
      normalizedModuleID <= 0 ||
      !(entity.activeModuleEffects instanceof Map)
    ) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_ACTIVE",
      };
    }

    const effectState = entity.activeModuleEffects.get(normalizedModuleID) || null;
    if (!effectState) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_ACTIVE",
      };
    }

    const now = this.getCurrentSimTimeMs();
    const reason = String(options.reason || "manual");
    const cycleBoundaryMs = getEffectCycleBoundaryMs(effectState, now);
    const shouldDefer = options.deferUntilCycle !== false && reason === "manual";

    if (effectState.deactivateAtMs > 0 && effectState.deactivateAtMs > now) {
      return {
        success: true,
        data: {
          entity,
          effectState,
          pending: true,
          deactivateAtMs: effectState.deactivateAtMs,
        },
      };
    }

    if (shouldDefer && cycleBoundaryMs > now + 1) {
      effectState.deactivationRequestedAtMs = now;
      effectState.deactivateAtMs = cycleBoundaryMs;
      effectState.stopReason = reason;
      persistDynamicEntity(entity);
      return {
        success: true,
        data: {
          entity,
          effectState,
          pending: true,
          deactivateAtMs: cycleBoundaryMs,
        },
      };
    }

    return this.finalizePropulsionModuleDeactivation(session, normalizedModuleID, {
      reason,
      nowMs: cycleBoundaryMs > 0 ? cycleBoundaryMs : now,
    });
  }

  // -------------------------------------------------------------------
  // Generic module activation (non-propulsion) — weapons, repairers,
  // shield boosters, etc.  Sends OnGodmaShipEffect with proper timing
  // so the HUD radial cycle ring animates correctly.
  // -------------------------------------------------------------------

  activateGenericModule(session, moduleItem, effectName, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || !moduleItem) {
      return { success: false, errorMsg: "SHIP_NOT_FOUND" };
    }
    if (entity.kind === "structure" && session) {
      entity.session = session;
      entity.characterID = toInt(session.characterID || session.charid, 0);
      entity.pilotCharacterID = entity.characterID;
      entity.corporationID = toInt(
        session.corporationID || session.corpid,
        entity.corporationID,
      );
      entity.allianceID = toInt(
        session.allianceID || session.allianceid,
        entity.allianceID,
      );
    }
    const effectiveModuleItem = buildNpcEffectiveModuleItem(moduleItem);

    const normalizedModuleID = toInt(moduleItem.itemID, 0);
    if (
      normalizedModuleID <= 0 ||
      toInt(moduleItem.locationID, 0) !== toInt(entity.itemID, 0)
    ) {
      return { success: false, errorMsg: "MODULE_NOT_FOUND" };
    }
    if (!isModuleOnline(moduleItem)) {
      return { success: false, errorMsg: "MODULE_NOT_ONLINE" };
    }
    if (!(entity.activeModuleEffects instanceof Map)) {
      entity.activeModuleEffects = new Map();
    }
    if (!(entity.moduleReactivationLocks instanceof Map)) {
      entity.moduleReactivationLocks = new Map();
    }
    if (entity.activeModuleEffects.has(normalizedModuleID)) {
      return { success: false, errorMsg: "MODULE_ALREADY_ACTIVE" };
    }

    const lockUntil = toFiniteNumber(
      entity.moduleReactivationLocks.get(normalizedModuleID),
      0,
    );
    const now = this.getCurrentSimTimeMs();
    if (lockUntil > now) {
      return { success: false, errorMsg: "MODULE_REACTIVATING" };
    }

    // Resolve the activation effect from the module's type dogma
    let effectRecord = effectName
      ? resolveEffectByName(effectiveModuleItem.typeID, effectName)
      : null;
    if (!effectRecord) {
      effectRecord = resolveDefaultActivationEffect(effectiveModuleItem.typeID);
    }
    if (!effectRecord) {
      return { success: false, errorMsg: "NO_ACTIVATABLE_EFFECT" };
    }
    if (
      moduleActivationRequiresActiveIndustrialCore(effectiveModuleItem.typeID) &&
      !hasActiveIndustrialCoreEffect(entity)
    ) {
      return {
        success: false,
        errorMsg: "ACTIVE_INDUSTRIAL_CORE_REQUIRED",
      };
    }

    const chargeItem = getEntityRuntimeLoadedCharge(entity, moduleItem);
    const weaponFamily = resolveWeaponFamily(moduleItem, chargeItem);
    const chargeOptionalTurretWeapon = isChargeOptionalTurretWeapon(
      moduleItem,
      chargeItem,
    );
    const miningRuntime =
      config.miningEnabled === true
        ? require(path.join(__dirname, "../services/mining/miningRuntime"))
        : null;
    let weaponSnapshot = null;
    let miningActivation = null;
    let commandBurstActivation = null;
    let assistanceActivation = null;
    let jammerModuleActivation = null;
    let hostileModuleActivation = null;
    let tractorBeamActivation = null;
    let salvagerActivation = null;
    let microJumpDriveActivation = null;
    let targetEntity = null;
    const shipRecord = getEntityRuntimeShipItem(entity);
    if (!shipRecord) {
      return { success: false, errorMsg: "SHIP_NOT_FOUND" };
    }
    const fittedItems = getEntityRuntimeFittedItems(entity);
    const skillMap = getEntityRuntimeSkillMap(entity);
    const activeModuleContexts = getEntityRuntimeActiveModuleContexts(entity, {
      excludeModuleID: normalizedModuleID,
    });
    if (isSnapshotWeaponFamily(weaponFamily)) {
      if (!chargeItem && !chargeOptionalTurretWeapon) {
        return { success: false, errorMsg: "NO_AMMO" };
      }
      const normalizedTargetID = toInt(options.targetID, 0);
      if (normalizedTargetID <= 0) {
        return { success: false, errorMsg: "TARGET_REQUIRED" };
      }
      targetEntity = this.getEntityByID(normalizedTargetID);
      if (!targetEntity || !hasDamageableHealth(targetEntity)) {
        return { success: false, errorMsg: "TARGET_NOT_FOUND" };
      }
      if (!isEntityLockedTarget(entity, normalizedTargetID)) {
        return { success: false, errorMsg: "TARGET_NOT_LOCKED" };
      }
      weaponSnapshot = buildWeaponSnapshotForEntity(entity, moduleItem, chargeItem, {
        shipItem: shipRecord,
      });
      if (!weaponSnapshot) {
        return { success: false, errorMsg: chargeItem ? "UNSUPPORTED_WEAPON" : "NO_AMMO" };
      }
      if (
        isMissileWeaponFamily(weaponSnapshot.family) &&
        getEntitySurfaceDistance(entity, targetEntity) >
          estimateMissileEffectiveRange(weaponSnapshot) + 1
      ) {
        return { success: false, errorMsg: "TARGET_OUT_OF_RANGE" };
      }
    }
    if (
      !weaponSnapshot &&
      miningRuntime &&
      typeof miningRuntime.resolveMiningActivation === "function"
    ) {
      miningActivation = miningRuntime.resolveMiningActivation(
        this,
        entity,
        moduleItem,
        effectRecord,
        options,
      );
      if (miningActivation && miningActivation.matched === true) {
        if (miningActivation.success !== true) {
          return {
            success: false,
            errorMsg: miningActivation.errorMsg || "UNSUPPORTED_MODULE",
          };
        }
        targetEntity = miningActivation.data && miningActivation.data.targetEntity
          ? miningActivation.data.targetEntity
          : null;
      }
    }
    if (!weaponSnapshot && !(miningActivation && miningActivation.success === true)) {
      commandBurstActivation = commandBurstRuntime.resolveCommandBurstActivation({
        effectRecord,
        moduleItem,
        chargeItem,
        shipItem: shipRecord,
        skillMap,
        fittedItems,
        activeModuleContexts,
      });
      if (commandBurstActivation && commandBurstActivation.matched === true) {
        if (commandBurstActivation.success !== true) {
          return {
            success: false,
            errorMsg: commandBurstActivation.errorMsg || "UNSUPPORTED_MODULE",
          };
        }
      }
    }
    if (
      !weaponSnapshot &&
      !(miningActivation && miningActivation.success === true) &&
      !(commandBurstActivation && commandBurstActivation.matched === true)
    ) {
      assistanceActivation = assistanceModuleRuntime.resolveAssistanceModuleActivation({
        scene: this,
        entity,
        moduleItem,
        effectRecord,
        chargeItem,
        shipItem: shipRecord,
        skillMap,
        fittedItems,
        activeModuleContexts,
        options,
        callbacks: buildAssistanceModuleRuntimeCallbacks(),
      });
      if (assistanceActivation && assistanceActivation.matched === true) {
        if (assistanceActivation.success !== true) {
          return {
            success: false,
            errorMsg: assistanceActivation.errorMsg || "UNSUPPORTED_MODULE",
          };
        }
        targetEntity = assistanceActivation.data && assistanceActivation.data.targetEntity
          ? assistanceActivation.data.targetEntity
          : targetEntity;
      }
    }
    if (
      !weaponSnapshot &&
      !(miningActivation && miningActivation.success === true) &&
      !(commandBurstActivation && commandBurstActivation.matched === true) &&
      !(assistanceActivation && assistanceActivation.matched === true)
    ) {
      jammerModuleActivation = jammerModuleRuntime.resolveJammerModuleActivation({
        scene: this,
        entity,
        moduleItem,
        effectRecord,
        chargeItem,
        shipItem: shipRecord,
        skillMap,
        fittedItems,
        activeModuleContexts,
        options,
        callbacks: buildJammerModuleRuntimeCallbacks(this),
      });
      if (jammerModuleActivation && jammerModuleActivation.matched === true) {
        if (jammerModuleActivation.success !== true) {
          return {
            success: false,
            errorMsg: jammerModuleActivation.errorMsg || "UNSUPPORTED_MODULE",
          };
        }
        targetEntity = jammerModuleActivation.data && jammerModuleActivation.data.targetEntity
          ? jammerModuleActivation.data.targetEntity
          : targetEntity;
      }
    }
    if (
      !weaponSnapshot &&
      !(miningActivation && miningActivation.success === true) &&
      !(commandBurstActivation && commandBurstActivation.matched === true) &&
      !(assistanceActivation && assistanceActivation.matched === true) &&
      !(jammerModuleActivation && jammerModuleActivation.matched === true)
    ) {
      hostileModuleActivation = hostileModuleRuntime.resolveHostileModuleActivation({
        scene: this,
        entity,
        moduleItem,
        effectRecord,
        chargeItem,
        shipItem: shipRecord,
        skillMap,
        fittedItems,
        activeModuleContexts,
        options,
        callbacks: buildHostileModuleRuntimeCallbacks(this),
      });
      if (hostileModuleActivation && hostileModuleActivation.matched === true) {
        if (hostileModuleActivation.success !== true) {
          return {
            success: false,
            errorMsg: hostileModuleActivation.errorMsg || "UNSUPPORTED_MODULE",
          };
        }
        targetEntity = hostileModuleActivation.data && hostileModuleActivation.data.targetEntity
          ? hostileModuleActivation.data.targetEntity
          : targetEntity;
      }
    }
    if (
      !weaponSnapshot &&
      !(miningActivation && miningActivation.success === true) &&
      !(commandBurstActivation && commandBurstActivation.matched === true) &&
      !(assistanceActivation && assistanceActivation.matched === true) &&
      !(jammerModuleActivation && jammerModuleActivation.matched === true) &&
      !(hostileModuleActivation && hostileModuleActivation.matched === true)
    ) {
      tractorBeamActivation = tractorBeamRuntime.resolveTractorBeamActivation({
        scene: this,
        entity,
        moduleItem,
        effectRecord,
        chargeItem,
        shipItem: shipRecord,
        skillMap,
        fittedItems,
        activeModuleContexts,
        options,
        callbacks: buildTractorBeamRuntimeCallbacks(),
      });
      if (tractorBeamActivation && tractorBeamActivation.matched === true) {
        if (tractorBeamActivation.success !== true) {
          return {
            success: false,
            errorMsg: tractorBeamActivation.errorMsg || "UNSUPPORTED_MODULE",
          };
        }
        targetEntity = tractorBeamActivation.data && tractorBeamActivation.data.targetEntity
          ? tractorBeamActivation.data.targetEntity
          : targetEntity;
      }
    }
    if (
      !weaponSnapshot &&
      !(miningActivation && miningActivation.success === true) &&
      !(commandBurstActivation && commandBurstActivation.matched === true) &&
      !(assistanceActivation && assistanceActivation.matched === true) &&
      !(jammerModuleActivation && jammerModuleActivation.matched === true) &&
      !(hostileModuleActivation && hostileModuleActivation.matched === true) &&
      !(tractorBeamActivation && tractorBeamActivation.matched === true)
    ) {
      salvagerActivation = salvagerRuntime.resolveSalvagerActivation({
        scene: this,
        entity,
        moduleItem,
        effectRecord,
        chargeItem,
        shipItem: shipRecord,
        skillMap,
        fittedItems,
        activeModuleContexts,
        options,
        callbacks: buildSalvagerRuntimeCallbacks(this),
      });
      if (salvagerActivation && salvagerActivation.matched === true) {
        if (salvagerActivation.success !== true) {
          return {
            success: false,
            errorMsg: salvagerActivation.errorMsg || "UNSUPPORTED_MODULE",
          };
        }
        targetEntity = salvagerActivation.data && salvagerActivation.data.targetEntity
          ? salvagerActivation.data.targetEntity
          : targetEntity;
      }
    }
    if (
      !weaponSnapshot &&
      !(miningActivation && miningActivation.success === true) &&
      !(commandBurstActivation && commandBurstActivation.matched === true) &&
      !(assistanceActivation && assistanceActivation.matched === true) &&
      !(jammerModuleActivation && jammerModuleActivation.matched === true) &&
      !(hostileModuleActivation && hostileModuleActivation.matched === true) &&
      !(tractorBeamActivation && tractorBeamActivation.matched === true) &&
      !(salvagerActivation && salvagerActivation.matched === true)
    ) {
      microJumpDriveActivation = microJumpDriveRuntime.resolveMicroJumpDriveActivation({
        moduleItem,
        effectRecord,
        chargeItem,
        shipItem: shipRecord,
        skillMap,
        fittedItems,
        activeModuleContexts,
      });
      if (microJumpDriveActivation && microJumpDriveActivation.matched === true) {
        if (microJumpDriveActivation.success !== true) {
          return {
            success: false,
            errorMsg: microJumpDriveActivation.errorMsg || "UNSUPPORTED_MODULE",
          };
        }
        if (hostileModuleRuntime.isMicroJumpDriveBlocked(entity)) {
          return {
            success: false,
            errorMsg: "MICRO_JUMP_DRIVE_BLOCKED",
          };
        }
      }
    }
    const runtimeAttrs =
      miningActivation && miningActivation.success === true
        ? miningActivation.data.runtimeAttrs
        : commandBurstActivation && commandBurstActivation.success === true
          ? commandBurstActivation.data.runtimeAttrs
          : assistanceActivation && assistanceActivation.success === true
            ? assistanceActivation.data.runtimeAttrs
            : jammerModuleActivation && jammerModuleActivation.success === true
              ? jammerModuleActivation.data.runtimeAttrs
            : hostileModuleActivation && hostileModuleActivation.success === true
              ? hostileModuleActivation.data.runtimeAttrs
            : tractorBeamActivation && tractorBeamActivation.success === true
              ? tractorBeamActivation.data.runtimeAttrs
            : salvagerActivation && salvagerActivation.success === true
              ? salvagerActivation.data.runtimeAttrs
              : microJumpDriveActivation && microJumpDriveActivation.success === true
                ? microJumpDriveActivation.data.runtimeAttrs
        : getGenericModuleRuntimeAttributes(
          getShipEntityInventoryCharacterID(entity, toInt(session && session.characterID, 0)),
          shipRecord,
          effectiveModuleItem,
          chargeItem,
          weaponSnapshot,
          {
            additionalLocationModifierSources: collectEntityWormholeLocationModifierSources(entity),
          },
        );
    if (!runtimeAttrs) {
      return { success: false, errorMsg: "UNSUPPORTED_MODULE" };
    }
    const localCycleCallbacks = buildLocalCycleRuntimeCallbacks(
      toInt(session && session.characterID, 0),
    );
    const superweaponCallbacks = buildSuperweaponRuntimeCallbacks(
      this,
      toInt(session && session.characterID, 0),
    );
    const localCycleActivation = prepareLocalCycleActivation({
      entity,
      shipItem: shipRecord,
      moduleItem,
      effectRecord,
      chargeItem,
      callbacks: localCycleCallbacks,
      baseRuntimeAttributes: runtimeAttrs,
    });
    if (localCycleActivation.matched === true && localCycleActivation.success !== true) {
      return {
        success: false,
        errorMsg: localCycleActivation.errorMsg || "UNSUPPORTED_MODULE",
      };
    }
    const effectiveRuntimeAttrs =
      localCycleActivation.matched === true &&
      localCycleActivation.success === true &&
      localCycleActivation.runtimeAttributes
        ? localCycleActivation.runtimeAttributes
        : runtimeAttrs;
    const superweaponActivation = prepareSuperweaponActivation({
      scene: this,
      session,
      entity,
      shipItem: shipRecord,
      moduleItem,
      effectRecord,
      chargeItem,
      callbacks: superweaponCallbacks,
      baseRuntimeAttributes: effectiveRuntimeAttrs,
      options,
      nowMs: now,
    });
    if (superweaponActivation.matched === true && superweaponActivation.success !== true) {
      return {
        success: false,
        errorMsg: superweaponActivation.errorMsg || "UNSUPPORTED_MODULE",
      };
    }
    if (superweaponActivation.targetEntity) {
      targetEntity = superweaponActivation.targetEntity;
    }
    const finalRuntimeAttrsBase =
      superweaponActivation.matched === true &&
      superweaponActivation.success === true &&
      superweaponActivation.runtimeAttributes
        ? superweaponActivation.runtimeAttributes
        : effectiveRuntimeAttrs;
    const superweaponEffectStatePatch =
      superweaponActivation.matched === true &&
      superweaponActivation.success === true &&
      superweaponActivation.effectStatePatch &&
      typeof superweaponActivation.effectStatePatch === "object"
        ? superweaponActivation.effectStatePatch
        : null;
    const finalRuntimeAttrs = superweaponEffectStatePatch
      ? {
        ...finalRuntimeAttrsBase,
        capNeed: roundNumber(
          toFiniteNumber(
            superweaponEffectStatePatch.capNeed,
            finalRuntimeAttrsBase.capNeed,
          ),
          6,
        ),
        fuelTypeID: Math.max(
          0,
          toInt(
            superweaponEffectStatePatch.superweaponFuelTypeID,
            finalRuntimeAttrsBase.fuelTypeID,
          ),
        ),
        fuelPerActivation: Math.max(
          0,
          toInt(
            superweaponEffectStatePatch.superweaponFuelPerActivation,
            finalRuntimeAttrsBase.fuelPerActivation,
          ),
        ),
      }
      : finalRuntimeAttrsBase;

    const offensiveActivation =
      (
        superweaponActivation.matched === true &&
        superweaponActivation.success === true &&
        superweaponActivation.offensiveActivation === true
      ) ||
      (
        jammerModuleActivation &&
        jammerModuleActivation.success === true &&
        jammerModuleActivation.data &&
        jammerModuleActivation.data.offensiveActivation === true
      ) ||
      targetEntity &&
      (
        isOffensiveWeaponFamily(
          weaponSnapshot && weaponSnapshot.family
            ? weaponSnapshot.family
            : weaponFamily,
        ) ||
        effectRecord.isOffensive === true
      );
    if (targetEntity && structureTethering.isEntityStructureTethered(targetEntity)) {
      return { success: false, errorMsg: "TARGET_TETHERED" };
    }
    if (offensiveActivation) {
      breakEntityStructureTether(this, entity, {
        nowMs: now,
        reason: "OFFENSIVE_ACTIVATION",
      });
    }

    if (finalRuntimeAttrs.maxGroupActive > 0) {
      const activeCount = [...entity.activeModuleEffects.values()].filter(
        (es) => toInt(es.groupID, 0) === toInt(moduleItem.groupID, 0),
      ).length;
      if (activeCount >= finalRuntimeAttrs.maxGroupActive) {
        return { success: false, errorMsg: "MAX_GROUP_ACTIVE" };
      }
    }

    const previousChargeAmount = getEntityCapacitorAmount(entity);
    if (finalRuntimeAttrs.capNeed > previousChargeAmount + 1e-6) {
      return { success: false, errorMsg: "NOT_ENOUGH_CAPACITOR" };
    }
    const initialFuelConsumptionResult = consumeShipModuleFuelForSession(
      session,
      entity,
      finalRuntimeAttrs.fuelTypeID,
      finalRuntimeAttrs.fuelPerActivation,
    );
    if (!initialFuelConsumptionResult.success) {
      return {
        success: false,
        errorMsg: initialFuelConsumptionResult.errorMsg || "NO_FUEL",
      };
    }
    if (!consumeEntityCapacitor(entity, finalRuntimeAttrs.capNeed)) {
      return { success: false, errorMsg: "NOT_ENOUGH_CAPACITOR" };
    }
    notifyCapacitorChangeToSession(session, entity, now, previousChargeAmount);

    const activeShipModifierEntries = [];
    appendDirectModifierEntries(
      activeShipModifierEntries,
      buildEffectiveItemAttributeMap(effectiveModuleItem, chargeItem),
      [effectRecord],
      "fittedModule",
    );

    const effectState = {
      moduleID: normalizedModuleID,
      moduleFlagID: toInt(moduleItem.flagID, 0),
      effectName: effectRecord.name,
      effectID: toInt(effectRecord.effectID, 0),
      effectCategoryID: toInt(effectRecord.effectCategoryID, 0),
      guid: resolveGenericModuleSpecialFxGuid(effectRecord, {
        weaponSnapshot,
        weaponFamily,
        moduleItem: effectiveModuleItem,
        chargeItem,
      }),
      groupID: toInt(moduleItem.groupID, 0),
      typeID: toInt(moduleItem.typeID, 0),
      startedAtMs: now,
      durationMs: finalRuntimeAttrs.durationMs,
      durationAttributeID: finalRuntimeAttrs.durationAttributeID,
      nextCycleAtMs: now + finalRuntimeAttrs.durationMs,
      capNeed: finalRuntimeAttrs.capNeed,
      fuelTypeID: Math.max(0, toInt(finalRuntimeAttrs.fuelTypeID, 0)),
      fuelPerActivation: Math.max(0, toInt(finalRuntimeAttrs.fuelPerActivation, 0)),
      reactivationDelayMs: finalRuntimeAttrs.reactivationDelayMs,
      repeat: normalizeEffectRepeatCount(options.repeat, null),
      targetID: targetEntity ? toInt(options.targetID, 0) : 0,
      chargeTypeID: toInt(
        (chargeItem && chargeItem.typeID) ||
          (weaponSnapshot && weaponSnapshot.chargeTypeID) ||
          (
            runtimeAttrs.miningSnapshot &&
            runtimeAttrs.miningSnapshot.chargeTypeID
          ),
        0,
      ),
      weaponFamily:
        weaponSnapshot && weaponSnapshot.family
          ? weaponSnapshot.family
          : null,
      bankModuleIDs:
        isTurretWeaponFamily(
          weaponSnapshot && weaponSnapshot.family
            ? weaponSnapshot.family
            : weaponFamily,
        )
          ? resolveGroupedTurretBankModuleIDs(
            entity,
            normalizedModuleID,
            toInt(moduleItem.typeID, 0),
          )
          : null,
      miningEffect: Boolean(miningActivation && miningActivation.success === true),
      salvagerEffect: Boolean(salvagerActivation && salvagerActivation.success === true),
      deactivationRequestedAtMs: 0,
      deactivateAtMs: 0,
      stopReason: null,
      isGeneric: true,
      genericAttributeOverrides:
        finalRuntimeAttrs &&
        finalRuntimeAttrs.attributeOverrides &&
        typeof finalRuntimeAttrs.attributeOverrides === "object"
          ? {
            ...finalRuntimeAttrs.attributeOverrides,
          }
          : null,
      affectsShipDerivedState: activeShipModifierEntries.length > 0,
      ...(localCycleActivation.matched === true && localCycleActivation.success === true
        ? localCycleActivation.effectStatePatch
        : {}),
      ...(commandBurstActivation && commandBurstActivation.matched === true &&
        commandBurstActivation.success === true
        ? commandBurstActivation.data.effectStatePatch
        : {}),
      ...(assistanceActivation && assistanceActivation.matched === true &&
        assistanceActivation.success === true
        ? assistanceActivation.data.effectStatePatch
        : {}),
      ...(jammerModuleActivation && jammerModuleActivation.matched === true &&
        jammerModuleActivation.success === true
        ? jammerModuleActivation.data.effectStatePatch
        : {}),
      ...(hostileModuleActivation && hostileModuleActivation.matched === true &&
        hostileModuleActivation.success === true
        ? hostileModuleActivation.data.effectStatePatch
        : {}),
      ...(tractorBeamActivation && tractorBeamActivation.matched === true &&
        tractorBeamActivation.success === true
        ? tractorBeamActivation.data.effectStatePatch
        : {}),
      ...(salvagerActivation && salvagerActivation.matched === true &&
        salvagerActivation.success === true
        ? salvagerActivation.data.effectStatePatch
        : {}),
      ...(microJumpDriveActivation && microJumpDriveActivation.matched === true &&
        microJumpDriveActivation.success === true
        ? microJumpDriveActivation.data.effectStatePatch
        : {}),
      ...(superweaponActivation.matched === true && superweaponActivation.success === true
        ? superweaponEffectStatePatch
        : {}),
    };
    if (effectState.tractorBeamEffect === true) {
      effectState.lastTractorTickAtMs = now;
      effectState.lastTractorPersistAtMs = 0;
    }
    if (isPrecursorTurretFamily(effectState.weaponFamily)) {
      initializePrecursorTurretEffectState(effectState, weaponSnapshot, now);
    }
    entity.activeModuleEffects.set(normalizedModuleID, effectState);
    if (effectState.affectsShipDerivedState) {
      this.refreshShipEntityDerivedState(entity, {
        session,
        broadcast: false,
        notifyTargeting: true,
      });
    }
    const compressionSlimChanged = refreshShipCompressionFacilityState(entity);
    if (compressionSlimChanged) {
      this.broadcastSlimItemChanges([entity]);
    }

    if (effectState.superweaponEffect === true) {
      const superweaponExecuteResult = executeSuperweaponActivation({
        scene: this,
        session,
        entity,
        moduleItem,
        effectState,
        nowMs: now,
        callbacks: superweaponCallbacks,
      });
      if (!superweaponExecuteResult.success) {
        this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
          reason: "superweapon",
          nowMs: now,
        });
        return {
          success: false,
          errorMsg:
            superweaponExecuteResult.errorMsg || "SUPERWEAPON_ACTIVATION_FAILED",
        };
      }
    }

    const groupedTurretPresentationStates =
      buildGroupedTurretBankPresentationEffectStates(entity, effectState);
    if (effectState.guid && effectState.suppressStartSpecialFx !== true) {
      for (const presentationEffectState of groupedTurretPresentationStates) {
        const baseStartFxOptions = {
          moduleID: presentationEffectState.moduleID,
          moduleTypeID: presentationEffectState.typeID,
          targetID: presentationEffectState.targetID || null,
          chargeTypeID: presentationEffectState.chargeTypeID || null,
          weaponFamily: String(effectState.weaponFamily || ""),
          isOffensive:
            isOffensiveWeaponFamily(effectState.weaponFamily) ||
            effectRecord.isOffensive === true,
          start: true,
          active: true,
          duration: presentationEffectState.durationMs,
          repeat: resolveSpecialFxRepeatCount(effectState),
          graphicInfo: buildPrecursorTurretGraphicInfo(effectState),
          ...buildMiningSpecialFxTimingOptions(effectState, now, {
            includeElapsed: false,
          }),
        };
        const startFxOptions =
          effectState.guid === "effects.MissileDeployment"
            ? buildMissileDeploymentSpecialFxOptions(baseStartFxOptions)
            : entity.nativeNpc === true && offensiveActivation
              ? buildNpcOffensiveSpecialFxOptions(baseStartFxOptions)
              : {
                ...baseStartFxOptions,
                useCurrentVisibleStamp: true,
              };
        this.broadcastSpecialFx(
          entity.itemID,
          effectState.guid,
          startFxOptions,
          entity,
        );
      }
    }
    notifyGenericDerivedAttributesToSession(session, effectState, now);
    for (const presentationEffectState of groupedTurretPresentationStates) {
      notifyGenericModuleEffectState(session, entity, presentationEffectState, true, {
        whenMs: now,
        startTimeMs: now,
      });
    }
    if (effectState.assistanceModuleEffect === true) {
      const initialAssistanceCycleResult = assistanceModuleRuntime.executeAssistanceModuleCycle({
        scene: this,
        session,
        entity,
        effectState,
        nowMs: now,
        callbacks: buildAssistanceModuleRuntimeCallbacks(),
      });
      if (!initialAssistanceCycleResult.success) {
        this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
          reason: initialAssistanceCycleResult.stopReason || "assistance",
          nowMs: now,
        });
      } else {
        const targetEntity = this.getEntityByID(toInt(effectState.targetID, 0));
        const targetSession = targetEntity && targetEntity.session ? targetEntity.session : null;
        const hudSyncResult = targetEntity
          ? hudIconRuntime.upsertHudIconState(
            targetEntity,
            buildAssistanceHudState(targetEntity, entity, effectState, now),
          )
          : { state: null };
        if (targetSession && isReadyForDestiny(targetSession) && hudSyncResult.state) {
          notifyAssistanceHudStateToSession(targetSession, hudSyncResult.state, true, {
            startTimeMs: now,
            durationMs: resolveAssistanceJamDurationMs(effectState, now),
          });
        }
      }
    }
    if (effectState.jammerModuleEffect === true) {
      const initialJammerCycleResult = jammerModuleRuntime.executeJammerModuleCycle({
        scene: this,
        entity,
        effectState,
        nowMs: now,
        callbacks: buildJammerModuleRuntimeCallbacks(this),
      });
      if (!initialJammerCycleResult.success) {
        this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
          reason: initialJammerCycleResult.stopReason || "jammer",
          nowMs: now,
        });
      } else {
        applyJammerCyclePresentation(
          this,
          entity,
          effectState,
          now,
          initialJammerCycleResult,
        );
      }
    }
    if (effectState.jammerBurstEffect === true) {
      const initialJammerBurstCycleResult = jammerModuleRuntime.executeJammerBurstCycle({
        scene: this,
        entity,
        effectState,
        nowMs: now,
        callbacks: buildJammerModuleRuntimeCallbacks(this),
      });
      if (!initialJammerBurstCycleResult.success) {
        this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
          reason: initialJammerBurstCycleResult.stopReason || "jammerBurst",
          nowMs: now,
        });
      }
    }
    if (effectState.hostileModuleEffect === true) {
      const initialHostileCycleResult = hostileModuleRuntime.executeHostileModuleCycle({
        scene: this,
        session,
        entity,
        effectState,
        nowMs: now,
        callbacks: buildHostileModuleRuntimeCallbacks(this),
      });
      if (!initialHostileCycleResult.success) {
        this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
          reason: initialHostileCycleResult.stopReason || "hostile",
          nowMs: now,
        });
      } else {
        const resolvedTargetEntity =
          initialHostileCycleResult.data && initialHostileCycleResult.data.targetEntity
            ? initialHostileCycleResult.data.targetEntity
            : this.getEntityByID(toInt(effectState.targetID, 0));
        const targetSession =
          resolvedTargetEntity && resolvedTargetEntity.session
            ? resolvedTargetEntity.session
            : null;
        if (
          resolvedTargetEntity &&
          initialHostileCycleResult.data &&
          initialHostileCycleResult.data.aggregateChanged
        ) {
          this.refreshShipEntityDerivedState(resolvedTargetEntity, {
            session: targetSession,
            broadcast: true,
            notifyTargeting: true,
          });
          if (
            hostileModuleRuntime.isMicrowarpdriveBlocked(resolvedTargetEntity) ||
            hostileModuleRuntime.isMicroJumpDriveBlocked(resolvedTargetEntity)
          ) {
            forceDeactivateBlockedMovementEffects(this, resolvedTargetEntity, now, "scram");
          }
        }
        const hudSyncResult = resolvedTargetEntity
          ? hudIconRuntime.upsertHudIconState(
            resolvedTargetEntity,
            buildHostileHudState(resolvedTargetEntity, entity, effectState, now),
          )
          : { state: null };
        if (targetSession && isReadyForDestiny(targetSession) && hudSyncResult.state) {
          notifyHostileHudStateToSession(targetSession, hudSyncResult.state, true, {
            startTimeMs: now,
            durationMs: resolveHostileJamDurationMs(effectState, now),
          });
        }
      }
    }
    if (effectState.localCycleEffect === true) {
      const initialLocalCycleResult = executeLocalCycle({
        scene: this,
        session,
        entity,
        moduleItem,
        effectState,
        nowMs: now,
        activation: true,
        callbacks: localCycleCallbacks,
      });
      if (!initialLocalCycleResult.success) {
        this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
          reason: initialLocalCycleResult.stopReason || "localCycle",
          nowMs: now,
        });
      } else if (
        initialLocalCycleResult.data &&
        initialLocalCycleResult.data.reloadState
      ) {
        effectState.pendingLocalReload = initialLocalCycleResult.data.reloadState;
        effectState.nextCycleAtMs = Math.max(
          now,
          Number(initialLocalCycleResult.data.reloadState.completeAtMs) || now,
        );
      }
    }
    if (effectState.commandBurstEffect === true) {
      const initialCommandBurstCycleResult = executeCommandBurstCycle(
        this,
        session,
        entity,
        moduleItem,
        effectState,
        now,
      );
      if (!initialCommandBurstCycleResult.success) {
        this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
          reason: initialCommandBurstCycleResult.stopReason || "commandBurst",
          nowMs: now,
        });
      } else if (
        initialCommandBurstCycleResult.data &&
        initialCommandBurstCycleResult.data.reloadState
      ) {
        effectState.pendingLocalReload = initialCommandBurstCycleResult.data.reloadState;
        effectState.nextCycleAtMs = Math.max(
          now,
          Number(initialCommandBurstCycleResult.data.reloadState.completeAtMs) || now,
        );
      } else if (
        initialCommandBurstCycleResult.data &&
        initialCommandBurstCycleResult.data.stopReason
      ) {
        this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
          reason: initialCommandBurstCycleResult.data.stopReason,
          nowMs: now,
        });
      }
    }

    if (
      offensiveActivation &&
      targetEntity
    ) {
      try {
        const crimewatchState = require(path.join(__dirname, "../services/security/crimewatchState"));
        if (
          crimewatchState &&
          typeof crimewatchState.recordHighSecCriminalAggression === "function"
        ) {
          crimewatchState.recordHighSecCriminalAggression(
            this,
            entity,
            targetEntity,
            now,
          );
        }
      } catch (error) {
        log.warn(`[SpaceRuntime] Crimewatch activation hook failed: ${error.message}`);
      }
    }

    if (
      offensiveActivation &&
      targetEntity
    ) {
      try {
        const npcService = require(path.join(__dirname, "./npc"));
        if (npcService && typeof npcService.noteNpcIncomingAggression === "function") {
          npcService.noteNpcIncomingAggression(
            targetEntity,
            entity,
            now,
          );
        }
      } catch (error) {
        log.warn(`[SpaceRuntime] NPC aggression activation hook failed: ${error.message}`);
      }
    }

    if (isSnapshotWeaponFamily(effectState.weaponFamily)) {
      const initialCycleResult = isTurretWeaponFamily(effectState.weaponFamily)
        ? executeTurretCycle(
          this,
          entity,
          effectState,
          now,
        )
        : executeMissileCycle(
          this,
          entity,
          effectState,
          now,
          {
            deferUntilVisibilitySync: true,
          },
        );
      if (entity && entity.nativeNpc === true) {
        logNpcCombatDebug("npc.weapons.initial-cycle", {
          entity: summarizeNpcCombatEntity(entity),
          moduleItem: summarizeNpcCombatModule(moduleItem),
          target: summarizeNpcCombatEntity(targetEntity),
          weaponFamily: String(effectState.weaponFamily || ""),
          success: Boolean(initialCycleResult && initialCycleResult.success),
          stopReason: initialCycleResult && initialCycleResult.stopReason
            ? String(initialCycleResult.stopReason)
            : (
              initialCycleResult &&
              initialCycleResult.data &&
              initialCycleResult.data.stopReason
                ? String(initialCycleResult.data.stopReason)
                : null
            ),
          reloadState:
            initialCycleResult && initialCycleResult.data
              ? initialCycleResult.data.reloadState || null
              : null,
          errorMsg: initialCycleResult && initialCycleResult.errorMsg
            ? String(initialCycleResult.errorMsg)
            : null,
        });
      }
      if (!initialCycleResult.success) {
        this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
          reason: initialCycleResult.stopReason || "weapon",
          nowMs: now,
        });
      } else if (
        initialCycleResult.data &&
        (
          initialCycleResult.data.reloadState ||
          initialCycleResult.data.bankReloadStates
        )
      ) {
        effectState.pendingMissileReload =
          initialCycleResult.data.bankReloadStates
            ? null
            : initialCycleResult.data.reloadState;
        effectState.pendingMissileBankReloads =
          initialCycleResult.data.bankReloadStates || null;
        const reloadCompletionAtMs = initialCycleResult.data.bankReloadStates
          ? Math.max(
            ...initialCycleResult.data.bankReloadStates.map(
              (reloadState) => Number(reloadState && reloadState.completeAtMs) || now,
            ),
            now,
          )
          : Number(initialCycleResult.data.reloadState && initialCycleResult.data.reloadState.completeAtMs) || now;
        effectState.nextCycleAtMs = Math.max(
          now,
          reloadCompletionAtMs,
        );
      } else if (
        initialCycleResult.data &&
        initialCycleResult.data.stopReason
      ) {
        this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
          reason: initialCycleResult.data.stopReason,
          nowMs: now,
        });
      }
    }

    return {
      success: true,
      data: { entity, effectState },
    };
  }

  finalizeGenericModuleDeactivation(session, moduleID, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const normalizedModuleID = toInt(moduleID, 0);
    if (
      !entity ||
      normalizedModuleID <= 0 ||
      !(entity.activeModuleEffects instanceof Map)
    ) {
      return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
    }

    const effectState = entity.activeModuleEffects.get(normalizedModuleID) || null;
    if (!effectState) {
      return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
    }

    const stopTimeMs = Math.max(
      0,
      toFiniteNumber(
        options.nowMs,
        getEffectCycleBoundaryMs(effectState, this.getCurrentSimTimeMs()),
      ),
    );

    entity.activeModuleEffects.delete(normalizedModuleID);
    if (!(entity.moduleReactivationLocks instanceof Map)) {
      entity.moduleReactivationLocks = new Map();
    }
    entity.moduleReactivationLocks.set(
      normalizedModuleID,
      stopTimeMs + Math.max(0, toFiniteNumber(effectState.reactivationDelayMs, 0)),
    );

    effectState.deactivatedAtMs = stopTimeMs;
    effectState.deactivationRequestedAtMs = 0;
    effectState.deactivateAtMs = 0;
    effectState.stopReason = options.reason || effectState.stopReason || null;
    const dependentIndustrialModuleIDs = isIndustrialCoreEffectName(effectState.effectName)
      ? getIndustrialCoreDependentModuleIDs(entity, normalizedModuleID)
      : [];
    if (effectState.tractorBeamEffect === true) {
      tractorBeamRuntime.handleTractorBeamDeactivation(this, effectState, stopTimeMs, {
        persistDynamicEntity,
      });
    }
    if (effectState.superweaponEffect === true) {
      finalizeSuperweaponDeactivation({
        scene: this,
        session,
        entity,
        effectState,
        nowMs: stopTimeMs,
      });
    }
    if (effectState.affectsShipDerivedState) {
      this.refreshShipEntityDerivedState(entity, {
        session,
        broadcast: false,
        notifyTargeting: true,
      });
    }
    if (effectState.assistanceModuleEffect === true) {
      const targetEntity = this.getEntityByID(toInt(effectState.targetID, 0));
      const targetSession = targetEntity && targetEntity.session ? targetEntity.session : null;
      const removedHudState = targetEntity
        ? hudIconRuntime.removeHudIconState(
          targetEntity,
          buildAssistanceHudState(targetEntity, entity, effectState, stopTimeMs),
        )
        : null;
      if (targetSession && isReadyForDestiny(targetSession) && removedHudState) {
        notifyAssistanceHudStateToSession(targetSession, removedHudState, false, {
          startTimeMs: stopTimeMs,
        });
      }
    }
  if (effectState.jammerModuleEffect === true) {
    removeJammerCyclePresentation(this, entity, effectState, stopTimeMs);
  }
    if (effectState.hostileModuleEffect === true) {
      const targetEntity = this.getEntityByID(toInt(effectState.targetID, 0));
      const targetSession = targetEntity && targetEntity.session ? targetEntity.session : null;
      const hostileRemovalResult = hostileModuleRuntime.removeHostileModuleState({
        targetEntity,
        sourceEntity: entity,
        effectState,
      });
      if (
        hostileRemovalResult &&
        hostileRemovalResult.success &&
        hostileRemovalResult.data &&
        hostileRemovalResult.data.aggregateChanged &&
        targetEntity
      ) {
        this.refreshShipEntityDerivedState(targetEntity, {
          session: targetSession,
          broadcast: true,
          notifyTargeting: true,
        });
      }
      const removedHudState = targetEntity
        ? hudIconRuntime.removeHudIconState(
          targetEntity,
          buildHostileHudState(targetEntity, entity, effectState, stopTimeMs),
        )
        : null;
      if (targetSession && isReadyForDestiny(targetSession) && removedHudState) {
        notifyHostileHudStateToSession(targetSession, removedHudState, false, {
          startTimeMs: stopTimeMs,
        });
      }
    }

    const groupedTurretPresentationStates =
      buildGroupedTurretBankPresentationEffectStates(entity, effectState);
    if (effectState.guid && effectState.suppressStopSpecialFx !== true) {
      const isOffensiveFx = isOffensiveWeaponFamily(effectState.weaponFamily);
      for (const presentationEffectState of groupedTurretPresentationStates) {
        const baseStopFxOptions = {
          moduleID: presentationEffectState.moduleID,
          moduleTypeID: presentationEffectState.typeID,
          targetID: presentationEffectState.targetID || null,
          chargeTypeID: presentationEffectState.chargeTypeID || null,
          weaponFamily: String(effectState.weaponFamily || ""),
          isOffensive: isOffensiveFx,
          start: false,
          active: effectState.miningEffect === true ? true : false,
          duration: presentationEffectState.durationMs,
          ...buildMiningSpecialFxTimingOptions(effectState, stopTimeMs, {
            includeElapsed: true,
          }),
        };
        const stopFxOptions =
          effectState.guid === "effects.MissileDeployment"
            ? buildMissileDeploymentSpecialFxOptions(baseStopFxOptions)
            : entity.nativeNpc === true && isOffensiveFx
              ? buildNpcOffensiveSpecialFxOptions(baseStopFxOptions)
              : {
                ...baseStopFxOptions,
                useCurrentVisibleStamp: true,
              };
        this.broadcastSpecialFx(
          entity.itemID,
          effectState.guid,
          stopFxOptions,
          entity,
        );
      }
    }
    notifyGenericDerivedAttributesToSession(session, effectState, stopTimeMs);
    for (const presentationEffectState of groupedTurretPresentationStates) {
      notifyGenericModuleEffectState(session, entity, presentationEffectState, false, {
        clampToVisibleStamp: options.clampToVisibleStamp === true,
        whenMs: stopTimeMs,
      });
    }
    if (dependentIndustrialModuleIDs.length > 0) {
      for (const dependentModuleID of dependentIndustrialModuleIDs) {
        this.finalizeGenericModuleDeactivation(session, dependentModuleID, {
          reason: "industrialCore",
          nowMs: stopTimeMs,
          suppressCompressionSlimBroadcast: true,
        });
      }
    }
    const compressionSlimChanged =
      refreshShipCompressionFacilityState(entity) ||
      dependentIndustrialModuleIDs.length > 0;
    if (
      compressionSlimChanged &&
      options.suppressCompressionSlimBroadcast !== true
    ) {
      this.broadcastSlimItemChanges([entity]);
    }

    return {
      success: true,
      data: { entity, effectState, stoppedAtMs: stopTimeMs },
    };
  }

  deactivateGenericModule(session, moduleID, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const normalizedModuleID = toInt(moduleID, 0);
    if (
      !entity ||
      normalizedModuleID <= 0 ||
      !(entity.activeModuleEffects instanceof Map)
    ) {
      return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
    }

    const effectState = entity.activeModuleEffects.get(normalizedModuleID) || null;
    if (!effectState) {
      return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
    }

    const now = this.getCurrentSimTimeMs();
    const reason = String(options.reason || "manual");
    const cycleBoundaryMs = getEffectCycleBoundaryMs(effectState, now);
    const shouldDefer = options.deferUntilCycle !== false && reason === "manual";

    if (reason === "manual" && effectState.miningEffect === true) {
      const durationMs = Math.max(
        1,
        toFiniteNumber(effectState.durationMs, 1000),
      );
      const elapsedMs = Math.min(
        durationMs,
        Math.max(
          0,
          now - toFiniteNumber(effectState.startedAtMs, now),
        ),
      );
      const efficiency = elapsedMs / durationMs;
      let partialMiningCycleResult = null;

      if (config.miningEnabled === true && efficiency > 0) {
        try {
          const miningRuntime = require(path.join(
            __dirname,
            "../services/mining/miningRuntime",
          ));
          if (
            miningRuntime &&
            typeof miningRuntime.executeMiningCycle === "function"
          ) {
            partialMiningCycleResult = miningRuntime.executeMiningCycle(
              this,
              entity,
              effectState,
              now,
              {
                efficiency,
                partialCycle: true,
              },
            );
          }
        } catch (error) {
          log.warn(
            `[SpaceRuntime] Partial mining cycle failed for entity=${toInt(entity.itemID, 0)} ` +
              `module=${normalizedModuleID}: ${error.message}`,
          );
        }
      }

      const moduleStillActive =
        entity.activeModuleEffects instanceof Map &&
        entity.activeModuleEffects.has(normalizedModuleID);
      const finalizeResult = moduleStillActive
        ? this.finalizeGenericModuleDeactivation(
            session,
            normalizedModuleID,
            {
              reason,
              nowMs: now,
            },
          )
        : {
            success: true,
            data: {
              entity,
              effectState,
              stoppedAtMs: now,
            },
          };
      if (finalizeResult.success && finalizeResult.data) {
        finalizeResult.data.partialMiningCycle = {
          efficiency,
          elapsedMs,
          durationMs,
          result: partialMiningCycleResult,
        };
      }
      return finalizeResult;
    }

    if (effectState.deactivateAtMs > 0 && effectState.deactivateAtMs > now) {
      return {
        success: true,
        data: { entity, effectState, pending: true, deactivateAtMs: effectState.deactivateAtMs },
      };
    }

    if (shouldDefer && cycleBoundaryMs > now + 1) {
      effectState.deactivationRequestedAtMs = now;
      effectState.deactivateAtMs = cycleBoundaryMs;
      effectState.stopReason = reason;
      return {
        success: true,
        data: { entity, effectState, pending: true, deactivateAtMs: cycleBoundaryMs },
      };
    }

    return this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
      reason,
      nowMs: cycleBoundaryMs > 0 ? cycleBoundaryMs : now,
    });
  }

  deactivateAllActiveModules(session, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (!entity) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const activeEffectStates =
      entity.activeModuleEffects instanceof Map
        ? [...entity.activeModuleEffects.values()]
        : [];
    if (activeEffectStates.length === 0) {
      return {
        success: true,
        data: {
          stoppedModuleIDs: [],
          errors: [],
        },
      };
    }

    const nowMs = Math.max(
      0,
      toFiniteNumber(options.nowMs, this.getCurrentSimTimeMs()),
    );
    const reason = String(options.reason || "sessionTransition");
    const clampToVisibleStamp = options.clampToVisibleStamp === true;
    const activeStatesByModuleID = new Map(
      activeEffectStates
        .map((effectState) => [toInt(effectState && effectState.moduleID, 0), effectState])
        .filter(([moduleID]) => moduleID > 0),
    );
    const sortedModuleIDs = [...activeStatesByModuleID.keys()].sort(
      (left, right) => left - right,
    );
    const stoppedModuleIDs = [];
    const errors = [];

    for (const moduleID of sortedModuleIDs) {
      if (
        !(entity.activeModuleEffects instanceof Map) ||
        !entity.activeModuleEffects.has(moduleID)
      ) {
        continue;
      }

      const effectState = activeStatesByModuleID.get(moduleID) || null;
      const effectName = String(effectState && effectState.effectName || "");
      const isPropulsionEffect =
        effectName === PROPULSION_EFFECT_AFTERBURNER ||
        effectName === PROPULSION_EFFECT_MICROWARPDRIVE;
      const result = isPropulsionEffect
        ? this.finalizePropulsionModuleDeactivation(session, moduleID, {
            reason,
            nowMs,
            clampToVisibleStamp,
          })
        : this.finalizeGenericModuleDeactivation(session, moduleID, {
            reason,
            nowMs,
            clampToVisibleStamp,
          });

      if (result && result.success) {
        stoppedModuleIDs.push(moduleID);
        continue;
      }

      errors.push({
        moduleID,
        errorMsg: result && result.errorMsg ? result.errorMsg : "DEACTIVATION_FAILED",
      });
    }

    return {
      success: errors.length === 0,
      errorMsg: errors.length > 0 ? "ACTIVE_MODULE_DEACTIVATION_FAILED" : null,
      data: {
        stoppedModuleIDs,
        errors,
      },
    };
  }

  spawnDynamicEntity(entity, options = {}) {
    if (!entity || !entity.itemID) {
      return {
        success: false,
        errorMsg: "INVALID_DYNAMIC_ENTITY",
      };
    }
    if (this.dynamicEntities.has(entity.itemID)) {
      return {
        success: false,
        errorMsg: "DYNAMIC_ENTITY_ALREADY_EXISTS",
      };
    }

    entity.systemID = this.systemID;
    entity.session = entity.session || null;
    this.reconcileEntityPublicGrid(entity);
    entity.departureBubbleID = null;
    entity.departureBubbleVisibleUntilMs = 0;
    ensureEntityTargetingState(entity);
    this.dynamicEntities.set(entity.itemID, entity);
    if (entity.kind === "drone") {
      this.droneEntityIDs.add(entity.itemID);
    }
    if (entity.kind === "fighter") {
      this.fighterEntityIDs.add(entity.itemID);
    }
    this.reconcileEntityBubble(entity);
    this.publicGridCompositionDirty = true;
    this.ensurePublicGridComposition();
    persistDynamicEntity(entity);

    if (options.broadcast !== false) {
      const broadcastOptions =
        options.broadcastOptions && typeof options.broadcastOptions === "object"
          ? { ...options.broadcastOptions }
          : {};
      const deferUntilVisibilitySync =
        broadcastOptions.deferUntilVisibilitySync === true;
      entity.deferUntilInitialVisibilitySync = deferUntilVisibilitySync;
      if (broadcastOptions.freshAcquire !== false) {
        broadcastOptions.freshAcquire = true;
      }
      delete broadcastOptions.deferUntilVisibilitySync;
      if (!deferUntilVisibilitySync) {
        this.broadcastAddBalls(
          [entity],
          options.excludedSession || null,
          broadcastOptions,
        );
      }
    }

    return {
      success: true,
      data: {
        entity,
      },
    };
  }

  launchMissile(attackerEntity, targetID, weaponSnapshot, options = {}) {
    if (!attackerEntity || !weaponSnapshot) {
      logMissileDebug("missile.launch.failed", {
        sceneSystemID: this.systemID,
        reason: "missing-input",
        attacker: summarizeRuntimeEntityForMissileDebug(attackerEntity),
        targetID: toInt(targetID, 0),
      });
      return {
        success: false,
        errorMsg: "MISSILE_SPAWN_FAILED",
      };
    }

    const targetEntity = this.getEntityByID(targetID);
    if (!targetEntity || !hasDamageableHealth(targetEntity)) {
      logMissileDebug("missile.launch.failed", {
        sceneSystemID: this.systemID,
        reason: "target-not-found",
        attacker: summarizeRuntimeEntityForMissileDebug(attackerEntity),
        target: summarizeRuntimeEntityForMissileDebug(targetEntity),
        targetID: toInt(targetID, 0),
      });
      return {
        success: false,
        errorMsg: "TARGET_NOT_FOUND",
      };
    }

    if (
      options.skipRangeCheck !== true &&
      getEntitySurfaceDistance(attackerEntity, targetEntity) >
        estimateMissileEffectiveRange(weaponSnapshot) + 1
    ) {
      logMissileDebug("missile.launch.failed", {
        sceneSystemID: this.systemID,
        reason: "target-out-of-range",
        attacker: summarizeRuntimeEntityForMissileDebug(attackerEntity),
        target: summarizeRuntimeEntityForMissileDebug(targetEntity),
        targetID: toInt(targetID, 0),
        moduleItem: summarizeMissileInventoryItemForDebug(options.moduleItem),
        chargeItem: summarizeMissileInventoryItemForDebug(options.chargeItem),
        rangeContext: buildMissileLaunchRangeDebugContext(
          attackerEntity,
          targetEntity,
          weaponSnapshot,
          options.moduleItem,
          options.chargeItem,
        ),
      });
      return {
        success: false,
        errorMsg: "TARGET_OUT_OF_RANGE",
      };
    }

    logMissileDebug("missile.launch.request", {
      sceneSystemID: this.systemID,
      nowMs: roundNumber(
        toFiniteNumber(options.launchTimeMs, this.getCurrentSimTimeMs()),
        3,
      ),
      attacker: summarizeRuntimeEntityForMissileDebug(attackerEntity),
      target: summarizeRuntimeEntityForMissileDebug(targetEntity),
      targetID: toInt(targetID, 0),
      moduleItem: summarizeMissileInventoryItemForDebug(options.moduleItem),
      chargeItem: summarizeMissileInventoryItemForDebug(options.chargeItem),
      chargeTuple: buildMissileChargeTupleDebugContext(
        attackerEntity,
        options.moduleItem,
        options.chargeItem,
      ),
      weaponSnapshot: summarizeMissileWeaponSnapshotForDebug(weaponSnapshot),
      rangeContext: buildMissileLaunchRangeDebugContext(
        attackerEntity,
        targetEntity,
        weaponSnapshot,
        options.moduleItem,
        options.chargeItem,
      ),
      options: normalizeTraceValue(options),
    });

    const missileEntity = buildMissileDynamicEntity(
      attackerEntity,
      targetEntity,
      weaponSnapshot,
      toFiniteNumber(options.launchTimeMs, this.getCurrentSimTimeMs()),
      options,
    );
    if (!missileEntity) {
      logMissileDebug("missile.launch.failed", {
        sceneSystemID: this.systemID,
        reason: "entity-build-failed",
        attacker: summarizeRuntimeEntityForMissileDebug(attackerEntity),
        target: summarizeRuntimeEntityForMissileDebug(targetEntity),
        targetID: toInt(targetID, 0),
      });
      return {
        success: false,
        errorMsg: "MISSILE_SPAWN_FAILED",
      };
    }

    const spawnResult = this.spawnDynamicEntity(missileEntity, {
      broadcast: options.broadcast,
      excludedSession: options.excludedSession || null,
      broadcastOptions:
        options.broadcastOptions && typeof options.broadcastOptions === "object"
          ? { ...options.broadcastOptions }
          : null,
    });
    if (!spawnResult.success) {
      logMissileDebug("missile.launch.failed", {
        sceneSystemID: this.systemID,
        reason: "spawn-failed",
        attacker: summarizeRuntimeEntityForMissileDebug(attackerEntity),
        target: summarizeRuntimeEntityForMissileDebug(targetEntity),
        missile: summarizeMissileEntity(missileEntity),
        spawnResult: normalizeTraceValue(spawnResult),
      });
      return spawnResult;
    }

    const deferredInitialOwnerAcquire =
      options.broadcast !== false &&
      options.broadcastOptions &&
      typeof options.broadcastOptions === "object" &&
      options.broadcastOptions.deferUntilVisibilitySync === true;
    if (
      deferredInitialOwnerAcquire &&
      this.hasActiveTickDestinyPresentationBatch()
    ) {
      const ownerSession = getOwningSessionForEntity(this, attackerEntity);
      if (ownerSession && isReadyForDestiny(ownerSession)) {
        this.acquireDynamicEntitiesForSession(
          ownerSession,
          [missileEntity],
          buildDeferredOwnerMissileAcquireOptions(this, ownerSession),
        );
      }
    }

    logMissileDebug("missile.launch.spawned", {
      sceneSystemID: this.systemID,
      nowMs: roundNumber(this.getCurrentSimTimeMs(), 3),
      deferredInitialOwnerAcquire,
      hasActiveTickDestinyPresentationBatch:
        this.hasActiveTickDestinyPresentationBatch(),
      missile: summarizeMissileEntity(missileEntity),
      attacker: summarizeRuntimeEntityForMissileDebug(attackerEntity),
      target: summarizeRuntimeEntityForMissileDebug(targetEntity),
      moduleItem: summarizeMissileInventoryItemForDebug(options.moduleItem),
      chargeItem: summarizeMissileInventoryItemForDebug(options.chargeItem),
      rangeContext: buildMissileLaunchRangeDebugContext(
        attackerEntity,
        targetEntity,
        weaponSnapshot,
        options.moduleItem,
        options.chargeItem,
      ),
    });

    return {
      success: true,
      data: {
        entity: missileEntity,
        targetEntity,
      },
    };
  }

  unregisterDynamicEntity(entity, options = {}) {
    if (!entity) {
      return null;
    }

    const visibilityEntity =
      options.broadcast !== false
        ? {
            ...entity,
            publicGridKey: this.getPublicGridKeyForEntity(entity),
            publicGridClusterKey: this.getPublicGridClusterKeyForEntity(entity),
          }
        : null;

    this.clearAllTargetingForEntity(entity, {
      notifySelf: entity.session ? isReadyForDestiny(entity.session) : false,
      notifyTarget: true,
      reason:
        toInt(options && options.terminalDestructionEffectID, 0) > 0
          ? TARGET_LOSS_REASON_EXPLODING
          : TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
    });
    persistDynamicEntity(entity);
    this.removeEntityFromBubble(entity);
    entity.publicGridKey = null;
    entity.publicGridClusterKey = null;
    entity.departureBubbleID = null;
    entity.departureBubbleVisibleUntilMs = 0;
    this.dynamicEntities.delete(entity.itemID);
    if (entity.kind === "drone") {
      this.droneEntityIDs.delete(entity.itemID);
    }
    if (entity.kind === "fighter") {
      this.fighterEntityIDs.delete(entity.itemID);
    }
    this.publicGridCompositionDirty = true;
    this.ensurePublicGridComposition();
    if (options.broadcast !== false) {
      this.broadcastRemoveBall(entity.itemID, options.excludedSession || null, {
        terminalDestructionEffectID: options.terminalDestructionEffectID,
        visibilityEntity,
        clampToVisibleStamp: options.clampToVisibleStamp === true,
        nowMs: options.nowMs,
        stampOverride: options.stampOverride,
        resolveSessionStamp: options.resolveSessionStamp,
        forceVisibleSessions: options.forceVisibleSessions,
      });
    }
    return entity;
  }

  removeDynamicEntity(entityID, options = {}) {
    const entity = this.dynamicEntities.get(Number(entityID)) || null;
    if (!entity) {
      return {
        success: false,
        errorMsg: "DYNAMIC_ENTITY_NOT_FOUND",
      };
    }
    if (entity.session && options.allowSessionOwned !== true) {
      return {
        success: false,
        errorMsg: "DYNAMIC_ENTITY_SESSION_OWNED",
      };
    }

    this.unregisterDynamicEntity(entity, options);
    return {
      success: true,
      data: {
        entityID: entity.itemID,
      },
    };
  }

  destroyInventoryBackedDynamicEntity(entityID, options = {}) {
    const entity = this.dynamicEntities.get(Number(entityID)) || null;
    if (!isInventoryBackedDynamicEntity(entity)) {
      return {
        success: false,
        errorMsg: "DYNAMIC_ENTITY_NOT_FOUND",
      };
    }

    this.unregisterDynamicEntity(entity, options);
    const removeResult = removeInventoryItem(entity.itemID, {
      removeContents: options.removeContents !== false,
    });
    if (!removeResult.success) {
      return removeResult;
    }

    return {
      success: true,
      data: {
        entityID: entity.itemID,
        changes: removeResult.data && removeResult.data.changes,
      },
    };
  }

  destroyExpiredInventoryBackedEntities(now = this.getCurrentSimTimeMs()) {
    const numericNow = toFiniteNumber(now, this.getCurrentSimTimeMs());
    const expiredEntities = [...this.dynamicEntities.values()]
      .filter((entity) =>
        (isInventoryBackedDynamicEntity(entity) || isNativeNpcWreckDynamicEntity(entity)) &&
        toFiniteNumber(entity.expiresAtMs, 0) > 0 &&
        toFiniteNumber(entity.expiresAtMs, 0) <= numericNow,
      )
      .map((entity) => ({
        entityID: entity.itemID,
        nativeNpcWreck: entity.nativeNpcWreck === true,
      }));

    const destroyedEntityIDs = [];
    for (const expiredEntity of expiredEntities) {
      let destroyResult = null;
      if (expiredEntity.nativeNpcWreck === true) {
        const {
          destroyNativeWreck,
        } = require(path.join(__dirname, "./npc/nativeNpcWreckService"));
        destroyResult = destroyNativeWreck(expiredEntity.entityID, {
          systemID: this.systemID,
        });
      } else {
        destroyResult = this.destroyInventoryBackedDynamicEntity(expiredEntity.entityID);
      }
      if (destroyResult.success) {
        destroyedEntityIDs.push(expiredEntity.entityID);
      }
    }

    return destroyedEntityIDs;
  }

  sendSlimItemChangesToSession(session, entities) {
    if (
      !session ||
      !isReadyForDestiny(session) ||
      !Array.isArray(entities) ||
      entities.length === 0
    ) {
      return;
    }

    const refreshedEntities = refreshEntitiesForSlimPayload(entities);
    const visibleEntities = refreshedEntities.filter((entity) => (
      entity && canSessionReceiveEntityDependentDestinyUpdate(this, session, entity)
    ));
    const skippedEntities = refreshedEntities.filter((entity) => (
      entity && !canSessionReceiveEntityDependentDestinyUpdate(this, session, entity)
    ));
    for (const skippedEntity of skippedEntities) {
      recordDependentNotificationSkip(
        this,
        session,
        "sendSlimItemChangesToSession",
        skippedEntity,
      );
    }
    const stamp = this.getNextDestinyStamp();
    const updates = visibleEntities
      .map((entity) => ({
        stamp,
        payload: destiny.buildOnSlimItemChangePayload(
          entity.itemID,
          destiny.buildSlimItemObject(entity),
        ),
      }));
    if (updates.length === 0) {
      return;
    }

    this.sendDestinyUpdates(session, updates, false, {
      destinyAuthorityContract: DESTINY_CONTRACTS.COMBAT_NONCRITICAL,
    });
  }

  sendSpecialFxToSession(session, shipID, guid, options = {}, visibilityEntity = null) {
    if (!session || !isReadyForDestiny(session)) {
      return {
        delivered: false,
        stamp: null,
      };
    }
    if (visibilityEntity) {
      const canSeeVisibilityEntity =
        isSessionViewingOwnVisibilityEntity(session, visibilityEntity) ||
        this.canSessionSeeDynamicEntity(session, visibilityEntity);
      const hasMaterializedVisibilityEntity =
        canSessionReceiveEntityDependentDestinyUpdate(
          this,
          session,
          visibilityEntity,
        );
      if (!hasMaterializedVisibilityEntity) {
        if (canSeeVisibilityEntity) {
          recordDependentNotificationSkip(
            this,
            session,
            "sendSpecialFxToSession",
            visibilityEntity,
          );
        }
        return {
          delivered: false,
          stamp: null,
        };
      }
    }

    const stampOverride =
      options && Object.prototype.hasOwnProperty.call(options, "stampOverride")
        ? options.stampOverride
        : null;
    const minimumLeadFromCurrentHistory = clamp(
      toInt(options && options.minimumLeadFromCurrentHistory, 0),
      0,
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    );
    const maximumLeadFromCurrentHistory =
      options &&
      Object.prototype.hasOwnProperty.call(
        options,
        "maximumLeadFromCurrentHistory",
      )
        ? clamp(
          toInt(
            options.maximumLeadFromCurrentHistory,
            minimumLeadFromCurrentHistory,
          ),
          minimumLeadFromCurrentHistory,
          MICHELLE_HELD_FUTURE_DESTINY_LEAD,
        )
        : null;
    const avoidCurrentHistoryInsertion =
      options && options.avoidCurrentHistoryInsertion === true;
    const historyLeadUsesImmediateSessionStamp =
      options && options.historyLeadUsesImmediateSessionStamp === true;
    const historyLeadUsesCurrentSessionStamp =
      options && options.historyLeadUsesCurrentSessionStamp === true;
    const historyLeadUsesPresentedSessionStamp =
      options && options.historyLeadUsesPresentedSessionStamp === true;
    const historyLeadPresentedMaximumFutureLead =
      options &&
      Object.prototype.hasOwnProperty.call(
        options,
        "historyLeadPresentedMaximumFutureLead",
      )
        ? clamp(
            toInt(
              options.historyLeadPresentedMaximumFutureLead,
              MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
            ),
            0,
            PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
          )
        : null;
    const rawOptions =
      options && typeof options === "object"
        ? { ...options }
        : {};
    delete rawOptions.stampOverride;
    delete rawOptions.minimumLeadFromCurrentHistory;
    const {
      resolvedOptions,
      payloads,
    } = buildSpecialFxPayloadsForEntity(shipID, guid, rawOptions, visibilityEntity);
    if (payloads.length === 0) {
      return {
        delivered: false,
        stamp: null,
      };
    }
    const destinyAuthorityContract =
      typeof rawOptions.destinyAuthorityContract === "string"
        ? rawOptions.destinyAuthorityContract
        : DESTINY_CONTRACTS.COMBAT_NONCRITICAL;
    const fallbackStamp = resolvedOptions.useCurrentStamp
      ? this.getCurrentDestinyStamp()
      : this.getNextDestinyStamp();
    const baseStamp =
      stampOverride === undefined || stampOverride === null
        ? fallbackStamp
        : toInt(stampOverride, fallbackStamp);
    const useImmediateVisibleStamp =
      resolvedOptions.useImmediateClientVisibleStamp === true &&
      sessionMatchesIdentity(session, resolvedOptions.resultSession);
    const useCurrentVisibleStamp =
      resolvedOptions.useCurrentVisibleStamp === true;
    const useLastClientVisibleStamp =
      resolvedOptions.useLastClientVisibleStamp === true;
    const stamp = useImmediateVisibleStamp
      ? this.getImmediateDestinyStampForSession(session, baseStamp)
      : useCurrentVisibleStamp
        ? this.getCurrentVisibleSessionDestinyStamp(session)
        : useLastClientVisibleStamp
          ? this.getCurrentVisibleSessionDestinyStamp(session)
          : baseStamp;

    this.sendDestinyUpdates(session, payloads.map((payload) => ({
      stamp,
      payload,
    })), false, {
      translateStamps:
        useImmediateVisibleStamp ||
        useCurrentVisibleStamp ||
        useLastClientVisibleStamp
          ? false
          : undefined,
      minimumLeadFromCurrentHistory:
        minimumLeadFromCurrentHistory > 0
          ? minimumLeadFromCurrentHistory
          : undefined,
      maximumLeadFromCurrentHistory:
        maximumLeadFromCurrentHistory !== null
          ? maximumLeadFromCurrentHistory
          : undefined,
      avoidCurrentHistoryInsertion:
        avoidCurrentHistoryInsertion || undefined,
      historyLeadUsesImmediateSessionStamp:
        historyLeadUsesImmediateSessionStamp || undefined,
      historyLeadUsesCurrentSessionStamp:
        historyLeadUsesCurrentSessionStamp || undefined,
      historyLeadUsesPresentedSessionStamp:
        historyLeadUsesPresentedSessionStamp || undefined,
      historyLeadPresentedMaximumFutureLead:
        historyLeadPresentedMaximumFutureLead !== null
          ? historyLeadPresentedMaximumFutureLead
          : undefined,
      destinyAuthorityAllowPostHeldFuture:
        rawOptions.destinyAuthorityAllowPostHeldFuture === true || undefined,
      destinyAuthorityContract,
    });

    return {
      delivered: true,
      stamp,
    };
  }

  broadcastSpecialFx(shipID, guid, options = {}, visibilityEntity = null) {
    const stampOverride =
      options && Object.prototype.hasOwnProperty.call(options, "stampOverride")
        ? options.stampOverride
        : null;
    const minimumLeadFromCurrentHistory = clamp(
      toInt(options && options.minimumLeadFromCurrentHistory, 0),
      0,
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    );
    const maximumLeadFromCurrentHistory =
      options &&
      Object.prototype.hasOwnProperty.call(
        options,
        "maximumLeadFromCurrentHistory",
      )
        ? clamp(
          toInt(
            options.maximumLeadFromCurrentHistory,
            minimumLeadFromCurrentHistory,
          ),
          minimumLeadFromCurrentHistory,
          MICHELLE_HELD_FUTURE_DESTINY_LEAD,
        )
        : null;
    const avoidCurrentHistoryInsertion =
      options && options.avoidCurrentHistoryInsertion === true;
    const historyLeadUsesImmediateSessionStamp =
      options && options.historyLeadUsesImmediateSessionStamp === true;
    const historyLeadUsesCurrentSessionStamp =
      options && options.historyLeadUsesCurrentSessionStamp === true;
    const historyLeadUsesPresentedSessionStamp =
      options && options.historyLeadUsesPresentedSessionStamp === true;
    const historyLeadPresentedMaximumFutureLead =
      options &&
      Object.prototype.hasOwnProperty.call(
        options,
        "historyLeadPresentedMaximumFutureLead",
      )
        ? clamp(
            toInt(
              options.historyLeadPresentedMaximumFutureLead,
              MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
            ),
            0,
            PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
          )
        : null;
    const rawOptions =
      options && typeof options === "object"
        ? { ...options }
        : {};
    delete rawOptions.stampOverride;
    delete rawOptions.minimumLeadFromCurrentHistory;
    const {
      resolvedOptions,
      payloads,
    } = buildSpecialFxPayloadsForEntity(shipID, guid, rawOptions, visibilityEntity);
    if (payloads.length === 0) {
      return {
        stamp: null,
        deliveredCount: 0,
      };
    }
    const destinyAuthorityContract =
      typeof rawOptions.destinyAuthorityContract === "string"
        ? rawOptions.destinyAuthorityContract
        : DESTINY_CONTRACTS.COMBAT_NONCRITICAL;
    // Use current stamp when requested so Michelle dispatches immediately rather
    // than queuing for a future tick. Critical under TiDi where the next tick is
    // delayed and a session change can tear down the ballpark before it arrives.
    const fallbackStamp = resolvedOptions.useCurrentStamp
      ? this.getCurrentDestinyStamp()
      : this.getNextDestinyStamp();
    const baseStamp =
      stampOverride === undefined || stampOverride === null
        ? fallbackStamp
        : toInt(stampOverride, fallbackStamp);
    let deliveredCount = 0;
    let resultStamp = null;

    for (const session of this.sessions.values()) {
      if (!isReadyForDestiny(session)) {
        continue;
      }
      if (
        rawOptions &&
        Object.prototype.hasOwnProperty.call(rawOptions, "excludedSession") &&
        sessionMatchesIdentity(session, rawOptions.excludedSession)
      ) {
        continue;
      }
      if (visibilityEntity) {
        const canSeeVisibilityEntity =
          isSessionViewingOwnVisibilityEntity(session, visibilityEntity) ||
          this.canSessionSeeDynamicEntity(session, visibilityEntity);
        const hasMaterializedVisibilityEntity =
          canSessionReceiveEntityDependentDestinyUpdate(
            this,
            session,
            visibilityEntity,
          );
        if (!hasMaterializedVisibilityEntity) {
          if (canSeeVisibilityEntity) {
            recordDependentNotificationSkip(
              this,
              session,
              "broadcastSpecialFx",
              visibilityEntity,
            );
          }
          continue;
        }
      }

      const useImmediateVisibleStamp =
        resolvedOptions.useImmediateClientVisibleStamp === true &&
        sessionMatchesIdentity(session, resolvedOptions.resultSession);
      const useCurrentVisibleStamp =
        resolvedOptions.useCurrentVisibleStamp === true;
      const useLastClientVisibleStamp =
        resolvedOptions.useLastClientVisibleStamp === true;
      const stamp = useImmediateVisibleStamp
        ? this.getImmediateDestinyStampForSession(session, baseStamp)
        : useCurrentVisibleStamp
          ? this.getCurrentVisibleSessionDestinyStamp(session)
        : useLastClientVisibleStamp
          ? this.getCurrentVisibleSessionDestinyStamp(session)
          : baseStamp;
      this.sendDestinyUpdates(session, payloads.map((payload) => ({
        stamp,
        payload,
      })), false, {
        translateStamps:
          useImmediateVisibleStamp ||
          useCurrentVisibleStamp ||
          useLastClientVisibleStamp
            ? false
            : undefined,
        minimumLeadFromCurrentHistory:
          minimumLeadFromCurrentHistory > 0
            ? minimumLeadFromCurrentHistory
            : undefined,
        maximumLeadFromCurrentHistory:
          maximumLeadFromCurrentHistory !== null
            ? maximumLeadFromCurrentHistory
            : undefined,
        avoidCurrentHistoryInsertion:
          avoidCurrentHistoryInsertion || undefined,
        historyLeadUsesImmediateSessionStamp:
          historyLeadUsesImmediateSessionStamp || undefined,
        historyLeadUsesCurrentSessionStamp:
          historyLeadUsesCurrentSessionStamp || undefined,
        historyLeadUsesPresentedSessionStamp:
          historyLeadUsesPresentedSessionStamp || undefined,
        historyLeadPresentedMaximumFutureLead:
          historyLeadPresentedMaximumFutureLead !== null
            ? historyLeadPresentedMaximumFutureLead
            : undefined,
        destinyAuthorityAllowPostHeldFuture:
          rawOptions.destinyAuthorityAllowPostHeldFuture === true || undefined,
        destinyAuthorityContract,
      });
      deliveredCount += 1;
      if (
        resultStamp === null &&
        (
          resolvedOptions.resultSession === undefined ||
          resolvedOptions.resultSession === null ||
          sessionMatchesIdentity(session, resolvedOptions.resultSession)
        )
      ) {
        resultStamp = stamp;
      }
    }

    return {
      stamp: resultStamp === null ? baseStamp : resultStamp,
      deliveredCount,
    };
  }

  broadcastSlimItemChanges(entities, excludedSession = null) {
    if (!Array.isArray(entities) || entities.length === 0) {
      return;
    }

    for (const session of this.sessions.values()) {
      if (
        sessionMatchesIdentity(session, excludedSession) ||
        !isReadyForDestiny(session)
      ) {
        continue;
      }
      this.sendSlimItemChangesToSession(session, entities);
    }
  }

  broadcastBallRefresh(entities, excludedSession = null) {
    if (!Array.isArray(entities) || entities.length === 0) {
      return;
    }

    const refreshedEntities = refreshEntitiesForSlimPayload(entities);
    for (const session of this.sessions.values()) {
      if (
        sessionMatchesIdentity(session, excludedSession) ||
        !isReadyForDestiny(session)
      ) {
        continue;
      }
      const visibleEntities = refreshedEntities.filter((entity) =>
        canSessionSeeAddedBallForBroadcast(this, session, entity),
      );
      if (visibleEntities.length === 0) {
        continue;
      }
      this.sendAddBallsToSession(session, visibleEntities);
    }
  }

  sendAddBallsToSession(session, entities, options = {}) {
    if (!session || !isReadyForDestiny(session) || entities.length === 0) {
      return {
        delivered: false,
        stamp: null,
      };
    }

    const rawNowMs = toFiniteNumber(
      options.nowMs,
      this.getCurrentSimTimeMs(),
    );
    const liveSessionStampedStamp =
      options.sessionStampedAddBalls === true
        ? toInt(
          options.stampOverride,
          this.getCurrentPresentedSessionDestinyStamp(session, rawNowMs),
        ) >>> 0
        : 0;
    const presentation =
      options.sessionStampedAddBalls === true && liveSessionStampedStamp > 0
        ? this.buildSessionStampedAddBallsUpdatesForSession(
          session,
          entities,
          liveSessionStampedStamp,
          {
            nowMs: rawNowMs,
          },
        )
        : this.buildAddBallsUpdatesForSession(
          session,
          entities,
          options,
        );
    if (
      options.sessionStampedAddBalls === true &&
      presentation &&
      presentation.sendOptions &&
      typeof presentation.sendOptions === "object"
    ) {
      presentation.sendOptions.destinyAuthorityContract =
        DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME;
    }
    if (presentation.updates.length <= 0) {
      return {
        delivered: false,
        stamp: null,
      };
    }

    const firstPresentationStamp =
      presentation.updates.length > 0 &&
      presentation.updates[0] &&
      presentation.updates[0].stamp !== undefined &&
      presentation.updates[0].stamp !== null
        ? (toInt(presentation.updates[0].stamp, 0) >>> 0)
        : null;
    let deliveryStamp = firstPresentationStamp;
    if (options.freshAcquire === true && session._space) {
      const addBallsUpdate = presentation.updates.find((update) => (
        update &&
        Array.isArray(update.payload) &&
        update.payload[0] === "AddBalls2"
      ));
      if (addBallsUpdate) {
        const preparedAddBallsUpdate = this.prepareDestinyUpdateForSession(
          session,
          addBallsUpdate,
          rawNowMs,
          presentation.sendOptions,
        );
        deliveryStamp = toInt(
          preparedAddBallsUpdate && preparedAddBallsUpdate.stamp,
          toInt(addBallsUpdate && addBallsUpdate.stamp, 0),
        ) >>> 0;
        const protectedUntilStamp =
          getFreshVisibilityProtectionReleaseStamp(deliveryStamp);
        const releaseStampByID =
          session._space.freshlyVisibleDynamicEntityReleaseStampByID instanceof Map
            ? session._space.freshlyVisibleDynamicEntityReleaseStampByID
            : new Map();
        for (const entity of entities) {
          const entityID = toInt(entity && entity.itemID, 0);
          if (entityID > 0 && entityID !== toInt(session._space.shipID, 0)) {
            releaseStampByID.set(entityID, protectedUntilStamp);
          }
        }
        session._space.freshlyVisibleDynamicEntityReleaseStampByID =
          releaseStampByID;
      }
    }

    if (
      this.hasActiveTickDestinyPresentationBatch() &&
      options.bypassTickPresentationBatch !== true
    ) {
      this.queueTickDestinyPresentationUpdates(session, presentation.updates, {
        sendOptions: presentation.sendOptions,
      });
      return {
        delivered: true,
        stamp: deliveryStamp,
      };
    }

    const emittedStamp = this.sendDestinyUpdates(
      session,
      presentation.updates,
      false,
      presentation.sendOptions,
    );
    if (emittedStamp > 0) {
      deliveryStamp = toInt(emittedStamp, deliveryStamp) >>> 0;
    }
    return {
      delivered: true,
      stamp: deliveryStamp,
    };
  }

  buildDestinyPresentationForSession(
    session,
    entities,
    sessionStamp,
    options = {},
  ) {
    const rawSimTimeMs = toFiniteNumber(
      options.nowMs,
      this.getCurrentSimTimeMs(),
    );
    if (
      !session ||
      !isReadyForDestiny(session) ||
      !Array.isArray(entities) ||
      entities.length === 0
    ) {
      return {
        entities,
        rawSimTimeMs,
        sessionSimTimeMs: this.getCurrentSessionSimTimeMs(session, rawSimTimeMs),
      };
    }

    const currentSessionSimTimeMs = this.getCurrentSessionSimTimeMs(
      session,
      rawSimTimeMs,
    );
    const normalizedSessionStamp = toInt(
      sessionStamp,
      this.translateDestinyStampForSession(
        session,
        this.getCurrentDestinyStamp(rawSimTimeMs),
      ),
    ) >>> 0;
    const presentationSessionSimTimeMs = Math.max(
      currentSessionSimTimeMs,
      normalizedSessionStamp * 1000,
    );
    const presentationDeltaMs = Math.max(
      0,
      presentationSessionSimTimeMs - currentSessionSimTimeMs,
    );
    if (presentationDeltaMs <= 0.000001) {
      return {
        entities,
        rawSimTimeMs,
        sessionSimTimeMs: presentationSessionSimTimeMs,
      };
    }

    const presentationRawSimTimeMs = rawSimTimeMs + presentationDeltaMs;
    const deltaSeconds = presentationDeltaMs / 1000;
    const projectedByID = new Map();
    const maxProjectionDepth = 2;
    const resolveProjectedEntity = (entityID, depth = 0) => {
      const normalizedEntityID = toInt(entityID, 0);
      if (normalizedEntityID <= 0) {
        return null;
      }
      if (projectedByID.has(normalizedEntityID)) {
        return projectedByID.get(normalizedEntityID);
      }

      const targetEntity = this.getEntityByID(normalizedEntityID);
      if (!targetEntity || depth > maxProjectionDepth) {
        return targetEntity;
      }

      return projectEntity(targetEntity, depth);
    };
    const projectEntity = (entity, depth = 0) => {
      if (!entity || typeof entity !== "object") {
        return entity;
      }

      const entityID = toInt(entity.itemID, 0);
      if (entityID > 0 && projectedByID.has(entityID)) {
        return projectedByID.get(entityID);
      }

      const projectedEntity = cloneDynamicEntityForDestinyPresentation(entity);
      if (entityID > 0) {
        projectedByID.set(entityID, projectedEntity);
      }

      if (!projectedEntity.sessionlessWarpIngress) {
        advanceMovement(
          projectedEntity,
          {
            getEntityByID: (targetEntityID) => resolveProjectedEntity(
              targetEntityID,
              depth + 1,
            ),
          },
          deltaSeconds,
          presentationRawSimTimeMs,
        );
      }

      return projectedEntity;
    };

    return {
      entities: entities.map((entity) => projectEntity(entity)),
      rawSimTimeMs: presentationRawSimTimeMs,
      sessionSimTimeMs: presentationSessionSimTimeMs,
    };
  }

  buildAddBallsUpdatesForSession(session, entities, options = {}) {
    if (!session || !isReadyForDestiny(session) || entities.length === 0) {
      return {
        updates: [],
        sendOptions: {
          translateStamps: false,
        },
      };
    }

    const filteredEntities = this.filterBallparkEntitiesForSession(
      session,
      entities,
    );
    if (filteredEntities.length === 0) {
      return {
        updates: [],
        sendOptions: {
          translateStamps: false,
        },
      };
    }

    const refreshedEntities = refreshEntitiesForSlimPayload(filteredEntities);
    const useFreshAcquireTimeline = options.freshAcquire === true;
    const allFreshAcquireEntitiesAreMissiles =
      refreshedEntities.length > 0 &&
      refreshedEntities.every((entity) => entity && entity.kind === "missile");
    const containsOwnerLaunchedMissiles =
      hasOwnerLaunchedMissileVisibleToSession(session, refreshedEntities);
    const containsDeferredFreshAcquireMissiles =
      useFreshAcquireTimeline &&
      refreshedEntities.some(
        (entity) => entity && entity.deferUntilInitialVisibilitySync === true,
      );
    const rawSimTimeMs = toFiniteNumber(
      options.nowMs,
      this.getCurrentSimTimeMs(),
    );
    // Fresh missile acquires stay on the authored tick; non-missile fresh
    // acquires still use Michelle's held-future window.
    const defaultFreshAcquireLead =
      containsOwnerLaunchedMissiles
        ? 0
        : allFreshAcquireEntitiesAreMissiles
          ? 0
          : MICHELLE_HELD_FUTURE_DESTINY_LEAD;
    const defaultMaximumFreshAcquireLead =
      containsOwnerLaunchedMissiles
        ? MICHELLE_HELD_FUTURE_DESTINY_LEAD
        : MICHELLE_HELD_FUTURE_DESTINY_LEAD;
    const maximumFreshAcquireLead = clamp(
      Math.max(
        toInt(
          options.maximumLeadFromCurrentHistory,
          defaultMaximumFreshAcquireLead,
        ),
        0,
      ),
      0,
      16,
    );
    const freshAcquireLead = clamp(
      toInt(
        options.minimumLeadFromCurrentHistory,
        defaultFreshAcquireLead,
      ),
      0,
      maximumFreshAcquireLead,
    );
    const defaultRawStamp = useFreshAcquireTimeline
      ? (
        (
          this.getCurrentDestinyStamp(rawSimTimeMs) +
          freshAcquireLead
        ) >>> 0
      )
      : this.getNextDestinyStamp(rawSimTimeMs);
    const currentSessionStamp = this.getCurrentSessionDestinyStamp(
      session,
      rawSimTimeMs,
    );
    const currentImmediateSessionStamp = this.getImmediateDestinyStampForSession(
      session,
      currentSessionStamp,
    );
    const authorityState = snapshotDestinyAuthorityState(session);
    const lastOwnerMissileFreshAcquireStamp = toInt(
      authorityState && authorityState.lastOwnerMissileFreshAcquireStamp,
      session &&
      session._space &&
      session._space.lastOwnerMissileFreshAcquireStamp,
      0,
    ) >>> 0;
    const lastOwnerMissileFreshAcquireAnchorStamp = toInt(
      authorityState && authorityState.lastOwnerMissileFreshAcquireAnchorStamp,
      session &&
      session._space &&
      session._space.lastOwnerMissileFreshAcquireAnchorStamp,
      0,
    ) >>> 0;
    const allowAdjacentRawOwnerFreshAcquireLaneReuse =
      !(
        containsOwnerLaunchedMissiles &&
        lastOwnerMissileFreshAcquireStamp > currentSessionStamp &&
        lastOwnerMissileFreshAcquireAnchorStamp > 0 &&
        currentSessionStamp > lastOwnerMissileFreshAcquireAnchorStamp
      );
    const currentVisibleSessionStamp = this.getCurrentVisibleDestinyStampForSession(
      session,
      currentSessionStamp,
    );
    const currentPresentedSessionStamp = this.getCurrentPresentedSessionDestinyStamp(
      session,
      rawSimTimeMs,
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    );
    const lastPilotCommandMovementStamp = toInt(
      session &&
      session._space &&
      session._space.lastPilotCommandMovementStamp,
      0,
    ) >>> 0;
    const hasRecentOwnerPilotMovementLane =
      lastPilotCommandMovementStamp > 0 &&
      lastPilotCommandMovementStamp >= currentImmediateSessionStamp &&
      lastPilotCommandMovementStamp <= currentPresentedSessionStamp;
    const defaultSessionStamp = useFreshAcquireTimeline
      ? containsOwnerLaunchedMissiles
        ? Math.max(
          this.translateDestinyStampForSession(session, defaultRawStamp),
          currentSessionStamp,
        ) >>> 0
        : this.getPendingHistorySafeSessionDestinyStamp(
          session,
          defaultRawStamp,
          rawSimTimeMs,
          freshAcquireLead,
        )
      : this.translateDestinyStampForSession(session, defaultRawStamp);
    const freshAcquireVisibleBarrierStamp = useFreshAcquireTimeline
      ? this.getCurrentVisibleDestinyStampForSession(
        session,
        this.getCurrentDestinyStamp(rawSimTimeMs),
      )
      : null;
    // CCP parity: the visible stamp equals the session stamp, which is ~1
    // tick ahead of the client's _current_time.  Adding
    // MICHELLE_HELD_FUTURE_DESTINY_LEAD (2) on top of the visible stamp
    // gives delta 3 from the client = jolt.  Subtract the echo offset so
    // that barrier + lead = client + 2 = delta 2 (safely held).
    const freshAcquireClientAnchorStamp =
      freshAcquireVisibleBarrierStamp !== null &&
      freshAcquireVisibleBarrierStamp > MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD
        ? ((freshAcquireVisibleBarrierStamp - MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD) >>> 0)
        : freshAcquireVisibleBarrierStamp;
    const minimumFreshAcquireSessionStamp =
      useFreshAcquireTimeline &&
      !containsOwnerLaunchedMissiles &&
      !allFreshAcquireEntitiesAreMissiles
        ? (
          (
            toInt(
              freshAcquireClientAnchorStamp,
              defaultSessionStamp,
            ) +
            freshAcquireLead
            ) >>> 0
        )
        : defaultSessionStamp;
    const minimumPresentedFreshAcquireSessionStamp =
      useFreshAcquireTimeline &&
      !allFreshAcquireEntitiesAreMissiles
        // Late observers can already have a trusted held-future lane from
        // their own bootstrap materialization. Keep subsequent fresh-acquire
        // AddBalls on or ahead of that presented lane so bootstrap-acquire
        // never backsteps behind `lastSentDestinyStamp`.
        ? (toInt(currentPresentedSessionStamp, 0) >>> 0)
        : 0;
    const stamp =
      options.stampOverride === undefined || options.stampOverride === null
        ? Math.max(
          defaultSessionStamp,
          minimumFreshAcquireSessionStamp,
          minimumPresentedFreshAcquireSessionStamp,
        ) >>> 0
        : (toInt(options.stampOverride, defaultSessionStamp) >>> 0);
    const latestMissileLaunchSessionStamp =
      useFreshAcquireTimeline &&
      allFreshAcquireEntitiesAreMissiles
        ? refreshedEntities.reduce((latestStamp, entity) => {
          const launchedAtMs = toFiniteNumber(
            entity && entity.launchedAtMs,
            rawSimTimeMs,
          );
          const launchStamp = this.getCurrentSessionDestinyStamp(
            session,
            launchedAtMs,
          );
          return Math.max(
            latestStamp,
            toInt(launchStamp, currentSessionStamp) >>> 0,
          ) >>> 0;
        }, 0)
        : 0;
    const useDeferredMissileLaunchSnapshots =
      useFreshAcquireTimeline &&
      allFreshAcquireEntitiesAreMissiles &&
      refreshedEntities.length > 0 &&
      refreshedEntities.every((entity) => (
        entity &&
        entity.kind === "missile" &&
        entity.deferUntilInitialVisibilitySync === true &&
        entity.launchPresentationSnapshot &&
        typeof entity.launchPresentationSnapshot === "object"
      ));
    const useLaunchStateForMissileFreshAcquire =
      useDeferredMissileLaunchSnapshots &&
      latestMissileLaunchSessionStamp > 0;
    const defaultMissileAuthoredStateStamp =
      useFreshAcquireTimeline &&
      allFreshAcquireEntitiesAreMissiles
        ? useLaunchStateForMissileFreshAcquire
          ? containsOwnerLaunchedMissiles
            ? latestMissileLaunchSessionStamp
            : Math.max(
              latestMissileLaunchSessionStamp,
              currentVisibleSessionStamp,
            ) >>> 0
          : containsOwnerLaunchedMissiles
            ? defaultSessionStamp
            : currentVisibleSessionStamp
        : stamp;
    const authoredStateStamp =
      useFreshAcquireTimeline &&
      allFreshAcquireEntitiesAreMissiles
        ? (
          options.stampOverride === undefined || options.stampOverride === null
            ? defaultMissileAuthoredStateStamp
            : (toInt(
              options.stampOverride,
              defaultMissileAuthoredStateStamp,
            ) >>> 0)
        )
        : stamp;
    const presentation =
      useDeferredMissileLaunchSnapshots
        ? {
            // Initial deferred missile acquires must serialize the authored
            // launch snapshot, not the live FOLLOW ball after server movement
            // has already advanced it for one or more ticks.
            entities: refreshedEntities.map((entity) =>
              buildMissileFreshAcquirePresentationEntity(entity)
            ),
            rawSimTimeMs,
            sessionSimTimeMs: this.getCurrentSessionSimTimeMs(
              session,
              rawSimTimeMs,
            ),
          }
        : this.buildDestinyPresentationForSession(
            session,
            refreshedEntities,
            authoredStateStamp,
            {
              nowMs: rawSimTimeMs,
            },
          );
    const presentationEntities = presentation.entities;
    const presentationRawSimTimeMs = presentation.rawSimTimeMs;
    const simFileTime = this.getCurrentSessionFileTime(
      session,
      presentationRawSimTimeMs,
    );
    const sendOptions = buildBootstrapAcquireSendOptions({
      translateStamps: false,
    });
    if (useFreshAcquireTimeline && allFreshAcquireEntitiesAreMissiles) {
      // Missile AddBalls still need the authored launch snapshot data
      // (position/velocity/slim info). Observers and launcher owners both need
      // a Michelle-safe outer lane, but the owner must anchor that safety to
      // the live session clock rather than visible/presented history or the
      // client will still hold the update and flush it on current.
      Object.assign(
        sendOptions,
        containsOwnerLaunchedMissiles
          ? buildOwnerMissileFreshAcquireSendOptions({
              // `deferUntilInitialVisibilitySync` is an observer/bootstrap
              // concern on the missile entity. The launcher owner still gets
              // the immediate fresh-acquire path, so keep adjacent-raw owner
              // lane reuse enabled only while the prior owner missile lane is
              // still in the same live owner-tick window. Once the owner's
              // session tick has advanced past that lane's anchor, Michelle has
              // already consumed the shared lane and the next acquire must
              // clear it instead of reusing the projected stamp.
              allowAdjacentRawFreshAcquireLaneReuse:
                allowAdjacentRawOwnerFreshAcquireLaneReuse,
            })
          : buildObserverCombatPresentedSendOptions(),
      );
    } else if (useFreshAcquireTimeline) {
      // Michelle explicitly holds updates that are only 1-2 ticks ahead of the
      // current lane (`eventStamp - currentTime < 3`). Fresh-acquire AddBalls
      // are smoother when we stay inside that hold window instead of jumping 3+
      // ticks ahead and forcing an immediate SynchroniseToSimulationTime()
      // rebase on materialization.
      //
      // Default to Michelle's immediate visible lane so a plain fresh acquire
      // lands at visible+2. If the owner already has a freshly presented pilot
      // movement lane, switch to the presented anchor instead so AddBalls2
      // clears that lane instead of materializing on top of it.
      sendOptions.avoidCurrentHistoryInsertion = true;
      sendOptions.preservePayloadStateStamp = false;
      sendOptions.minimumLeadFromCurrentHistory =
        MICHELLE_HELD_FUTURE_DESTINY_LEAD;
      sendOptions.maximumLeadFromCurrentHistory =
        MICHELLE_HELD_FUTURE_DESTINY_LEAD;
      sendOptions.historyLeadUsesImmediateSessionStamp =
        hasRecentOwnerPilotMovementLane ? undefined : true;
      sendOptions.historyLeadUsesPresentedSessionStamp =
        hasRecentOwnerPilotMovementLane || undefined;
      sendOptions.historyLeadPresentedMaximumFutureLead =
        hasRecentOwnerPilotMovementLane
          ? MICHELLE_HELD_FUTURE_DESTINY_LEAD
          : undefined;
      sendOptions.destinyAuthorityAllowPostHeldFuture = true;
    }
    let updates = [
      {
        stamp: authoredStateStamp,
        payload: destiny.buildAddBalls2Payload(
          authoredStateStamp,
          presentationEntities,
          simFileTime,
        ),
      },
    ];
    const primeUpdates = buildShipPrimeUpdatesForEntities(
      presentationEntities,
      authoredStateStamp,
    );
    updates.push(...primeUpdates);
    const modeUpdates = [];
    for (const entity of presentationEntities) {
      modeUpdates.push(...this.buildModeUpdates(entity, authoredStateStamp));
    }
    const bootstrapModeUpdates = resolveFreshAcquireBootstrapModeUpdates(
      presentationEntities,
      modeUpdates,
    );
    if (bootstrapModeUpdates.length > 0) {
      updates.push(...bootstrapModeUpdates);
    }
    const activeSpecialFxReplayUpdates =
      useFreshAcquireTimeline
        ? buildFreshAcquireActiveSpecialFxReplayUpdates(
          presentationEntities,
          authoredStateStamp,
          presentationRawSimTimeMs,
          {
            session,
          },
        )
        : [];
    if (activeSpecialFxReplayUpdates.length > 0) {
      updates.push(...activeSpecialFxReplayUpdates);
    }
    const containsFreshAcquireMissiles =
      presentationEntities.length > 0 &&
      presentationEntities.some((entity) => entity && entity.kind === "missile");
    if (useFreshAcquireTimeline) {
      updates = tagUpdatesFreshAcquireLifecycleGroup(updates);
    }
    if (containsFreshAcquireMissiles) {
      updates = tagUpdatesMissileLifecycleGroup(updates);
      updates = stripMissileFreshAcquireModeReplayUpdates(
        presentationEntities,
        updates,
      );
      if (containsOwnerLaunchedMissiles) {
        updates = tagUpdatesOwnerMissileLifecycleGroup(updates);
      }
    }
    if (
      useFreshAcquireTimeline &&
      containsFreshAcquireMissiles &&
      !containsOwnerLaunchedMissiles
    ) {
      const currentVisibleSessionStamp = this.getCurrentVisibleSessionDestinyStamp(
        session,
        rawSimTimeMs,
      );
      const currentPresentedSessionStamp =
        this.getCurrentPresentedSessionDestinyStamp(
          session,
          rawSimTimeMs,
          Math.max(
            MICHELLE_HELD_FUTURE_DESTINY_LEAD,
            (
              PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS +
              MICHELLE_HELD_FUTURE_DESTINY_LEAD
            ),
          ),
        );
      const currentRawDispatchStamp = this.getCurrentDestinyStamp(rawSimTimeMs);
      const authorityState = snapshotDestinyAuthorityState(session);
      const lastSentDestinyStamp = toInt(
        authorityState && authorityState.lastPresentedStamp,
        session && session._space && session._space.lastSentDestinyStamp,
        0,
      ) >>> 0;
      const lastSentDestinyRawDispatchStamp = toInt(
        authorityState && authorityState.lastRawDispatchStamp,
        session && session._space && session._space.lastSentDestinyRawDispatchStamp,
        0,
      ) >>> 0;
      const projectedObserverPresentedFloorStamp =
        lastSentDestinyStamp > 0 &&
        lastSentDestinyRawDispatchStamp > 0 &&
        currentRawDispatchStamp > lastSentDestinyRawDispatchStamp &&
        (
          currentRawDispatchStamp - lastSentDestinyRawDispatchStamp
        ) <= 1 &&
        !(
          authorityState &&
          authorityState.lastSentOnlyStaleProjectedOwnerMissileLane === true
        )
          ? projectPreviouslySentDestinyLane(
              lastSentDestinyStamp,
              lastSentDestinyRawDispatchStamp,
              currentRawDispatchStamp,
            )
          : 0;
      if (
        currentVisibleSessionStamp > 0 ||
        currentPresentedSessionStamp > 0 ||
        projectedObserverPresentedFloorStamp > 0
      ) {
        updates = clampQueuedSubwarpUpdates({
          queuedUpdates: updates,
          visibleFloorStamp: currentVisibleSessionStamp,
          presentedFloorStamp: currentPresentedSessionStamp,
          projectedFloorStamp: projectedObserverPresentedFloorStamp,
          restampPayloadState: destiny.restampPayloadState,
        });
      }
    }
    if (containsFreshAcquireMissiles) {
      logMissileDebug("missile.addballs.build", {
        rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
        rawDispatchStamp: this.getCurrentDestinyStamp(rawSimTimeMs),
        session: buildMissileSessionSnapshot(this, session, rawSimTimeMs),
        options: normalizeTraceValue(options),
        useFreshAcquireTimeline,
        allFreshAcquireEntitiesAreMissiles,
        containsOwnerLaunchedMissiles,
        containsDeferredFreshAcquireMissiles,
        useDeferredMissileLaunchSnapshots,
        useLaunchStateForMissileFreshAcquire,
        defaultFreshAcquireLead,
        maximumFreshAcquireLead,
        freshAcquireLead,
        defaultRawStamp,
        currentSessionStamp,
        currentVisibleSessionStamp,
        defaultSessionStamp,
        minimumFreshAcquireSessionStamp,
        stamp,
        authoredStateStamp,
        presentationRawSimTimeMs: roundNumber(presentationRawSimTimeMs, 3),
        sendOptions: normalizeTraceValue(sendOptions),
        missiles: presentationEntities
          .filter((entity) => entity && entity.kind === "missile")
          .map((entity) => summarizeMissileEntity(entity)),
        updates: summarizeMissileUpdatesForLog(updates),
      });
    }

    return {
      updates,
      sendOptions,
    };
  }

  buildSessionStampedAddBallsUpdatesForSession(
    session,
    entities,
    sessionStamp,
    options = {},
  ) {
    if (!session || !isReadyForDestiny(session) || entities.length === 0) {
      return {
        updates: [],
        sendOptions: {
          translateStamps: false,
        },
      };
    }

    const filteredEntities = this.filterBallparkEntitiesForSession(
      session,
      entities,
    );
    if (filteredEntities.length === 0) {
      return {
        updates: [],
        sendOptions: {
          translateStamps: false,
        },
      };
    }

    const refreshedEntities = refreshEntitiesForSlimPayload(filteredEntities);
    const stamp = toInt(sessionStamp, 0) >>> 0;
    const nowMs = toFiniteNumber(
      options.nowMs,
      this.getCurrentSimTimeMs(),
    );
    const presentation = this.buildDestinyPresentationForSession(
      session,
      refreshedEntities,
      stamp,
      {
        nowMs,
      },
    );
    const presentationEntities = presentation.entities;
    const presentationRawSimTimeMs = presentation.rawSimTimeMs;
    const simFileTime = this.getCurrentSessionFileTime(
      session,
      presentationRawSimTimeMs,
    );
    let updates = [
      {
        stamp,
        payload: destiny.buildAddBalls2Payload(
          stamp,
          presentationEntities,
          simFileTime,
        ),
      },
    ];
    const primeUpdates = buildShipPrimeUpdatesForEntities(
      presentationEntities,
      stamp,
    );
    updates.push(...primeUpdates);
    const modeUpdates = [];
    for (const entity of presentationEntities) {
      modeUpdates.push(...this.buildModeUpdates(entity, stamp));
    }
    const bootstrapModeUpdates = resolveFreshAcquireBootstrapModeUpdates(
      presentationEntities,
      modeUpdates,
    );
    if (bootstrapModeUpdates.length > 0) {
      updates.push(...bootstrapModeUpdates);
    }
    const activeSpecialFxReplayUpdates = buildFreshAcquireActiveSpecialFxReplayUpdates(
      presentationEntities,
      stamp,
      presentationRawSimTimeMs,
      {
        session,
      },
    );
    if (activeSpecialFxReplayUpdates.length > 0) {
      updates.push(...activeSpecialFxReplayUpdates);
    }
    const containsFreshAcquireMissiles =
      presentationEntities.length > 0 &&
      presentationEntities.some((entity) => entity && entity.kind === "missile");
    if (containsFreshAcquireMissiles) {
      updates = stripMissileFreshAcquireModeReplayUpdates(
        presentationEntities,
        updates,
      );
    }

    return {
      updates,
      sendOptions: {
        translateStamps: false,
      },
    };
  }

  buildDynamicVisibilityDeltaForSession(
    session,
    now = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (!session || !session._space || session._space.initialStateSent !== true) {
      return null;
    }

    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return null;
    }

    const desiredEntities = this.getVisibleDynamicEntitiesForSession(session, now, {
      bypassPilotWarpQuietWindow: options.bypassPilotWarpQuietWindow === true,
      visibilityClusterKeyOverride:
        options.visibilityClusterKeyOverride === undefined ||
        options.visibilityClusterKeyOverride === null
          ? null
          : options.visibilityClusterKeyOverride,
    }).filter(
      (entity) => entity.itemID !== egoEntity.itemID,
    );
    const desiredIDs = new Set(desiredEntities.map((entity) => entity.itemID));
    const currentIDs =
      session._space.visibleDynamicEntityIDs instanceof Set
        ? session._space.visibleDynamicEntityIDs
        : new Set();
    const addedEntities = desiredEntities.filter(
      (entity) => !currentIDs.has(entity.itemID),
    );
    const removedIDs = [...currentIDs].filter((entityID) => !desiredIDs.has(entityID));

    return {
      egoEntity,
      desiredEntities,
      desiredIDs,
      currentIDs,
      addedEntities,
      removedIDs,
    };
  }

  buildStaticVisibilityDeltaForSession(
    session,
    now = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (!session || !session._space || session._space.initialStateSent !== true) {
      return null;
    }

    const desiredEntities = this.getVisibleIncrementalStaticEntitiesForSession(
      session,
      options,
    );
    const desiredIDs = new Set(desiredEntities.map((entity) => entity.itemID));
    const currentIDs =
      session._space.visibleBubbleScopedStaticEntityIDs instanceof Set
        ? session._space.visibleBubbleScopedStaticEntityIDs
        : new Set();
    const addedEntities = desiredEntities.filter(
      (entity) => !currentIDs.has(entity.itemID),
    );
    const removedIDs = [...currentIDs].filter((entityID) => !desiredIDs.has(entityID));

    return {
      desiredEntities,
      desiredIDs,
      currentIDs,
      addedEntities,
      removedIDs,
    };
  }

  acquireDynamicEntitiesForSession(
    session,
    entities,
    options = {},
  ) {
    if (
      !session ||
      !isReadyForDestiny(session) ||
      !Array.isArray(entities) ||
      entities.length === 0
    ) {
      return [];
    }

    const now = toFiniteNumber(options.nowMs, this.getCurrentSimTimeMs());
    const currentIDs =
      session._space && session._space.visibleDynamicEntityIDs instanceof Set
        ? session._space.visibleDynamicEntityIDs
        : new Set();
    const refreshedEntities = refreshEntitiesForSlimPayload(
      this.filterBallparkEntitiesForSession(session, entities),
    );
    const acquiredEntities = refreshedEntities.filter((entity) => {
      if (!entity || entity.itemID === session._space.shipID) {
        return false;
      }
      if (currentIDs.has(entity.itemID)) {
        return false;
      }
      if (typeof options.visibilityFn === "function") {
        return options.visibilityFn(session, entity, now) === true;
      }
      return this.canSessionSeeDynamicEntity(session, entity, now);
    });
    if (acquiredEntities.length === 0) {
      return [];
    }

    const sendResult = this.sendAddBallsToSession(session, acquiredEntities, {
      freshAcquire: true,
      nowMs: now,
      bypassTickPresentationBatch:
        options.bypassTickPresentationBatch === true,
    });
    recordVisibilityJournal(session, "dynamic.add", {
      nowMs: now,
      stamp:
        sendResult && sendResult.stamp !== undefined && sendResult.stamp !== null
          ? (toInt(sendResult.stamp, 0) >>> 0)
          : null,
      addedEntityIDs: acquiredEntities.map((entity) => entity.itemID),
      source: "acquireDynamicEntitiesForSession",
    });
    for (const entity of acquiredEntities) {
      currentIDs.add(entity.itemID);
    }
    if (session._space) {
      session._space.visibleDynamicEntityIDs = currentIDs;
      const freshIDs =
        session._space.freshlyVisibleDynamicEntityIDs instanceof Set
          ? session._space.freshlyVisibleDynamicEntityIDs
          : new Set();
      for (const entity of acquiredEntities) {
        freshIDs.add(entity.itemID);
      }
      session._space.freshlyVisibleDynamicEntityIDs = freshIDs;
    }
    return acquiredEntities;
  }

  acquireDynamicEntitiesForRelevantSessions(entities, options = {}) {
    if (!Array.isArray(entities) || entities.length === 0) {
      return {
        deliveredSessionCount: 0,
        deliveredEntityCount: 0,
      };
    }

    const now = toFiniteNumber(options.nowMs, this.getCurrentSimTimeMs());
    let deliveredSessionCount = 0;
    let deliveredEntityCount = 0;
    for (const session of this.sessions.values()) {
      const acquiredEntities = this.acquireDynamicEntitiesForSession(
        session,
        entities,
        {
          ...options,
          nowMs: now,
        },
      );
      if (acquiredEntities.length <= 0) {
        continue;
      }
      deliveredSessionCount += 1;
      deliveredEntityCount += acquiredEntities.length;
    }

    return {
      deliveredSessionCount,
      deliveredEntityCount,
    };
  }

  sendRemoveBallsToSession(session, entityIDs) {
    if (!session || !isReadyForDestiny(session) || entityIDs.length === 0) {
      return;
    }
    this.sendDestinyUpdates(
      session,
      this.buildRemoveBallsUpdates(entityIDs),
      false,
      buildDestructionTeardownSendOptions({
        translateStamps: false,
      }),
    );
  }

  buildSessionStampedRemoveBallsUpdates(entityIDs, sessionStamp) {
    if (!Array.isArray(entityIDs) || entityIDs.length === 0) {
      return [];
    }
    const stamp = toInt(sessionStamp, 0) >>> 0;
    return [{
      stamp,
      payload: destiny.buildRemoveBallsPayload(entityIDs),
    }];
  }

  buildRemoveBallsUpdates(entityIDs, options = {}) {
    if (!Array.isArray(entityIDs) || entityIDs.length === 0) {
      return [];
    }
    const defaultStamp = this.getNextDestinyStamp(
      options.nowMs === undefined || options.nowMs === null
        ? this.getCurrentSimTimeMs()
        : options.nowMs,
    );
    const stamp =
      options.stampOverride === undefined || options.stampOverride === null
        ? defaultStamp
        : (toInt(options.stampOverride, defaultStamp) >>> 0);
    return [{
      stamp,
      payload: destiny.buildRemoveBallsPayload(entityIDs),
    }];
  }

  broadcastDestinyUpdatesToBubble(bubbleID, updates, options = {}) {
    if (!Array.isArray(updates) || updates.length === 0) {
      return {
        deliveredCount: 0,
      };
    }

    let deliveredCount = 0;
    const sendOptions =
      options && options.sendOptions && typeof options.sendOptions === "object"
        ? { ...options.sendOptions }
        : {};
    for (const session of this.getSessionsInBubble(bubbleID)) {
      if (session === options.excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      this.sendDestinyUpdates(
        session,
        updates,
        options.waitForBubble === true,
        sendOptions,
      );
      deliveredCount += 1;
    }

    return {
      deliveredCount,
    };
  }

  syncDynamicVisibilityForSession(
    session,
    now = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (!session || !session._space || session._space.initialStateSent !== true) {
      return;
    }

    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return;
    }
    if (
      options.bypassPilotWarpQuietWindow !== true &&
      this.isSessionInPilotWarpQuietWindow(session, now)
    ) {
      return;
    }
    const visibilityDelta = this.buildDynamicVisibilityDeltaForSession(
      session,
      now,
      options,
    );
    if (!visibilityDelta) {
      return;
    }
    const {
      desiredIDs,
      addedEntities,
      removedIDs,
    } = visibilityDelta;

    const stampOverride =
      options.stampOverride === undefined || options.stampOverride === null
        ? null
        : (toInt(options.stampOverride, 0) >>> 0);
    const removeUpdates =
      removedIDs.length > 0
        ? this.buildRemoveBallsUpdates(removedIDs, {
            nowMs: now,
            stampOverride,
          })
        : [];
    const addPresentation =
      addedEntities.length > 0
        ? this.buildAddBallsUpdatesForSession(session, addedEntities, {
            freshAcquire: true,
            nowMs: now,
            stampOverride,
          })
        : null;
    const addSendOptions = addPresentation && addPresentation.sendOptions
      ? { ...addPresentation.sendOptions }
      : null;
    if (
      addSendOptions &&
      stampOverride !== null &&
      options.bypassPilotWarpQuietWindow === true
    ) {
      // Post-warp landing visibility should materialize on the authored landing
      // stamp, not get bumped a tick later by the generic fresh-acquire safety
      // rule. The pilot is already transitioning onto that landing stamp.
      delete addSendOptions.avoidCurrentHistoryInsertion;
    }
    if (this.hasActiveTickDestinyPresentationBatch()) {
      if (removeUpdates.length > 0) {
        this.queueTickDestinyPresentationUpdates(session, removeUpdates, {
          sendOptions: buildDestructionTeardownSendOptions({
            translateStamps: false,
          }),
        });
      }
      if (addPresentation && addPresentation.updates.length > 0) {
        this.queueTickDestinyPresentationUpdates(session, addPresentation.updates, {
          sendOptions: addSendOptions || addPresentation.sendOptions,
        });
      }
    } else if (addPresentation && addPresentation.updates.length > 0) {
      this.sendDestinyUpdates(
        session,
        [...removeUpdates, ...addPresentation.updates],
        false,
        addSendOptions || addPresentation.sendOptions,
      );
    } else if (removeUpdates.length > 0) {
      this.sendDestinyUpdates(
        session,
        removeUpdates,
        false,
        buildDestructionTeardownSendOptions({
          translateStamps: false,
        }),
      );
    }

    if (removedIDs.length > 0 || addedEntities.length > 0) {
      recordVisibilityJournal(session, "dynamic.sync", {
        nowMs: now,
        stamp: stampOverride,
        addStamp:
          addPresentation && addPresentation.updates && addPresentation.updates[0]
            ? (toInt(addPresentation.updates[0].stamp, 0) >>> 0)
            : null,
        removeStamp:
          removeUpdates && removeUpdates[0]
            ? (toInt(removeUpdates[0].stamp, 0) >>> 0)
            : null,
        addedEntityIDs: addedEntities.map((entity) => entity.itemID),
        removedEntityIDs: removedIDs,
        desiredVisibleEntityIDs: [...desiredIDs],
      });
      logBubbleDebug("bubble.visibility_sync", {
        systemID: this.systemID,
        sessionCharacterID: toInt(session.charID, 0),
        sessionShipID: toInt(session._space.shipID, 0),
        egoBubbleID: toInt(egoEntity.bubbleID, 0),
        addedEntityIDs: addedEntities.map((entity) => toInt(entity.itemID, 0)),
        removedEntityIDs: removedIDs.map((entityID) => toInt(entityID, 0)),
        desiredVisibleEntityIDs: [...desiredIDs].map((entityID) => toInt(entityID, 0)),
      });
    }

    session._space.visibleDynamicEntityIDs = desiredIDs;
    session._space.freshlyVisibleDynamicEntityIDs = new Set(
      addedEntities.map((entity) => entity.itemID),
    );
    if (session._space.freshlyVisibleDynamicEntityReleaseStampByID instanceof Map) {
      const currentSessionStamp = this.getCurrentSessionDestinyStamp(session, now);
      for (const [entityID, releaseStamp] of session._space
        .freshlyVisibleDynamicEntityReleaseStampByID.entries()) {
        if (
          !desiredIDs.has(entityID) ||
          currentSessionStamp > (toInt(releaseStamp, 0) >>> 0)
        ) {
          session._space.freshlyVisibleDynamicEntityReleaseStampByID.delete(entityID);
        }
      }
    }
  }

  syncStaticVisibilityForSession(
    session,
    now = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (!session || !session._space || session._space.initialStateSent !== true) {
      return;
    }
    if (
      options.bypassPilotWarpQuietWindow !== true &&
      this.isSessionInPilotWarpQuietWindow(session, now)
    ) {
      return;
    }

    const delta = this.buildStaticVisibilityDeltaForSession(session, now, options);
    if (!delta) {
      return;
    }

    const stampOverride =
      options.stampOverride === undefined || options.stampOverride === null
        ? null
        : (toInt(options.stampOverride, 0) >>> 0);
    const removeUpdates =
      delta.removedIDs.length > 0
        ? this.buildRemoveBallsUpdates(delta.removedIDs, {
            nowMs: now,
            stampOverride,
          })
        : [];
    const addPresentation =
      delta.addedEntities.length > 0
        ? this.buildAddBallsUpdatesForSession(session, delta.addedEntities, {
            freshAcquire: true,
            nowMs: now,
            stampOverride,
          })
        : null;
    const addSendOptions = addPresentation && addPresentation.sendOptions
      ? { ...addPresentation.sendOptions }
      : null;

    if (this.hasActiveTickDestinyPresentationBatch()) {
      if (removeUpdates.length > 0) {
        this.queueTickDestinyPresentationUpdates(session, removeUpdates, {
          sendOptions: buildDestructionTeardownSendOptions({
            translateStamps: false,
          }),
        });
      }
      if (addPresentation && addPresentation.updates.length > 0) {
        this.queueTickDestinyPresentationUpdates(session, addPresentation.updates, {
          sendOptions: addSendOptions || addPresentation.sendOptions,
        });
      }
    } else if (addPresentation && addPresentation.updates.length > 0) {
      this.sendDestinyUpdates(
        session,
        [...removeUpdates, ...addPresentation.updates],
        false,
        addSendOptions || addPresentation.sendOptions,
      );
    } else if (removeUpdates.length > 0) {
      this.sendDestinyUpdates(
        session,
        removeUpdates,
        false,
        buildDestructionTeardownSendOptions({
          translateStamps: false,
        }),
      );
    }

    if (delta.removedIDs.length > 0 || delta.addedEntities.length > 0) {
      recordVisibilityJournal(session, "static.sync", {
        nowMs: now,
        stamp: stampOverride,
        addStamp:
          addPresentation && addPresentation.updates && addPresentation.updates[0]
            ? (toInt(addPresentation.updates[0].stamp, 0) >>> 0)
            : null,
        removeStamp:
          removeUpdates && removeUpdates[0]
            ? (toInt(removeUpdates[0].stamp, 0) >>> 0)
            : null,
        addedStaticEntityIDs: delta.addedEntities.map((entity) => entity.itemID),
        removedStaticEntityIDs: delta.removedIDs,
        desiredVisibleEntityIDs: [...delta.desiredIDs],
      });
    }

    session._space.visibleBubbleScopedStaticEntityIDs = delta.desiredIDs;
  }

  syncDynamicVisibilityForAllSessions(
    now = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    for (const session of this.sessions.values()) {
      this.syncDynamicVisibilityForSession(session, now, options);
      this.syncStaticVisibilityForSession(session, now, options);
    }
  }

  runPostAttachVisibilityReconciliation(
    session,
    now = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (
      !session ||
      !session._space ||
      session._space.postAttachVisibilityReconcile !== true
    ) {
      return false;
    }

    session._space.postAttachVisibilityReconcile = false;
    const stampOverride =
      options.stampOverride === undefined || options.stampOverride === null
        ? null
        : (toInt(options.stampOverride, 0) >>> 0);
    const reason =
      typeof session._space.postAttachVisibilityReconcileReason === "string"
        ? session._space.postAttachVisibilityReconcileReason
        : null;
    recordVisibilityJournal(session, "attach.reconcile", {
      nowMs: now,
      stamp: stampOverride,
      source:
        typeof options.source === "string"
          ? options.source
          : "postAttachVisibilityReconciliation",
      reason,
      shipID: toInt(session._space.shipID, 0),
    });
    this.syncDynamicVisibilityForAllSessions(now, {
      stampOverride,
      bypassPilotWarpQuietWindow: true,
    });
    return true;
  }

  buildModeUpdates(entity, stampOverride = null) {
    const updates = [];
    const modeStamp =
      stampOverride === null
        ? this.getNextDestinyStamp()
        : toInt(stampOverride, this.getNextDestinyStamp());

    switch (entity.mode) {
      case "GOTO":
        updates.push({
          stamp: modeStamp,
          payload: destiny.buildGotoDirectionPayload(
            entity.itemID,
            getCommandDirection(entity, entity.direction),
          ),
        });
        break;
      case "FOLLOW":
        updates.push({
          stamp: modeStamp,
          payload: destiny.buildFollowBallPayload(
            entity.itemID,
            entity.targetEntityID,
            entity.followRange,
          ),
        });
        break;
      case "ORBIT":
        updates.push({
          stamp: modeStamp,
          payload: destiny.buildOrbitPayload(
            entity.itemID,
            entity.targetEntityID,
            entity.orbitDistance,
          ),
        });
        break;
      case "WARP":
        if (entity.warpState) {
          if (entity.pendingWarp && toInt(entity.warpState.effectStamp, 0) < 0) {
            updates.push(
              buildWarpPrepareCommandUpdate(
                entity,
                modeStamp,
                entity.warpState,
              ),
            );
          } else {
            updates.push(
              ...(entity.session
                ? buildPlayerWarpInFlightAcquireUpdates(
                    entity,
                    entity.warpState,
                    modeStamp,
                  )
                : buildSessionlessWarpInFlightAcquireUpdates(
                    entity,
                    entity.warpState,
                    modeStamp,
                  )),
            );
          }
        }
        break;
      default:
        break;
    }

    if (entity.mode !== "WARP" && entity.speedFraction > 0) {
      updates.push({
        stamp: modeStamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      });
    }
    if (entity.mode !== "WARP" && magnitude(entity.velocity) > 0) {
      updates.push({
        stamp: modeStamp,
        payload: destiny.buildSetBallVelocityPayload(
          entity.itemID,
          entity.velocity,
        ),
      });
    }

    return updates;
  }

  attachSession(session, shipItem, options = {}) {
    if (!session || !shipItem) {
      return null;
    }

    const shipEntity = buildShipEntity(session, shipItem, this.systemID);
    if (
      shipEntity.mode === "WARP" &&
      shipEntity.warpState &&
      !shipEntity.pendingWarp
    ) {
      log.warn(
        `[SpaceRuntime] Restoring persisted warp state for ship=${shipEntity.itemID} on login is unsupported; spawning stopped at current position instead.`,
      );
      resetEntityMotion(shipEntity);
      shipEntity.warpState = null;
      shipEntity.pendingWarp = null;
      shipEntity.targetEntityID = null;
    }
    if (options.skipLegacyStationNormalization !== true) {
      normalizeLegacyStationState(shipEntity);
    }
    if (options.spawnStopped) {
      resetEntityMotion(shipEntity);
    } else if (options.undockDirection) {
      buildUndockMovement(
        shipEntity,
        options.undockDirection,
        options.speedFraction ?? 1,
      );
    }

    ensureEntityTargetingState(shipEntity);
    session._space = {
      systemID: this.systemID,
      shipID: shipEntity.itemID,
      beyonceBound: Boolean(options.beyonceBound),
      initialStateSent: Boolean(options.initialStateSent),
      initialBallparkVisualsSent: Boolean(options.initialBallparkVisualsSent),
      initialBallparkClockSynced: Boolean(options.initialBallparkClockSynced),
      deferInitialBallparkClockUntilBind:
        options.deferInitialBallparkClockUntilBind === true,
      deferInitialBallparkStateUntilBind:
        options.deferInitialBallparkStateUntilBind === true,
      pendingUndockMovement: Boolean(options.pendingUndockMovement),
      visibleDynamicEntityIDs: new Set(),
      visibleBubbleScopedStaticEntityIDs: new Set(),
      freshlyVisibleDynamicEntityIDs: new Set(),
      freshlyVisibleDynamicEntityReleaseStampByID: new Map(),
      visibilityJournal: [],
      visibilityJournalSeq: 0,
      postAttachVisibilityReconcile:
        options.postAttachVisibilityReconcile === true,
      postAttachVisibilityReconcileReason:
        typeof options.postAttachVisibilityReconcileReason === "string"
          ? options.postAttachVisibilityReconcileReason
          : null,
      pilotWarpQuietUntilStamp: 0,
      pilotWarpVisibilityHandoff: null,
      clockOffsetMs: 0,
      historyFloorDestinyStamp: null,
      lastSentDestinyStamp: null,
      lastSentDestinyRawDispatchStamp: null,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: null,
      lastSentDestinyWasOwnerCritical: null,
      lastOwnerNonMissileCriticalStamp: null,
      lastOwnerNonMissileCriticalRawDispatchStamp: null,
      lastPilotCommandMovementStamp: null,
      lastPilotCommandMovementAnchorStamp: null,
      lastPilotCommandMovementRawDispatchStamp: null,
      lastPilotCommandDirection: null,
      lastFreshAcquireLifecycleStamp: null,
      lastMissileLifecycleStamp: null,
      lastOwnerMissileLifecycleStamp: null,
      lastOwnerMissileLifecycleAnchorStamp: null,
      lastOwnerMissileFreshAcquireStamp: null,
      lastOwnerMissileFreshAcquireAnchorStamp: null,
      lastOwnerMissileFreshAcquireRawDispatchStamp: null,
      lastOwnerMissileLifecycleRawDispatchStamp: null,
      timeDilation: this.getTimeDilation(),
      simTimeMs: this.getCurrentSimTimeMs(),
      simFileTime: this.getCurrentFileTime(),
    };

    this.sessions.set(session.clientID, session);
    this.dynamicEntities.set(shipEntity.itemID, shipEntity);
    this.reconcileEntityPublicGrid(shipEntity);
    this.reconcileEntityBubble(shipEntity);
    this.publicGridCompositionDirty = true;
    this.ensurePublicGridComposition();
    persistShipEntity(shipEntity);
    session._skipNextInitialBallparkRebase =
      options.skipNextInitialBallparkRebase === true;
    session._nextInitialBallparkPreviousSimTimeMs =
      options.initialBallparkPreviousSimTimeMs === undefined ||
      options.initialBallparkPreviousSimTimeMs === null
        ? null
        : toFiniteNumber(options.initialBallparkPreviousSimTimeMs, null);
    session._nextInitialBallparkPreviousTimeDilation =
      options.initialBallparkPreviousTimeDilation === undefined ||
      options.initialBallparkPreviousTimeDilation === null
        ? null
        : clampTimeDilationFactor(options.initialBallparkPreviousTimeDilation);
    session._nextInitialBallparkPreviousCapturedAtWallclockMs =
      options.initialBallparkPreviousCapturedAtWallclockMs === undefined ||
      options.initialBallparkPreviousCapturedAtWallclockMs === null
        ? null
        : toFiniteNumber(options.initialBallparkPreviousCapturedAtWallclockMs, null);
    const attachedSceneCurrentSimTimeMs = this.getCurrentSimTimeMs();
    const preservedCurrentSessionSimTimeMs = resolvePreservedSimTimeMs(
      options.initialBallparkPreviousSimTimeMs,
      options.initialBallparkPreviousTimeDilation,
      options.initialBallparkPreviousCapturedAtWallclockMs,
      null,
    );
    if (preservedCurrentSessionSimTimeMs !== null) {
      session._space.clockOffsetMs = roundNumber(
        preservedCurrentSessionSimTimeMs - attachedSceneCurrentSimTimeMs,
        3,
      );
    }
    const syncResult = this.syncSessionSimClock(session, {
      previousSimTimeMs: options.previousSimTimeMs,
      currentSimTimeMs:
        preservedCurrentSessionSimTimeMs === null
          ? undefined
          : preservedCurrentSessionSimTimeMs,
      emit: options.emitSimClockRebase !== false,
      forceRebase: options.forceSimClockRebase === true,
    });
    recordSessionJumpTimingTrace(session, "attach-session", {
      systemID: this.systemID,
      shipID: shipEntity.itemID,
      options: {
        beyonceBound: options.beyonceBound === true,
        pendingUndockMovement: options.pendingUndockMovement === true,
        postAttachVisibilityReconcile:
          options.postAttachVisibilityReconcile === true,
        spawnStopped: options.spawnStopped === true,
        broadcast: options.broadcast !== false,
        emitSimClockRebase: options.emitSimClockRebase !== false,
        forceSimClockRebase: options.forceSimClockRebase === true,
        previousSimTimeMs:
          options.previousSimTimeMs === undefined ? null : options.previousSimTimeMs,
        initialBallparkPreviousSimTimeMs:
          options.initialBallparkPreviousSimTimeMs === undefined
            ? null
            : options.initialBallparkPreviousSimTimeMs,
        initialBallparkPreviousTimeDilation:
          options.initialBallparkPreviousTimeDilation === undefined
            ? null
            : options.initialBallparkPreviousTimeDilation,
        initialBallparkPreviousCapturedAtWallclockMs:
          options.initialBallparkPreviousCapturedAtWallclockMs === undefined
            ? null
            : options.initialBallparkPreviousCapturedAtWallclockMs,
        deferInitialBallparkClockUntilBind:
          options.deferInitialBallparkClockUntilBind === true,
        deferInitialBallparkStateUntilBind:
          options.deferInitialBallparkStateUntilBind === true,
      },
      sceneTimeState: this.buildTimeStateSnapshot(),
      sessionClockOffsetMs: session._space.clockOffsetMs,
      syncResult,
    });

    log.info(
      `[SpaceRuntime] Attached ${session.characterName || session.characterID} ship=${shipEntity.itemID} to system ${this.systemID}`,
    );

    if (options.spawnAsteroidBeltRats !== false) {
      this.maybeSpawnAsteroidBeltRatsForArrival(session, shipEntity, {
        nowMs: attachedSceneCurrentSimTimeMs,
        broadcast: false,
        source: "attachSession",
      });
    }

    if (options.broadcast !== false) {
      if (options.emitEgoBallAdd === true && isReadyForDestiny(session)) {
        // Same-ballpark ship swaps (for example ejecting into a fresh capsule)
        // still need the new ego ball inserted into Michelle. Visibility sync
        // intentionally excludes the ego ship, so seed it explicitly first.
        this.sendAddBallsToSession(session, [shipEntity]);
      }
      const visibilitySyncStartedAtMs = Date.now();
      this.syncDynamicVisibilityForAllSessions();
      const visibilitySyncElapsedMs = Date.now() - visibilitySyncStartedAtMs;
      if (visibilitySyncElapsedMs >= 250) {
        log.info(
          `[SpaceRuntime] syncDynamicVisibilityForAllSessions system=${this.systemID} ` +
          `ship=${shipEntity.itemID} took ${visibilitySyncElapsedMs}ms`,
        );
      }
    }
    if (session._space && session._space.initialStateSent === true) {
      this.syncSessionStructureTetherState(session, {
        nowMs: attachedSceneCurrentSimTimeMs,
        forceReplayFx: true,
      });
    }

    return shipEntity;
  }

  maybeSpawnAsteroidBeltRatsForArrival(session, shipEntity, options = {}) {
    if (!session || !shipEntity || shipEntity.session !== session) {
      return {
        success: false,
        spawned: false,
        reason: "SESSION_SHIP_MISMATCH",
      };
    }

    try {
      const beltRatRuntime = require(path.join(__dirname, "./npc/beltRatRuntime"));
      if (
        beltRatRuntime &&
        typeof beltRatRuntime.maybeSpawnForSessionArrival === "function"
      ) {
        return beltRatRuntime.maybeSpawnForSessionArrival(
          this,
          session,
          shipEntity,
          options,
        );
      }
    } catch (error) {
      log.warn(
        `[SpaceRuntime] Belt-rat arrival check failed for system=${this.systemID}: ${error.message}`,
      );
    }

    return {
      success: false,
      spawned: false,
      reason: "BELT_RAT_RUNTIME_UNAVAILABLE",
    };
  }

  attachSessionToExistingEntity(session, shipItem, entity, options = {}) {
    if (!session || !shipItem || !entity || entity.kind !== "ship") {
      return null;
    }

    applySessionStateToShipEntity(entity, session, shipItem);
    ensureEntityTargetingState(entity);
    if (
      entity.mode === "WARP" &&
      entity.warpState &&
      !entity.pendingWarp
    ) {
      log.warn(
        `[SpaceRuntime] Restoring persisted warp state for boarded ship=${entity.itemID} is unsupported; spawning stopped at current position instead.`,
      );
      resetEntityMotion(entity);
      entity.warpState = null;
      entity.pendingWarp = null;
      entity.targetEntityID = null;
    }
    if (options.skipLegacyStationNormalization !== true) {
      normalizeLegacyStationState(entity);
    }
    if (options.spawnStopped) {
      resetEntityMotion(entity);
    } else if (options.undockDirection) {
      buildUndockMovement(
        entity,
        options.undockDirection,
        options.speedFraction ?? 1,
      );
    }

    session._space = {
      systemID: this.systemID,
      shipID: entity.itemID,
      beyonceBound: Boolean(options.beyonceBound),
      initialStateSent: Boolean(options.initialStateSent),
      initialBallparkVisualsSent: Boolean(options.initialBallparkVisualsSent),
      initialBallparkClockSynced: Boolean(options.initialBallparkClockSynced),
      deferInitialBallparkClockUntilBind:
        options.deferInitialBallparkClockUntilBind === true,
      deferInitialBallparkStateUntilBind:
        options.deferInitialBallparkStateUntilBind === true,
      pendingUndockMovement: Boolean(options.pendingUndockMovement),
      visibleDynamicEntityIDs: new Set(),
      visibleBubbleScopedStaticEntityIDs: new Set(),
      freshlyVisibleDynamicEntityIDs: new Set(),
      freshlyVisibleDynamicEntityReleaseStampByID: new Map(),
      visibilityJournal: [],
      visibilityJournalSeq: 0,
      postAttachVisibilityReconcile:
        options.postAttachVisibilityReconcile === true,
      postAttachVisibilityReconcileReason:
        typeof options.postAttachVisibilityReconcileReason === "string"
          ? options.postAttachVisibilityReconcileReason
          : null,
      pilotWarpQuietUntilStamp: 0,
      pilotWarpVisibilityHandoff: null,
      clockOffsetMs: 0,
      historyFloorDestinyStamp: null,
      lastSentDestinyStamp: null,
      lastSentDestinyRawDispatchStamp: null,
      lastSentDestinyOnlyStaleProjectedOwnerMissileLane: null,
      lastSentDestinyWasOwnerCritical: null,
      lastOwnerNonMissileCriticalStamp: null,
      lastOwnerNonMissileCriticalRawDispatchStamp: null,
      lastPilotCommandMovementStamp: null,
      lastPilotCommandMovementAnchorStamp: null,
      lastPilotCommandMovementRawDispatchStamp: null,
      lastPilotCommandDirection: null,
      lastFreshAcquireLifecycleStamp: null,
      lastMissileLifecycleStamp: null,
      lastOwnerMissileLifecycleStamp: null,
      lastOwnerMissileLifecycleAnchorStamp: null,
      lastOwnerMissileFreshAcquireStamp: null,
      lastOwnerMissileFreshAcquireAnchorStamp: null,
      lastOwnerMissileFreshAcquireRawDispatchStamp: null,
      lastOwnerMissileLifecycleRawDispatchStamp: null,
      timeDilation: this.getTimeDilation(),
      simTimeMs: this.getCurrentSimTimeMs(),
      simFileTime: this.getCurrentFileTime(),
    };

    this.sessions.set(session.clientID, session);
    this.reconcileEntityPublicGrid(entity);
    this.reconcileEntityBubble(entity);
    this.publicGridCompositionDirty = true;
    this.ensurePublicGridComposition();
    persistShipEntity(entity);
    session._skipNextInitialBallparkRebase =
      options.skipNextInitialBallparkRebase === true;
    session._nextInitialBallparkPreviousSimTimeMs =
      options.initialBallparkPreviousSimTimeMs === undefined ||
      options.initialBallparkPreviousSimTimeMs === null
        ? null
        : toFiniteNumber(options.initialBallparkPreviousSimTimeMs, null);
    session._nextInitialBallparkPreviousTimeDilation =
      options.initialBallparkPreviousTimeDilation === undefined ||
      options.initialBallparkPreviousTimeDilation === null
        ? null
        : clampTimeDilationFactor(options.initialBallparkPreviousTimeDilation);
    session._nextInitialBallparkPreviousCapturedAtWallclockMs =
      options.initialBallparkPreviousCapturedAtWallclockMs === undefined ||
      options.initialBallparkPreviousCapturedAtWallclockMs === null
        ? null
        : toFiniteNumber(options.initialBallparkPreviousCapturedAtWallclockMs, null);
    const attachedExistingSceneCurrentSimTimeMs = this.getCurrentSimTimeMs();
    const preservedExistingSessionSimTimeMs = resolvePreservedSimTimeMs(
      options.initialBallparkPreviousSimTimeMs,
      options.initialBallparkPreviousTimeDilation,
      options.initialBallparkPreviousCapturedAtWallclockMs,
      null,
    );
    if (preservedExistingSessionSimTimeMs !== null) {
      session._space.clockOffsetMs = roundNumber(
        preservedExistingSessionSimTimeMs - attachedExistingSceneCurrentSimTimeMs,
        3,
      );
    }
    const syncResult = this.syncSessionSimClock(session, {
      previousSimTimeMs: options.previousSimTimeMs,
      currentSimTimeMs:
        preservedExistingSessionSimTimeMs === null
          ? undefined
          : preservedExistingSessionSimTimeMs,
      emit: options.emitSimClockRebase !== false,
      forceRebase: options.forceSimClockRebase === true,
    });
    recordSessionJumpTimingTrace(session, "attach-session-existing-entity", {
      systemID: this.systemID,
      shipID: entity.itemID,
      options: {
        beyonceBound: options.beyonceBound === true,
        pendingUndockMovement: options.pendingUndockMovement === true,
        postAttachVisibilityReconcile:
          options.postAttachVisibilityReconcile === true,
        spawnStopped: options.spawnStopped === true,
        broadcast: options.broadcast !== false,
        emitSimClockRebase: options.emitSimClockRebase !== false,
        forceSimClockRebase: options.forceSimClockRebase === true,
        previousSimTimeMs:
          options.previousSimTimeMs === undefined ? null : options.previousSimTimeMs,
        initialBallparkPreviousSimTimeMs:
          options.initialBallparkPreviousSimTimeMs === undefined
            ? null
            : options.initialBallparkPreviousSimTimeMs,
        initialBallparkPreviousTimeDilation:
          options.initialBallparkPreviousTimeDilation === undefined
            ? null
            : options.initialBallparkPreviousTimeDilation,
        initialBallparkPreviousCapturedAtWallclockMs:
          options.initialBallparkPreviousCapturedAtWallclockMs === undefined
            ? null
            : options.initialBallparkPreviousCapturedAtWallclockMs,
        deferInitialBallparkClockUntilBind:
          options.deferInitialBallparkClockUntilBind === true,
        deferInitialBallparkStateUntilBind:
          options.deferInitialBallparkStateUntilBind === true,
      },
      sceneTimeState: this.buildTimeStateSnapshot(),
      sessionClockOffsetMs: session._space.clockOffsetMs,
      syncResult,
    });

    log.info(
      `[SpaceRuntime] Attached ${session.characterName || session.characterID} to existing ship=${entity.itemID} in system ${this.systemID}`,
    );

    if (options.spawnAsteroidBeltRats !== false) {
      this.maybeSpawnAsteroidBeltRatsForArrival(session, entity, {
        nowMs: attachedExistingSceneCurrentSimTimeMs,
        broadcast: false,
        source: "attachSessionToExistingEntity",
      });
    }

    if (options.broadcast !== false) {
      this.broadcastSlimItemChanges([entity]);
      this.broadcastBallRefresh([entity], session);
      this.syncDynamicVisibilityForAllSessions();
    }
    if (session._space && session._space.initialStateSent === true) {
      this.syncSessionStructureTetherState(session, {
        nowMs: attachedExistingSceneCurrentSimTimeMs,
        forceReplayFx: true,
      });
    }

    return entity;
  }

  syncSessionStructureTetherState(session, options = {}) {
    if (!session || !session._space) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    const entity = this.getShipEntityForSession(session);
    if (!entity) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const result = syncEntityStructureTetherState(this, entity, {
      nowMs: options.nowMs,
      broadcastFx: false,
      replaySession: session,
      forceReplayFx: options.forceReplayFx === true,
      repairOnEngage: options.repairOnEngage !== false,
    });
    const repaired = result.repaired;
    const repairedModules =
      repaired && Array.isArray(repaired.repairedModules)
        ? repaired.repairedModules
        : [];
    if (
      result.changed ||
      result.fxReplayed ||
      (
        repaired &&
        (
          repaired.repairedShip ||
          repaired.rechargedCapacitor ||
          repairedModules.length > 0
        )
      )
    ) {
      persistShipEntity(entity);
    }

    return {
      success: true,
      data: result,
    };
  }

  detachSession(session, options = {}) {
    if (!session || !session._space) {
      return;
    }

    recordSessionJumpTimingTrace(session, "detach-session", {
      systemID: session._space.systemID,
      shipID: session._space.shipID,
      broadcast: options.broadcast !== false,
      sessionSimTimeMs: session._space.simTimeMs,
      sessionSimFileTime: session._space.simFileTime,
      sessionTimeDilation: session._space.timeDilation,
    });
    const entity = this.dynamicEntities.get(session._space.shipID) || null;
    this.sessions.delete(session.clientID);
    if (entity) {
      this.clearAllTargetingForEntity(entity, {
        notifySelf: options.notifySelfOnTargetClear === true,
        notifyTarget: true,
        reason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
      });
      handleDroneControllerLostSafe(this, entity, {
        lifecycleReason: options.lifecycleReason,
        attemptBayRecovery: options.attemptDroneBayRecovery === true,
      });
      handleFighterControllerLostSafe(this, entity, {
        lifecycleReason: options.lifecycleReason,
        attemptTubeRecovery: options.attemptFighterTubeRecovery === true,
      });
      this.unregisterDynamicEntity(entity, {
        broadcast: options.broadcast !== false,
        excludedSession: session,
      });
    }

    session._space = null;
  }

  disembarkSession(session, options = {}) {
    if (!session || !session._space) {
      return null;
    }

    const entity = this.dynamicEntities.get(session._space.shipID) || null;
    this.sessions.delete(session.clientID);

    if (entity) {
      this.clearAllTargetingForEntity(entity, {
        notifySelf: true,
        notifyTarget: true,
        reason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
      });
      handleDroneControllerLostSafe(this, entity, {
        lifecycleReason: options.lifecycleReason,
        attemptBayRecovery: options.attemptDroneBayRecovery === true,
      });
      handleFighterControllerLostSafe(this, entity, {
        lifecycleReason: options.lifecycleReason,
        attemptTubeRecovery: options.attemptFighterTubeRecovery === true,
      });
      clearSessionStateFromShipEntity(entity);
      persistShipEntity(entity);
    }

    session._space = null;

    if (entity && options.broadcast !== false) {
      this.broadcastSlimItemChanges([entity]);
      this.broadcastBallRefresh([entity], session);
    }

    return entity;
  }

  markBeyonceBound(session) {
    if (session && session._space) {
      session._space.beyonceBound = true;
    }
  }

  sendDestinyUpdates(session, payloads, waitForBubble = false, options = {}) {
    return movementDestinyDispatch.sendDestinyUpdates(
      this,
      session,
      payloads,
      waitForBubble,
      options,
    );
  }

  sendDestinyBatch(
    session,
    payloads,
    waitForBubble = false,
    options = {},
  ) {
    return movementDestinyDispatch.sendDestinyBatch(
      this,
      session,
      payloads,
      waitForBubble,
      options,
    );
  }

  sendDestinyUpdatesIndividually(
    session,
    payloads,
    waitForBubble = false,
    options = {},
  ) {
    return movementDestinyDispatch.sendDestinyUpdatesIndividually(
      this,
      session,
      payloads,
      waitForBubble,
      options,
    );
  }

  sendMovementUpdatesToSession(session, updates) {
    return movementDestinyDispatch.sendMovementUpdatesToSession(
      this,
      session,
      updates,
    );
  }

  broadcastPilotCommandMovementUpdates(
    session,
    updates,
    nowMs = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    return movementOwnerDispatch.broadcastPilotCommandMovementUpdates(
      this,
      session,
      updates,
      nowMs,
      options,
    );
  }

  dispatchConfiguredSubwarpMovement(
    entity,
    buildUpdates,
    nowMs = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    return movementContractDispatch.dispatchConfiguredSubwarpMovement(
      this,
      entity,
      buildUpdates,
      nowMs,
      options,
    );
  }

  dispatchSubwarpMovementUpdates(entity, updates, options = {}) {
    return movementContractDispatch.dispatchSubwarpMovementUpdates(
      this,
      entity,
      updates,
      options,
    );
  }

  queueSubwarpMovementContract(
    entity,
    buildUpdates,
    options = {},
  ) {
    return movementContractDispatch.queueSubwarpMovementContract(
      this,
      entity,
      buildUpdates,
      options,
    );
  }

  clearPendingSubwarpMovementContract(entityOrID) {
    return movementContractDispatch.clearPendingSubwarpMovementContract(
      this,
      entityOrID,
    );
  }

  flushPendingSubwarpMovementContracts(now = this.getCurrentSimTimeMs()) {
    return movementContractDispatch.flushPendingSubwarpMovementContracts(
      this,
      now,
    );
  }

  sendStateRefresh(session, egoEntity, stampOverride = null, options = {}) {
    return movementSceneRefresh.sendStateRefresh(
      this,
      session,
      egoEntity,
      stampOverride,
      options,
    );
  }

  ensureInitialBallpark(session, options = {}) {
    if (!session || !session._space) {
      return false;
    }

    if (session._space.initialStateSent && options.force !== true) {
      return true;
    }

    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return false;
    }
    const isStructureObserver =
      session._space.observerKind === "structure" &&
      egoEntity.kind === "structure";

    refreshShipPresentationFields(egoEntity);
    const dynamicEntities = refreshEntitiesForSlimPayload(
      this.getVisibleDynamicEntitiesForSession(session),
    );
    const visibleEntities = refreshEntitiesForSlimPayload(
      this.getVisibleEntitiesForSession(session),
    );
    const stateRefreshVisibleEntities = visibleEntities.filter(
      (entity) => !isDedicatedSiteStaticVisibilityEntity(entity),
    );
    const bootstrapEntities = isStructureObserver
      ? stateRefreshVisibleEntities
      : dynamicEntities;
    // V23.02 expects the initial bootstrap as a split AddBalls2 -> SetState ->
    // prime/mode sequence. Collapsing everything into one waitForBubble batch
    // leaves Michelle stuck in "state waiting: yes" on login.
    const deferInitialBallparkStateUntilBind =
      session._space.deferInitialBallparkStateUntilBind === true;
    const deferInitialBallparkClockUntilBind =
      session._space.deferInitialBallparkClockUntilBind === true;
    const allowDeferredJumpBootstrapVisuals =
      options.allowDeferredJumpBootstrapVisuals === true;
    const skipInitialBallparkRebase = session._skipNextInitialBallparkRebase === true;
    const initialBallparkPreviousSimTimeMs = resolveBootstrapPreviousSimTimeMs(
      session,
      undefined,
    );
    const currentFactor = this.getTimeDilation();
    const rawCurrentSimTimeMs = this.getCurrentSimTimeMs();
    const initialBallparkCurrentSimTimeMs =
      initialBallparkPreviousSimTimeMs === undefined ||
      initialBallparkPreviousSimTimeMs === null
        ? this.getCurrentSessionSimTimeMs(session, rawCurrentSimTimeMs)
        : initialBallparkPreviousSimTimeMs;
    session._space.clockOffsetMs = roundNumber(
      initialBallparkCurrentSimTimeMs - rawCurrentSimTimeMs,
      3,
    );
    this.refreshSessionClockSnapshot(session, rawCurrentSimTimeMs, {
      currentSimTimeMs: initialBallparkCurrentSimTimeMs,
    });
    recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-enter", {
      options,
      deferInitialBallparkStateUntilBind,
      deferInitialBallparkClockUntilBind,
      allowDeferredJumpBootstrapVisuals,
      skipInitialBallparkRebase,
      initialBallparkPreviousSimTimeMs,
      currentFactor,
      initialBallparkCurrentSimTimeMs,
      sceneTimeState: this.buildTimeStateSnapshot(),
    });

    const syncClockOnce = () => {
      if (session._space.initialBallparkClockSynced === true) {
        return;
      }

      // Always announce the destination scene's TiDi factor as part of the
      // first jump bootstrap. Cross-system jumps that leave TiDi need the
      // client clock resynced immediately, but seeding SetState too early
      // causes Michelle to run backwards when the destination scene swaps in.
      sendTimeDilationNotificationToSession(session, currentFactor);

      const syncResult = this.syncSessionSimClock(session, {
        previousSimTimeMs: initialBallparkPreviousSimTimeMs,
        currentSimTimeMs:
          initialBallparkPreviousSimTimeMs === undefined ||
          initialBallparkPreviousSimTimeMs === null
            ? undefined
            : initialBallparkCurrentSimTimeMs,
        emit: skipInitialBallparkRebase ? false : true,
        forceRebase: skipInitialBallparkRebase ? false : true,
      });
      recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-sync-clock", {
        currentFactor,
        skipInitialBallparkRebase,
        initialBallparkPreviousSimTimeMs,
        initialBallparkCurrentSimTimeMs,
        syncResult,
      });
      session._skipNextInitialBallparkRebase = false;
      session._nextInitialBallparkPreviousSimTimeMs = null;
      session._nextInitialBallparkPreviousTimeDilation = null;
      session._nextInitialBallparkPreviousCapturedAtWallclockMs = null;
      session._space.initialBallparkClockSynced = true;
    };

    const updateVisibleDynamicEntities = () => {
      session._space.visibleDynamicEntityIDs = new Set(
        dynamicEntities
          .filter((entity) => entity.itemID !== egoEntity.itemID)
          .map((entity) => entity.itemID),
      );
      session._space.visibleBubbleScopedStaticEntityIDs = new Set(
        visibleEntities
          .filter((entity) => (
            isIncrementalStaticVisibilityEntity(entity) &&
            !isDedicatedSiteStaticVisibilityEntity(entity)
          ))
          .map((entity) => entity.itemID),
      );
      session._space.freshlyVisibleDynamicEntityIDs = new Set();
      recordVisibilityJournal(session, "bootstrap.visible-set", {
        nowMs: rawCurrentSimTimeMs,
        stamp: addBallsStamp,
        dynamicEntityIDs: dynamicEntities.map((entity) => entity.itemID),
        staticEntityIDs: visibleEntities
          .filter((entity) => (
            isIncrementalStaticVisibilityEntity(entity) &&
            !isDedicatedSiteStaticVisibilityEntity(entity)
          ))
          .map((entity) => entity.itemID),
      });
    };

    const bootstrapBaseRawStamp = this.getCurrentDestinyStamp(rawCurrentSimTimeMs);
    const bootstrapFileTime = this.getCurrentSessionFileTime(
      session,
      rawCurrentSimTimeMs,
    );
    // Deferred jump/bootstrap AddBalls must seed Michelle on the destination
    // scene clock. The continuous player-session clock is carried by the
    // paired DoSimClockRebase, not by translating the bootstrap ballpark
    // history itself into the player's prior session domain.
    const addBallsStamp = bootstrapBaseRawStamp;
    recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-bootstrap-state", {
      currentSimTimeMs: initialBallparkCurrentSimTimeMs,
      bootstrapBaseStamp: addBallsStamp,
      bootstrapBaseRawStamp,
      bootstrapFileTime,
      addBallsStamp,
      dynamicEntityCount: bootstrapEntities.length,
      visibleEntityCount: stateRefreshVisibleEntities.length,
    });

    const sendInitialBallparkDestinyUpdates = (
      payloads,
      waitForBubble = false,
      options = {},
    ) => {
      session._space.initialBallparkBootstrapInProgress = true;
      try {
        return this.sendDestinyUpdates(session, payloads, waitForBubble, options);
      } finally {
        if (session && session._space) {
          session._space.initialBallparkBootstrapInProgress = false;
        }
      }
    };

    if (
      deferInitialBallparkStateUntilBind &&
      allowDeferredJumpBootstrapVisuals === true
    ) {
      if (!deferInitialBallparkClockUntilBind) {
        syncClockOnce();
      }
      if (session._space.initialBallparkVisualsSent !== true) {
        sendInitialBallparkDestinyUpdates([
          {
            stamp: addBallsStamp,
            payload: destiny.buildAddBalls2Payload(
              addBallsStamp,
              bootstrapEntities,
              bootstrapFileTime,
            ),
          },
        ], true, buildBootstrapAcquireSendOptions({ translateStamps: false }));
        recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-addballs-only", {
          addBallsStamp,
          bootstrapFileTime,
          dynamicEntityCount: bootstrapEntities.length,
        });
        session._space.initialBallparkVisualsSent = true;
        updateVisibleDynamicEntities();
      }

      this.flushDirectDestinyNotificationBatchIfIdle();

      return true;
    }

    syncClockOnce();
    const setStateRawStamp = (bootstrapBaseRawStamp + 1) >>> 0;
    const translatedSetStateStamp = this.translateDestinyStampForSession(
      session,
      setStateRawStamp,
    );
    const setStateStamp = Math.max(
      translatedSetStateStamp,
      (addBallsStamp + 1) >>> 0,
    ) >>> 0;
    const primeStamp = setStateStamp;
    const modeStamp = setStateStamp;
    this.nextStamp = Math.max(this.nextStamp, setStateRawStamp);

    const setStateUpdate = {
      stamp: setStateStamp,
      payload: destiny.buildSetStatePayload(
        setStateStamp,
        this.system,
        egoEntity.itemID,
        stateRefreshVisibleEntities,
        bootstrapFileTime,
        buildCommandBurstDbuffStateEntriesForSession(
          session,
          egoEntity,
          rawCurrentSimTimeMs,
        ),
      ),
    };

    const primeUpdates = buildShipPrimeUpdatesForEntities(
      bootstrapEntities,
      primeStamp,
    );
    const followUp = resolveFreshAcquireBootstrapModeUpdates(
      [egoEntity],
      this.buildModeUpdates(egoEntity, modeStamp),
    );
    logBallDebug("bootstrap.ego", egoEntity, {
      addBallsStamp,
      setStateStamp,
      primeStamp,
      modeStamp,
      dynamicEntityCount: bootstrapEntities.length,
      visibleEntityCount: stateRefreshVisibleEntities.length,
      addBallsAlreadySent: session._space.initialBallparkVisualsSent === true,
      deferredStateUntilBind: deferInitialBallparkStateUntilBind,
    });

    if (session._space.initialBallparkVisualsSent !== true) {
      sendInitialBallparkDestinyUpdates([
        {
          stamp: addBallsStamp,
          payload: destiny.buildAddBalls2Payload(
            addBallsStamp,
            bootstrapEntities,
            bootstrapFileTime,
          ),
        },
      ], true, buildBootstrapAcquireSendOptions({ translateStamps: false }));
      recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-addballs", {
        addBallsStamp,
        bootstrapFileTime,
        dynamicEntityCount: bootstrapEntities.length,
      });
      session._space.initialBallparkVisualsSent = true;
    }

    sendInitialBallparkDestinyUpdates(
      [setStateUpdate],
      false,
      buildStateResetSendOptions({
        translateStamps: false,
      }),
    );
    if (session && session._space) {
      session._space.historyFloorDestinyStamp = Math.max(
        toInt(session._space.historyFloorDestinyStamp, 0) >>> 0,
        setStateStamp,
      ) >>> 0;
    }
    recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-setstate", {
      setStateStamp,
      bootstrapFileTime,
      visibleEntityCount: visibleEntities.length,
    });
    notifyActiveAssistanceJamStatesToSession(
      this,
      session,
      egoEntity,
      visibleEntities,
      rawCurrentSimTimeMs,
    );
    notifyActiveHostileJamStatesToSession(
      this,
      session,
      egoEntity,
      visibleEntities,
      rawCurrentSimTimeMs,
    );
    notifyActiveCommandBurstHudStatesToSession(
      this,
      session,
      egoEntity,
      rawCurrentSimTimeMs,
    );
    if (primeUpdates.length > 0) {
      sendInitialBallparkDestinyUpdates(primeUpdates, false, {
        translateStamps: false,
        destinyAuthorityContract: DESTINY_CONTRACTS.BOOTSTRAP_ACQUIRE,
      });
      recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-prime", {
        primeStamp,
        primeUpdateCount: primeUpdates.length,
      });
    }
    if (followUp.length > 0) {
      sendInitialBallparkDestinyUpdates(followUp, false, {
        translateStamps: false,
        destinyAuthorityContract: DESTINY_CONTRACTS.BOOTSTRAP_ACQUIRE,
      });
      recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-followup", {
        modeStamp,
        followUpCount: followUp.length,
      });
    }
    const activeSpecialFxReplayUpdates = buildFreshAcquireActiveSpecialFxReplayUpdates(
      bootstrapEntities,
      modeStamp,
      rawCurrentSimTimeMs,
      {
        session,
      },
    );
    if (activeSpecialFxReplayUpdates.length > 0) {
      sendInitialBallparkDestinyUpdates(activeSpecialFxReplayUpdates, false, {
        translateStamps: false,
        destinyAuthorityContract: DESTINY_CONTRACTS.BOOTSTRAP_ACQUIRE,
      });
      recordSessionJumpTimingTrace(
        session,
        "ensure-initial-ballpark-active-special-fx",
        {
          modeStamp,
          replayCount: activeSpecialFxReplayUpdates.length,
        },
      );
    }

    session._space.initialStateSent = true;
    session._space.pendingUndockMovement = false;
    session._space.deferInitialBallparkClockUntilBind = false;
    session._space.deferInitialBallparkStateUntilBind = false;
    updateVisibleDynamicEntities();
    autoMaterializeNearbyUniverseSiteForAttach(this, egoEntity, {
      broadcast: false,
      session,
      nowMs: rawCurrentSimTimeMs,
    });
    this.syncStaticVisibilityForSession(session, rawCurrentSimTimeMs, {
      stampOverride: modeStamp,
    });
    this.syncSessionStructureTetherState(session, {
      nowMs: rawCurrentSimTimeMs,
      forceReplayFx: true,
    });
    this.runPostAttachVisibilityReconciliation(session, rawCurrentSimTimeMs, {
      stampOverride: modeStamp,
      source: "ensureInitialBallpark",
    });
    this.flushDirectDestinyNotificationBatchIfIdle();
    return true;
  }

  broadcastAddBalls(entities, excludedSession = null, options = {}) {
    if (entities.length === 0) {
      return [];
    }

    const refreshedEntities = refreshEntitiesForSlimPayload(entities);
    const rawSimTimeMs = this.getCurrentSimTimeMs();
    const deliveries = [];

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      const initialBallparkReady =
        session &&
        session._space &&
        session._space.initialStateSent === true;
      const visibleEntities = this.filterBallparkEntitiesForSession(
        session,
        refreshedEntities.filter((entity) =>
          canSessionSeeAddedBallForBroadcast(this, session, entity, rawSimTimeMs) &&
          (
            initialBallparkReady ||
            // Dedicated site statics must not arrive before the initial
            // AddBalls2/SetState bootstrap, or Michelle can wipe them while the
            // server still believes the session has acquired them.
            !isDedicatedSiteStaticVisibilityEntity(entity)
          ),
        ),
      );
      if (visibleEntities.length === 0) {
        continue;
      }
      const sendResult = this.sendAddBallsToSession(session, visibleEntities, {
        freshAcquire: options.freshAcquire === true,
        minimumLeadFromCurrentHistory: options.minimumLeadFromCurrentHistory,
        maximumLeadFromCurrentHistory: options.maximumLeadFromCurrentHistory,
        stampOverride: options.stampOverride,
        nowMs: rawSimTimeMs,
        bypassTickPresentationBatch:
          options.bypassTickPresentationBatch === true,
      });
      deliveries.push({
        session,
        stamp:
          sendResult && sendResult.stamp !== null && sendResult.stamp !== undefined
            ? (toInt(sendResult.stamp, 0) >>> 0)
            : null,
        entities: visibleEntities,
      });
      recordVisibilityJournal(session, "broadcast.add", {
        nowMs: rawSimTimeMs,
        stamp:
          sendResult && sendResult.stamp !== null && sendResult.stamp !== undefined
            ? (toInt(sendResult.stamp, 0) >>> 0)
            : null,
        addedEntityIDs: visibleEntities.map((entity) => entity.itemID),
        source: "broadcastAddBalls",
      });
      if (session._space) {
        const currentIDs =
          session._space.visibleDynamicEntityIDs instanceof Set
            ? session._space.visibleDynamicEntityIDs
            : new Set();
        const freshIDs =
          session._space.freshlyVisibleDynamicEntityIDs instanceof Set
            ? session._space.freshlyVisibleDynamicEntityIDs
            : new Set();
        for (const entity of visibleEntities) {
          const entityID = toInt(entity && entity.itemID, 0);
          if (
            entityID > 0 &&
            entityID !== session._space.shipID &&
            this.dynamicEntities.has(entityID)
          ) {
            currentIDs.add(entity.itemID);
            freshIDs.add(entity.itemID);
          }
        }
        session._space.visibleDynamicEntityIDs = currentIDs;
        session._space.freshlyVisibleDynamicEntityIDs = freshIDs;
        const visibleStaticIDs =
          session._space.visibleBubbleScopedStaticEntityIDs instanceof Set
            ? session._space.visibleBubbleScopedStaticEntityIDs
            : new Set();
        for (const entity of visibleEntities) {
          const entityID = toInt(entity && entity.itemID, 0);
          if (
            entityID > 0 &&
            isIncrementalStaticVisibilityEntity(entity) &&
            this.staticEntitiesByID.has(entityID)
          ) {
            visibleStaticIDs.add(entityID);
          }
        }
        session._space.visibleBubbleScopedStaticEntityIDs = visibleStaticIDs;
      }
    }
    this.flushDirectDestinyNotificationBatchIfIdle();
    return deliveries;
  }

  broadcastRemoveBall(entityID, excludedSession = null, options = {}) {
    const normalizedEntityID = toInt(entityID, 0);
    const terminalDestructionEffectID = toInt(
      options && options.terminalDestructionEffectID,
      0,
    );
    const visibilityEntity =
      options && options.visibilityEntity && typeof options.visibilityEntity === "object"
        ? options.visibilityEntity
        : null;
    const rawNowMs =
      options && options.nowMs !== undefined && options.nowMs !== null
        ? toFiniteNumber(options.nowMs, this.getCurrentSimTimeMs())
        : this.getCurrentSimTimeMs();
    const useSceneAlignedStamp =
      (options && options.clampToVisibleStamp === true) ||
      this.hasActiveTickDestinyPresentationBatch();
    const baseStamp =
      options && options.stampOverride !== undefined && options.stampOverride !== null
        ? (
          toInt(
            options.stampOverride,
            useSceneAlignedStamp
              ? this.getCurrentDestinyStamp(rawNowMs)
              : this.getNextDestinyStamp(rawNowMs),
          ) >>> 0
        )
        : useSceneAlignedStamp
          ? this.getCurrentDestinyStamp(rawNowMs)
          : this.getNextDestinyStamp(rawNowMs);
    const clampToVisibleStamp = options && options.clampToVisibleStamp === true;
    const removalVisibilityEntity =
      visibilityEntity && typeof visibilityEntity === "object"
        ? visibilityEntity
        : null;
    const forcedVisibleSessions = Array.isArray(
      options && options.forceVisibleSessions,
    )
      ? options.forceVisibleSessions
      : [];
    const forcedVisibleSessionObjects = new Set();
    const forcedVisibleClientIDs = new Set();
    for (const candidate of forcedVisibleSessions) {
      if (!candidate) {
        continue;
      }
      if (typeof candidate === "object") {
        forcedVisibleSessionObjects.add(candidate);
        const candidateClientID = toInt(candidate.clientID, 0);
        if (candidateClientID > 0) {
          forcedVisibleClientIDs.add(candidateClientID);
        }
        continue;
      }
      const candidateClientID = toInt(candidate, 0);
      if (candidateClientID > 0) {
        forcedVisibleClientIDs.add(candidateClientID);
      }
    }
    const explodingNonMissileRemoval =
      terminalDestructionEffectID > 0 &&
      (!removalVisibilityEntity || removalVisibilityEntity.kind !== "missile");
    const resolveSessionStamp =
      options && typeof options.resolveSessionStamp === "function"
        ? options.resolveSessionStamp
        : explodingNonMissileRemoval
          ? (session, context = {}) =>
            resolveExplodingNonMissileDestructionSessionStamp(
              this,
              session,
              context.nowMs,
              context.baseStamp,
            )
        : terminalDestructionEffectID > 0
          // RemoveBalls is still a critical Destiny action, so exploding removals
          // need the same history-safe +1 treatment as other owner-visible
          // critical updates to avoid Michelle rebasing back a tick.
          ? (session, context = {}) =>
            this.getHistorySafeSessionDestinyStamp(
              session,
              context.nowMs,
              MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
              MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
            )
          : null;

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      const visibleEntityIDs =
        session._space && session._space.visibleDynamicEntityIDs instanceof Set
          ? session._space.visibleDynamicEntityIDs
          : null;
      const wasMarkedVisible =
        visibleEntityIDs instanceof Set && visibleEntityIDs.has(normalizedEntityID);
      const forcedVisible =
        forcedVisibleSessionObjects.has(session) ||
        forcedVisibleClientIDs.has(toInt(session && session.clientID, 0));
      const canStillSeeEntity =
        visibilityEntity && this.canSessionSeeDynamicEntity(session, visibilityEntity);
      if (!wasMarkedVisible && !forcedVisible && !canStillSeeEntity) {
        continue;
      }

      const missileLifecycleVisible =
        removalVisibilityEntity && removalVisibilityEntity.kind === "missile";
      const ownerMissileLifecycleVisible = isOwnerLaunchedMissileVisibleToSession(
        session,
        removalVisibilityEntity,
      );
      const currentSessionStamp = this.getCurrentSessionDestinyStamp(
        session,
        rawNowMs,
      );
      const visibleStamp = clampToVisibleStamp
        ? ownerMissileLifecycleVisible
          ? this.getImmediateDestinyStampForSession(
            session,
            currentSessionStamp,
          )
          : this.getCurrentVisibleDestinyStampForSession(session, baseStamp)
        : baseStamp;
      const resolvedStamp = ownerMissileLifecycleVisible
        ? null
        : resolveSessionStamp
        ? resolveSessionStamp(session, {
          baseStamp,
          visibleStamp,
          nowMs: rawNowMs,
          entityID: normalizedEntityID,
        })
        : null;
      const stamp = ownerMissileLifecycleVisible
        ? Math.max(
          baseStamp,
          currentSessionStamp,
          visibleStamp,
        ) >>> 0
        : Number.isFinite(Number(resolvedStamp))
        ? Math.max(
          baseStamp,
          visibleStamp,
          toInt(resolvedStamp, visibleStamp) >>> 0,
        ) >>> 0
        : visibleStamp;
      const updates = [];
      if (terminalDestructionEffectID > 0) {
        updates.push({
          stamp,
          payload: destiny.buildTerminalPlayDestructionEffectPayload(
            normalizedEntityID,
            terminalDestructionEffectID,
          ),
        });
      }
      updates.push({
        stamp,
        payload: destiny.buildRemoveBallsPayload([normalizedEntityID]),
      });
      const sendOptions = ownerMissileLifecycleVisible
        ? buildOwnerMissileLifecycleSendOptions({
            translateStamps: clampToVisibleStamp ? false : undefined,
          })
        : missileLifecycleVisible
          ? buildObserverCombatPresentedSendOptions({
              translateStamps: clampToVisibleStamp ? false : undefined,
            })
          : explodingNonMissileRemoval
            // `client/funky.txt` still showed exploding non-missile
            // TerminalPlay/RemoveBalls landing one tick behind the already
            // presented kill lane during queued presentation flush. Keep the
            // authored teardown stamp, but let the queued delivery realign to
            // the current presented lane instead of replaying the stale one.
            ? buildPresentedSessionAlignedDestinySendOptions({
                translateStamps: clampToVisibleStamp ? false : undefined,
              })
          : {
            translateStamps: clampToVisibleStamp ? false : undefined,
          };
      let preparedUpdates = updates;
      if (missileLifecycleVisible) {
        preparedUpdates = tagUpdatesMissileLifecycleGroup(preparedUpdates);
      }
      if (ownerMissileLifecycleVisible) {
        preparedUpdates = tagUpdatesOwnerMissileLifecycleGroup(preparedUpdates);
      }
      if (missileLifecycleVisible && !ownerMissileLifecycleVisible) {
        const currentVisibleSessionStamp = this.getCurrentVisibleSessionDestinyStamp(
          session,
          rawNowMs,
        );
        const currentPresentedSessionStamp =
          this.getCurrentPresentedSessionDestinyStamp(
            session,
            rawNowMs,
            Math.max(
              MICHELLE_HELD_FUTURE_DESTINY_LEAD,
              MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
            ),
          );
        const currentRawDispatchStamp = this.getCurrentDestinyStamp(rawNowMs);
        const authorityState = snapshotDestinyAuthorityState(session);
        const lastSentDestinyStamp = toInt(
          authorityState && authorityState.lastPresentedStamp,
          session && session._space && session._space.lastSentDestinyStamp,
          0,
        ) >>> 0;
        const lastSentDestinyRawDispatchStamp = toInt(
          authorityState && authorityState.lastRawDispatchStamp,
          session && session._space && session._space.lastSentDestinyRawDispatchStamp,
          0,
        ) >>> 0;
        const projectedObserverPresentedFloorStamp =
          lastSentDestinyStamp > 0 &&
          lastSentDestinyRawDispatchStamp > 0 &&
          currentRawDispatchStamp > lastSentDestinyRawDispatchStamp &&
          (
            currentRawDispatchStamp - lastSentDestinyRawDispatchStamp
          ) <= 1 &&
          !(
            authorityState &&
            authorityState.lastSentOnlyStaleProjectedOwnerMissileLane === true
          )
            ? projectPreviouslySentDestinyLane(
                lastSentDestinyStamp,
                lastSentDestinyRawDispatchStamp,
                currentRawDispatchStamp,
              )
            : 0;
        // Cap presented and projected floors so missile RemoveBalls stamps
        // stay within delta 2 of the client's _current_time.  Without this
        // cap, the lastSentStamp feedback loop in
        // getCurrentPresentedSessionDestinyStamp and the lane projection
        // push stamps far beyond the dispatch max lead.  The dispatch's
        // max-clamp tolerance intentionally skips clamping for stamps far
        // above max (designed for missile restamp), so inflated floors pass
        // through unclamped, ratcheting lastSentStamp ever higher.
        // CCP parity: visibleStamp + ECHO_LEAD(1) keeps delivery at
        // delta ~2 from the client — safely inside Michelle's held-future
        // window (delta < 3).
        const maxHeldFutureStamp = currentVisibleSessionStamp > 0
          ? ((currentVisibleSessionStamp + MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD) >>> 0)
          : 0;
        const cappedPresentedFloorStamp = maxHeldFutureStamp > 0 &&
          currentPresentedSessionStamp > maxHeldFutureStamp
            ? maxHeldFutureStamp
            : currentPresentedSessionStamp;
        const cappedProjectedFloorStamp = maxHeldFutureStamp > 0 &&
          projectedObserverPresentedFloorStamp > maxHeldFutureStamp
            ? maxHeldFutureStamp
            : projectedObserverPresentedFloorStamp;
        if (
          currentVisibleSessionStamp > 0 ||
          cappedPresentedFloorStamp > 0 ||
          cappedProjectedFloorStamp > 0
        ) {
          preparedUpdates = clampQueuedSubwarpUpdates({
            queuedUpdates: preparedUpdates,
            visibleFloorStamp: currentVisibleSessionStamp,
            presentedFloorStamp: cappedPresentedFloorStamp,
            projectedFloorStamp: cappedProjectedFloorStamp,
            restampPayloadState: destiny.restampPayloadState,
          });
        }
      }
      if (missileLifecycleVisible) {
        logMissileDebug("missile.remove-ball.dispatch", {
          sceneSystemID: this.systemID,
          entityID: normalizedEntityID,
          terminalDestructionEffectID,
          clampToVisibleStamp,
          baseStamp,
          visibleStamp,
          resolvedStamp:
            Number.isFinite(Number(resolvedStamp))
              ? (toInt(resolvedStamp, 0) >>> 0)
              : null,
          finalStamp: stamp,
          ownerMissileLifecycleVisible,
          session: buildMissileSessionSnapshot(this, session, rawNowMs),
          missile: summarizeMissileEntity(removalVisibilityEntity),
          sendOptions: normalizeTraceValue(sendOptions),
          updates: summarizeMissileUpdatesForLog(preparedUpdates),
        });
      }

      // Be tolerant of visibility-cache drift so observers still drop ghost balls
      // when the scene says they can see the entity but the cached set missed it.
      if (this.hasActiveTickDestinyPresentationBatch()) {
        this.queueTickDestinyPresentationUpdates(session, preparedUpdates, {
          sendOptions,
          getDedupeKey: (update) => {
            if (!update || !Array.isArray(update.payload)) {
              return null;
            }
            const name = update.payload[0];
            if (name === "RemoveBalls") {
              return `remove:${normalizedEntityID}`;
            }
            if (name === "TerminalPlayDestructionEffect") {
              return `destroy:${normalizedEntityID}`;
            }
            return null;
          },
        });
      } else {
        this.sendDestinyUpdates(session, preparedUpdates, false, sendOptions);
      }
      recordVisibilityJournal(session, "broadcast.remove", {
        nowMs: rawNowMs,
        stamp,
        removedEntityIDs: [normalizedEntityID],
        wasMarkedVisible,
        forcedVisible,
        canStillSeeEntity: Boolean(canStillSeeEntity),
        source: "broadcastRemoveBall",
      });
      if (visibleEntityIDs instanceof Set) {
        visibleEntityIDs.delete(normalizedEntityID);
      }
    }
  }

  broadcastRemoveStaticEntity(entityID, excludedSession = null, options = {}) {
    const normalizedEntityID = toInt(entityID, 0);
    const terminalDestructionEffectID = toInt(
      options && options.terminalDestructionEffectID,
      0,
    );
    const rawNowMs =
      options && options.nowMs !== undefined && options.nowMs !== null
        ? toFiniteNumber(options.nowMs, this.getCurrentSimTimeMs())
        : this.getCurrentSimTimeMs();
    const useSceneAlignedStamp = this.hasActiveTickDestinyPresentationBatch();
    const baseStamp =
      options && options.stampOverride !== undefined && options.stampOverride !== null
        ? (
          toInt(
            options.stampOverride,
            useSceneAlignedStamp
              ? this.getCurrentDestinyStamp(rawNowMs)
              : this.getNextDestinyStamp(rawNowMs),
          ) >>> 0
        )
        : useSceneAlignedStamp
          ? this.getCurrentDestinyStamp(rawNowMs)
          : this.getNextDestinyStamp(rawNowMs);
    let deliveredCount = 0;

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }

      const visibleStamp = this.getCurrentVisibleDestinyStampForSession(
        session,
        baseStamp,
      );
      const stamp =
        terminalDestructionEffectID > 0
          // Static explosion removals use the same history-safe critical stamp so
          // the destruction burst does not land one tick behind the active view.
          ? Math.max(
            visibleStamp,
            this.getHistorySafeSessionDestinyStamp(
              session,
              rawNowMs,
              MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
              MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
            ),
          ) >>> 0
          : visibleStamp;
      const updates = [];
      if (terminalDestructionEffectID > 0) {
        updates.push({
          stamp,
          payload: destiny.buildTerminalPlayDestructionEffectPayload(
            normalizedEntityID,
            terminalDestructionEffectID,
          ),
        });
      }
      updates.push({
        stamp,
        payload: destiny.buildRemoveBallsPayload([normalizedEntityID]),
      });

      if (this.hasActiveTickDestinyPresentationBatch()) {
        this.queueTickDestinyPresentationUpdates(session, updates, {
          sendOptions: buildDestructionTeardownSendOptions({
            translateStamps: false,
          }),
          getDedupeKey: (update) => {
            if (!update || !Array.isArray(update.payload)) {
              return null;
            }
            const name = update.payload[0];
            if (name === "RemoveBalls") {
              return `remove:${normalizedEntityID}`;
            }
            if (name === "TerminalPlayDestructionEffect") {
              return `destroy:${normalizedEntityID}`;
            }
            return null;
          },
        });
      } else {
        this.sendDestinyUpdates(
          session,
          updates,
          false,
          buildDestructionTeardownSendOptions({
            translateStamps: false,
          }),
        );
      }

      recordVisibilityJournal(session, "broadcast.static-remove", {
        nowMs: rawNowMs,
        stamp,
        removedStaticEntityIDs: [normalizedEntityID],
        source: "broadcastRemoveStaticEntity",
      });

      if (session._space) {
        if (session._space.visibleDynamicEntityIDs instanceof Set) {
          session._space.visibleDynamicEntityIDs.delete(normalizedEntityID);
        }
        if (session._space.freshlyVisibleDynamicEntityIDs instanceof Set) {
          session._space.freshlyVisibleDynamicEntityIDs.delete(normalizedEntityID);
        }
      }
      deliveredCount += 1;
    }

    return {
      deliveredCount,
    };
  }

  broadcastMovementUpdates(updates, excludedSession = null, options = {}) {
    if (updates.length === 0) {
      return;
    }
    const rawOptions =
      options && typeof options === "object"
        ? options
        : {};

    for (const session of this.sessions.values()) {
      if (
        sessionMatchesIdentity(session, excludedSession) ||
        (
          rawOptions.suppressedSessions instanceof Set &&
          rawOptions.suppressedSessions.has(session)
        ) ||
        !isReadyForDestiny(session)
      ) {
        continue;
      }
      const filteredUpdates = this.filterMovementUpdatesForSession(
        session,
        updates,
      );
      if (filteredUpdates.length > 0) {
        let preparedUpdates = filteredUpdates;
        const egoShipID =
          session && session._space
            ? (toInt(session._space.shipID, 0) >>> 0)
            : 0;
        let containsObserverMovementContract = false;
        let observerMovementAuthoredStamp = 0;
        if (egoShipID > 0) {
          for (const update of filteredUpdates) {
            const payload = update && Array.isArray(update.payload)
              ? update.payload
              : null;
            if (!payload || !isMovementContractPayload(payload)) {
              continue;
            }
            if (getPayloadPrimaryEntityID(payload) === egoShipID) {
              continue;
            }
            containsObserverMovementContract = true;
            observerMovementAuthoredStamp = toInt(
              update && update.stamp,
              observerMovementAuthoredStamp,
            ) >>> 0;
            break;
          }
        }
        if (containsObserverMovementContract) {
          const currentVisibleSessionStamp =
            this.getCurrentVisibleSessionDestinyStamp(session);
          const currentPresentedSessionStamp =
            this.getCurrentPresentedSessionDestinyStamp(
              session,
              undefined,
              PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
            );
          const currentRawDispatchStamp = this.getCurrentDestinyStamp();
          const authorityState = snapshotDestinyAuthorityState(session);
          const lastSentDestinyStamp = toInt(
            authorityState && authorityState.lastPresentedStamp,
            session._space && session._space.lastSentDestinyStamp,
            0,
          ) >>> 0;
          const lastSentDestinyRawDispatchStamp = toInt(
            authorityState && authorityState.lastRawDispatchStamp,
            session._space && session._space.lastSentDestinyRawDispatchStamp,
            0,
          ) >>> 0;
          const projectedObserverFloorStamp =
            lastSentDestinyStamp > 0 &&
            lastSentDestinyRawDispatchStamp > 0 &&
            currentRawDispatchStamp > lastSentDestinyRawDispatchStamp &&
            (
              currentRawDispatchStamp - lastSentDestinyRawDispatchStamp
            ) <= 1 &&
            !(
              authorityState &&
              authorityState.lastSentOnlyStaleProjectedOwnerMissileLane === true
            )
              ? projectPreviouslySentDestinyLane(
                  lastSentDestinyStamp,
                  lastSentDestinyRawDispatchStamp,
                  currentRawDispatchStamp,
                )
              : 0;
          const visibleObserverFloorStamp =
            currentVisibleSessionStamp > observerMovementAuthoredStamp
              ? currentVisibleSessionStamp
              : 0;
          // Cap presented and projected floors to the held-future window
          // to prevent stamp inflation from the lastSentStamp feedback
          // loop.  Same fix as broadcastRemoveBall's missile lifecycle
          // path — keeps observer movement stamps within delta 2 of the
          // client.
          const maxObserverFloorStamp = currentVisibleSessionStamp > 0
            ? ((currentVisibleSessionStamp + MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD) >>> 0)
            : 0;
          const cappedObserverPresentedFloor = maxObserverFloorStamp > 0 &&
            currentPresentedSessionStamp > maxObserverFloorStamp
              ? maxObserverFloorStamp
              : currentPresentedSessionStamp;
          const cappedObserverProjectedFloor = maxObserverFloorStamp > 0 &&
            projectedObserverFloorStamp > maxObserverFloorStamp
              ? maxObserverFloorStamp
              : projectedObserverFloorStamp;
          if (
            visibleObserverFloorStamp > 0 ||
            cappedObserverPresentedFloor > 0 ||
            cappedObserverProjectedFloor > 0
          ) {
            preparedUpdates = clampQueuedSubwarpUpdates({
              queuedUpdates: filteredUpdates,
              visibleFloorStamp: visibleObserverFloorStamp,
              presentedFloorStamp: cappedObserverPresentedFloor,
              projectedFloorStamp: cappedObserverProjectedFloor,
              restampPayloadState: destiny.restampPayloadState,
            });
          }
        }
        this.sendDestinyUpdates(session, preparedUpdates, false, rawOptions);
      }
    }
  }

  broadcastShipPrimeUpdates(entity, options = {}) {
    if (!entity || entity.kind !== "ship") {
      return {
        stamp: null,
        deliveredCount: 0,
      };
    }

    const defaultStamp =
      options.stampMode === "currentVisible"
        ? this.getCurrentDestinyStamp()
        : this.getNextDestinyStamp();
    const baseStamp =
      options.stampOverride === undefined || options.stampOverride === null
        ? defaultStamp
        : toInt(options.stampOverride, defaultStamp);
    const primeUpdates = buildShipPrimeUpdates(entity, baseStamp);
    if (primeUpdates.length === 0) {
      return {
        stamp: baseStamp,
        deliveredCount: 0,
      };
    }

    let deliveredCount = 0;
    for (const session of this.sessions.values()) {
      if (
        sessionMatchesIdentity(session, options.excludedSession) ||
        !isReadyForDestiny(session)
      ) {
        continue;
      }
      const filteredUpdates = this.filterMovementUpdatesForSession(
        session,
        primeUpdates,
      );
      if (filteredUpdates.length === 0) {
        continue;
      }

      if (options.stampMode === "currentVisible") {
        const sessionStamp = this.getCurrentVisibleSessionDestinyStamp(session);
        this.sendDestinyUpdates(
          session,
          filteredUpdates.map((update) => ({
            ...update,
            stamp: sessionStamp,
          })),
          false,
          {
            translateStamps: false,
            destinyAuthorityContract:
              DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
          },
        );
      } else {
        this.sendDestinyUpdates(
          session,
          filteredUpdates,
          false,
          {
            destinyAuthorityContract:
              DESTINY_CONTRACTS.CRITICAL_MOVEMENT_OR_SHIPPRIME,
            ...(options.sendOptions || {}),
          },
        );
      }
      deliveredCount += 1;
    }

    return {
      stamp: baseStamp,
      deliveredCount,
    };
  }

  filterMovementUpdatesForSession(session, updates) {
    if (!session || !isReadyForDestiny(session) || !Array.isArray(updates)) {
      return [];
    }
    const suppressNonEgoDynamicUpdates = this.isSessionInPilotWarpQuietWindow(session);
    const egoShipID =
      session._space && toInt(session._space.shipID, 0) > 0
        ? toInt(session._space.shipID, 0)
        : 0;
    const egoShipHasSpeedStartUpdate =
      egoShipID > 0 &&
      updates.some((candidate) => (
        getPayloadPrimaryEntityID(candidate && candidate.payload) === egoShipID &&
        Array.isArray(candidate && candidate.payload) &&
        candidate.payload[0] === "SetSpeedFraction"
      ));
    const currentSessionStamp = this.getCurrentSessionDestinyStamp(session);
    const freshVisibilityReleaseStampByID =
      session._space &&
      session._space.freshlyVisibleDynamicEntityReleaseStampByID instanceof Map
        ? session._space.freshlyVisibleDynamicEntityReleaseStampByID
        : null;

    return updates.filter((update) => {
      const entityID = getPayloadPrimaryEntityID(update && update.payload);
      if (!entityID) {
        return true;
      }
      const entity = this.dynamicEntities.get(entityID);
      if (egoShipID > 0 && entityID === egoShipID) {
        if (entity && (entity.pendingWarp || entity.warpState)) {
          return false;
        }
        return true;
      }
      if (suppressNonEgoDynamicUpdates) {
        return false;
      }
      if (!entity) {
        return true;
      }
      if (update && update.requireExistingVisibility === true) {
        const protectedReleaseStamp =
          freshVisibilityReleaseStampByID instanceof Map
            ? toInt(freshVisibilityReleaseStampByID.get(entityID), 0) >>> 0
            : 0;
        if (
          protectedReleaseStamp > 0 &&
          currentSessionStamp <= protectedReleaseStamp
        ) {
          return false;
        }
        if (
          protectedReleaseStamp > 0 &&
          currentSessionStamp > protectedReleaseStamp &&
          freshVisibilityReleaseStampByID instanceof Map
        ) {
          freshVisibilityReleaseStampByID.delete(entityID);
        }
        return Boolean(
          session._space &&
          session._space.visibleDynamicEntityIDs instanceof Set &&
          session._space.visibleDynamicEntityIDs.has(entityID) &&
          !(
            session._space.freshlyVisibleDynamicEntityIDs instanceof Set &&
            session._space.freshlyVisibleDynamicEntityIDs.has(entityID)
          ),
        );
      }
      return this.canSessionSeeDynamicEntity(session, entity);
    });
  }

  broadcastMovementUpdatesWithSpecialFx(
    updates,
    shipID,
    guid,
    fxOptions = {},
    visibilityEntity = null,
    excludedSession = null,
    options = {},
  ) {
    const movementUpdates = Array.isArray(updates) ? updates : [];
    const stampOverride =
      fxOptions && Object.prototype.hasOwnProperty.call(fxOptions, "stampOverride")
        ? fxOptions.stampOverride
        : null;
    const minimumLeadFromCurrentHistory = clamp(
      Math.max(
        toInt(options.minimumLeadFromCurrentHistory, 0),
        toInt(fxOptions && fxOptions.minimumLeadFromCurrentHistory, 0),
      ),
      0,
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    );
    const rawFxOptions =
      fxOptions && typeof fxOptions === "object"
        ? { ...fxOptions }
        : {};
    delete rawFxOptions.stampOverride;
    delete rawFxOptions.minimumLeadFromCurrentHistory;
    const baseStamp =
      stampOverride === undefined || stampOverride === null
        ? this.getNextDestinyStamp()
        : toInt(stampOverride, this.getNextDestinyStamp());
    const { payloads: fxPayloads } = buildSpecialFxPayloadsForEntity(
      shipID,
      guid,
      rawFxOptions,
      visibilityEntity,
    );
    let deliveredCount = 0;

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }

      const filteredUpdates = this.filterMovementUpdatesForSession(
        session,
        movementUpdates,
      );
      const canReceiveFx =
        !visibilityEntity ||
        (
          session._space &&
          toInt(session._space.shipID, 0) === toInt(visibilityEntity.itemID, 0)
        ) ||
        this.canSessionSeeDynamicEntity(session, visibilityEntity);
      if (filteredUpdates.length === 0 && !canReceiveFx) {
        continue;
      }

      const sessionUpdates = [...filteredUpdates];
      if (canReceiveFx) {
        for (const fxPayload of fxPayloads) {
          sessionUpdates.push({
            stamp: baseStamp,
            payload: fxPayload,
          });
        }
      }
      if (sessionUpdates.length === 0) {
        continue;
      }

      this.sendDestinyUpdates(session, sessionUpdates, false, {
        minimumLeadFromCurrentHistory:
          minimumLeadFromCurrentHistory > 0
            ? minimumLeadFromCurrentHistory
            : undefined,
      });
      deliveredCount += 1;
    }

    return {
      stamp: baseStamp,
      deliveredCount,
    };
  }

  scheduleWatcherMovementAnchor(
    entity,
    now = this.getCurrentSimTimeMs(),
    reason = "movement",
  ) {
    return movementSceneRefresh.scheduleWatcherMovementAnchor(
      this,
      entity,
      now,
      reason,
    );
  }

  gotoDirection(session, direction, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (isSuperweaponMovementLocked(entity, this.getCurrentSimTimeMs())) {
      return false;
    }
    const result = dispatchGotoDirection(this, session, direction, options);
    if (result) {
      this.flushDirectDestinyNotificationBatchIfIdle();
    }
    return result;
  }

  gotoPoint(session, point, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (isSuperweaponMovementLocked(entity, this.getCurrentSimTimeMs())) {
      return false;
    }
    const result = dispatchGotoPoint(this, session, point, options);
    if (result) {
      this.flushDirectDestinyNotificationBatchIfIdle();
    }
    return result;
  }

  alignTo(session, targetEntityID) {
    const entity = this.getShipEntityForSession(session);
    if (isSuperweaponMovementLocked(entity, this.getCurrentSimTimeMs())) {
      return false;
    }
    const result = dispatchAlignTo(this, session, targetEntityID);
    if (result) {
      this.flushDirectDestinyNotificationBatchIfIdle();
    }
    return result;
  }

  followShipEntity(entityOrID, targetEntityID, range = 0, options = {}) {
    return dispatchFollowShipEntity(
      this,
      entityOrID,
      targetEntityID,
      range,
      options,
    );
  }

  followBall(session, targetEntityID, range = 0, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (isSuperweaponMovementLocked(entity, this.getCurrentSimTimeMs())) {
      return false;
    }
    const result = dispatchFollowBall(this, session, targetEntityID, range, options);
    if (result) {
      this.flushDirectDestinyNotificationBatchIfIdle();
    }
    return result;
  }

  orbitShipEntity(entityOrID, targetEntityID, distanceValue = 0, options = {}) {
    return dispatchOrbitShipEntity(
      this,
      entityOrID,
      targetEntityID,
      distanceValue,
      options,
    );
  }

  orbit(session, targetEntityID, distanceValue = 0, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (isSuperweaponMovementLocked(entity, this.getCurrentSimTimeMs())) {
      return false;
    }
    const result = dispatchOrbit(this, session, targetEntityID, distanceValue, options);
    if (result) {
      this.flushDirectDestinyNotificationBatchIfIdle();
    }
    return result;
  }

  warpToEntity(session, targetEntityID, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (isSuperweaponMovementLocked(entity, this.getCurrentSimTimeMs())) {
      return {
        success: false,
        errorMsg: "SHIP_IMMOBILE",
      };
    }
    const targetEntity = this.getEntityByID(targetEntityID);
    if (targetEntity && targetEntity.kind === "wormhole") {
      try {
        const wormholeRuntime = require(path.join(
          __dirname,
          "../services/exploration/wormholes/wormholeRuntime",
        ));
        wormholeRuntime.markWarpInitiated(targetEntityID, this.getCurrentSimTimeMs());
        wormholeRuntime.syncSceneEntities(this, this.getCurrentSimTimeMs());
      } catch (error) {
        log.warn(
          `[SpaceRuntime] Wormhole warp pre-activation failed for system=${this.systemID} target=${targetEntityID}: ${error.message}`,
        );
      }
    }
    return dispatchWarpToEntity(this, session, targetEntityID, options);
  }

  warpToPoint(session, point, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (isSuperweaponMovementLocked(entity, this.getCurrentSimTimeMs())) {
      return {
        success: false,
        errorMsg: "SHIP_IMMOBILE",
      };
    }
    if (hostileModuleRuntime.isEntityWarpScrambled(entity)) {
      return {
        success: false,
        errorMsg: "WARP_SCRAMBLED",
      };
    }
    return dispatchWarpToPoint(this, session, point, options);
  }

  warpDynamicEntityToPoint(entityOrID, point, options = {}) {
    return dispatchWarpDynamicEntityToPoint(this, entityOrID, point, options);
  }

  forceStartPendingWarp(entityOrID, options = {}) {
    return dispatchForceStartPendingWarp(this, entityOrID, options);
  }

  sendSessionlessWarpStartToVisibleSessions(entity, updates) {
    return dispatchSendSessionlessWarpStartToVisibleSessions(
      this,
      entity,
      updates,
    );
  }

  startSessionlessWarpIngress(entityOrID, point, options = {}) {
    return dispatchStartSessionlessWarpIngress(this, entityOrID, point, options);
  }

  teleportDynamicEntityToPoint(entityOrID, point, options = {}) {
    const entity =
      typeof entityOrID === "object" && entityOrID !== null
        ? entityOrID
        : this.getEntityByID(entityOrID);
    if (!entity || !this.dynamicEntities.has(entity.itemID)) {
      return {
        success: false,
        errorMsg: "DYNAMIC_ENTITY_NOT_FOUND",
      };
    }

    const now = this.getCurrentSimTimeMs();
    const movementStamp = this.getMovementStamp(now);
    const previousBubbleID = toInt(entity.bubbleID, 0);
    const previousPublicGridClusterKey = entity.publicGridClusterKey || null;

    entity.position = cloneVector(point, entity.position);
    entity.direction = normalizeVector(
      options.direction,
      entity.direction || { x: 1, y: 0, z: 0 },
    );
    resetEntityMotion(entity);
    entity.lastObserverCorrectionBroadcastAt = 0;
    entity.lastObserverPositionBroadcastAt = 0;
    entity.lastWarpCorrectionBroadcastAt = 0;
    this.reconcileEntityPublicGrid(entity);
    this.reconcileEntityBubble(entity);
    this.publicGridCompositionDirty = true;
    this.ensurePublicGridComposition();
    persistDynamicEntity(entity);

    const visibilityChanged =
      toInt(entity.bubbleID, 0) !== previousBubbleID ||
      (entity.publicGridClusterKey || null) !== previousPublicGridClusterKey;
    if (visibilityChanged) {
      // Same-scene teleports should stream normal AddBalls2/RemoveBalls deltas
      // on the teleport lane instead of forcing an owner SetState rebuild.
      this.syncDynamicVisibilityForAllSessions(now, {
        stampOverride: movementStamp,
      });
    }

    this.broadcastMovementUpdates([
      {
        stamp: movementStamp,
        payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 0),
      },
      {
        stamp: movementStamp,
        payload: destiny.buildSetBallPositionPayload(entity.itemID, entity.position),
      },
      {
        stamp: movementStamp,
        payload: destiny.buildStopPayload(entity.itemID),
      },
      {
        stamp: movementStamp,
        payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
      },
    ]);

    return {
      success: true,
      data: {
        entity,
        stamp: movementStamp,
      },
    };
  }

  setSpeedFraction(session, fraction) {
    const entity = this.getShipEntityForSession(session);
    if (isSuperweaponMovementLocked(entity, this.getCurrentSimTimeMs())) {
      return false;
    }
    return dispatchSetSpeedFraction(this, session, fraction);
  }

  stopShipEntity(entityOrID, options = {}) {
    return dispatchStopShipEntity(this, entityOrID, options);
  }

  stop(session) {
    return dispatchStop(this, session);
  }

  acceptDocking(session, stationID) {
    const entity = this.getShipEntityForSession(session);
    const station = this.getEntityByID(stationID);
    const nowMs = this.getCurrentSimTimeMs();
    if (
      !entity ||
      !station ||
      (station.kind !== "station" && station.kind !== "structure")
    ) {
      return {
        success: false,
        errorMsg: "STATION_NOT_FOUND",
      };
    }

    if (
      entity.pendingDock &&
      Number(entity.pendingDock.stationID || 0) === station.itemID
    ) {
      return {
        success: true,
        data: {
          acceptedAtFileTime: entity.pendingDock.acceptedAtFileTime,
          pending: true,
        },
      };
    }

    if (!canShipDockAtStation(entity, station)) {
      return {
        success: false,
        errorMsg: "DOCKING_APPROACH_REQUIRED",
      };
    }
    if (station.kind === "structure") {
      const structureTetherRestrictionState = require(path.join(
        __dirname,
        "../services/structure/structureTetherRestrictionState",
      ));
      const restriction = structureTetherRestrictionState.getCharacterStructureDockingRestriction(
        session && session.characterID,
        nowMs,
        {
          session,
        },
      );
      if (restriction.restricted) {
        return {
          success: false,
          errorMsg: restriction.reason || "STRUCTURE_DOCKING_RESTRICTED",
        };
      }
    }

    clearTrackingState(entity);
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.targetPoint = cloneVector(entity.position);
    entity.pendingDock = {
      stationID: station.itemID,
      acceptedAtMs: nowMs,
      completeAtMs: nowMs + STATION_DOCK_ACCEPT_DELAY_MS,
      acceptedAtFileTime: this.getCurrentFileTime(),
    };
    persistShipEntity(entity);
    logMovementDebug("dock.accepted", entity, {
      stationID: station.itemID,
      dockingState: buildDockingDebugState(entity, station),
    });

    const stamp = this.getNextDestinyStamp();
    this.broadcastMovementUpdates([
      {
        stamp,
        payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 0),
      },
      {
        stamp,
        payload: destiny.buildStopPayload(entity.itemID),
      },
      {
        stamp,
        payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
      },
    ]);

    if (session && typeof session.sendNotification === "function") {
      const dockingAcceptedPayload = destiny.buildOnDockingAcceptedPayload(
        entity.position,
        station.position,
        station.itemID,
      );
      session.sendNotification(
        "OnDockingAccepted",
        "charid",
        dockingAcceptedPayload,
      );
    }

    return {
      success: true,
      data: {
        acceptedAtFileTime: entity.pendingDock.acceptedAtFileTime,
      },
    };
  }

  tick(wallclockNow) {
    const clockState = this.advanceClock(wallclockNow);
    const now = clockState.simNowMs;
    const deltaSeconds = Math.max(clockState.simDeltaMs / 1000, 0);
    this._tickTargetingStatsCache = new Map();
    flushDogmaReloadsAtSimTime(now);
    this.beginTickDestinyPresentationBatch();
    this.flushPendingSubwarpMovementContracts(now);
    // DoSimClockRebase mirrors native client sim-clock changes. Broadcasting
    // it as a periodic keepalive made Michelle's ball time run backwards, so
    // rebases are now limited to scene entry/bootstrap and explicit TiDi
    // changes until the native TiDi update path is reproduced.

    const settledStargates = this.settleTransientStargateActivationStates(
      clockState.wallclockNowMs,
    );
    if (settledStargates.length > 0) {
      this.broadcastSlimItemChanges(settledStargates);
    }

    const sharedUpdates = [];
    const sessionOnlyPreEffectUpdates = [];
    const sessionOnlyUpdates = [];
    const watcherOnlyUpdates = [];
    const postWarpVisibilityReconciles = [];
    const beltRatArrivalEvents = [];
    const dockRequests = new Map();
    try {
      const crimewatchState = require(path.join(__dirname, "../services/security/crimewatchState"));
      if (crimewatchState && typeof crimewatchState.tickScene === "function") {
        crimewatchState.tickScene(this, now);
      }
    } catch (error) {
      log.warn(`[SpaceRuntime] Crimewatch tick failed for system=${this.systemID}: ${error.message}`);
    }
    try {
      const npcService = require(path.join(__dirname, "./npc"));
      if (npcService && typeof npcService.tickScene === "function") {
        npcService.tickScene(this, now);
      }
    } catch (error) {
      log.warn(`[SpaceRuntime] NPC tick failed for system=${this.systemID}: ${error.message}`);
    }
    if (config.miningEnabled === true) {
      try {
        const miningRuntime = require(path.join(__dirname, "../services/mining/miningRuntime"));
        if (miningRuntime && typeof miningRuntime.tickScene === "function") {
          miningRuntime.tickScene(this, now);
        }
      } catch (error) {
        log.warn(`[SpaceRuntime] Mining tick failed for system=${this.systemID}: ${error.message}`);
      }
    }
    try {
      const droneRuntime = require(path.join(__dirname, "../services/drone/droneRuntime"));
      if (droneRuntime && typeof droneRuntime.tickScene === "function") {
        droneRuntime.tickScene(this, now);
      }
    } catch (error) {
      log.warn(`[SpaceRuntime] Drone tick failed for system=${this.systemID}: ${error.message}`);
    }
    try {
      const fighterRuntime = require(path.join(__dirname, "../services/fighter/fighterRuntime"));
      if (fighterRuntime && typeof fighterRuntime.tickScene === "function") {
        fighterRuntime.tickScene(this, now);
      }
    } catch (error) {
      log.warn(`[SpaceRuntime] Fighter tick failed for system=${this.systemID}: ${error.message}`);
    }
    if (config.wormholesEnabled === true) {
      try {
        const wormholeRuntime = require(path.join(
          __dirname,
          "../services/exploration/wormholes/wormholeRuntime",
        ));
        if (wormholeRuntime && typeof wormholeRuntime.tickScene === "function") {
          wormholeRuntime.tickScene(this, now);
        }
      } catch (error) {
        log.warn(`[SpaceRuntime] Wormhole tick failed for system=${this.systemID}: ${error.message}`);
      }
    }
    try {
      tickSuperweaponScene(
        this,
        now,
        buildSuperweaponRuntimeCallbacks(this, 0),
      );
    } catch (error) {
      log.warn(`[SpaceRuntime] Superweapon tick failed for system=${this.systemID}: ${error.message}`);
    }
    try {
      remoteRepairShowRuntime.tickScene(this, now);
    } catch (error) {
      log.warn(`[SpaceRuntime] Remote repair show tick failed for system=${this.systemID}: ${error.message}`);
    }
    try {
      tractorBeamRuntime.tickScene(this, now, buildTractorBeamRuntimeCallbacks());
    } catch (error) {
      log.warn(`[SpaceRuntime] Tractor beam tick failed for system=${this.systemID}: ${error.message}`);
    }
    const deferredInitialVisibilityEntities = [...this.dynamicEntities.values()]
      .filter((entity) => entity && entity.deferUntilInitialVisibilitySync === true);
    if (deferredInitialVisibilityEntities.length > 0) {
      this.acquireDynamicEntitiesForRelevantSessions(
        deferredInitialVisibilityEntities,
        {
          nowMs: now,
        },
      );
      for (const entity of deferredInitialVisibilityEntities) {
        entity.deferUntilInitialVisibilitySync = false;
        if (entity.kind === "missile") {
          delete entity.launchPresentationSnapshot;
        }
      }
    }
    for (const entity of this.dynamicEntities.values()) {
      if (Array.isArray(entity.pendingModuleStopNotifications) && entity.pendingModuleStopNotifications.length > 0) {
        const flushSession = entity.session || getOwningSessionForEntity(this, entity);
        if (flushSession && isReadyForDestiny(flushSession)) {
          const pendingStops = entity.pendingModuleStopNotifications.splice(0);
          for (const pending of pendingStops) {
            if (pending.isPropulsion) {
              notifyModuleEffectState(flushSession, entity, pending.effectState, false, { whenMs: pending.stopTimeMs });
            } else {
              notifyGenericModuleEffectState(flushSession, entity, pending.effectState, false, { whenMs: pending.stopTimeMs });
            }
          }
        }
      }
      const commandBurstPruneResult = commandBurstRuntime.pruneExpiredCommandBursts(
        entity,
        now,
      );
      if (
        commandBurstPruneResult.changed &&
        entity &&
        entity.kind === "ship"
      ) {
        this.refreshShipEntityDerivedState(entity, {
          session: entity.session || null,
          broadcast: true,
          notifyTargeting: true,
        });
      }
      if (
        commandBurstPruneResult.changed &&
        entity &&
        entity.session &&
        isReadyForDestiny(entity.session)
      ) {
        notifyCommandBurstDbuffStateToSession(
          this,
          entity.session,
          entity,
          now,
          {
            reason: "command-burst-expire",
          },
        );
      }
      if (entity.activeModuleEffects instanceof Map && entity.activeModuleEffects.size > 0) {
        const ownerSession = getOwningSessionForEntity(this, entity);
        for (const effectState of [...entity.activeModuleEffects.values()]) {
          const cycleBoundaryMs = getEffectCycleBoundaryMs(effectState, now);
          if (!effectState || now < cycleBoundaryMs) {
            continue;
          }

          const isGenericEffect = Boolean(effectState.isGeneric);
          const finalizeDeactivation = isGenericEffect
            ? (sess, modID, opts) => this.finalizeGenericModuleDeactivation(sess, modID, opts)
            : (sess, modID, opts) => this.finalizePropulsionModuleDeactivation(sess, modID, opts);
          const notifyEffect = isGenericEffect
            ? notifyGenericModuleEffectState
            : notifyModuleEffectState;
          const moduleItem = isGenericEffect
            ? getEntityRuntimeModuleItem(
              entity,
              effectState.moduleID,
              effectState.moduleFlagID,
            )
            : null;

          if (toFiniteNumber(effectState.deactivateAtMs, 0) > 0) {
            if (ownerSession && isReadyForDestiny(ownerSession)) {
              finalizeDeactivation(
                ownerSession,
                effectState.moduleID,
                {
                  reason: effectState.stopReason || "manual",
                  nowMs: Math.max(
                    cycleBoundaryMs,
                    toFiniteNumber(effectState.deactivateAtMs, 0),
                  ),
                },
              );
            } else {
              if (isGenericEffect) {
                finalizeGenericModuleDeactivationWithoutSession(
                  this,
                  entity,
                  effectState,
                  {
                    reason: effectState.stopReason || "manual",
                    nowMs: Math.max(
                      cycleBoundaryMs,
                      toFiniteNumber(effectState.deactivateAtMs, 0),
                    ),
                  },
                );
              } else {
                entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
              }
            }
            continue;
          }

          const localCycleCallbacks = effectState.localCycleEffect === true
            ? buildLocalCycleRuntimeCallbacks(
              toInt(ownerSession && ownerSession.characterID, 0),
            )
            : null;
          if (effectState.localCycleEffect === true) {
            const boundaryResult = prepareLocalCycleBoundary({
              entity,
              moduleItem,
              effectState,
              effectRecord: effectState.localCycleFamily || effectState.effectName,
              callbacks: localCycleCallbacks,
              nowMs: cycleBoundaryMs,
            });
            if (!boundaryResult.success) {
              if (ownerSession && isReadyForDestiny(ownerSession)) {
                finalizeDeactivation(ownerSession, effectState.moduleID, {
                  reason: boundaryResult.stopReason || "localCycle",
                  nowMs: cycleBoundaryMs,
                });
              } else {
                if (isGenericEffect) {
                  finalizeGenericModuleDeactivationWithoutSession(
                    this,
                    entity,
                    effectState,
                    {
                      reason: boundaryResult.stopReason || "localCycle",
                      nowMs: cycleBoundaryMs,
                    },
                  );
                } else {
                  entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
                }
              }
              continue;
            }
            if (boundaryResult.waiting) {
              continue;
            }
          }

          if (isMissileWeaponFamily(effectState.weaponFamily)) {
            const reloadResult = effectState.pendingMissileBankReloads
              ? resolvePendingGroupedMissileReloads(
                entity,
                effectState,
                { nowMs: now },
              )
              : resolvePendingMissileReload(
                entity,
                effectState,
                moduleItem,
                { nowMs: now },
              );
            if (!reloadResult.success) {
              if (ownerSession && isReadyForDestiny(ownerSession)) {
                finalizeDeactivation(ownerSession, effectState.moduleID, {
                  reason: "ammo",
                  nowMs: cycleBoundaryMs,
                });
              } else {
                if (isGenericEffect) {
                  finalizeGenericModuleDeactivationWithoutSession(
                    this,
                    entity,
                    effectState,
                    {
                      reason: "ammo",
                      nowMs: cycleBoundaryMs,
                    },
                  );
                } else {
                  entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
                }
              }
              continue;
            }
            if (reloadResult.waiting) {
              continue;
            }
            // CCP parity: reload completed — re-notify the client that the
            // module is active again so the HUD cycle ring resumes.
            if (
              effectState.pendingReloadReactivation &&
              ownerSession &&
              isReadyForDestiny(ownerSession)
            ) {
              effectState.pendingReloadReactivation = false;
              notifyEffect(ownerSession, entity, effectState, true, {
                whenMs: cycleBoundaryMs,
                startTimeMs: cycleBoundaryMs,
              });
            }
          }
          if (
            effectState.commandBurstEffect === true &&
            effectState.pendingLocalReload
          ) {
            const reloadResult = resolvePendingLocalModuleReload(
              entity,
              effectState,
              moduleItem,
              {
                nowMs: now,
              },
            );
            if (!reloadResult.success) {
              if (ownerSession && isReadyForDestiny(ownerSession)) {
                finalizeDeactivation(ownerSession, effectState.moduleID, {
                  reason: "ammo",
                  nowMs: cycleBoundaryMs,
                });
              } else if (isGenericEffect) {
                finalizeGenericModuleDeactivationWithoutSession(
                  this,
                  entity,
                  effectState,
                  {
                    reason: "ammo",
                    nowMs: cycleBoundaryMs,
                  },
                );
              } else {
                entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
              }
              continue;
            }
            if (reloadResult.waiting) {
              continue;
            }
          }
          if (
            entity.nativeNpc === true &&
            isTurretWeaponFamily(effectState.weaponFamily) &&
            effectState.pendingLocalReload
          ) {
            const reloadResult = resolvePendingLocalModuleReload(
              entity,
              effectState,
              moduleItem,
              {
                nowMs: now,
              },
            );
            if (!reloadResult.success) {
              if (ownerSession && isReadyForDestiny(ownerSession)) {
                finalizeDeactivation(ownerSession, effectState.moduleID, {
                  reason: "ammo",
                  nowMs: cycleBoundaryMs,
                });
              } else if (isGenericEffect) {
                finalizeGenericModuleDeactivationWithoutSession(
                  this,
                  entity,
                  effectState,
                  {
                    reason: "ammo",
                    nowMs: cycleBoundaryMs,
                  },
                );
              } else {
                entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
              }
              continue;
            }
            if (reloadResult.waiting) {
              continue;
            }
          }

          if (effectState.autoDeactivateAtCycleEnd === true) {
            queueGenericModuleAutoReloadOnCycleEnd(
              this,
              ownerSession || entity.session || null,
              entity,
              moduleItem,
              effectState,
              cycleBoundaryMs,
            );
            if (ownerSession && isReadyForDestiny(ownerSession)) {
              finalizeDeactivation(ownerSession, effectState.moduleID, {
                reason: effectState.stopReason || "cycle",
                nowMs: cycleBoundaryMs,
              });
            } else if (isGenericEffect) {
              finalizeGenericModuleDeactivationWithoutSession(
                this,
                entity,
                effectState,
                {
                  reason: effectState.stopReason || "cycle",
                  nowMs: cycleBoundaryMs,
                },
              );
            } else {
              entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
            }
            continue;
          }

          const previousChargeAmount = getEntityCapacitorAmount(entity);
          if (effectState.capNeed > previousChargeAmount + 1e-6) {
            if (entity.session && isReadyForDestiny(entity.session)) {
              notifyCapacitorChangeToSession(
                entity.session,
                entity,
                now,
                previousChargeAmount,
              );
              finalizeDeactivation(entity.session, effectState.moduleID, {
                reason: "capacitor",
                nowMs: cycleBoundaryMs,
              });
            } else {
              if (isGenericEffect) {
                finalizeGenericModuleDeactivationWithoutSession(
                  this,
                  entity,
                  effectState,
                  {
                    reason: "capacitor",
                    nowMs: cycleBoundaryMs,
                  },
                );
              } else {
                entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
              }
            }
            continue;
          }
          const cycleFuelConsumptionResult = consumeShipModuleFuelForSession(
            ownerSession,
            entity,
            effectState.fuelTypeID,
            effectState.fuelPerActivation,
          );
          if (!cycleFuelConsumptionResult.success) {
            if (entity.session && isReadyForDestiny(entity.session)) {
              finalizeDeactivation(entity.session, effectState.moduleID, {
                reason: "fuel",
                nowMs: cycleBoundaryMs,
              });
            } else if (isGenericEffect) {
              finalizeGenericModuleDeactivationWithoutSession(
                this,
                entity,
                effectState,
                {
                  reason: "fuel",
                  nowMs: cycleBoundaryMs,
                },
              );
            } else {
              entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
            }
            continue;
          }
          if (!consumeEntityCapacitor(entity, effectState.capNeed)) {
            if (entity.session && isReadyForDestiny(entity.session)) {
              notifyCapacitorChangeToSession(
                entity.session,
                entity,
                now,
                previousChargeAmount,
              );
              finalizeDeactivation(entity.session, effectState.moduleID, {
                reason: "capacitor",
                nowMs: cycleBoundaryMs,
              });
            } else {
              if (isGenericEffect) {
                finalizeGenericModuleDeactivationWithoutSession(
                  this,
                  entity,
                  effectState,
                  {
                    reason: "capacitor",
                    nowMs: cycleBoundaryMs,
                  },
                );
              } else {
                entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
              }
            }
            continue;
          }
          // CCP parity: Update the client's capacitor gauge each cycle.
          if (entity.session && isReadyForDestiny(entity.session)) {
            notifyCapacitorChangeToSession(
              entity.session,
              entity,
              now,
              previousChargeAmount,
            );
          }

          let cycleStopReason = null;
          if (
            effectState &&
            effectState.localCycleEffect === true
          ) {
            const cycleResult = executeLocalCycle({
              scene: this,
              session: ownerSession,
              entity,
              moduleItem,
              effectState,
              nowMs: cycleBoundaryMs,
              callbacks: localCycleCallbacks,
            });
            if (!cycleResult.success) {
              cycleStopReason = cycleResult.stopReason || "localCycle";
            } else if (cycleResult.data && cycleResult.data.reloadState) {
              effectState.pendingLocalReload = cycleResult.data.reloadState;
              effectState.startedAtMs = cycleBoundaryMs;
              effectState.nextCycleAtMs = Math.max(
                cycleBoundaryMs,
                Number(cycleResult.data.reloadState.completeAtMs) || cycleBoundaryMs,
              );
              continue;
            }
          } else if (
            config.miningEnabled === true &&
            effectState &&
            effectState.miningEffect === true
          ) {
            try {
              const miningRuntime = require(path.join(__dirname, "../services/mining/miningRuntime"));
              if (
                miningRuntime &&
                typeof miningRuntime.executeMiningCycle === "function"
              ) {
                const cycleResult = miningRuntime.executeMiningCycle(
                  this,
                  entity,
                  effectState,
                  cycleBoundaryMs,
                );
                if (!cycleResult.success) {
                  cycleStopReason = cycleResult.stopReason || "mining";
                } else if (
                  cycleResult.data &&
                  cycleResult.data.depleted === true
                ) {
                  const moduleID = toInt(effectState && effectState.moduleID, 0);
                  if (
                    !(entity.activeModuleEffects instanceof Map) ||
                    !entity.activeModuleEffects.has(moduleID)
                  ) {
                    continue;
                  }
                  cycleStopReason = "target";
                }
              } else {
                cycleStopReason = "mining";
              }
            } catch (error) {
              log.warn(
                `[SpaceRuntime] Mining cycle failed for entity=${toInt(entity && entity.itemID, 0)} ` +
                  `module=${toInt(effectState && effectState.moduleID, 0)}: ${error.message}`,
              );
              cycleStopReason = "mining";
            }
          } else if (
            effectState &&
            effectState.commandBurstEffect === true
          ) {
            const cycleResult = executeCommandBurstCycle(
              this,
              ownerSession,
              entity,
              moduleItem,
              effectState,
              cycleBoundaryMs,
            );
            if (!cycleResult.success) {
              cycleStopReason = cycleResult.stopReason || "commandBurst";
            } else if (cycleResult.data && cycleResult.data.reloadState) {
              effectState.pendingLocalReload = cycleResult.data.reloadState;
              effectState.startedAtMs = cycleBoundaryMs;
              effectState.nextCycleAtMs = Math.max(
                cycleBoundaryMs,
                Number(cycleResult.data.reloadState.completeAtMs) || cycleBoundaryMs,
              );
              continue;
            } else if (cycleResult.data && cycleResult.data.stopReason) {
              cycleStopReason = cycleResult.data.stopReason;
            }
          } else if (
            effectState &&
            effectState.assistanceModuleEffect === true
          ) {
            const cycleResult = assistanceModuleRuntime.executeAssistanceModuleCycle({
              scene: this,
              session: ownerSession,
              entity,
              effectState,
              nowMs: cycleBoundaryMs,
              callbacks: buildAssistanceModuleRuntimeCallbacks(),
            });
            if (!cycleResult.success) {
              cycleStopReason = cycleResult.stopReason || "assistance";
            } else {
              const targetEntity = this.getEntityByID(toInt(effectState.targetID, 0));
              const targetSession = targetEntity && targetEntity.session ? targetEntity.session : null;
              const hudSyncResult = targetEntity
                ? hudIconRuntime.upsertHudIconState(
                  targetEntity,
                  buildAssistanceHudState(targetEntity, entity, effectState, cycleBoundaryMs),
                )
                : { state: null };
              if (targetSession && isReadyForDestiny(targetSession) && hudSyncResult.state) {
                notifyAssistanceHudStateToSession(targetSession, hudSyncResult.state, true, {
                  startTimeMs: cycleBoundaryMs,
                  durationMs: Math.max(
                    1,
                    toInt(effectState.durationMs, 1000) + ASSISTANCE_JAM_REFRESH_GRACE_MS,
                  ),
                  refreshTimerOnly: true,
                });
              }
            }
          } else if (
            effectState &&
            effectState.jammerModuleEffect === true
          ) {
            const cycleResult = jammerModuleRuntime.executeJammerModuleCycle({
              scene: this,
              entity,
              effectState,
              nowMs: cycleBoundaryMs,
              callbacks: buildJammerModuleRuntimeCallbacks(this),
            });
            if (!cycleResult.success) {
              cycleStopReason = cycleResult.stopReason || "jammer";
            } else {
              applyJammerCyclePresentation(
                this,
                entity,
                effectState,
                cycleBoundaryMs,
                cycleResult,
              );
            }
          } else if (
            effectState &&
            effectState.jammerBurstEffect === true
          ) {
            const cycleResult = jammerModuleRuntime.executeJammerBurstCycle({
              scene: this,
              entity,
              effectState,
              nowMs: cycleBoundaryMs,
              callbacks: buildJammerModuleRuntimeCallbacks(this),
            });
            if (!cycleResult.success) {
              cycleStopReason = cycleResult.stopReason || "jammerBurst";
            }
          } else if (
            effectState &&
            effectState.hostileModuleEffect === true
          ) {
            const cycleResult = hostileModuleRuntime.executeHostileModuleCycle({
              scene: this,
              session: ownerSession,
              entity,
              effectState,
              nowMs: cycleBoundaryMs,
              callbacks: buildHostileModuleRuntimeCallbacks(this),
            });
            if (!cycleResult.success) {
              cycleStopReason = cycleResult.stopReason || "hostile";
            } else {
              const targetEntity =
                cycleResult.data && cycleResult.data.targetEntity
                  ? cycleResult.data.targetEntity
                  : this.getEntityByID(toInt(effectState.targetID, 0));
              const targetSession = targetEntity && targetEntity.session ? targetEntity.session : null;
              if (targetEntity && cycleResult.data && cycleResult.data.aggregateChanged) {
                this.refreshShipEntityDerivedState(targetEntity, {
                  session: targetSession,
                  broadcast: true,
                  notifyTargeting: true,
                });
                if (
                  hostileModuleRuntime.isMicrowarpdriveBlocked(targetEntity) ||
                  hostileModuleRuntime.isMicroJumpDriveBlocked(targetEntity)
                ) {
                  forceDeactivateBlockedMovementEffects(this, targetEntity, cycleBoundaryMs, "scram");
                }
              }
              const hudSyncResult = targetEntity
                ? hudIconRuntime.upsertHudIconState(
                  targetEntity,
                  buildHostileHudState(targetEntity, entity, effectState, cycleBoundaryMs),
                )
                : { state: null };
              if (targetSession && isReadyForDestiny(targetSession) && hudSyncResult.state) {
                notifyHostileHudStateToSession(targetSession, hudSyncResult.state, true, {
                  startTimeMs: cycleBoundaryMs,
                  durationMs: resolveHostileJamRefreshDurationMs(effectState),
                  refreshTimerOnly: true,
                });
              }
            }
          } else if (
            effectState &&
            effectState.salvagerEffect === true
          ) {
            const cycleResult = salvagerRuntime.executeSalvagerCycle({
              scene: this,
              entity,
              effectState,
              nowMs: cycleBoundaryMs,
              callbacks: buildSalvagerRuntimeCallbacks(this),
            });
            if (!cycleResult.success) {
              cycleStopReason = cycleResult.stopReason || "salvager";
            }
          } else if (
            effectState &&
            effectState.tractorBeamEffect === true
          ) {
            const cycleResult = tractorBeamRuntime.executeTractorBeamCycle({
              scene: this,
              entity,
              effectState,
              callbacks: buildTractorBeamRuntimeCallbacks(),
            });
            if (!cycleResult.success) {
              cycleStopReason = cycleResult.stopReason || "tractor";
            }
          } else if (
            effectState &&
            effectState.microJumpDriveEffect === true
          ) {
            const cycleResult = microJumpDriveRuntime.executeMicroJumpDriveCycle({
              scene: this,
              entity,
              effectState,
              nowMs: cycleBoundaryMs,
              callbacks: buildMicroJumpDriveRuntimeCallbacks(this),
            });
            if (!cycleResult.success) {
              cycleStopReason = cycleResult.stopReason || "microJumpDrive";
            } else if (cycleResult.data && cycleResult.data.stopReason) {
              cycleStopReason = cycleResult.data.stopReason;
            }
          } else if (isSnapshotWeaponFamily(effectState.weaponFamily)) {
            const cycleResult = isTurretWeaponFamily(effectState.weaponFamily)
              ? executeTurretCycle(
                this,
                entity,
                effectState,
                cycleBoundaryMs,
              )
              : executeMissileCycle(
                this,
                entity,
                effectState,
                cycleBoundaryMs,
                {
                  deferUntilVisibilitySync: true,
                },
              );
            if (!cycleResult.success) {
              cycleStopReason = cycleResult.stopReason || "weapon";
            } else if (cycleResult.data) {
              if (
                cycleResult.data.reloadState ||
                cycleResult.data.bankReloadStates
              ) {
                if (isTurretWeaponFamily(effectState.weaponFamily)) {
                  effectState.pendingLocalReload = cycleResult.data.reloadState;
                } else {
                  effectState.pendingMissileReload =
                    cycleResult.data.bankReloadStates
                      ? null
                      : cycleResult.data.reloadState;
                  effectState.pendingMissileBankReloads =
                    cycleResult.data.bankReloadStates || null;
                }
                const reloadCompletionAtMs =
                  cycleResult.data.bankReloadStates
                    ? Math.max(
                      ...cycleResult.data.bankReloadStates.map(
                        (reloadState) =>
                          Number(reloadState && reloadState.completeAtMs) || cycleBoundaryMs,
                      ),
                      cycleBoundaryMs,
                    )
                    : Number(cycleResult.data.reloadState && cycleResult.data.reloadState.completeAtMs) || cycleBoundaryMs;
                effectState.startedAtMs = cycleBoundaryMs;
                effectState.nextCycleAtMs = Math.max(
                  cycleBoundaryMs,
                  reloadCompletionAtMs,
                );
                if (!isTurretWeaponFamily(effectState.weaponFamily)) {
                  // CCP parity: missile launcher deactivates visually while
                  // reloading. The module stays in activeModuleEffects so the
                  // reload can complete and auto-resume, but the client must
                  // see active=0 during the reload window.
                  effectState.pendingReloadReactivation = true;
                  if (ownerSession && isReadyForDestiny(ownerSession)) {
                    notifyEffect(ownerSession, entity, effectState, false, {
                      whenMs: cycleBoundaryMs,
                    });
                  }
                }
                continue;
              }
              if (
                (
                  cycleResult.data.destroyResult &&
                  cycleResult.data.destroyResult.success
                ) ||
                (
                  cycleResult.data.damageResult &&
                  cycleResult.data.damageResult.success &&
                  cycleResult.data.damageResult.data &&
                  cycleResult.data.damageResult.data.destroyed
                )
              ) {
                cycleStopReason = "target";
              } else if (cycleResult.data.stopReason) {
                cycleStopReason = cycleResult.data.stopReason;
              }
            }
          }
          if (cycleStopReason) {
            if (entity && entity.nativeNpc === true) {
              logNpcCombatDebug("npc.weapons.cycle-stop", {
                entity: summarizeNpcCombatEntity(entity),
                moduleItem: summarizeNpcCombatModule(moduleItem),
                targetID: toInt(effectState && effectState.targetID, 0),
                weaponFamily: String(effectState.weaponFamily || ""),
                reason: String(cycleStopReason || "weapon"),
                cycleBoundaryMs: roundNumber(toFiniteNumber(cycleBoundaryMs, 0), 3),
                pendingMissileReload:
                  effectState && effectState.pendingMissileReload
                    ? effectState.pendingMissileReload
                    : null,
                pendingLocalReload:
                  effectState && effectState.pendingLocalReload
                    ? effectState.pendingLocalReload
                    : null,
              });
            }
            if (entity.session && isReadyForDestiny(entity.session)) {
              finalizeDeactivation(entity.session, effectState.moduleID, {
                reason: cycleStopReason,
                nowMs: cycleBoundaryMs,
              });
            } else {
              if (isGenericEffect) {
                finalizeGenericModuleDeactivationWithoutSession(
                  this,
                  entity,
                  effectState,
                  {
                    reason: cycleStopReason,
                    nowMs: cycleBoundaryMs,
                  },
                );
              } else {
                entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
              }
            }
            continue;
          }

          effectState.startedAtMs = cycleBoundaryMs;
          effectState.nextCycleAtMs =
            cycleBoundaryMs + Math.max(1, toFiniteNumber(effectState.durationMs, 1000));
          if (
            entity.session &&
            isReadyForDestiny(entity.session) &&
            isPrecursorTurretFamily(effectState.weaponFamily)
          ) {
            notifyGenericDerivedAttributesToSession(
              entity.session,
              effectState,
              cycleBoundaryMs,
            );
          }
          if (
            entity.session &&
            isReadyForDestiny(entity.session) &&
            !(
              isGenericEffect &&
              isMissileWeaponFamily(effectState.weaponFamily)
            )
          ) {
            // CCP client parity: missile launchers keep repeating locally from the
            // initial OnGodmaShipEffect timing data. Re-sending a fresh active=1
            // start packet every cycle restarts the owner's launcher presentation.
            notifyEffect(entity.session, entity, effectState, true, {
              whenMs: cycleBoundaryMs,
              startTimeMs: cycleBoundaryMs,
            });
          }
        }
      }

      // -----------------------------------------------------------------
      // CCP parity: Non-linear capacitor recharge.
      //
      // Formula (instantaneous rate):
      //   dC/dt = (10 * Cmax / tau) * ( sqrt(C/Cmax) - C/Cmax )
      //
      // Where Cmax = capacitorCapacity (GJ), tau = rechargeRate (ms → s),
      // C = current capacitor level.  Peak recharge occurs at exactly 25%
      // capacitor.  This matches CCP's Dogma engine as verified by
      // community tools (Pyfa, EFT) and the EVE University wiki.
      //
      // Notifications are throttled to ~500 ms to avoid flooding the
      // client (which itself only polls at 500 ms intervals).
      // -----------------------------------------------------------------
      if (
        entity.kind === "ship" &&
        toFiniteNumber(entity.capacitorCapacity, 0) > 0 &&
        toFiniteNumber(entity.capacitorRechargeRate, 0) > 0
      ) {
        const capRatio = getEntityCapacitorRatio(entity);
        if (capRatio < 1) {
          const Cmax = entity.capacitorCapacity;
          const tauSeconds = entity.capacitorRechargeRate / 1000;
          const previousChargeAmount = Cmax * capRatio;
          const rechargedRatio = advancePassiveRechargeRatio(
            capRatio,
            deltaSeconds,
            tauSeconds,
          );
          const newRatio = settlePassiveRechargeRatio(rechargedRatio, Cmax);
          if (newRatio !== capRatio) {
            setEntityCapacitorRatio(entity, newRatio);
            // Throttle persistence and client notifications to ~500 ms.
            const lastCapNotify = toFiniteNumber(entity._lastCapNotifyAtMs, 0);
            if (now - lastCapNotify >= 500) {
              persistEntityCapacitorRatio(entity);
              if (entity.session && isReadyForDestiny(entity.session)) {
                notifyCapacitorChangeToSession(
                  entity.session,
                  entity,
                  now,
                  previousChargeAmount,
                );
              }
              entity._lastCapNotifyAtMs = now;
            }
          }
        }
      }

      // -----------------------------------------------------------------
      // Server-authoritative passive shield recharge.
      //
      // CCP's client already animates shield recovery locally from the last
      // Michelle damage-state tuple and its tau/filetime. Re-broadcasting
      // OnDamageStateChange every recharge tick just injects extra non-local
      // destiny traffic into normal movement/combat history and causes
      // Michelle to rebase mid-flight. Keep the runtime conditionState and the
      // pilot HUD attributes authoritative here, but leave in-space damage
      // presentation on the last discrete damage/heal event.
      // -----------------------------------------------------------------
      if (
        passiveShieldRechargeEnabled &&
        entity.kind === "ship" &&
        toFiniteNumber(entity.shieldCapacity, 0) > 0 &&
        toFiniteNumber(entity.shieldRechargeRate, 0) > 0
      ) {
        const previousConditionState = normalizeShipConditionState(entity.conditionState);
        const shieldRatio = clamp(
          toFiniteNumber(previousConditionState.shieldCharge, 0),
          0,
          1,
        );
        if (shieldRatio < 1) {
          const shieldCapacity = entity.shieldCapacity;
          const rechargeSeconds = entity.shieldRechargeRate / 1000;
          const seededShieldRatio =
            shieldRatio > 0
              ? shieldRatio
              : Math.min(1, 1 / Math.max(1, shieldCapacity));
          const rechargedRatio = advancePassiveRechargeRatio(
            seededShieldRatio,
            deltaSeconds,
            rechargeSeconds,
          );
          const newShieldRatio = settlePassiveRechargeRatio(rechargedRatio, shieldCapacity);
          if (Math.abs(newShieldRatio - shieldRatio) > 1e-9) {
            entity.conditionState = normalizeShipConditionState({
              ...previousConditionState,
              shieldCharge: newShieldRatio,
            });
            const lastShieldNotify = toFiniteNumber(entity._lastShieldNotifyAtMs, 0);
            if (now - lastShieldNotify >= 500) {
              const healthTransitionResult = buildShipHealthTransitionResult(
                entity,
                previousConditionState,
              );
              persistDynamicEntity(entity);
              if (entity.session && isReadyForDestiny(entity.session)) {
                notifyShipHealthAttributesToSession(
                  entity.session,
                  entity,
                  healthTransitionResult,
                  now,
                );
              }
              entity._lastShieldNotifyAtMs = now;
            }
          }
        }
      }

      const traceActive = isMovementTraceActive(entity, now);
      if (entity.pendingDock) {
        if (
          entity.session &&
          entity.session._space &&
          now >= Number(entity.pendingDock.completeAtMs || 0)
        ) {
          dockRequests.set(entity.session.clientID, {
            session: entity.session,
            stationID: entity.pendingDock.stationID,
          });
        }
        continue;
      }

      const result = advanceMovement(entity, this, deltaSeconds, now);
      if (entity.pendingWarp) {
        const pendingWarp = entity.pendingWarp;
        const pendingWarpState = evaluatePendingWarp(entity, pendingWarp, now);
        if (pendingWarpState.ready) {
          const currentStamp = this.getCurrentDestinyStamp(now);
          const pilotCanReceiveWarpEgoStateRefresh =
            ENABLE_PILOT_WARP_EGO_STATE_REFRESH &&
            entity.session &&
            isReadyForDestiny(entity.session);
          const pilotCanReceivePreWarpRebaseline =
            ENABLE_PILOT_PRE_WARP_ADDBALL_REBASE &&
            entity.session &&
            isReadyForDestiny(entity.session);
          // Build rebaseline updates if enabled — these are merged into the
          // SAME DoDestinyUpdate packet as activation so the DLL processes
          // everything in a single state-history rebase.  The old two-tick
          // separation (rebaseline on tick N, activation on tick N+1) caused
          // two separate rebases; the second one disrupted alignment progress
          // (100% → ~90% → 100%) because the replayed state diverged from
          // the DLL's local simulation.
          // Do NOT send any pilot rebaseline or activation updates.  ANY
          // DoDestinyUpdate during WarpState=1 causes a state-history rebase
          // that disrupts alignment progress.  The DLL handles WarpState 1→2
          // entirely on its own after the initial WarpTo prepare dispatch.
          if (pilotCanReceivePreWarpRebaseline) {
            pendingWarp.preWarpSyncStamp = currentStamp;
          }
          logBallDebug("warp.pre_start.ego", entity, {
            pendingWarp: summarizePendingWarp(pendingWarp),
            pendingWarpState,
            preWarpSyncStamp: toInt(pendingWarp.preWarpSyncStamp, 0),
          });
          const warpState = activatePendingWarp(entity, pendingWarp, {
            nowMs: now,
            defaultEffectStamp: currentStamp,
          });
          if (warpState) {
            if (entity.suppressWarpAcquireUntilNextTick === true) {
              entity.visibilitySuppressedUntilMs = Math.max(
                toFiniteNumber(entity.visibilitySuppressedUntilMs, 0),
                now + DESTINY_STAMP_INTERVAL_MS,
              );
              entity.suppressWarpAcquireUntilNextTick = false;
            }
            this.beginWarpDepartureOwnership(entity, now);
            this.beginPilotWarpVisibilityHandoff(entity, warpState, now);
            const warpStartStamp =
              entity.session && isReadyForDestiny(entity.session)
                ? currentStamp
                : this.getNextDestinyStamp(now);
            primePilotWarpActivationState(entity, warpState, warpStartStamp);
            const pilotWarpFactor = getPilotWarpFactorOptionA(entity, warpState);
            const watcherWarpStartStamp = getWatcherWarpStartStamp(
              warpState,
              pendingWarp,
              warpStartStamp,
            );
            const warpStartUpdates = buildWarpStartUpdates(
              entity,
              warpState,
              watcherWarpStartStamp,
              {
                includeEntityWarpIn: false,
              },
            );
            if (entity.session && isReadyForDestiny(entity.session)) {
              // Do NOT send any DoDestinyUpdate to the pilot between the
              // WarpTo prepare dispatch and warp completion.  ANY server update
              // during WarpState=1 causes a state-history rebase that disrupts
              // alignment progress (the "establishing warp vector" bar drops).
              // The DLL handles WarpState 1→2 entirely on its own.
              // Watchers still need the live warp-start contract so the
              // client can drive departure motion and FX locally.
              watcherOnlyUpdates.push({
                excludedSession: entity.session,
                updates: warpStartUpdates,
                sendOptions: {
                  minimumSessionStamp: toInt(
                    pendingWarp && pendingWarp.prepareVisibleStamp,
                    0,
                  ),
                },
              });
            } else {
              sharedUpdates.push(...warpStartUpdates);
            }
            persistShipEntity(entity);
            logBallDebug("warp.started.ego", entity, {
              pendingWarpState,
              warpCommandStamp: warpStartStamp,
              warpEffectStamp: warpState.effectStamp,
            });
            logMovementDebug("warp.started", entity, {
              pendingWarpState,
              warpState: serializeWarpState(entity),
              warpCommandStamp: warpStartStamp,
              warpEffectStamp: warpState.effectStamp,
            });
            const officialProfile = buildOfficialWarpReferenceProfile(
              warpState.totalDistance,
              Math.max(
                toFiniteNumber(warpState.warpSpeed, 0) / 1000,
                toFiniteNumber(warpState.cruiseWarpSpeedMs, 0) / ONE_AU_IN_METERS,
              ),
              entity.maxVelocity,
            );
            logWarpDebug("warp.started", entity, {
              pendingWarpState,
              officialProfile,
              profileDelta: buildWarpProfileDelta(warpState, officialProfile),
              pilotPlan: {
                bootstrapLiteRefresh: pilotCanReceiveWarpEgoStateRefresh,
                dualWarpCommand: false,
                preWarpAddBall: pilotCanReceivePreWarpRebaseline,
                preWarpSyncStamp: toInt(pendingWarp.preWarpSyncStamp, 0),
                watcherWarpFactor: getNominalWarpFactor(entity, warpState),
                pilotWarpFactor,
                pilotWarpFactorScale: ENABLE_PILOT_WARP_FACTOR_OPTION_A
                  ? PILOT_WARP_FACTOR_OPTION_A_SCALE
                  : 1,
                optionBDecelAssistScale: ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B
                  ? PILOT_WARP_SOLVER_ASSIST_SCALE
                  : 1,
                optionBDecelAssistLeadMs: ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B
                  ? PILOT_WARP_SOLVER_ASSIST_LEAD_MS
                  : 0,
                seedSpeedMs: roundNumber(getPilotWarpActivationSeedSpeed(entity), 3),
                seedSpeedAU: roundNumber(
                  getPilotWarpActivationSeedSpeed(entity) / ONE_AU_IN_METERS,
                  9,
                ),
                startupGuidanceVelocityMs: roundNumber(
                  magnitude(warpState.startupGuidanceVelocity),
                  3,
                ),
                activationVelocityFloorMs: roundNumber(
                  getPilotWarpNativeActivationSpeedFloor(entity),
                  3,
                ),
                activationVelocityFloorAU: roundNumber(
                  getPilotWarpNativeActivationSpeedFloor(entity) /
                    ONE_AU_IN_METERS,
                  9,
                ),
                maxSpeedRamp: warpState.pilotMaxSpeedRamp.map((entry) => ({
                  atMs: roundNumber(entry.atMs, 3),
                  stamp: entry.stamp,
                  speedMs: roundNumber(entry.speed, 3),
                  speedAU: roundNumber(entry.speed / ONE_AU_IN_METERS, 6),
                  label: entry.label,
                })),
                commandStamp: warpStartStamp,
                cruiseBumpAtMs: roundNumber(
                  toFiniteNumber(warpState.cruiseBumpAtMs, 0),
                  3,
                ),
                cruiseBumpStamp: warpState.cruiseBumpStamp,
                effectAtMs: roundNumber(
                  toFiniteNumber(warpState.effectAtMs, 0),
                  3,
                ),
                effectStamp: warpState.effectStamp,
              },
            });
            continue;
          }

          entity.pendingWarp = null;
          logMovementDebug("warp.aborted", entity, {
            reason: "WARP_DISTANCE_TOO_CLOSE_AFTER_ALIGN",
            pendingWarpState,
          });
        }
      }

      if (entity.kind === "missile") {
        logMissileDebug("missile.tick", {
          sceneSystemID: this.systemID,
          nowMs: roundNumber(now, 3),
          deltaSeconds: roundNumber(deltaSeconds, 4),
          traceActive,
          movementResult: normalizeTraceValue(result),
          flight: buildMissileFlightSnapshot(this, entity, now),
        });
        const missileLifecycle = resolveMissileLifecycle(this, entity, now);
        if (missileLifecycle.removed) {
          continue;
        }
        if (traceActive) {
          logMovementDebug("trace.tick.missile", entity, {
            deltaSeconds: roundNumber(deltaSeconds, 4),
            changed: result.changed === true,
          });
        }
        continue;
      }

      if (!result.changed) {
        if (traceActive) {
          logMovementDebug("trace.tick.idle", entity, {
            deltaSeconds: roundNumber(deltaSeconds, 4),
            correction: null,
          });
        }
        continue;
      }

      let correctionDebug = null;
      if (entity.mode === "WARP") {
        const warpState = entity.warpState || null;
        const warpCommandStamp = toInt(
          warpState && warpState.commandStamp,
          0,
        );
        const warpEffectStamp = toInt(
          warpState && warpState.effectStamp,
          warpCommandStamp,
        );
        const warpCruiseBumpStamp = toInt(warpState && warpState.cruiseBumpStamp, 0);
        const warpCruiseBumpAtMs = toFiniteNumber(
          warpState && warpState.cruiseBumpAtMs,
          shouldSchedulePilotWarpCruiseBump(warpState)
            ? getPilotWarpCruiseBumpAtMs(warpState)
            : 0,
        );
        const warpEffectAtMs = toFiniteNumber(
          warpState && warpState.effectAtMs,
          getPilotWarpEffectAtMs(warpState),
        );
        const warpElapsedMs = Math.max(
          0,
          toFiniteNumber(now, Date.now()) -
            toFiniteNumber(warpState && warpState.startTimeMs, now),
        );
        const warpCorrectionStamp = Math.max(
          this.getMovementStamp(now),
          warpCommandStamp,
        );
        const hasMeaningfulWarpVelocity = magnitude(entity.velocity) > 0.5;
        this.advancePilotWarpVisibilityHandoff(
          entity,
          now,
          sessionOnlyUpdates,
        );
        if (
          !result.warpCompleted &&
          entity.session &&
          isReadyForDestiny(entity.session)
        ) {
          const pilotWarpPhaseStamp = warpCorrectionStamp;
          const pilotMaxSpeedRamp = clonePilotWarpMaxSpeedRamp(
            warpState && warpState.pilotMaxSpeedRamp,
          );
          let duePilotWarpRampIndex = entity.lastPilotWarpMaxSpeedRampIndex;
          for (
            let index = entity.lastPilotWarpMaxSpeedRampIndex + 1;
            index < pilotMaxSpeedRamp.length;
            index += 1
          ) {
            if (now >= toFiniteNumber(pilotMaxSpeedRamp[index].atMs, 0)) {
              duePilotWarpRampIndex = index;
            } else {
              break;
            }
          }
          const shouldSendPilotWarpCruiseBump =
            warpCruiseBumpStamp > warpCommandStamp &&
            now >= warpCruiseBumpAtMs &&
            entity.lastPilotWarpCruiseBumpStamp !== warpCruiseBumpStamp;
          const shouldSendPilotWarpEffect =
            warpEffectStamp > warpCommandStamp &&
            now >= warpEffectAtMs &&
            entity.lastPilotWarpEffectStamp !== warpEffectStamp;
          const pilotWarpPhaseUpdates = [];
          let rampDebug = null;
          const shouldFoldDueRampIntoCruiseBump =
            shouldSendPilotWarpCruiseBump &&
            duePilotWarpRampIndex > entity.lastPilotWarpMaxSpeedRampIndex;
          if (shouldFoldDueRampIntoCruiseBump) {
            entity.lastPilotWarpMaxSpeedRampIndex = duePilotWarpRampIndex;
          } else if (duePilotWarpRampIndex > entity.lastPilotWarpMaxSpeedRampIndex) {
            const rampEntry = pilotMaxSpeedRamp[duePilotWarpRampIndex];
            pilotWarpPhaseUpdates.push({
              stamp: pilotWarpPhaseStamp,
              payload: destiny.buildSetMaxSpeedPayload(
                entity.itemID,
                rampEntry.speed,
              ),
            });
            entity.lastPilotWarpMaxSpeedRampIndex = duePilotWarpRampIndex;
            rampDebug = {
              index: duePilotWarpRampIndex,
              label: rampEntry.label,
              speedMs: roundNumber(rampEntry.speed, 3),
              speedAU: roundNumber(
                rampEntry.speed / ONE_AU_IN_METERS,
                6,
              ),
            };
          }
          if (shouldSendPilotWarpCruiseBump) {
            pilotWarpPhaseUpdates.push(
              buildWarpCruiseMaxSpeedUpdate(
                entity,
                pilotWarpPhaseStamp,
                warpState,
              ),
            );
            entity.lastPilotWarpCruiseBumpStamp = warpCruiseBumpStamp;
          }
          if (shouldSendPilotWarpEffect) {
            pilotWarpPhaseUpdates.push(
              buildWarpStartEffectUpdate(entity, pilotWarpPhaseStamp),
            );
            entity.lastPilotWarpEffectStamp = warpEffectStamp;
          }
          if (pilotWarpPhaseUpdates.length > 0) {
              sessionOnlyUpdates.push({
                session: entity.session,
                updates: pilotWarpPhaseUpdates,
                sendOptions: {
                  minimumLeadFromCurrentHistory: PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
                  maximumLeadFromCurrentHistory: PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
                },
              });
            logWarpDebug("warp.pilot.phase", entity, {
              stamp: pilotWarpPhaseStamp,
              ramp: rampDebug,
              cruiseBump: shouldSendPilotWarpCruiseBump,
              effect: shouldSendPilotWarpEffect,
            });
          }
          correctionDebug = movementWatcherCorrections.resolveWatcherCorrectionDispatch({
            runtime: this,
            entity,
            result,
            now,
            sessionOnlyUpdates,
            watcherOnlyUpdates,
          });
        }
        // Remote watchers should stay on their own WarpTo simulation once they
        // have received the warp-start contract. Mid-warp SetBallPosition /
        // SetBallVelocity corrections fight that local simulation and produce
        // the observed "jolt in place, then teleport" behavior on observers.
        // Keep only the normal warp-start and warp-completion updates for
        // watchers; the pilot still gets authoritative mid-warp hop updates.
        if (entity.lastWarpDiagnosticStamp !== warpCorrectionStamp) {
          logWarpDebug("warp.progress", entity, {
            stamp: warpCorrectionStamp,
          });
          entity.lastWarpDiagnosticStamp = warpCorrectionStamp;
        }
      } else {
        // `client/jolt3.txt` confirmed the remaining shared-space jolt was not
        // an NPC-only issue: every moving remote player / NPC / entity in
        // active GOTO/FOLLOW/ORBIT was still receiving a once-per-stamp
        // watcher SetBallVelocity, and Michelle rebased on those batches.
        // Keep active subwarp watchers entirely on the original command
        // contract (GotoDirection / FollowBall / Orbit / SetSpeedFraction)
        // until a mode transition or explicit recovery path needs a hard
        // anchor. That removes the periodic heading/orientation snap while
        // staying TiDi-safe because the command stamps are still scene-clock
        // driven.
        // `client/jolt9.txt` shows Michelle already has the right stop
        // contract once it receives SetSpeedFraction + Stop (+ the initial
        // velocity seed). Re-sending per-stamp SetBallVelocity after that
        // makes the client rebase its local stop simulation and visibly jolt.
        correctionDebug = movementWatcherCorrections.resolveWatcherCorrectionDispatch({
          runtime: this,
          entity,
          result,
          now,
          sessionOnlyUpdates,
          watcherOnlyUpdates,
        });
      }

      if (traceActive) {
        logMovementDebug("trace.tick", entity, {
          deltaSeconds: roundNumber(deltaSeconds, 4),
          correction: correctionDebug,
          dockingState:
            entity.dockingTargetID && this.getEntityByID(entity.dockingTargetID)
              ? buildDockingDebugState(
                  entity,
                  this.getEntityByID(entity.dockingTargetID),
                )
              : null,
        });
      }

      if (
        entity.session &&
        entity.mode !== "STOP" &&
        (now - entity.lastMovementDebugAt) >= 2000
      ) {
        logMovementDebug("tick", entity, {
          deltaSeconds: roundNumber(deltaSeconds, 4),
          correction: correctionDebug,
          dockingState:
            entity.dockingTargetID && this.getEntityByID(entity.dockingTargetID)
              ? buildDockingDebugState(
                  entity,
                  this.getEntityByID(entity.dockingTargetID),
                )
              : null,
        });
        entity.lastMovementDebugAt = now;
      }

      if (result.warpCompleted) {
        this.clearPilotWarpVisibilityHandoff(entity.session);
        const warpCompletionStamp = this.getHistorySafeDestinyStamp(
          now,
          PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
          PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
        );
        entity.lastWarpCorrectionBroadcastAt = now;
        entity.lastWarpPositionBroadcastStamp = warpCompletionStamp;
        entity.lastObserverCorrectionBroadcastAt = now;
        entity.lastObserverPositionBroadcastAt = now;
        entity.lastObserverPositionBroadcastStamp = warpCompletionStamp;
        const warpCompletionUpdates = buildWarpCompletionUpdates(
          entity,
          warpCompletionStamp,
          {
            includePosition: false,
          },
        );
        if (entity.session && isReadyForDestiny(entity.session)) {
          const pilotCompletionSessionStamp = this.getHistorySafeSessionDestinyStamp(
            entity.session,
            now,
            PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
            PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
          );
          if (entity.session._space) {
            entity.session._space.pilotWarpQuietUntilStamp = Math.max(
              toInt(entity.session._space.pilotWarpQuietUntilStamp, 0),
              pilotCompletionSessionStamp,
            ) >>> 0;
          }
          postWarpVisibilityReconciles.push({
            session: entity.session,
            entity,
            nowMs: now,
            rawStamp: warpCompletionStamp,
            sessionStamp: pilotCompletionSessionStamp,
          });
          beltRatArrivalEvents.push({
            session: entity.session,
            entity,
            nowMs: now,
            targetEntityID: toInt(
              result.completedWarpState && result.completedWarpState.targetEntityID,
              toInt(entity.targetEntityID, 0),
            ),
          });
          watcherOnlyUpdates.push({
            excludedSession: entity.session,
            updates: warpCompletionUpdates,
          });
        } else {
          sharedUpdates.push(...warpCompletionUpdates);
        }
        logMovementDebug("warp.completed", entity, {
          completionStamp: warpCompletionStamp,
        });
        logWarpDebug("warp.completed", entity, {
          completionStamp: warpCompletionStamp,
          completedWarpState: result.completedWarpState,
          officialProfile: buildOfficialWarpReferenceProfile(
            result.completedWarpState.totalDistance,
            Math.max(
              toFiniteNumber(result.completedWarpState.warpSpeed, 0) / 1000,
              toFiniteNumber(result.completedWarpState.cruiseWarpSpeedMs, 0) /
                ONE_AU_IN_METERS,
            ),
            entity.maxVelocity,
          ),
          profileDelta: buildWarpProfileDelta(
            result.completedWarpState,
            buildOfficialWarpReferenceProfile(
              result.completedWarpState.totalDistance,
              Math.max(
                toFiniteNumber(result.completedWarpState.warpSpeed, 0) / 1000,
                toFiniteNumber(result.completedWarpState.cruiseWarpSpeedMs, 0) /
                  ONE_AU_IN_METERS,
              ),
              entity.maxVelocity,
            ),
          ),
        });
        if (!entity.session) {
          try {
            const npcService = require(path.join(__dirname, "./npc"));
            if (npcService && typeof npcService.wakeNpcController === "function") {
              const deferredWakeAtMs = toFiniteNumber(
                entity.deferNpcWarpCompletionWakeUntilMs,
                0,
              );
              entity.deferNpcWarpCompletionWakeUntilMs = 0;
              if (deferredWakeAtMs <= now) {
                npcService.wakeNpcController(entity.itemID, now);
              }
            }
          } catch (error) {
            log.warn(`[SpaceRuntime] NPC warp completion wake failed: ${error.message}`);
          }
        }
      }

      if (now - entity.lastPersistAt >= 2000 || result.warpCompleted) {
        persistShipEntity(entity);
      }
    }

    if (dockRequests.size > 0) {
      const { dockSession } = require(path.join(__dirname, "./transitions"));
      for (const request of dockRequests.values()) {
        const result = dockSession(request.session, request.stationID);
        if (!result.success) {
          const entity = this.getShipEntityForSession(request.session);
          clearPendingDock(entity);
          log.warn(
            `[SpaceRuntime] Delayed dock failed for char=${request.session && request.session.characterID} station=${request.stationID}: ${result.errorMsg}`,
          );
        }
      }
    }

    this.validateAllTargetLocks(now);
    tickSceneStructureTethers(this, now);
    this.reconcileAllDynamicEntityPublicGrids();
    this.ensurePublicGridComposition();
    this.reconcileAllDynamicEntityBubbles();
    if (isAnchorRelevanceEnabled() && hasStartupAnchorRelevanceContext(this)) {
      const anchorRelevanceResult = syncRelevantStartupControllersForScene(this, {
        broadcast: false,
        nowMs: now,
      });
      if (!anchorRelevanceResult.success) {
        log.warn(
          `[SpaceRuntime] NPC anchor relevance sync failed for system=${this.systemID}: ${anchorRelevanceResult.errorMsg || "SYNC_FAILED"}`,
        );
      }
    }
    for (const arrivalEvent of beltRatArrivalEvents) {
      this.maybeSpawnAsteroidBeltRatsForArrival(
        arrivalEvent.session,
        arrivalEvent.entity,
        {
          nowMs: arrivalEvent.nowMs,
          targetEntityID: arrivalEvent.targetEntityID,
          broadcast: false,
          source: "warpCompleted",
        },
      );
    }
    for (const reconcile of postWarpVisibilityReconciles) {
      const landingDelta = this.buildDynamicVisibilityDeltaForSession(
        reconcile.session,
        reconcile.nowMs,
        {
          bypassPilotWarpQuietWindow: true,
        },
      );
      const completionUpdates = buildPilotWarpCompletionUpdates(
        reconcile.entity,
        reconcile.sessionStamp,
      );
      let landingUpdates = completionUpdates;
      if (landingDelta) {
        const removeUpdates =
          landingDelta.removedIDs.length > 0
            ? this.buildRemoveBallsUpdates(landingDelta.removedIDs, {
                nowMs: reconcile.nowMs,
                stampOverride: reconcile.sessionStamp,
              })
            : [];
        const addPresentation =
          landingDelta.addedEntities.length > 0
            ? this.buildSessionStampedAddBallsUpdatesForSession(
                reconcile.session,
                landingDelta.addedEntities,
                reconcile.sessionStamp,
                {
                  nowMs: reconcile.nowMs,
                },
              )
            : null;
        landingUpdates = [
          ...completionUpdates,
          ...removeUpdates,
          ...(addPresentation ? addPresentation.updates : []),
        ];
        reconcile.session._space.visibleDynamicEntityIDs = landingDelta.desiredIDs;
      }
      const staticLandingDelta = this.buildStaticVisibilityDeltaForSession(
        reconcile.session,
        reconcile.nowMs,
      );
      if (staticLandingDelta) {
        const removeUpdates =
          staticLandingDelta.removedIDs.length > 0
            ? this.buildRemoveBallsUpdates(staticLandingDelta.removedIDs, {
                nowMs: reconcile.nowMs,
                stampOverride: reconcile.sessionStamp,
              })
            : [];
        const addPresentation =
          staticLandingDelta.addedEntities.length > 0
            ? this.buildSessionStampedAddBallsUpdatesForSession(
                reconcile.session,
                staticLandingDelta.addedEntities,
                reconcile.sessionStamp,
                {
                  nowMs: reconcile.nowMs,
                },
              )
            : null;
        landingUpdates = [
          ...landingUpdates,
          ...removeUpdates,
          ...(addPresentation ? addPresentation.updates : []),
        ];
        reconcile.session._space.visibleBubbleScopedStaticEntityIDs =
          staticLandingDelta.desiredIDs;
      }
      sessionOnlyUpdates.push({
        session: reconcile.session,
        updates: landingUpdates,
        sendOptions: {
          translateStamps: false,
        },
      });
    }
    tickHudIconStateExpiries(this, now);
    this.syncDynamicVisibilityForAllSessions(now);
    this.flushTickDestinyPresentationBatch();

    for (const batch of sessionOnlyPreEffectUpdates) {
      if (batch.splitUpdates) {
        this.sendDestinyUpdatesIndividually(
          batch.session,
          batch.updates,
          false,
          batch && batch.sendOptions ? batch.sendOptions : {},
        );
      } else {
        this.sendDestinyUpdates(
          batch.session,
          batch.updates,
          false,
          batch && batch.sendOptions ? batch.sendOptions : {},
        );
      }
    }
    this.broadcastMovementUpdates(sharedUpdates);
    for (const batch of sessionOnlyUpdates) {
      this.sendDestinyUpdates(
        batch.session,
        batch.updates,
        false,
        batch && batch.sendOptions ? batch.sendOptions : {},
      );
    }
    for (const batch of watcherOnlyUpdates) {
      this.broadcastMovementUpdates(
        batch.updates,
        batch.excludedSession,
        batch.sendOptions || {},
      );
    }
    this.flushDirectDestinyNotificationBatch();
    this._tickTargetingStatsCache = null;
  }

  settleTransientStargateActivationStates(now) {
    const changed = [];
    for (const entity of this.staticEntities) {
      if (entity.kind !== "stargate") {
        continue;
      }
      if (entity.activationState !== STARGATE_ACTIVATION_STATE.ACTIVATING) {
        continue;
      }
      if (toFiniteNumber(entity.activationTransitionAtMs, 0) > now) {
        continue;
      }
      entity.activationState = STARGATE_ACTIVATION_STATE.OPEN;
      entity.activationTransitionAtMs = 0;
      changed.push(entity);
    }
    return changed;
  }
}

class SpaceRuntime {
  constructor() {
    this.scenes = new Map();
    this.solarSystemGateActivationOverrides = new Map();
    this.stargateActivationOverrides = new Map();
    this._tickIntervalMs = RUNTIME_TICK_INTERVAL_MS;
    this._lastTickStartedAtMonotonicMs = getMonotonicTimeMs();
    this._lastTickSummary = null;
    pruneExpiredSpaceItems(Date.now());
    this._tickHandle = setInterval(() => this.tick(), this._tickIntervalMs);
    if (this._tickHandle && typeof this._tickHandle.unref === "function") {
      this._tickHandle.unref();
    }
  }

  isSolarSystemSceneLoaded(systemID) {
    const numericSystemID = toInt(systemID, 0);
    return numericSystemID > 0 && this.scenes.has(numericSystemID);
  }

  getSolarSystemStargateActivationState(systemID) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return STARGATE_ACTIVATION_STATE.CLOSED;
    }
    if (this.solarSystemGateActivationOverrides.has(numericSystemID)) {
      return this.solarSystemGateActivationOverrides.get(numericSystemID);
    }
    if (keepsAllStargatesActiveDuringLazyLoading()) {
      return STARGATE_ACTIVATION_STATE.OPEN;
    }
    return this.isSolarSystemSceneLoaded(numericSystemID)
      ? STARGATE_ACTIVATION_STATE.OPEN
      : STARGATE_ACTIVATION_STATE.CLOSED;
  }

  resolveStargateActivationState(stargate) {
    const numericGateID = toInt(stargate && stargate.itemID, 0);
    if (numericGateID && this.stargateActivationOverrides.has(numericGateID)) {
      return this.stargateActivationOverrides.get(numericGateID);
    }

    const destinationSystemID = toInt(
      stargate && stargate.destinationSolarSystemID,
      0,
    );
    if (destinationSystemID) {
      return this.getSolarSystemStargateActivationState(destinationSystemID);
    }

    return coerceStableActivationState(
      stargate && stargate.activationState,
      STARGATE_ACTIVATION_STATE.CLOSED,
    );
  }

  refreshStargateActivationStates(options = {}) {
    const targetGateID = toInt(options.targetGateID, 0);
    const targetSystemID = toInt(options.targetSystemID, 0);
    const now = Date.now();
    const animateOpenTransitions =
      options.animateOpenTransitions !== false && options.broadcast !== false;
    const changedByScene = new Map();

    for (const scene of this.scenes.values()) {
      for (const entity of scene.staticEntities) {
        if (entity.kind !== "stargate") {
          continue;
        }
        if (targetGateID && toInt(entity.itemID, 0) !== targetGateID) {
          continue;
        }
        if (
          targetSystemID &&
          toInt(entity.destinationSolarSystemID, 0) !== targetSystemID
        ) {
          continue;
        }

        const nextActivationState = this.resolveStargateActivationState(entity);
        const currentStableActivationState = coerceStableActivationState(
          entity.activationState,
          STARGATE_ACTIVATION_STATE.CLOSED,
        );
        if (currentStableActivationState === nextActivationState) {
          continue;
        }

        if (
          animateOpenTransitions &&
          currentStableActivationState === STARGATE_ACTIVATION_STATE.CLOSED &&
          nextActivationState === STARGATE_ACTIVATION_STATE.OPEN
        ) {
          entity.activationState = STARGATE_ACTIVATION_STATE.ACTIVATING;
          entity.activationTransitionAtMs =
            now + STARGATE_ACTIVATION_TRANSITION_MS;
        } else {
          entity.activationState = nextActivationState;
          entity.activationTransitionAtMs = 0;
        }
        if (!changedByScene.has(scene)) {
          changedByScene.set(scene, []);
        }
        changedByScene.get(scene).push(entity);
      }
    }

    if (options.broadcast !== false) {
      for (const [scene, entities] of changedByScene.entries()) {
        scene.broadcastSlimItemChanges(entities);
      }
    }

    return [...changedByScene.entries()].flatMap(([scene, entities]) =>
      entities.map((entity) => ({
        systemID: scene.systemID,
        itemID: entity.itemID,
        activationState: entity.activationState,
      })),
    );
  }

  setSolarSystemStargateActivationState(systemID, activationState, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return [];
    }

    if (activationState === undefined || activationState === null) {
      this.solarSystemGateActivationOverrides.delete(numericSystemID);
    } else {
      this.solarSystemGateActivationOverrides.set(
        numericSystemID,
        coerceStableActivationState(
          activationState,
          STARGATE_ACTIVATION_STATE.CLOSED,
        ),
      );
    }

    return this.refreshStargateActivationStates({
      broadcast: options.broadcast !== false,
      targetSystemID: numericSystemID,
    });
  }

  setStargateActivationState(stargateID, activationState, options = {}) {
    const numericStargateID = toInt(stargateID, 0);
    if (!numericStargateID) {
      return [];
    }

    if (activationState === undefined || activationState === null) {
      this.stargateActivationOverrides.delete(numericStargateID);
    } else {
      this.stargateActivationOverrides.set(
        numericStargateID,
        coerceStableActivationState(
          activationState,
          STARGATE_ACTIVATION_STATE.CLOSED,
        ),
      );
    }

    return this.refreshStargateActivationStates({
      broadcast: options.broadcast !== false,
      targetGateID: numericStargateID,
    });
  }

  preloadSolarSystems(systemIDs, options = {}) {
    const preloadList = Array.isArray(systemIDs) ? systemIDs : [systemIDs];
    const normalizedSystemIDs = preloadList
      .map((systemID) => toInt(systemID, 0))
      .filter((systemID) => systemID > 0);
    const totalSystems = normalizedSystemIDs.length;
    const logStartupProgress = options.logStartupProgress === true;

    for (const [systemIndex, systemID] of normalizedSystemIDs.entries()) {
      const numericSystemID = toInt(systemID, 0);
      const progressIndex = systemIndex + 1;
      const shouldLogCheckpoint =
        logStartupProgress &&
        shouldLogStartupPreloadCheckpoint(progressIndex, totalSystems);
      const bootstrapMetrics = logStartupProgress ? {} : null;
      const systemLabel = getStartupPreloadSystemLabel(numericSystemID);
      const sceneStartedAtMs = Date.now();

      if (shouldLogCheckpoint) {
        log.info(
          `[SpaceRuntime] Startup preload ${progressIndex}/${totalSystems}: ` +
            `bootstrapping ${systemLabel}`,
        );
      }

      this.ensureScene(numericSystemID, {
        refreshStargates: false,
        startupBootstrapMetrics: bootstrapMetrics,
      });

      if (shouldLogCheckpoint) {
        const sceneElapsedMs = Date.now() - sceneStartedAtMs;
        const metricsSummary = formatStartupBootstrapMetrics(bootstrapMetrics);
        log.info(
          `[SpaceRuntime] Startup preload ${progressIndex}/${totalSystems}: ` +
            `${systemLabel} ready in ${sceneElapsedMs}ms` +
            `${metricsSummary ? ` | ${metricsSummary}` : ""}`,
        );
      }
    }

    const stargateRefreshStartedAtMs = Date.now();
    if (logStartupProgress) {
      log.info(
        `[SpaceRuntime] Startup preload stargates: refreshing activation state after ` +
          `${totalSystems} system(s)`,
      );
    }
    const activationChanges = this.refreshStargateActivationStates({
      broadcast: options.broadcast !== false,
    });
    if (logStartupProgress) {
      log.info(
        `[SpaceRuntime] Startup preload stargates complete in ` +
          `${Date.now() - stargateRefreshStartedAtMs}ms ` +
          `(${activationChanges.length} activation update(s))`,
      );
    }
    return activationChanges;
  }

  preloadStartupSolarSystems(options = {}) {
    const preloadPlan = resolveStartupSolarSystemPreloadPlan();
    const startedAt = Date.now();
    const startupPresenceConfigSummary = buildStartupPresenceSummary([]);
    log.info(
      `[SpaceRuntime] Starting startup solar-system preload: mode=${preloadPlan.mode} ` +
        `${preloadPlan.modeName} count=${preloadPlan.systemIDs.length}`,
    );
    log.info(
      `[SpaceRuntime] NPC startup config: skip=${startupPresenceConfigSummary.settings.skipNpcStartup} ` +
        `authored=${startupPresenceConfigSummary.settings.authoredStartupEnabled} ` +
        `defaultConcord=${startupPresenceConfigSummary.settings.defaultConcordStartupEnabled} ` +
        `stationScreens=${startupPresenceConfigSummary.settings.defaultConcordStationScreensEnabled} ` +
        `ambientVirtualization=${startupPresenceConfigSummary.settings.ambientVirtualizationEnabled} ` +
        `combatDormancy=${startupPresenceConfigSummary.settings.combatDormancyEnabled}`,
    );
    const activationChanges = this.preloadSolarSystems(preloadPlan.systemIDs, {
      ...options,
      logStartupProgress: true,
    });
    const startupPresenceSummary = buildStartupPresenceSummary(preloadPlan.systemIDs);
    log.info(
      `[SpaceRuntime] Startup CONCORD presence: ${startupPresenceSummary.concord.ships} ships ` +
        `(live ${startupPresenceSummary.concord.liveShips} / virtualized ${startupPresenceSummary.concord.virtualizedShips}) ` +
        `across ${startupPresenceSummary.concord.stargateAnchors} gates / ` +
        `${startupPresenceSummary.concord.anchors} anchors in ` +
        `${startupPresenceSummary.concord.systems} systems`,
    );
    log.info(
      `[SpaceRuntime] Startup NPC presence: ${startupPresenceSummary.npc.ships} ships ` +
        `(live ${startupPresenceSummary.npc.liveShips} / virtualized ${startupPresenceSummary.npc.virtualizedShips}) ` +
        `across ${startupPresenceSummary.npc.stargateAnchors} gates / ` +
        `${startupPresenceSummary.npc.anchors} anchors in ` +
        `${startupPresenceSummary.npc.systems} systems`,
    );
    log.info(
      `[SpaceRuntime] Startup presence totals: ${startupPresenceSummary.totalStartupShips} ships ` +
        `(live ${startupPresenceSummary.liveStartupShips} / virtualized ${startupPresenceSummary.virtualizedStartupShips}) ` +
        `with startup presence in ${startupPresenceSummary.startupSystemsWithPresence} / ` +
        `${startupPresenceSummary.systemsConsidered} preloaded systems`,
    );
    log.success(
      `[SpaceRuntime] Startup solar-system preload complete in ${Date.now() - startedAt}ms ` +
        `(${preloadPlan.systemIDs.length} systems, ${activationChanges.length} stargate activation updates)`,
    );
    return activationChanges;
  }

  getStartupSolarSystemPreloadPlan() {
    return resolveStartupSolarSystemPreloadPlan();
  }

  ensureScene(systemID, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return null;
    }

    const bootstrapMetrics =
      options.startupBootstrapMetrics &&
      typeof options.startupBootstrapMetrics === "object"
        ? options.startupBootstrapMetrics
        : null;
    const ensureSceneStartedAtMs = bootstrapMetrics ? Date.now() : 0;
    let created = false;
    if (!this.scenes.has(numericSystemID)) {
      const sceneConstructionStartedAtMs = bootstrapMetrics ? Date.now() : 0;
      this.scenes.set(numericSystemID, new SolarSystemScene(numericSystemID));
      if (bootstrapMetrics) {
        bootstrapMetrics.sceneConstructionElapsedMs =
          Date.now() - sceneConstructionStartedAtMs;
      }
      created = true;
    }
    const scene = this.scenes.get(numericSystemID);
    if (created && options.refreshStargates !== false) {
      this.refreshStargateActivationStates({
        broadcast: options.broadcastStargateChanges !== false,
      });
    }
    if (created) {
      if (config.asteroidFieldsEnabled === true) {
        try {
          const startupStartedAtMs = bootstrapMetrics ? Date.now() : 0;
          const asteroidService = require(path.join(__dirname, "./asteroids"));
          if (asteroidService && typeof asteroidService.handleSceneCreated === "function") {
            asteroidService.handleSceneCreated(scene);
          }
          if (bootstrapMetrics) {
            bootstrapMetrics.asteroidsElapsedMs = Date.now() - startupStartedAtMs;
          }
        } catch (error) {
          log.warn(
            `[SpaceRuntime] Failed to initialize asteroid fields for system ${numericSystemID}: ${error.message}`,
          );
        }
      } else {
        scene._asteroidFieldsInitialized = true;
      }
      if (config.miningEnabled === true) {
        try {
          const startupStartedAtMs = Date.now();
          const miningRuntime = require(path.join(__dirname, "../services/mining/miningRuntime"));
          if (miningRuntime && typeof miningRuntime.handleSceneCreated === "function") {
            miningRuntime.handleSceneCreated(scene);
          }
          const startupElapsedMs = Date.now() - startupStartedAtMs;
          if (bootstrapMetrics) {
            bootstrapMetrics.miningElapsedMs = startupElapsedMs;
          }
          if (startupElapsedMs >= 500) {
            log.info(
              `[SpaceRuntime] Scene startup mining system=${numericSystemID} took ${startupElapsedMs}ms`,
            );
          }
        } catch (error) {
          log.warn(
            `[SpaceRuntime] Mining scene startup failed for system=${numericSystemID}: ${error.message}`,
          );
        }
      }
      if (process.env.EVEJS_SKIP_NPC_STARTUP !== "1") {
        try {
          const startupStartedAtMs = Date.now();
          const npcService = require(path.join(__dirname, "./npc"));
          if (npcService && typeof npcService.handleSceneCreated === "function") {
            npcService.handleSceneCreated(scene);
          }
          const startupElapsedMs = Date.now() - startupStartedAtMs;
          if (bootstrapMetrics) {
            bootstrapMetrics.npcElapsedMs = startupElapsedMs;
          }
          if (startupElapsedMs >= 500) {
            log.info(
              `[SpaceRuntime] Scene startup npc system=${numericSystemID} took ${startupElapsedMs}ms`,
            );
          }
        } catch (error) {
          log.warn(
            `[SpaceRuntime] NPC scene startup failed for system=${numericSystemID}: ${error.message}`,
          );
        }
      }
      try {
        const startupStartedAtMs = Date.now();
        const dungeonUniverseSiteService = require(path.join(
          __dirname,
          "../services/dungeon/dungeonUniverseSiteService",
        ));
        if (
          dungeonUniverseSiteService &&
          typeof dungeonUniverseSiteService.handleSceneCreated === "function"
        ) {
          // The seeded-site hook can spawn first-pass encounter NPCs, so let
          // the shared NPC scene bootstrap finish first and then materialize
          // dungeon contents on top of that initialized runtime.
          dungeonUniverseSiteService.handleSceneCreated(scene);
        }
        const startupElapsedMs = Date.now() - startupStartedAtMs;
        if (bootstrapMetrics) {
          bootstrapMetrics.dungeonElapsedMs = startupElapsedMs;
        }
        if (startupElapsedMs >= 500) {
          log.info(
            `[SpaceRuntime] Scene startup dungeon system=${numericSystemID} took ${startupElapsedMs}ms`,
          );
        }
      } catch (error) {
        log.warn(
          `[SpaceRuntime] Dungeon universe site startup failed for system=${numericSystemID}: ${error.message}`,
        );
      }
      if (config.wormholesEnabled === true) {
        try {
          const startupStartedAtMs = Date.now();
          const wormholeRuntime = require(path.join(
            __dirname,
            "../services/exploration/wormholes/wormholeRuntime",
          ));
          if (wormholeRuntime && typeof wormholeRuntime.handleSceneCreated === "function") {
            wormholeRuntime.handleSceneCreated(scene);
          }
          const startupElapsedMs = Date.now() - startupStartedAtMs;
          if (bootstrapMetrics) {
            bootstrapMetrics.wormholesElapsedMs = startupElapsedMs;
          }
          if (startupElapsedMs >= 500) {
            log.info(
              `[SpaceRuntime] Scene startup wormholes system=${numericSystemID} took ${startupElapsedMs}ms`,
            );
          }
        } catch (error) {
          log.warn(
            `[SpaceRuntime] Wormhole scene startup failed for system=${numericSystemID}: ${error.message}`,
          );
        }
      }
      if (process.env.EVEJS_SKIP_NPC_STARTUP !== "1") {
        try {
          const startupStartedAtMs = Date.now();
          const npcService = require(path.join(__dirname, "./npc"));
          if (
            npcService &&
            typeof npcService.refreshStartupRulesForScene === "function"
          ) {
            // Some startup rules depend on static scene content that is
            // materialized later in scene bootstrap, like universe signature
            // sites and wormhole scene anchors. Sweep those rules one more time
            // after the static layers are in place so they do not wait for the
            // first maintenance tick to appear.
            npcService.refreshStartupRulesForScene(scene);
          }
          const startupElapsedMs = Date.now() - startupStartedAtMs;
          if (bootstrapMetrics) {
            bootstrapMetrics.npcPostStaticElapsedMs = startupElapsedMs;
          }
          if (startupElapsedMs >= 500) {
            log.info(
              `[SpaceRuntime] Scene startup npc post-static sweep system=${numericSystemID} took ${startupElapsedMs}ms`,
            );
          }
        } catch (error) {
          log.warn(
            `[SpaceRuntime] NPC post-static startup sweep failed for system=${numericSystemID}: ${error.message}`,
          );
        }
      }
    }
    if (bootstrapMetrics) {
      bootstrapMetrics.created = created;
      bootstrapMetrics.totalElapsedMs = Date.now() - ensureSceneStartedAtMs;
      bootstrapMetrics.systemID = numericSystemID;
    }
    return scene;
  }

  getSceneActivityState(systemID, wallclockNow = Date.now()) {
    const numericSystemID = toInt(systemID, 0);
    const scene = this.scenes.get(numericSystemID);
    return scene ? getSceneActivityState(scene, wallclockNow) : null;
  }

  wakeSceneForImmediateUse(sceneOrSystemID, options = {}) {
    const scene =
      typeof sceneOrSystemID === "object" && sceneOrSystemID !== null
        ? sceneOrSystemID
        : this.ensureScene(sceneOrSystemID, {
            refreshStargates: options.refreshStargates,
            broadcastStargateChanges: options.broadcastStargateChanges,
          });
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const wallclockNow = toFiniteNumber(options.wallclockNowMs, Date.now());
    const before = getSceneActivityState(scene, wallclockNow);
    const shouldCatchUp = options.force === true || before.sessionCount === 0;
    if (shouldCatchUp) {
      const destroyExpiredStartedAtMs = Date.now();
      scene.destroyExpiredInventoryBackedEntities(before.sceneNowMs);
      const destroyExpiredElapsedMs = Date.now() - destroyExpiredStartedAtMs;
      if (destroyExpiredElapsedMs >= 250) {
        log.info(
          `[SpaceRuntime] destroyExpiredInventoryBackedEntities system=${scene.systemID} ` +
          `reason=${String(options.reason || "").trim() || "wake"} took ${destroyExpiredElapsedMs}ms`,
        );
      }
      const tickStartedAtMs = Date.now();
      scene.tick(wallclockNow);
      const tickElapsedMs = Date.now() - tickStartedAtMs;
      if (tickElapsedMs >= 250) {
        log.info(
          `[SpaceRuntime] scene.tick system=${scene.systemID} reason=${String(options.reason || "").trim() || "wake"} ` +
          `took ${tickElapsedMs}ms`,
        );
      }
    }
    const useAnchorRelevance =
      isAnchorRelevanceEnabled() &&
      hasStartupAnchorRelevanceContext(scene, {
        relevantClusterKeys: options.relevantClusterKeys,
        relevantEntities: options.relevantEntities,
        relevantPositions: options.relevantPositions,
      });
    let ambientMaterializationResult;
    let combatMaterializationResult;
    if (useAnchorRelevance) {
      const anchorRelevanceResult = syncRelevantStartupControllersForScene(scene, {
        broadcast: false,
        excludedSession: options.excludedSession || null,
        nowMs: before.sceneNowMs,
        catchUpBehavior: true,
        relevantClusterKeys: options.relevantClusterKeys,
        relevantEntities: options.relevantEntities,
        relevantPositions: options.relevantPositions,
        materializeAmbientStartup: options.materializeAmbientStartup !== false,
        materializeDormantCombat: options.materializeDormantCombat !== false,
        dematerializeAmbientStartup: true,
        dematerializeDormantCombat: true,
      });
      if (!anchorRelevanceResult.success) {
        return anchorRelevanceResult;
      }
      ambientMaterializationResult = {
        success: true,
        data: anchorRelevanceResult.data.ambient,
      };
      combatMaterializationResult = {
        success: true,
        data: anchorRelevanceResult.data.combat,
      };
    } else {
      ambientMaterializationResult =
        options.materializeAmbientStartup === false || before.sessionCount > 0
          ? {
              success: true,
              data: {
                materialized: [],
                materializedCount: 0,
              },
            }
          : materializeAmbientStartupControllersForScene(scene, {
              broadcast: false,
              excludedSession: options.excludedSession || null,
            });
      if (!ambientMaterializationResult.success) {
        return ambientMaterializationResult;
      }
      combatMaterializationResult =
        options.materializeDormantCombat === false || before.sessionCount > 0
          ? {
              success: true,
              data: {
                materialized: [],
                materializedCount: 0,
              },
            }
          : materializeDormantCombatControllersForScene(scene, {
              broadcast: false,
              excludedSession: options.excludedSession || null,
              catchUpBehavior: true,
              nowMs: before.sceneNowMs,
            });
      if (!combatMaterializationResult.success) {
        return combatMaterializationResult;
      }
    }

    return {
      success: true,
      data: {
        scene,
        ticked: shouldCatchUp,
        ambientMaterialization: ambientMaterializationResult.data,
        combatMaterialization: combatMaterializationResult.data,
        before,
        after: getSceneActivityState(scene, wallclockNow),
        reason: String(options.reason || "").trim() || null,
      },
    };
  }

  syncStructureSceneState(systemID, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    const scene = this.scenes.get(numericSystemID);
    if (!scene) {
      return {
        success: true,
        data: {
          added: [],
          updated: [],
        },
      };
    }

    return {
      success: true,
      data: scene.syncStructureEntitiesFromState(options),
    };
  }

  handleStructureStateChange(changePayload = {}) {
    return syncRuntimeStructureStateChanges(this, changePayload);
  }

  getSceneTimeSnapshot(systemID) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.buildTimeStateSnapshot() : null;
  }

  getSolarSystemTimeDilation(systemID) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.getTimeDilation() : 1;
  }

  setSolarSystemTimeDilation(systemID, factor, options = {}) {
    const scene = this.ensureScene(systemID);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    return {
      success: true,
      data: scene.setTimeDilation(factor, {
        ...options,
        syncSessions: options.syncSessions !== false,
        emit: options.emit !== false,
        forceRebase: options.forceRebase !== false,
      }),
    };
  }

  getSceneForSession(session) {
    if (!session || !session._space) {
      return null;
    }

    return this.scenes.get(Number(session._space.systemID)) || null;
  }

  getSimulationTimeMsForSession(session, fallback = Date.now()) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.getCurrentSessionSimTimeMs(session)
      : toFiniteNumber(fallback, Date.now());
  }

  getSimulationFileTimeForSession(session, fallback = currentFileTime()) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getCurrentSessionFileTime(session) : fallback;
  }

  getSimulationTimeMsForSystem(systemID, fallback = Date.now()) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.getCurrentSimTimeMs() : toFiniteNumber(fallback, Date.now());
  }

  getSimulationFileTimeForSystem(systemID, fallback = currentFileTime()) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.getCurrentFileTime() : fallback;
  }

  syncSessionSimClock(session, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.syncSessionSimClock(session, options) : null;
  }

  getEntity(session, entityID) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getEntityByID(entityID) : null;
  }

  healSessionShipResources(session, options = {}) {
    const shipID = toInt(
      session &&
        session._space &&
        session._space.shipID,
      0,
    );
    if (!shipID) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const scene = this.getSceneForSession(session);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const entity = scene.getEntityByID(shipID);
    if (!entity || entity.kind !== "ship") {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    return healShipResourcesForSession(session, scene, entity, options);
  }

  getEntitySpaceStateSnapshot(session, entityID) {
    const entity = this.getEntity(session, entityID);
    return entity ? serializeSpaceState(entity) : null;
  }

  getBubbleForSession(session) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getBubbleForSession(session) : null;
  }

  getSessionsInBubble(systemID, bubbleID) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.getSessionsInBubble(bubbleID) : [];
  }

  getDynamicEntitiesInBubble(systemID, bubbleID) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.getDynamicEntitiesInBubble(bubbleID) : [];
  }

  getShipsInBubble(systemID, bubbleID) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.getShipsInBubble(bubbleID) : [];
  }

  broadcastDestinyUpdatesToBubble(systemID, bubbleID, updates, options = {}) {
    const scene = this.ensureScene(systemID);
    return scene
      ? scene.broadcastDestinyUpdatesToBubble(bubbleID, updates, options)
      : { deliveredCount: 0 };
  }

  spawnDynamicShip(systemID, shipSpec, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    const scene = this.ensureScene(numericSystemID);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const entity = buildRuntimeShipEntity(shipSpec || {}, numericSystemID, {
      session: options.session || null,
      persistSpaceState: options.persistSpaceState === true,
    });
    return scene.spawnDynamicEntity(entity, options);
  }

  buildRuntimeSpaceEntityFromItemRecord(itemRecord, systemID, nowMs = Date.now(), options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID || !itemRecord || !itemRecord.itemID) {
      return null;
    }
    return buildRuntimeSpaceEntityFromItem(
      itemRecord,
      numericSystemID,
      toFiniteNumber(nowMs, Date.now()),
      options,
    );
  }

  spawnDynamicInventoryEntity(systemID, itemID, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    const numericItemID = toInt(itemID, 0);
    if (!numericSystemID) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }
    if (!numericItemID) {
      return {
        success: false,
        errorMsg: "ITEM_NOT_FOUND",
      };
    }

    const scene = this.ensureScene(numericSystemID);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const existingEntity = scene.getEntityByID(numericItemID);
    if (isInventoryBackedDynamicEntity(existingEntity)) {
      return scene.refreshInventoryBackedEntityPresentation(numericItemID, options);
    }
    if (existingEntity) {
      return {
        success: true,
        data: {
          entity: existingEntity,
        },
      };
    }

    const itemRecord = findItemById(numericItemID);
    if (!itemRecord) {
      return {
        success: false,
        errorMsg: "ITEM_NOT_FOUND",
      };
    }

    const entity = buildRuntimeSpaceEntityFromItem(
      itemRecord,
      numericSystemID,
      scene.getCurrentSimTimeMs(),
    );
    if (!entity) {
      return {
        success: false,
        errorMsg: "UNSUPPORTED_DYNAMIC_ITEM",
      };
    }

    return scene.spawnDynamicEntity(entity, options);
  }

  refreshInventoryBackedEntityPresentation(systemID, entityID, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    const scene = this.ensureScene(numericSystemID);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    return scene.refreshInventoryBackedEntityPresentation(entityID, options);
  }

  removeDynamicEntity(systemID, entityID, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    const scene = this.scenes.get(numericSystemID);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    return scene.removeDynamicEntity(entityID, options);
  }

  destroyDynamicInventoryEntity(systemID, entityID, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    const scene = this.scenes.get(numericSystemID);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    return scene.destroyInventoryBackedDynamicEntity(entityID, options);
  }

  attachSession(session, shipItem, options = {}) {
    const previousSimTimeMs =
      options.previousSimTimeMs === undefined || options.previousSimTimeMs === null
        ? (
          session && session._space
            ? this.getSimulationTimeMsForSession(session, null)
            : null
        )
        : toFiniteNumber(options.previousSimTimeMs, null);
    if (session && session._space) {
      this.detachSession(session, { broadcast: false });
    }

    const numericSystemID =
      Number(options.systemID || session.solarsystemid || session.solarsystemid2 || 0);
    if (!numericSystemID) {
      return null;
    }

    const scene = this.ensureScene(numericSystemID);
    const wakeStartedAtMs = Date.now();
    const wakeResult = this.wakeSceneForImmediateUse(scene, {
      reason: "attach-session",
      relevantPositions: [
        shipItem &&
        shipItem.spaceState &&
        shipItem.spaceState.position,
      ].filter(Boolean),
    });
    const wakeElapsedMs = Date.now() - wakeStartedAtMs;
    if (wakeElapsedMs >= 500) {
      log.info(
        `[SpaceRuntime] wakeSceneForImmediateUse system=${numericSystemID} ` +
        `reason=attach-session took ${wakeElapsedMs}ms`,
      );
    }
    if (!wakeResult || wakeResult.success === false) {
      log.warn(
        `[SpaceRuntime] wakeSceneForImmediateUse failed for system=${numericSystemID}: ` +
        `${wakeResult && wakeResult.errorMsg ? wakeResult.errorMsg : "UNKNOWN_ERROR"}`,
      );
    }
    const attachStartedAtMs = Date.now();
    const attached = scene.attachSession(session, shipItem, {
      ...options,
      forceSimClockRebase: options.forceSimClockRebase === true,
      previousSimTimeMs,
    });
    const attachElapsedMs = Date.now() - attachStartedAtMs;
    if (attachElapsedMs >= 500) {
      log.info(
        `[SpaceRuntime] scene.attachSession system=${numericSystemID} ship=${Number(shipItem && shipItem.itemID) || 0} ` +
        `took ${attachElapsedMs}ms`,
      );
    }
    autoMaterializeNearbyUniverseSiteForAttach(
      scene,
      attached || {
        position:
          shipItem &&
          shipItem.spaceState &&
          shipItem.spaceState.position,
      },
      {
        broadcast: true,
        excludedSession: session || null,
        session: session || null,
      },
    );
    return attached;
  }

  attachSessionToExistingEntity(session, shipItem, entity, options = {}) {
    const previousSimTimeMs =
      options.previousSimTimeMs === undefined || options.previousSimTimeMs === null
        ? (
          session && session._space
            ? this.getSimulationTimeMsForSession(session, null)
            : null
        )
        : toFiniteNumber(options.previousSimTimeMs, null);
    if (session && session._space) {
      this.detachSession(session, { broadcast: false });
    }

    const numericSystemID =
      Number(options.systemID || session.solarsystemid || session.solarsystemid2 || 0);
    if (!numericSystemID) {
      return null;
    }

    const scene = this.ensureScene(numericSystemID);
    this.wakeSceneForImmediateUse(scene, {
      reason: "attach-session-existing-entity",
      relevantEntities: [entity].filter(Boolean),
    });
    const attached = scene.attachSessionToExistingEntity(session, shipItem, entity, {
      ...options,
      forceSimClockRebase: options.forceSimClockRebase === true,
      previousSimTimeMs,
    });
    autoMaterializeNearbyUniverseSiteForAttach(scene, attached || entity, {
      broadcast: true,
      excludedSession: session || null,
      session: session || null,
    });
    return attached;
  }

  detachSession(session, options = {}) {
    if (!session || !session._space) {
      return;
    }

    const scene = this.scenes.get(Number(session._space.systemID));
    if (scene) {
      scene.detachSession(session, options);
      if (scene.sessions instanceof Map && scene.sessions.size === 0) {
        dematerializeAmbientStartupControllersForScene(scene, {
          broadcast: false,
        });
        dematerializeDormantCombatControllersForScene(scene, {
          broadcast: false,
          nowMs: toFiniteNumber(
            scene.getCurrentSimTimeMs && scene.getCurrentSimTimeMs(),
            Date.now(),
          ),
        });
      }
    } else {
      session._space = null;
    }
  }

  disembarkSession(session, options = {}) {
    if (!session || !session._space) {
      return null;
    }

    const scene = this.scenes.get(Number(session._space.systemID));
    if (!scene) {
      session._space = null;
      return null;
    }

    const entity = scene.disembarkSession(session, options);
    if (scene.sessions instanceof Map && scene.sessions.size === 0) {
      dematerializeAmbientStartupControllersForScene(scene, {
        broadcast: false,
      });
      dematerializeDormantCombatControllersForScene(scene, {
        broadcast: false,
        nowMs: toFiniteNumber(
          scene.getCurrentSimTimeMs && scene.getCurrentSimTimeMs(),
          Date.now(),
        ),
      });
    }
    return entity;
  }

  markBeyonceBound(session) {
    const scene = this.getSceneForSession(session);
    if (scene) {
      scene.markBeyonceBound(session);
    }
  }

  bootstrapDockedStructureView(session, options = {}) {
    if (!session || session._space) {
      return false;
    }

    const structureID = toInt(
      session && (session.structureID || session.structureid),
      0,
    );
    const systemID = toInt(
      session && (session.solarsystemid || session.solarsystemid2),
      0,
    );
    if (structureID <= 0 || systemID <= 0) {
      return false;
    }

    const scene = this.ensureScene(systemID);
    if (!scene) {
      return false;
    }

    scene.syncStructureEntitiesFromState({
      broadcast: false,
    });
    const structureEntity = scene.getEntityByID(structureID);
    if (!structureEntity || structureEntity.kind !== "structure") {
      return false;
    }

    const previousSpaceState = session._space || null;
    const previousObserverState =
      options.reset === true ||
      !session._structureViewSpace ||
      session._structureViewSpace.pendingBallparkBind === true
        ? null
        : session._structureViewSpace;
    session._structureViewSpace = buildStructureObserverSpaceState(
      scene,
      structureID,
      previousObserverState,
    );
    session._structureViewSpace.pendingBallparkBind = false;
    session._space = session._structureViewSpace;
    try {
      const bootstrapResult = scene.ensureInitialBallpark(session, {
        ...options,
        force: options.force === true,
      });
      session._structureViewSpace = session._space;
      return bootstrapResult;
    } finally {
      session._space = previousSpaceState;
    }
  }

  prepareDockedStructureView(session) {
    if (!session || session._space) {
      return false;
    }

    const structureID = toInt(
      session && (session.structureID || session.structureid),
      0,
    );
    const systemID = toInt(
      session && (session.solarsystemid || session.solarsystemid2),
      0,
    );
    if (structureID <= 0 || systemID <= 0) {
      return false;
    }

    const scene = this.ensureScene(systemID);
    if (!scene) {
      return false;
    }

    scene.syncStructureEntitiesFromState({
      broadcast: false,
    });
    const structureEntity = scene.getEntityByID(structureID);
    if (!structureEntity || structureEntity.kind !== "structure") {
      return false;
    }

    session._structureViewSpace = buildStructureObserverSpaceState(
      scene,
      structureID,
      null,
    );
    session._structureViewSpace.pendingBallparkBind = true;
    return true;
  }

  clearDockedStructureView(session) {
    if (session) {
      session._structureViewSpace = null;
    }
  }

  ensureInitialBallpark(session, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.ensureInitialBallpark(session, options) : false;
  }

  gotoDirection(session, direction, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.gotoDirection(session, direction, options) : false;
  }

  gotoPoint(session, point, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.gotoPoint(session, point, options) : false;
  }

  alignTo(session, targetEntityID) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.alignTo(session, targetEntityID) : false;
  }

  followBall(session, targetEntityID, range, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.followBall(session, targetEntityID, range, options) : false;
  }

  followDynamicEntity(systemID, entityOrID, targetEntityID, range, options = {}) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.followShipEntity(entityOrID, targetEntityID, range, options) : false;
  }

  orbit(session, targetEntityID, distanceValue, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.orbit(session, targetEntityID, distanceValue, options) : false;
  }

  orbitDynamicEntity(systemID, entityOrID, targetEntityID, distanceValue, options = {}) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.orbitShipEntity(entityOrID, targetEntityID, distanceValue, options) : false;
  }

  warpToEntity(session, targetEntityID, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.warpToEntity(session, targetEntityID, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  warpToPoint(session, point, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.warpToPoint(session, point, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  warpDynamicEntityToPoint(systemID, entityOrID, point, options = {}) {
    const scene = this.ensureScene(systemID);
    return scene
      ? scene.warpDynamicEntityToPoint(entityOrID, point, options)
      : { success: false, errorMsg: "SCENE_NOT_FOUND" };
  }

  startSessionlessWarpIngress(systemID, entityOrID, point, options = {}) {
    const scene = this.ensureScene(systemID);
    return scene
      ? scene.startSessionlessWarpIngress(entityOrID, point, options)
      : { success: false, errorMsg: "SCENE_NOT_FOUND" };
  }

  teleportSessionShipToPoint(session, point, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.teleportDynamicEntityToPoint(
        session && session._space ? session._space.shipID : null,
        point,
        {
          ...options,
          refreshOwnerSession: options.refreshOwnerSession !== false,
        },
      )
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  teleportDynamicEntityToPoint(systemID, entityOrID, point, options = {}) {
    const scene = this.ensureScene(systemID);
    return scene
      ? scene.teleportDynamicEntityToPoint(entityOrID, point, options)
      : { success: false, errorMsg: "SCENE_NOT_FOUND" };
  }

  setSpeedFraction(session, fraction) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.setSpeedFraction(session, fraction) : false;
  }

  stop(session) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.stop(session) : false;
  }

  stopDynamicEntity(systemID, entityOrID, options = {}) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.stopShipEntity(entityOrID, options) : false;
  }

  refreshShipDerivedState(session, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.refreshSessionShipDerivedState(session, options)
      : {
          success: false,
          errorMsg: "SCENE_NOT_FOUND",
        };
  }

  getShipCapacitorState(session) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getShipCapacitorState(session) : null;
  }

  setShipCapacitorRatio(session, nextRatio) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.setShipCapacitorRatio(session, nextRatio)
      : {
          success: false,
          errorMsg: "SCENE_NOT_FOUND",
        };
  }

  getActiveModuleEffect(session, moduleID) {
    const scene = this.getSceneForSession(session);
    const shipEntity = scene ? scene.getShipEntityForSession(session) : null;
    if (!scene || !shipEntity) {
      return null;
    }

    return scene.getActiveModuleEffect(shipEntity.itemID, moduleID);
  }

  reconcileActiveTurretWeaponBankEffects(session, shipID, moduleIDs = []) {
    const scene = this.getSceneForSession(session);
    if (!scene) {
      return {
        changed: false,
        activeModuleIDs: [],
      };
    }
    return scene.reconcileActiveTurretWeaponBankEffects(shipID, moduleIDs);
  }

  getPropulsionModuleRuntimeAttributes(characterID, moduleItem) {
    return getPropulsionModuleRuntimeAttributes(characterID, moduleItem);
  }

  getActiveModuleContextsForEntity(entity, options = {}) {
    return getEntityRuntimeActiveModuleContexts(entity, options);
  }

  getActiveModuleContextsForSession(session, options = {}) {
    const scene =
      runtimeExports &&
      typeof runtimeExports.getSceneForSession === "function"
        ? runtimeExports.getSceneForSession(session)
        : null;
    const entity =
      scene && typeof scene.getShipEntityForSession === "function"
        ? scene.getShipEntityForSession(session)
        : null;
    return getEntityRuntimeActiveModuleContexts(entity, options);
  }

  getGenericModuleRuntimeAttributes(
    characterID,
    shipItem,
    moduleItem,
    chargeItem = null,
    weaponSnapshot = null,
    options = {},
  ) {
    return getGenericModuleRuntimeAttributes(
      characterID,
      shipItem,
      moduleItem,
      chargeItem,
      weaponSnapshot,
      options,
    );
  }

  getShipAttributeSnapshot(session) {
    const scene = this.getSceneForSession(session);
    const entity = scene ? scene.getShipEntityForSession(session) : null;
    if (!entity) {
      return null;
    }

    return {
      itemID: toInt(entity.itemID, 0),
      mass: roundNumber(toFiniteNumber(entity.mass, 0), 6),
      maxVelocity: roundNumber(toFiniteNumber(entity.maxVelocity, 0), 6),
      maxLockedTargets: roundNumber(toFiniteNumber(entity.maxLockedTargets, 0), 6),
      maxTargetRange: roundNumber(toFiniteNumber(entity.maxTargetRange, 0), 6),
      cloakingTargetingDelay: roundNumber(
        toFiniteNumber(entity.cloakingTargetingDelay, 0),
        6,
      ),
      scanResolution: roundNumber(toFiniteNumber(entity.scanResolution, 0), 6),
      signatureRadius: roundNumber(
        toFiniteNumber(entity.signatureRadius, 0),
        6,
      ),
      alignTime: roundNumber(toFiniteNumber(entity.alignTime, 0), 6),
      attributes: Object.fromEntries(
        Object.entries(
          (entity.passiveDerivedState &&
            entity.passiveDerivedState.attributes &&
            typeof entity.passiveDerivedState.attributes === "object")
            ? entity.passiveDerivedState.attributes
            : {},
        )
          .map(([attributeID, value]) => [Number(attributeID), Number(value)])
          .filter(
            ([attributeID, value]) =>
              Number.isInteger(attributeID) && Number.isFinite(value),
          ),
      ),
    };
  }

  addTarget(session, targetEntityID) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.addTarget(session, targetEntityID)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  cancelAddTarget(session, targetEntityID, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.cancelAddTarget(session, targetEntityID, options)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  removeTarget(session, targetEntityID, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.removeTarget(session, targetEntityID, options)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  removeTargets(session, targetEntityIDs = [], options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.removeTargets(session, targetEntityIDs, options)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  clearTargets(session, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.clearTargets(session, options)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  getTargets(session) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getTargets(session) : [];
  }

  getTargeters(session) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getTargeters(session) : [];
  }

  activatePropulsionModule(session, moduleItem, effectName, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.activatePropulsionModule(session, moduleItem, effectName, options)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  deactivatePropulsionModule(session, moduleID, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.deactivatePropulsionModule(session, moduleID, options)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  activateGenericModule(session, moduleItem, effectName, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.activateGenericModule(session, moduleItem, effectName, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  deactivateGenericModule(session, moduleID, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.deactivateGenericModule(session, moduleID, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  deactivateAllActiveModules(session, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.deactivateAllActiveModules(session, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  playSpecialFx(session, guid, options = {}) {
    if (!session || !session._space) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    if (!isReadyForDestiny(session)) {
      return {
        success: false,
        errorMsg: "DESTINY_NOT_READY",
      };
    }

    const scene = this.getSceneForSession(session);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const {
      shipID: requestedShipID = null,
      debugAutoTarget = null,
      debugAutoTargetRangeMeters = DEBUG_TEST_AUTO_TARGET_DEFAULT_RANGE_METERS,
      debugOnly = false,
      ...fxOptions
    } = options || {};
    const shipID = Number(requestedShipID || session._space.shipID || 0) || 0;
    if (!shipID) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const entity = scene.getEntityByID(shipID);
    if (!entity) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const resolvedFxOptions = { ...fxOptions };
    let debugAutoTargetResult = null;
    const hasExplicitTargetID = Number(resolvedFxOptions.targetID || 0) > 0;
    if (!hasExplicitTargetID && debugAutoTarget === "nearest_station") {
      debugAutoTargetResult = resolveDebugTestNearestStationTarget(
        scene,
        entity,
        debugAutoTargetRangeMeters,
      );
      if (debugAutoTargetResult.success) {
        resolvedFxOptions.targetID = debugAutoTargetResult.data.target.itemID;
      } else {
        const stopLikeRequest =
          resolvedFxOptions.start === false || resolvedFxOptions.active === false;
        if (!stopLikeRequest) {
          return {
            success: false,
            errorMsg: debugAutoTargetResult.errorMsg,
            data: {
              ...(debugAutoTargetResult.data || {}),
              debugAutoTarget,
              debugOnly,
            },
          };
        }
      }
    }

    const stamp = scene.getNextDestinyStamp();
    scene.sendDestinyUpdates(session, [
      {
        stamp,
        payload: destiny.buildOnSpecialFXPayload(shipID, guid, resolvedFxOptions),
      },
    ], false, {
      destinyAuthorityContract: DESTINY_CONTRACTS.COMBAT_NONCRITICAL,
    });
    return {
      success: true,
      data: {
        autoTarget:
          debugAutoTargetResult && debugAutoTargetResult.success
            ? {
                mode: debugAutoTarget,
                maxRangeMeters: debugAutoTargetResult.data.maxRangeMeters,
                distanceMeters: debugAutoTargetResult.data.nearestDistanceMeters,
                targetID: debugAutoTargetResult.data.target.itemID,
                targetName:
                  debugAutoTargetResult.data.target.itemName ||
                  `station ${debugAutoTargetResult.data.target.itemID}`,
              }
            : null,
        debugOnly,
        guid: String(guid || ""),
        shipID,
        stamp,
      },
    };
  }

  startStargateJump(session, sourceGateID, options = {}) {
    if (!session || !session._space) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    const scene = this.getSceneForSession(session);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const shipEntity = scene.getShipEntityForSession(session);
    if (!shipEntity) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }
    if (isSuperweaponMovementLocked(shipEntity, scene.getCurrentSimTimeMs())) {
      return {
        success: false,
        errorMsg: "SHIP_IMMOBILE",
      };
    }
    if (isSuperweaponJumpOrCloakLocked(shipEntity, scene.getCurrentSimTimeMs())) {
      return {
        success: false,
        errorMsg: "JUMP_COOLDOWN_ACTIVE",
      };
    }

    const sourceGateEntity = scene.getEntityByID(sourceGateID);
    if (!sourceGateEntity || sourceGateEntity.kind !== "stargate") {
      return {
        success: false,
        errorMsg: "STARGATE_NOT_FOUND",
      };
    }

    const currentActivationState = coerceActivationState(
      sourceGateEntity.activationState,
      this.resolveStargateActivationState(sourceGateEntity),
    );
    if (currentActivationState !== STARGATE_ACTIVATION_STATE.OPEN) {
      return {
        success: false,
        errorMsg: "STARGATE_NOT_ACTIVE",
      };
    }

    if (
      options.freezeMotion !== false &&
      (
        shipEntity.mode !== "STOP" ||
        shipEntity.speedFraction > 0 ||
        magnitude(shipEntity.velocity) > 0.5
      )
    ) {
      resetEntityMotion(shipEntity);
      persistShipEntity(shipEntity);
    }

    const fxOptions = {
      ...(options.fxOptions || {}),
    };
    if (
      !Object.prototype.hasOwnProperty.call(fxOptions, "graphicInfo") &&
      Number(sourceGateEntity.destinationSolarSystemID || 0) > 0
    ) {
      fxOptions.graphicInfo = [
        Number(sourceGateEntity.destinationSolarSystemID),
      ];
    }

    const { stamp, deliveredCount } = scene.broadcastSpecialFx(
      shipEntity.itemID,
      "effects.JumpOut",
      {
        targetID: sourceGateEntity.itemID,
        start: true,
        active: false,
        // Use current stamp so Michelle dispatches the FX immediately. Under TiDi,
        // getNextDestinyStamp() puts the FX 1 tick ahead, but the dilated sim clock
        // won't reach that tick before completeStargateJump tears down the scene.
        useCurrentStamp: true,
        // For the jumping pilot, raw "current" can be one Michelle step ahead
        // of the live client history under TiDi, but clamping to the last sent
        // stamp can also backstep too far after the client has locally evolved.
        // Use the immediate visible window instead: max(last visible, current-1).
        useImmediateClientVisibleStamp: true,
        resultSession: session,
        ...fxOptions,
      },
      shipEntity,
    );

    const sourceObserverGateActivity = scene.broadcastSpecialFx(
      sourceGateEntity.itemID,
      "effects.GateActivity",
      buildObserverStargateGateActivityFxOptions({
        excludedSession: session,
      }),
      shipEntity,
    );
    recordSessionJumpTimingTrace(session, "stargate-jump-source-observer-fx", {
      sourceGateID: sourceGateEntity.itemID,
      shipID: shipEntity.itemID,
      jumpOutStamp: stamp,
      jumpOutDeliveredCount: deliveredCount,
      gateActivityStamp: sourceObserverGateActivity.stamp,
      gateActivityDeliveredCount: sourceObserverGateActivity.deliveredCount,
    });

    return {
      success: true,
      data: {
        shipID: shipEntity.itemID,
        sourceGateID: sourceGateEntity.itemID,
        stamp,
        deliveredCount,
        sourceObserverGateActivityStamp: sourceObserverGateActivity.stamp,
        sourceObserverGateActivityDeliveredCount:
          sourceObserverGateActivity.deliveredCount,
      },
    };
  }

  emitStargateArrivalObserverFx(session, destinationGateID, shipID, options = {}) {
    if (!session || !session._space) {
      return {
        success: false,
        errorMsg: "INVALID_SESSION",
      };
    }

    const scene = this.getSceneForSession(session);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const destinationGateEntity = scene.getEntityByID(destinationGateID);
    const shipEntity = scene.getEntityByID(shipID);
    if (!destinationGateEntity || destinationGateEntity.kind !== "stargate") {
      return {
        success: false,
        errorMsg: "STARGATE_NOT_FOUND",
      };
    }
    if (!shipEntity) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const gateActivity = scene.broadcastSpecialFx(
      destinationGateEntity.itemID,
      "effects.GateActivity",
      buildObserverStargateGateActivityFxOptions({
        excludedSession: session,
        ...options.gateActivityOptions,
      }),
      shipEntity,
    );
    const jumpIn = scene.broadcastSpecialFx(
      shipEntity.itemID,
      "effects.JumpIn",
      buildObserverStargateJumpFxOptions({
        excludedSession: session,
        duration: 5000,
        ...options.jumpInOptions,
      }),
      shipEntity,
    );

    recordSessionJumpTimingTrace(session, "stargate-jump-destination-observer-fx", {
      destinationGateID: destinationGateEntity.itemID,
      shipID: shipEntity.itemID,
      gateActivityStamp: gateActivity.stamp,
      gateActivityDeliveredCount: gateActivity.deliveredCount,
      jumpInStamp: jumpIn.stamp,
      jumpInDeliveredCount: jumpIn.deliveredCount,
    });

    return {
      success: true,
      data: {
        gateActivityStamp: gateActivity.stamp,
        gateActivityDeliveredCount: gateActivity.deliveredCount,
        jumpInStamp: jumpIn.stamp,
        jumpInDeliveredCount: jumpIn.deliveredCount,
      },
    };
  }

  getStationInteractionRadius(station) {
    return getStationInteractionRadius(station);
  }

  getStationUndockSpawnState(station, options = {}) {
    return getStationUndockSpawnState(station, options);
  }

  canDockAtStation(session, stationID, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
    const dockNow =
      session &&
      session._space &&
      Number.isFinite(Number(session._space.simTimeMs))
        ? Number(session._space.simTimeMs)
        : Date.now();
    try {
      const crimewatchState = require(path.join(__dirname, "../services/security/crimewatchState"));
      if (
        crimewatchState &&
        crimewatchState.isCriminallyFlagged(session && session.characterID, dockNow)
      ) {
        return false;
      }
    } catch (error) {
      log.warn(`[SpaceRuntime] Crimewatch dock check failed: ${error.message}`);
    }

    const entity = this.getEntity(session, session && session._space ? session._space.shipID : null);
    const structure = worldData.getStructureByID(stationID);
    const station =
      worldData.getStationByID(stationID) ||
      structure;
    if (!entity || !station) {
      return false;
    }
    if (structure) {
      try {
        const structureTetherRestrictionState = require(path.join(
          __dirname,
          "../services/structure/structureTetherRestrictionState",
        ));
        const restriction = structureTetherRestrictionState.getCharacterStructureDockingRestriction(
          session && session.characterID,
          dockNow,
          {
            session,
          },
        );
        if (restriction.restricted) {
          return false;
        }
      } catch (error) {
        log.warn(`[SpaceRuntime] Structure docking restriction check failed: ${error.message}`);
      }
    }

    return canShipDockAtStation(entity, station, maxDistance);
  }

  getDockingDebugState(session, stationID, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
    const entity = this.getEntity(
      session,
      session && session._space ? session._space.shipID : null,
    );
    const station =
      worldData.getStationByID(stationID) ||
      worldData.getStructureByID(stationID);
    return buildDockingDebugState(entity, station, maxDistance);
  }

  acceptDocking(session, stationID) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.acceptDocking(session, stationID)
      : {
          success: false,
          errorMsg: "SCENE_NOT_FOUND",
        };
  }

  tick() {
    const startedAtMonotonicMs = getMonotonicTimeMs();
    const previousTickStartedAtMonotonicMs = toFiniteNumber(
      this._lastTickStartedAtMonotonicMs,
      startedAtMonotonicMs - this._tickIntervalMs,
    );
    const actualIntervalMs = Math.max(
      this._tickIntervalMs,
      startedAtMonotonicMs - previousTickStartedAtMonotonicMs,
    );
    this._lastTickStartedAtMonotonicMs = startedAtMonotonicMs;

    const now = Date.now();
    structureState.tickStructures(now);
    let tickedSceneCount = 0;
    for (const scene of this.scenes.values()) {
      const sceneActivity = getSceneActivityState(scene, now);
      if (!sceneActivity.shouldTick) {
        continue;
      }
      scene.syncStructureEntitiesFromState();
      scene.destroyExpiredInventoryBackedEntities(sceneActivity.sceneNowMs);
      const sceneTickStartMs = getMonotonicTimeMs();
      scene.tick(now);
      const sceneTickWorkMs = Math.max(0, getMonotonicTimeMs() - sceneTickStartMs);
      scene._lastTickWorkMs = sceneTickWorkMs;
      scene._lastTickAtWallclockMs = now;
      if (!Array.isArray(scene._recentTickWorkMs)) scene._recentTickWorkMs = [];
      scene._recentTickWorkMs.push(sceneTickWorkMs);
      if (scene._recentTickWorkMs.length > 120) scene._recentTickWorkMs.shift();
      if (!Array.isArray(scene._recentFactors)) scene._recentFactors = [];
      const factorSample = typeof scene.getTimeDilation === "function"
        ? scene.getTimeDilation()
        : Number(scene.timeDilation) || 1.0;
      scene._recentFactors.push(factorSample);
      if (scene._recentFactors.length > 120) scene._recentFactors.shift();
      if (scene.sessions instanceof Map && scene.sessions.size === 0) {
        dematerializeDormantCombatControllersForScene(scene, {
          broadcast: false,
          nowMs: toFiniteNumber(
            scene.getCurrentSimTimeMs && scene.getCurrentSimTimeMs(),
            sceneActivity.sceneNowMs,
          ),
        });
      }
      tickedSceneCount += 1;
    }

    const finishedAtMonotonicMs = getMonotonicTimeMs();
    const tickSummary = {
      startedAtMonotonicMs,
      actualIntervalMs,
      targetTickIntervalMs: this._tickIntervalMs,
      tickDurationMs: Math.max(0, finishedAtMonotonicMs - startedAtMonotonicMs),
      latenessMs: Math.max(0, actualIntervalMs - this._tickIntervalMs),
      sceneCount: this.scenes.size,
      tickedSceneCount,
    };
    this._lastTickSummary = tickSummary;
    if (!Array.isArray(this._recentTickSummaries)) this._recentTickSummaries = [];
    this._recentTickSummaries.push(tickSummary);
    if (this._recentTickSummaries.length > 120) this._recentTickSummaries.shift();
    try {
      const tidiAutoscaler = require(path.join(__dirname, "../utils/tidiAutoscaler"));
      if (
        tidiAutoscaler &&
        typeof tidiAutoscaler.observeRuntimeTickSample === "function"
      ) {
        tidiAutoscaler.observeRuntimeTickSample(tickSummary);
      }
    } catch (error) {
      log.warn(`[SpaceRuntime] TiDi autoscaler sample failed: ${error.message}`);
    }

    return tickSummary;
  }
}

// Preserve the original CommonJS exports object so modules that observed it
// during a circular load still see the fully initialized runtime singleton.
const runtimeSingleton = new SpaceRuntime();
const runtimeExports = module.exports;
Object.setPrototypeOf(runtimeExports, Object.getPrototypeOf(runtimeSingleton));
Object.assign(runtimeExports, runtimeSingleton);
runtimeExports.beginSessionJumpTimingTrace = beginSessionJumpTimingTrace;
runtimeExports.recordSessionJumpTimingTrace = recordSessionJumpTimingTrace;
runtimeExports.resolveCompressionFacilityRangeMeters = resolveCompressionFacilityRangeMeters;
runtimeExports.resolveCompressionFacilityTypelistsForEntity =
  resolveCompressionFacilityTypelistsForEntity;
runtimeExports.applyJammerCyclePresentation = applyJammerCyclePresentation;
runtimeExports.removeJammerCyclePresentation = removeJammerCyclePresentation;
runtimeExports.droneInterop = {
  resolveTurretShot,
  getCombatMessageHitQuality,
  getAppliedDamageAmount,
  notifyWeaponDamageMessages,
  applyWeaponDamageToTarget,
  noteKillmailDamage,
  recordKillmailFromDestruction,
};

if (typeof structureState.registerStructureChangeListener === "function") {
  structureState.registerStructureChangeListener((changePayload) => {
    try {
      runtimeExports.handleStructureStateChange(changePayload);
    } catch (error) {
      log.warn(
        `[SpaceRuntime] Structure state-change sync failed: ${error.message}`,
      );
    }
  });
}

runtimeExports._testing = {
  SolarSystemScene,
  BUBBLE_RADIUS_METERS,
  BUBBLE_HYSTERESIS_METERS,
  BUBBLE_CENTER_MIN_DISTANCE_METERS,
  PUBLIC_GRID_BOX_METERS,
  PUBLIC_GRID_HALF_BOX_METERS,
  STARGATE_ACTIVATION_STATE,
  STARGATE_ACTIVATION_TRANSITION_MS,
  RUNTIME_TICK_INTERVAL_MS,
  NEW_EDEN_SYSTEM_LOADING,
  STARTUP_PRELOADED_SYSTEM_IDS,
  getStartupSolarSystemPreloadPlanForTesting: resolveStartupSolarSystemPreloadPlan,
  getConfiguredStartupSystemLoadingModeForTesting: getConfiguredStartupSystemLoadingMode,
  resolveStartupPreloadedSystemIDsForTesting: resolveStartupPreloadedSystemIDs,
  resolveStartupSolarSystemPreloadPlanForTesting: resolveStartupSolarSystemPreloadPlan,
  ACTIVE_SUBWARP_WATCHER_CORRECTION_INTERVAL_MS,
  ACTIVE_SUBWARP_WATCHER_POSITION_CORRECTION_INTERVAL_MS,
  WATCHER_CORRECTION_INTERVAL_MS,
  WATCHER_POSITION_CORRECTION_INTERVAL_MS,
  ENABLE_PILOT_WARP_ACTIVE_CORRECTIONS,
  buildPositionVelocityCorrectionUpdates,
  buildPilotWarpCorrectionUpdates,
  getWatcherCorrectionIntervalMs,
  getWatcherPositionCorrectionIntervalMs,
  usesActiveSubwarpWatcherCorrections,
  usesLocalStopDecelContract,
  resolveWatcherCorrectionDispatchForTesting: (options = {}) => {
    const sessionOnlyUpdates = [];
    const watcherOnlyUpdates = [];
    const correctionDebug =
      movementWatcherCorrections.resolveWatcherCorrectionDispatch({
        ...options,
        sessionOnlyUpdates,
        watcherOnlyUpdates,
      });
    return {
      correctionDebug,
      sessionOnlyUpdates,
      watcherOnlyUpdates,
      entity: options.entity || null,
    };
  },
  getSceneActivityStateForTesting(systemID, wallclockNow = Date.now()) {
    return runtimeExports.getSceneActivityState(systemID, wallclockNow);
  },
  wakeSceneForImmediateUseForTesting(systemID, options = {}) {
    return runtimeExports.wakeSceneForImmediateUse(systemID, options);
  },
  getLastRuntimeTickSummary() {
    return runtimeExports._lastTickSummary
      ? {
          ...runtimeExports._lastTickSummary,
        }
      : null;
  },
  buildShipEntityForTesting: buildShipEntity,
  buildRuntimeShipEntityForTesting: buildRuntimeShipEntity,
  buildRuntimeSpaceEntityFromItemForTesting: buildRuntimeSpaceEntityFromItem,
  refreshShipPresentationFieldsForTesting: refreshShipPresentationFields,
  buildPublicGridKeyForTesting: buildPublicGridKey,
  applyDesiredVelocityForTesting: applyDesiredVelocity,
  deriveAgilitySecondsForTesting: deriveAgilitySeconds,
  getWarpStopDistanceForTargetForTesting: getWarpStopDistanceForTarget,
  resolveStargateWarpTargetForTesting: resolveStargateWarpTarget,
  getClientParityWarpInPointForTesting: getClientParityWarpInPoint,
  evaluatePendingWarpForTesting: evaluatePendingWarp,
  buildWarpPrepareDispatchForTesting: buildWarpPrepareDispatch,
  buildPilotWarpActivationStateRefreshUpdatesForTesting:
    buildPilotWarpActivationStateRefreshUpdates,
  buildPilotWarpActivationUpdatesForTesting: buildPilotWarpActivationUpdates,
  buildWarpStartEffectUpdateForTesting: buildWarpStartEffectUpdate,
  buildDirectedMovementUpdatesForTesting: buildDirectedMovementUpdates,
  buildAttributeChangeForTesting: buildAttributeChange,
  computeTargetLockDurationMsForTesting: computeTargetLockDurationMs,
  notifyCapacitorChangeToSessionForTesting: notifyCapacitorChangeToSession,
  notifyShipHealthAttributesToSessionForTesting: notifyShipHealthAttributesToSession,
  notifyModuleEffectStateForTesting: notifyModuleEffectState,
  notifyGenericModuleEffectStateForTesting: notifyGenericModuleEffectState,
  notifyRuntimeChargeTransitionToSessionForTesting: notifyRuntimeChargeTransitionToSession,
  broadcastDamageStateChangeForTesting: broadcastDamageStateChange,
  buildLaserDamageMessagePayloadForTesting: buildLaserDamageMessagePayload,
  resolveSpecialFxOptionsForEntityForTesting: resolveSpecialFxOptionsForEntity,
  resolveSpecialFxRepeatCountForTesting: resolveSpecialFxRepeatCount,
  hasActiveIndustrialCoreEffectForTesting: hasActiveIndustrialCoreEffect,
  resolveCompressionFacilityRangeMetersForTesting: resolveCompressionFacilityRangeMeters,
  resolveCompressionFacilityTypelistsForTesting:
    resolveCompressionFacilityTypelistsForEntity,
  buildStaticStargateEntityForTesting: buildStaticStargateEntity,
  buildChangedStructureRowsForTesting: buildChangedStructureRows,
  syncRuntimeStructureStateChangesForTesting:
    syncRuntimeStructureStateChanges,
  notifyDockedStructureHangarViewSessionsForTesting:
    notifyDockedStructureHangarViewSessions,
  buildRuntimeInventoryEntityForTesting: buildRuntimeInventoryEntity,
  buildStaticStructureEntityForTesting: buildStaticStructureEntity,
  buildNpcOffensiveSpecialFxOptionsForTesting: buildNpcOffensiveSpecialFxOptions,
  buildMissileDeploymentSpecialFxOptionsForTesting:
    buildMissileDeploymentSpecialFxOptions,
  buildOwnerMissileFreshAcquireSendOptionsForTesting:
    buildOwnerMissileFreshAcquireSendOptions,
  buildObserverCombatPresentedSendOptionsForTesting:
    buildObserverCombatPresentedSendOptions,
  buildOwnerDamageStateSendOptionsForTesting:
    buildOwnerDamageStateSendOptions,
  buildObserverDamageStateSendOptionsForTesting:
    buildObserverDamageStateSendOptions,
  resolveExplodingNonMissileDestructionSessionStampForTesting:
    resolveExplodingNonMissileDestructionSessionStamp,
  queueAutomaticNpcTurretReloadForTesting: queueAutomaticNpcTurretReload,
  cloneDynamicEntityForDestinyPresentationForTesting:
    cloneDynamicEntityForDestinyPresentation,
  shouldBypassTickPresentationBatchForDeferredOwnerMissileAcquireForTesting:
    shouldBypassTickPresentationBatchForDeferredOwnerMissileAcquire,
  buildDeferredOwnerMissileAcquireOptionsForTesting:
    buildDeferredOwnerMissileAcquireOptions,
  getStationWarpTargetPositionForTesting: getStationWarpTargetPosition,
  getStationUndockSpawnStateForTesting: getStationUndockSpawnState,
  isPlayerOwnedActiveSpaceShipRecordForTesting: isPlayerOwnedActiveSpaceShipRecord,
  getSharedWorldPosition,
  getStargateDerivedDunRotation,
  resetStargateActivationOverrides() {
    runtimeExports.solarSystemGateActivationOverrides.clear();
    runtimeExports.stargateActivationOverrides.clear();
  },
  isPassiveShieldRechargeEnabledForTesting() {
    return passiveShieldRechargeEnabled === true;
  },
  setPassiveShieldRechargeEnabledForTesting(enabled) {
    passiveShieldRechargeEnabled = enabled === true;
    return passiveShieldRechargeEnabled;
  },
  clearScenes() {
    runtimeExports.scenes.clear();
    nextRuntimeEntityID = 900_000_000_000;
    nextFallbackStamp = 0;
    passiveShieldRechargeEnabled = DEFAULT_PASSIVE_SHIELD_RECHARGE_ENABLED;
  },
  getSecurityStatusIconKey,
  resolveShipSkinMaterialSetID,
  allocateRuntimeEntityIDForTesting: allocateRuntimeEntityID,
};
