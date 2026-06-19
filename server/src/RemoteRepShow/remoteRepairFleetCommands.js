const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../space/runtime"));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../services/skills/skillState"));
const {
  getTypeAttributeValue,
  getModuleChargeCapacity,
} = require(path.join(__dirname, "../services/fitting/liveFittingState"));
const {
  resolveItemByName,
} = require(path.join(__dirname, "../services/inventory/itemTypeRegistry"));
const nativeNpcStore = require(path.join(__dirname, "../space/npc/nativeNpcStore"));
const {
  FIGHTER_TUBE_FLAGS,
  grantItemToCharacterLocation,
  removeInventoryItem,
  updateInventoryItem,
} = require(path.join(__dirname, "../services/inventory/itemStore"));
const {
  clearRemoteRepairShowController,
  clearRemoteRepairShowFighters,
  registerRemoteRepairShowController,
  tickScene: tickRemoteRepairShowScene,
} = require(path.join(__dirname, "./remoteRepairShowRuntime"));

const DEFAULT_REMOTE_REPAIR_FLEET_COUNT = 10;
const MIN_REMOTE_REPAIR_FLEET_COUNT = 1;
const MAX_REMOTE_REPAIR_FLEET_COUNT = 100;
const REMOTE_REPAIR_ENTITY_ID_START = 3960000000000000;
const REMOTE_REPAIR_RUNTIME_ITEM_ID_START = 3970000000000000;
const BASE_WING_OFFSET_METERS = 14_000;
const WING_SEPARATION_MARGIN_METERS = 12_000;
const SUPERCAP_FORWARD_OFFSET_METERS = 4_000;
const SUPERCAP_UP_OFFSET_METERS = 1_500;
const CAPITAL_RING_BASE_RADIUS_METERS = 10_500;
const CAPITAL_RING_SPACING_METERS = 4_500;
const CAPITAL_RING_CAPACITY = 4;
const LOGI_RING_BASE_RADIUS_METERS = 6_500;
const LOGI_RING_SPACING_METERS = 3_000;
const LOGI_RING_CAPACITY = 8;
const LOGI_CHAIN_ORBIT_DISTANCE_METERS = 3_500;
const SUPERCAP_ORBIT_DISTANCE_METERS = 8_500;
const COMMAND_SHIP_ORBIT_DISTANCE_METERS = 11_500;
const COMMAND_SHIP_CENTER_ORBIT_DISTANCE_METERS = 9_000;
const COMMAND_SHIP_FORWARD_OFFSET_METERS = 2_500;
const COMMAND_SHIP_UP_OFFSET_METERS = 2_250;
const COMMAND_BURST_RESERVE_QUANTITY = 100;
const REMOTE_REPAIR_BURST_AFFINITY_ID_START = 3980000000000000;
const REMOTE_REPAIR_BURST_STAGGER_STEP_MS = 1_100;
const REMOTE_REPAIR_BURST_MODULE_STAGGER_STEP_MS = 350;
const REMOTE_REPAIR_MOVEMENT_PHASE_STEP_MS = 1_400;
const REMOTE_REPAIR_PRIMARY_ANCHOR_DRIFT_PERIOD_MS = 20_000;
const REMOTE_REPAIR_PRIMARY_ANCHOR_DRIFT_FORWARD_METERS = 3_500;
const REMOTE_REPAIR_PRIMARY_ANCHOR_DRIFT_VERTICAL_METERS = 1_250;
const REMOTE_REPAIR_ORBIT_PULSE_PERIOD_MS = 18_000;
const REMOTE_REPAIR_COMMAND_ORBIT_PULSE_PERIOD_MS = 14_000;
const REMOTE_REPAIR_COVER_DRIFT_PERIOD_MS = 22_000;
const REMOTE_REPAIR_COVER_REFRESH_INTERVAL_MS = 1_900;
const REMOTE_REPAIR_FIGHTER_SQUADRON_SIZE = 6;
const REMOTE_REPAIR_FIGHTER_LIGHT_ORBIT_DISTANCE_METERS = 2_600;
const REMOTE_REPAIR_FIGHTER_HEAVY_ORBIT_DISTANCE_METERS = 4_100;
const REMOTE_REPAIR_FIGHTER_SUPPORT_ORBIT_DISTANCE_METERS = 3_200;
const REMOTE_REPAIR_FIGHTER_COVER_LIGHT_ORBIT_DISTANCE_METERS = 5_000;
const REMOTE_REPAIR_FIGHTER_COVER_HEAVY_ORBIT_DISTANCE_METERS = 6_800;
const REMOTE_REPAIR_FIGHTER_COVER_SUPPORT_ORBIT_DISTANCE_METERS = 5_600;
const REMOTE_REPAIR_FIGHTER_PHASE_STEP_MS = 650;
const REMOTE_REPAIR_FIGHTER_LAUNCH_OFFSET_METERS = 220;

let nextRemoteRepairEntityID = REMOTE_REPAIR_ENTITY_ID_START;
let nextRemoteRepairRuntimeItemID = REMOTE_REPAIR_RUNTIME_ITEM_ID_START;
let nextRemoteRepairBurstAffinityID = REMOTE_REPAIR_BURST_AFFINITY_ID_START;

const ARMOR_LOGI_MODULES = Object.freeze([
  Object.freeze({ name: "Large Remote Armor Repairer II", family: "remoteArmor" }),
  Object.freeze({ name: "Large Remote Armor Repairer II", family: "remoteArmor" }),
  Object.freeze({ name: "Large Remote Armor Repairer II", family: "remoteArmor" }),
  Object.freeze({ name: "Large Remote Capacitor Transmitter II", family: "remoteCapacitor" }),
  Object.freeze({ name: "Large Remote Capacitor Transmitter II", family: "remoteCapacitor" }),
]);
const SHIELD_LOGI_MODULES = Object.freeze([
  Object.freeze({ name: "Large Remote Shield Booster II", family: "remoteShield" }),
  Object.freeze({ name: "Large Remote Shield Booster II", family: "remoteShield" }),
  Object.freeze({ name: "Large Remote Shield Booster II", family: "remoteShield" }),
  Object.freeze({ name: "Large Remote Capacitor Transmitter II", family: "remoteCapacitor" }),
  Object.freeze({ name: "Large Remote Capacitor Transmitter II", family: "remoteCapacitor" }),
]);
const ARMOR_CAPITAL_MODULES = Object.freeze([
  Object.freeze({ name: "Capital Remote Armor Repairer II", family: "remoteArmor" }),
  Object.freeze({ name: "Capital Remote Armor Repairer II", family: "remoteArmor" }),
  Object.freeze({ name: "Capital Remote Hull Repairer II", family: "remoteHull" }),
  Object.freeze({ name: "Capital Remote Capacitor Transmitter II", family: "remoteCapacitor" }),
  Object.freeze({ name: "Capital Remote Capacitor Transmitter II", family: "remoteCapacitor" }),
]);
const SHIELD_CAPITAL_MODULES = Object.freeze([
  Object.freeze({ name: "Capital Remote Shield Booster II", family: "remoteShield" }),
  Object.freeze({ name: "Capital Remote Shield Booster II", family: "remoteShield" }),
  Object.freeze({ name: "Capital Remote Hull Repairer II", family: "remoteHull" }),
  Object.freeze({ name: "Capital Remote Capacitor Transmitter II", family: "remoteCapacitor" }),
  Object.freeze({ name: "Capital Remote Capacitor Transmitter II", family: "remoteCapacitor" }),
]);
const REMOTE_REPAIR_WING_TEMPLATES = Object.freeze({
  left: Object.freeze({
    anchorHullName: "Archon",
    superHullName: "Aeon",
    logiHullName: "Guardian",
    repairFamily: "remoteArmor",
    anchorModules: ARMOR_CAPITAL_MODULES,
    superModules: ARMOR_CAPITAL_MODULES,
    logiModules: ARMOR_LOGI_MODULES,
  }),
  right: Object.freeze({
    anchorHullName: "Chimera",
    superHullName: "Wyvern",
    logiHullName: "Basilisk",
    repairFamily: "remoteShield",
    anchorModules: SHIELD_CAPITAL_MODULES,
    superModules: SHIELD_CAPITAL_MODULES,
    logiModules: SHIELD_LOGI_MODULES,
  }),
});
const COMMAND_SHIP_TEMPLATES = Object.freeze([
  Object.freeze({
    key: "leftCommand",
    wing: "left",
    role: "command",
    hullName: "Damnation",
    orbitStrategy: "wingAnchor",
    orbitDistance: COMMAND_SHIP_ORBIT_DISTANCE_METERS,
    formationRadius: COMMAND_SHIP_ORBIT_DISTANCE_METERS,
    modules: Object.freeze([
      Object.freeze({ name: "Armor Command Burst II", family: "commandBurst" }),
      Object.freeze({ name: "Information Command Burst II", family: "commandBurst" }),
    ]),
    cargo: Object.freeze([
      Object.freeze({ name: "Rapid Repair Charge", quantity: COMMAND_BURST_RESERVE_QUANTITY }),
      Object.freeze({ name: "Sensor Optimization Charge", quantity: COMMAND_BURST_RESERVE_QUANTITY }),
    ]),
    preloadCharges: Object.freeze([
      Object.freeze({ moduleName: "Armor Command Burst II", chargeName: "Rapid Repair Charge", fullClip: true }),
      Object.freeze({ moduleName: "Information Command Burst II", chargeName: "Sensor Optimization Charge", fullClip: true }),
    ]),
  }),
  Object.freeze({
    key: "rightCommand",
    wing: "right",
    role: "command",
    hullName: "Claymore",
    orbitStrategy: "wingAnchor",
    orbitDistance: COMMAND_SHIP_ORBIT_DISTANCE_METERS,
    formationRadius: COMMAND_SHIP_ORBIT_DISTANCE_METERS,
    modules: Object.freeze([
      Object.freeze({ name: "Shield Command Burst II", family: "commandBurst" }),
      Object.freeze({ name: "Skirmish Command Burst II", family: "commandBurst" }),
    ]),
    cargo: Object.freeze([
      Object.freeze({ name: "Shield Extension Charge", quantity: COMMAND_BURST_RESERVE_QUANTITY }),
      Object.freeze({ name: "Rapid Deployment Charge", quantity: COMMAND_BURST_RESERVE_QUANTITY }),
    ]),
    preloadCharges: Object.freeze([
      Object.freeze({ moduleName: "Shield Command Burst II", chargeName: "Shield Extension Charge", fullClip: true }),
      Object.freeze({ moduleName: "Skirmish Command Burst II", chargeName: "Rapid Deployment Charge", fullClip: true }),
    ]),
  }),
  Object.freeze({
    key: "centerCommand",
    wing: "center",
    role: "command",
    hullName: "Vulture",
    orbitStrategy: "player",
    orbitDistance: COMMAND_SHIP_CENTER_ORBIT_DISTANCE_METERS,
    formationRadius: COMMAND_SHIP_CENTER_ORBIT_DISTANCE_METERS,
    modules: Object.freeze([
      Object.freeze({ name: "Information Command Burst II", family: "commandBurst" }),
      Object.freeze({ name: "Shield Command Burst II", family: "commandBurst" }),
    ]),
    cargo: Object.freeze([
      Object.freeze({ name: "Electronic Hardening Charge", quantity: COMMAND_BURST_RESERVE_QUANTITY }),
      Object.freeze({ name: "Active Shielding Charge", quantity: COMMAND_BURST_RESERVE_QUANTITY }),
    ]),
    preloadCharges: Object.freeze([
      Object.freeze({ moduleName: "Information Command Burst II", chargeName: "Electronic Hardening Charge", fullClip: true }),
      Object.freeze({ moduleName: "Shield Command Burst II", chargeName: "Active Shielding Charge", fullClip: true }),
    ]),
  }),
]);
const CAPITAL_SCALING_TIERS = Object.freeze([
  Object.freeze({ minSupportCount: 8, pairType: "super", pairIndex: 1 }),
  Object.freeze({ minSupportCount: 16, pairType: "anchor", pairIndex: 2 }),
  Object.freeze({ minSupportCount: 28, pairType: "super", pairIndex: 2 }),
  Object.freeze({ minSupportCount: 44, pairType: "anchor", pairIndex: 3 }),
  Object.freeze({ minSupportCount: 64, pairType: "super", pairIndex: 3 }),
]);
const REMOTE_REPAIR_FIGHTER_LOADOUTS = Object.freeze({
  Aeon: Object.freeze([
    "Templar II",
    "Templar II",
    "Templar II",
    "Malleus II",
    "Malleus II",
  ]),
  Wyvern: Object.freeze([
    "Dragonfly II",
    "Dragonfly II",
    "Dragonfly II",
    "Cyclops II",
    "Cyclops II",
  ]),
  Archon: Object.freeze([
    "Templar II",
    "Templar II",
    "Templar II",
    "Templar II",
  ]),
  Chimera: Object.freeze([
    "Dragonfly II",
    "Dragonfly II",
    "Dragonfly II",
    "Dragonfly II",
  ]),
});

const itemTypeCache = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = toInt(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, toFiniteNumber(value, min)));
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function addVectors(left, right) {
  const resolvedLeft = cloneVector(left);
  const resolvedRight = cloneVector(right);
  return {
    x: resolvedLeft.x + resolvedRight.x,
    y: resolvedLeft.y + resolvedRight.y,
    z: resolvedLeft.z + resolvedRight.z,
  };
}

function scaleVector(vector, scalar) {
  const resolved = cloneVector(vector);
  const resolvedScalar = toFiniteNumber(scalar, 0);
  return {
    x: resolved.x * resolvedScalar,
    y: resolved.y * resolvedScalar,
    z: resolved.z * resolvedScalar,
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function crossVectors(left, right) {
  return {
    x: (toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.z, 0)) -
      (toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.y, 0)),
    y: (toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.x, 0)) -
      (toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.z, 0)),
    z: (toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.y, 0)) -
      (toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.x, 0)),
  };
}

function magnitude(vector) {
  const resolved = cloneVector(vector);
  return Math.sqrt((resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2));
}

function distanceBetweenVectors(left, right) {
  return magnitude(subtractVectors(left, right));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = magnitude(resolved);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback, { x: 1, y: 0, z: 0 });
  }
  return {
    x: resolved.x / length,
    y: resolved.y / length,
    z: resolved.z / length,
  };
}

function buildFormationBasis(direction) {
  const forward = normalizeVector(direction, { x: 1, y: 0, z: 0 });
  const upReference = Math.abs(toFiniteNumber(forward.y, 0)) >= 0.95
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 1, z: 0 };
  const right = normalizeVector(
    crossVectors(forward, upReference),
    { x: 0, y: 0, z: 1 },
  );
  const up = normalizeVector(crossVectors(right, forward), upReference);
  return { forward, right, up };
}

function uniqueCandidates(values = []) {
  const seen = new Set();
  const resolved = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    resolved.push(normalized);
  }
  return resolved;
}

function resolveExactItem(name) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    return null;
  }
  if (itemTypeCache.has(normalizedName)) {
    return itemTypeCache.get(normalizedName);
  }

  const result = resolveItemByName(normalizedName);
  if (result && result.success === true && result.match) {
    itemTypeCache.set(normalizedName, result.match);
    return result.match;
  }
  return null;
}

function allocateRemoteRepairEntityID() {
  const allocated = nextRemoteRepairEntityID;
  nextRemoteRepairEntityID += 1;
  return allocated;
}

function allocateSyntheticRuntimeItemID() {
  const allocated = nextRemoteRepairRuntimeItemID;
  nextRemoteRepairRuntimeItemID += 1;
  return allocated;
}

function allocateRemoteRepairBurstAffinityID() {
  const allocated = nextRemoteRepairBurstAffinityID;
  nextRemoteRepairBurstAffinityID += 1;
  return allocated;
}

function isRemoteRepairShowEntity(entity) {
  if (!entity) {
    return false;
  }
  if (entity.remoteRepairShowTransient === true) {
    return true;
  }
  const entityID = toInt(entity.itemID, 0);
  return Boolean(
    entity.nativeNpc === true &&
    entity.transient === true &&
    entityID >= REMOTE_REPAIR_ENTITY_ID_START &&
    entityID < REMOTE_REPAIR_RUNTIME_ITEM_ID_START,
  );
}

function reconcileRemoteRepairEntityIDSeed(scene) {
  if (!scene || !scene.dynamicEntities) {
    return;
  }
  let maxEntityID = nextRemoteRepairEntityID - 1;
  for (const entity of scene.dynamicEntities.values()) {
    if (!isRemoteRepairShowEntity(entity)) {
      continue;
    }
    const entityID = toInt(entity.itemID, 0);
    if (entityID > maxEntityID) {
      maxEntityID = entityID;
    }
  }
  if (maxEntityID >= nextRemoteRepairEntityID) {
    nextRemoteRepairEntityID = maxEntityID + 1;
  }
}

function clearOrphanedRemoteRepairEntities(scene, nowMs) {
  if (!scene || !scene.dynamicEntities) {
    return { removedCount: 0 };
  }

  let removedCount = 0;
  for (const entity of scene.dynamicEntities.values()) {
    if (!isRemoteRepairShowEntity(entity)) {
      continue;
    }
    const entityID = toInt(entity.itemID, 0);
    const removeResult = scene.removeDynamicEntity(entityID, {
      nowMs,
    });
    if (removeResult && removeResult.success === true) {
      removedCount += 1;
    }
    nativeNpcStore.removeNativeEntityCascade(entityID);
  }
  return { removedCount };
}

function buildSyntheticOnlineModuleItem(entityID, moduleType, flagID, slotIndex, family) {
  return {
    itemID: allocateSyntheticRuntimeItemID(),
    locationID: entityID,
    ownerID: 0,
    typeID: Number(moduleType && moduleType.typeID) || 0,
    groupID: Number(moduleType && moduleType.groupID) || 0,
    categoryID: Number(moduleType && moduleType.categoryID) || 7,
    itemName: String(moduleType && moduleType.name || "Module"),
    flagID,
    singleton: 1,
    stacksize: 1,
    quantity: 1,
    rrFamily: String(family || ""),
    moduleState: {
      online: true,
      damage: 0,
      charge: 0,
      skillPoints: 0,
      armorDamage: 0,
      shieldCharge: 0,
      incapacitated: false,
    },
  };
}

function buildSyntheticCargoItem(entityID, itemType, quantity, moduleID = 0) {
  const resolvedQuantity = Math.max(1, toInt(quantity, 1));
  return {
    itemID: allocateSyntheticRuntimeItemID(),
    ownerID: 0,
    locationID: entityID,
    moduleID: toInt(moduleID, 0),
    typeID: Number(itemType && itemType.typeID) || 0,
    groupID: Number(itemType && itemType.groupID) || 0,
    categoryID: Number(itemType && itemType.categoryID) || 8,
    itemName: String(itemType && itemType.name || "Charge"),
    singleton: 0,
    quantity: resolvedQuantity,
    stacksize: resolvedQuantity,
    volume: Number(itemType && itemType.volume || 0),
  };
}

function buildSyntheticRepairShipSpec(ownerSession, blueprint, position, direction, entityID, skillMap) {
  const hullType = resolveExactItem(blueprint.hullName);
  if (!hullType) {
    return null;
  }

  const modules = [];
  const modulesByName = new Map();
  let slotIndex = 1;
  let flagID = 27;
  for (const moduleDef of Array.isArray(blueprint.modules) ? blueprint.modules : []) {
    const moduleType = resolveExactItem(moduleDef && moduleDef.name);
    if (!moduleType) {
      return null;
    }
    const moduleItem = buildSyntheticOnlineModuleItem(
      entityID,
      moduleType,
      flagID,
      slotIndex,
      moduleDef.family,
    );
    modules.push(moduleItem);
    modulesByName.set(String(moduleDef && moduleDef.name || ""), moduleItem);
    slotIndex += 1;
    flagID += 1;
  }

  const nativeCargoItems = [];
  for (const cargoDef of Array.isArray(blueprint.cargo) ? blueprint.cargo : []) {
    const cargoType = resolveExactItem(cargoDef && cargoDef.name);
    if (!cargoType) {
      return null;
    }
    nativeCargoItems.push(
      buildSyntheticCargoItem(
        entityID,
        cargoType,
        cargoDef && cargoDef.quantity,
        0,
      ),
    );
  }

  for (const preloadDef of Array.isArray(blueprint.preloadCharges) ? blueprint.preloadCharges : []) {
    const moduleItem = modulesByName.get(String(preloadDef && preloadDef.moduleName || ""));
    const chargeType = resolveExactItem(preloadDef && preloadDef.chargeName);
    if (!moduleItem || !chargeType) {
      return null;
    }
    const loadedQuantity = preloadDef && preloadDef.fullClip === true
      ? Math.max(1, getModuleChargeCapacity(moduleItem.typeID, chargeType.typeID))
      : Math.max(1, toInt(preloadDef && preloadDef.quantity, 1));
    nativeCargoItems.push(
      buildSyntheticCargoItem(
        entityID,
        chargeType,
        loadedQuantity,
        moduleItem.itemID,
      ),
    );
  }

  return {
    itemID: entityID,
    typeID: hullType.typeID,
    groupID: hullType.groupID,
    categoryID: hullType.categoryID || 6,
    itemName: String(hullType.name || blueprint.hullName),
    ownerID: Number(ownerSession && ownerSession.characterID || 0) || 0,
    pilotCharacterID: 0,
    characterID: 0,
    corporationID: Number(ownerSession && ownerSession.corporationID || 0) || 0,
    allianceID: Number(ownerSession && ownerSession.allianceID || 0) || 0,
    warFactionID: Number(ownerSession && ownerSession.warFactionID || 0) || 0,
    nativeNpc: true,
    transient: true,
    fittedItems: modules,
    nativeCargoItems,
    skillMap: skillMap instanceof Map ? new Map(skillMap) : new Map(),
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction,
    targetPoint: position,
    mode: "STOP",
    speedFraction: 0,
    conditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
      incapacitated: false,
    },
  };
}

function resolveRequestedFleetCount(argumentText) {
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      success: true,
      count: DEFAULT_REMOTE_REPAIR_FLEET_COUNT,
      requestedCount: DEFAULT_REMOTE_REPAIR_FLEET_COUNT,
    };
  }

  const parsed = normalizePositiveInteger(trimmed, null);
  if (!parsed) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  const count = clamp(
    parsed,
    MIN_REMOTE_REPAIR_FLEET_COUNT,
    MAX_REMOTE_REPAIR_FLEET_COUNT,
  );
  return {
    success: true,
    count,
    requestedCount: parsed,
  };
}

function resolveRequestedFleetCommand(argumentText) {
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      success: true,
      mode: "spawn",
      count: DEFAULT_REMOTE_REPAIR_FLEET_COUNT,
      requestedCount: DEFAULT_REMOTE_REPAIR_FLEET_COUNT,
    };
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === "cover") {
    return {
      success: true,
      mode: "cover",
    };
  }
  if (lowered === "fighter" || lowered === "fighters") {
    return {
      success: true,
      mode: "fighter",
    };
  }

  const countResult = resolveRequestedFleetCount(trimmed);
  if (!countResult.success) {
    return countResult;
  }
  return {
    ...countResult,
    mode: "spawn",
  };
}

function buildLogiRingRadius(logiIndex) {
  const normalizedIndex = Math.max(1, toInt(logiIndex, 1));
  const ringIndex = Math.floor((normalizedIndex - 1) / LOGI_RING_CAPACITY);
  return LOGI_RING_BASE_RADIUS_METERS + (ringIndex * LOGI_RING_SPACING_METERS);
}

function buildCapitalRingRadius(capitalSlotIndex) {
  const normalizedIndex = Math.max(1, toInt(capitalSlotIndex, 1));
  const ringIndex = Math.floor((normalizedIndex - 1) / CAPITAL_RING_CAPACITY);
  return CAPITAL_RING_BASE_RADIUS_METERS + (ringIndex * CAPITAL_RING_SPACING_METERS);
}

function buildAnchorBlueprint(wing, anchorIndex = 1) {
  const template = REMOTE_REPAIR_WING_TEMPLATES[String(wing || "")];
  const resolvedIndex = Math.max(1, toInt(anchorIndex, 1));
  const capitalSlotIndex = (resolvedIndex * 2) - 1;
  const isPrimaryAnchor = resolvedIndex === 1;
  if (!template) {
    return null;
  }
  return Object.freeze({
    key: resolvedIndex === 1 ? `${wing}Anchor` : `${wing}Anchor${resolvedIndex}`,
    wing,
    role: "anchor",
    capitalIndex: resolvedIndex,
    capitalSlotIndex,
    hullName: template.anchorHullName,
    orbitStrategy: isPrimaryAnchor ? "hold" : "wingAnchor",
    orbitDistance: isPrimaryAnchor ? 0 : buildCapitalRingRadius(capitalSlotIndex - 1),
    formationRadius: isPrimaryAnchor ? 0 : buildCapitalRingRadius(capitalSlotIndex - 1),
    modules: template.anchorModules,
  });
}

function buildSuperBlueprint(wing, superIndex = 1) {
  const template = REMOTE_REPAIR_WING_TEMPLATES[String(wing || "")];
  const resolvedIndex = Math.max(1, toInt(superIndex, 1));
  const capitalSlotIndex = resolvedIndex * 2;
  if (!template) {
    return null;
  }
  return Object.freeze({
    key: resolvedIndex === 1 ? `${wing}Super` : `${wing}Super${resolvedIndex}`,
    wing,
    role: "super",
    capitalIndex: resolvedIndex,
    capitalSlotIndex,
    hullName: template.superHullName,
    orbitStrategy: "wingAnchor",
    orbitDistance: Math.max(
      SUPERCAP_ORBIT_DISTANCE_METERS,
      buildCapitalRingRadius(capitalSlotIndex - 1),
    ),
    formationRadius: Math.max(
      SUPERCAP_ORBIT_DISTANCE_METERS,
      buildCapitalRingRadius(capitalSlotIndex - 1),
    ),
    modules: template.superModules,
  });
}

function buildLogiBlueprint(wing, logiIndex) {
  const template = REMOTE_REPAIR_WING_TEMPLATES[String(wing || "")];
  const normalizedIndex = Math.max(1, toInt(logiIndex, 1));
  if (!template) {
    return null;
  }
  return Object.freeze({
    key: `${wing}Logi${normalizedIndex}`,
    wing,
    role: "logi",
    hullName: template.logiHullName,
    logiIndex: normalizedIndex,
    orbitStrategy: normalizedIndex % 2 === 0 ? "previousLogi" : "wingAnchor",
    orbitDistance: normalizedIndex % 2 === 0
      ? LOGI_CHAIN_ORBIT_DISTANCE_METERS
      : buildLogiRingRadius(normalizedIndex),
    formationRadius: buildLogiRingRadius(normalizedIndex),
    modules: template.logiModules,
  });
}

function resolveCommandShipCount(totalCount) {
  const normalizedCount = Math.max(0, toInt(totalCount, 0));
  if (normalizedCount >= 24) {
    return 3;
  }
  if (normalizedCount >= 10) {
    return 2;
  }
  if (normalizedCount >= 5) {
    return 1;
  }
  return 0;
}

function buildCommandShipBlueprints(count) {
  return COMMAND_SHIP_TEMPLATES.slice(
    0,
    Math.max(0, Math.min(COMMAND_SHIP_TEMPLATES.length, toInt(count, 0))),
  );
}

function buildCapitalTierBlueprints(pairType, pairIndex) {
  const resolvedType = String(pairType || "");
  const resolvedIndex = Math.max(1, toInt(pairIndex, 1));
  if (resolvedType === "anchor") {
    return [
      buildAnchorBlueprint("left", resolvedIndex),
      buildAnchorBlueprint("right", resolvedIndex),
    ].filter(Boolean);
  }
  if (resolvedType === "super") {
    return [
      buildSuperBlueprint("left", resolvedIndex),
      buildSuperBlueprint("right", resolvedIndex),
    ].filter(Boolean);
  }
  return [];
}

function selectSupportBlueprints(count) {
  const resolvedCount = Math.max(1, toInt(count, 1));
  const blueprints = [];
  const leftAnchor = buildAnchorBlueprint("left", 1);
  const rightAnchor = buildAnchorBlueprint("right", 1);

  if (leftAnchor && blueprints.length < resolvedCount) {
    blueprints.push(leftAnchor);
  }
  if (rightAnchor && blueprints.length < resolvedCount) {
    blueprints.push(rightAnchor);
  }

  for (const tier of CAPITAL_SCALING_TIERS) {
    if (!tier || resolvedCount < toInt(tier.minSupportCount, 0)) {
      continue;
    }
    for (const blueprint of buildCapitalTierBlueprints(tier.pairType, tier.pairIndex)) {
      if (blueprints.length >= resolvedCount) {
        break;
      }
      blueprints.push(blueprint);
    }
  }

  let logiIndex = 1;
  while (blueprints.length < resolvedCount) {
    const leftLogi = buildLogiBlueprint("left", logiIndex);
    if (leftLogi && blueprints.length < resolvedCount) {
      blueprints.push(leftLogi);
    }

    const rightLogi = buildLogiBlueprint("right", logiIndex);
    if (rightLogi && blueprints.length < resolvedCount) {
      blueprints.push(rightLogi);
    }

    logiIndex += 1;
  }

  return blueprints;
}

function selectRosterBlueprints(count) {
  const resolvedCount = Math.max(
    MIN_REMOTE_REPAIR_FLEET_COUNT,
    Math.min(MAX_REMOTE_REPAIR_FLEET_COUNT, toInt(count, DEFAULT_REMOTE_REPAIR_FLEET_COUNT)),
  );
  const commandShipCount = Math.min(
    resolveCommandShipCount(resolvedCount),
    Math.max(0, resolvedCount - 1),
  );
  const supportBlueprints = selectSupportBlueprints(resolvedCount - commandShipCount);
  const commandBlueprints = buildCommandShipBlueprints(commandShipCount);
  const anchors = supportBlueprints.filter((blueprint) => blueprint.role === "anchor");
  const remainingSupports = supportBlueprints.filter((blueprint) => blueprint.role !== "anchor");
  return [
    ...anchors,
    ...commandBlueprints,
    ...remainingSupports,
  ];
}

function getWingMaxFormationRadius(blueprints, wing) {
  return blueprints.reduce((largest, blueprint) => {
    if (!blueprint || blueprint.wing !== wing) {
      return largest;
    }
    return Math.max(largest, toFiniteNumber(blueprint.formationRadius, 0));
  }, 0);
}

function buildLogiSlotPosition(wingCenter, basis, wing, blueprint) {
  const logiIndex = Math.max(1, toInt(blueprint && blueprint.logiIndex, 1));
  const ringIndex = Math.floor((logiIndex - 1) / LOGI_RING_CAPACITY);
  const slotIndex = (logiIndex - 1) % LOGI_RING_CAPACITY;
  const radius = Math.max(
    LOGI_RING_BASE_RADIUS_METERS,
    toFiniteNumber(blueprint && blueprint.formationRadius, LOGI_RING_BASE_RADIUS_METERS),
  );
  const phaseOffset = wing === "left" ? 0 : (Math.PI / LOGI_RING_CAPACITY);
  const angle = phaseOffset + ((Math.PI * 2 * slotIndex) / LOGI_RING_CAPACITY);
  const forwardOffset = Math.cos(angle) * radius;
  const upOffset = Math.sin(angle) * radius;
  const ringDepthOffset = ringIndex * 900;
  return addVectors(
    wingCenter,
    addVectors(
      scaleVector(basis.forward, forwardOffset - ringDepthOffset),
      scaleVector(basis.up, upOffset),
    ),
  );
}

function buildCommandSlotPosition(center, wingCenter, basis, blueprint) {
  if (!blueprint || blueprint.role !== "command") {
    return cloneVector(wingCenter);
  }
  if (blueprint.wing === "center") {
    return addVectors(
      center,
      addVectors(
        scaleVector(basis.forward, -COMMAND_SHIP_CENTER_ORBIT_DISTANCE_METERS),
        scaleVector(basis.up, COMMAND_SHIP_UP_OFFSET_METERS + 750),
      ),
    );
  }
  return addVectors(
    wingCenter,
    addVectors(
      scaleVector(
        basis.forward,
        blueprint.wing === "right"
          ? COMMAND_SHIP_FORWARD_OFFSET_METERS
          : -COMMAND_SHIP_FORWARD_OFFSET_METERS,
      ),
      scaleVector(basis.up, COMMAND_SHIP_UP_OFFSET_METERS),
    ),
  );
}

function buildCapitalSlotPosition(wingCenter, basis, wing, blueprint) {
  const role = String(blueprint && blueprint.role || "");
  const capitalSlotIndex = Math.max(1, toInt(blueprint && blueprint.capitalSlotIndex, 1));
  if (role === "anchor" && capitalSlotIndex === 1) {
    return cloneVector(wingCenter);
  }

  const normalizedIndex = Math.max(1, capitalSlotIndex - 1);
  const ringIndex = Math.floor((normalizedIndex - 1) / CAPITAL_RING_CAPACITY);
  const slotIndex = (normalizedIndex - 1) % CAPITAL_RING_CAPACITY;
  const radius = buildCapitalRingRadius(normalizedIndex);
  const phaseOffset = wing === "left" ? 0 : (Math.PI / CAPITAL_RING_CAPACITY);
  const roleOffset = role === "super" ? (Math.PI / 6) : 0;
  const angle = phaseOffset + roleOffset + ((Math.PI * 2 * slotIndex) / CAPITAL_RING_CAPACITY);
  const forwardOffset = Math.cos(angle) * radius;
  const upOffset = Math.sin(angle) * radius;
  const ringDepthOffset = ringIndex * 1_500;
  return addVectors(
    wingCenter,
    addVectors(
      scaleVector(basis.forward, forwardOffset - ringDepthOffset),
      scaleVector(basis.up, upOffset),
    ),
  );
}

function buildFormationSlots(ownerEntity, blueprints = []) {
  const basis = buildFormationBasis(ownerEntity && ownerEntity.direction);
  const center = cloneVector(ownerEntity && ownerEntity.position);
  const maximumWingRadius = Math.max(
    getWingMaxFormationRadius(blueprints, "left"),
    getWingMaxFormationRadius(blueprints, "right"),
    SUPERCAP_ORBIT_DISTANCE_METERS,
  );
  const wingOffsetMeters = Math.max(
    BASE_WING_OFFSET_METERS,
    maximumWingRadius + WING_SEPARATION_MARGIN_METERS,
  );
  const leftCenter = addVectors(
    center,
    scaleVector(basis.right, -wingOffsetMeters),
  );
  const rightCenter = addVectors(
    center,
    scaleVector(basis.right, wingOffsetMeters),
  );

  const facingCenter = (position) => normalizeVector(
    subtractVectors(center, position),
    scaleVector(basis.right, -1),
  );

  const slots = {};
  for (const blueprint of blueprints) {
    if (!blueprint || !blueprint.key) {
      continue;
    }
    const wingCenter =
      blueprint.wing === "right"
        ? rightCenter
        : blueprint.wing === "center"
          ? center
          : leftCenter;
    let position = wingCenter;
    if (blueprint.role === "anchor" || blueprint.role === "super") {
      position = buildCapitalSlotPosition(
        wingCenter,
        basis,
        blueprint.wing,
        blueprint,
      );
    } else if (blueprint.role === "command") {
      position = buildCommandSlotPosition(center, wingCenter, basis, blueprint);
    } else if (blueprint.role === "logi") {
      position = buildLogiSlotPosition(wingCenter, basis, blueprint.wing, blueprint);
    }

    slots[blueprint.key] = {
      position,
      direction: facingCenter(position),
    };
  }

  return slots;
}

function resolveBuddyKey(logiKeys = [], currentKey) {
  const index = logiKeys.indexOf(currentKey);
  if (index === -1) {
    return null;
  }
  if (logiKeys.length === 1) {
    return null;
  }
  return logiKeys[(index + 1) % logiKeys.length] || null;
}

function buildCandidateList(...values) {
  return uniqueCandidates(values.flat());
}

function buildWingEntryState(spawnedEntries = []) {
  const wingState = {
    left: {
      anchorKeys: [],
      superKeys: [],
      primaryAnchorKey: null,
      primarySuperKey: null,
      logiKeys: [],
    },
    right: {
      anchorKeys: [],
      superKeys: [],
      primaryAnchorKey: null,
      primarySuperKey: null,
      logiKeys: [],
    },
  };

  for (const entry of spawnedEntries) {
    const blueprint = entry && entry.blueprint;
    const wing = blueprint && wingState[blueprint.wing];
    if (!wing || !blueprint || !blueprint.key) {
      continue;
    }
    if (blueprint.role === "anchor") {
      wing.anchorKeys.push(blueprint.key);
      if (!wing.primaryAnchorKey) {
        wing.primaryAnchorKey = blueprint.key;
      }
      continue;
    }
    if (blueprint.role === "super") {
      wing.superKeys.push(blueprint.key);
      if (!wing.primarySuperKey) {
        wing.primarySuperKey = blueprint.key;
      }
      continue;
    }
    if (blueprint.role === "logi") {
      wing.logiKeys.push(blueprint.key);
    }
  }

  for (const wing of Object.values(wingState)) {
    wing.logiKeys.sort((leftKey, rightKey) => {
      const leftValue = normalizePositiveInteger(String(leftKey).replace(/^\D+/u, ""), 0);
      const rightValue = normalizePositiveInteger(String(rightKey).replace(/^\D+/u, ""), 0);
      return leftValue - rightValue;
    });
  }

  return wingState;
}

function buildRepairModulePlansForEntry(blueprint, entity, wingState) {
  const wing = wingState[blueprint.wing] || {
    anchorKeys: [],
    superKeys: [],
    primaryAnchorKey: null,
    primarySuperKey: null,
    logiKeys: [],
  };
  const allLogiKeys = wing.logiKeys;
  const logiKeys = allLogiKeys.filter((key) => key !== blueprint.key);
  const capitalKeys = buildCandidateList(wing.anchorKeys, wing.superKeys);
  const peerCapitalKeys = capitalKeys.filter((key) => key !== blueprint.key);
  const primaryAnchorKey = wing.primaryAnchorKey;
  const primarySuperKey = wing.primarySuperKey;
  const reserveCapitalKeys = peerCapitalKeys.filter((key) => (
    key !== primaryAnchorKey &&
    key !== primarySuperKey
  ));
  const buddyKey = resolveBuddyKey(allLogiKeys, blueprint.key);
  const blueprintKey = String(blueprint && blueprint.key || "");
  const logiIndex = allLogiKeys.indexOf(blueprintKey);
  const previousLogiKey =
    logiIndex > 0
      ? allLogiKeys[logiIndex - 1] || null
      : null;
  const nextLogiKey =
    logiIndex >= 0
      ? allLogiKeys[logiIndex + 1] || null
      : null;
  const fittedModules = Array.isArray(entity && entity.fittedItems) ? entity.fittedItems : [];
  const armorModules = fittedModules.filter((item) => item && item.rrFamily === "remoteArmor");
  const shieldModules = fittedModules.filter((item) => item && item.rrFamily === "remoteShield");
  const hullModules = fittedModules.filter((item) => item && item.rrFamily === "remoteHull");
  const capModules = fittedModules.filter((item) => item && item.rrFamily === "remoteCapacitor");
  const repairModules = blueprint.wing === "left" ? armorModules : shieldModules;
  const modulePlans = [];

  if (blueprint.role === "command") {
    for (const burstModule of fittedModules) {
      if (!burstModule || !/Command Burst|Foreman Burst/u.test(String(burstModule.itemName || ""))) {
        continue;
      }
      modulePlans.push({
        moduleID: burstModule.itemID,
        family: "commandBurst",
        targetless: true,
      });
    }
    return modulePlans;
  }

  if (blueprint.role === "logi") {
    if (repairModules[0]) {
      modulePlans.push({
        moduleID: repairModules[0].itemID,
        family: repairModules[0].rrFamily,
        candidates: buildCandidateList(
          buddyKey,
          nextLogiKey,
          previousLogiKey,
          primaryAnchorKey,
          primarySuperKey,
          reserveCapitalKeys,
          "player",
        ),
      });
    }
    if (repairModules[1]) {
      modulePlans.push({
        moduleID: repairModules[1].itemID,
        family: repairModules[1].rrFamily,
        candidates: buildCandidateList(
          primaryAnchorKey,
          previousLogiKey,
          buddyKey,
          nextLogiKey,
          primarySuperKey,
          reserveCapitalKeys,
          "player",
        ),
      });
    }
    if (repairModules[2]) {
      modulePlans.push({
        moduleID: repairModules[2].itemID,
        family: repairModules[2].rrFamily,
        candidates: buildCandidateList(
          "player",
          primarySuperKey,
          primaryAnchorKey,
          reserveCapitalKeys,
          buddyKey,
          nextLogiKey,
          previousLogiKey,
        ),
      });
    }
    if (capModules[0]) {
      modulePlans.push({
        moduleID: capModules[0].itemID,
        family: capModules[0].rrFamily,
        candidates: buildCandidateList(
          buddyKey,
          nextLogiKey,
          previousLogiKey,
          primaryAnchorKey,
          primarySuperKey,
          reserveCapitalKeys,
          "player",
          logiKeys[0],
        ),
      });
    }
    if (capModules[1]) {
      modulePlans.push({
        moduleID: capModules[1].itemID,
        family: capModules[1].rrFamily,
        candidates: buildCandidateList(
          "player",
          primaryAnchorKey,
          primarySuperKey,
          reserveCapitalKeys,
          buddyKey,
          nextLogiKey,
          previousLogiKey,
          logiKeys[0],
        ),
      });
    }
  }

  if (blueprint.role === "anchor") {
    if (repairModules[0]) {
      modulePlans.push({
        moduleID: repairModules[0].itemID,
        family: repairModules[0].rrFamily,
        candidates: buildCandidateList(
          peerCapitalKeys,
          logiKeys[0],
          "player",
          logiKeys[1],
          logiKeys[2],
        ),
      });
    }
    if (repairModules[1]) {
      modulePlans.push({
        moduleID: repairModules[1].itemID,
        family: repairModules[1].rrFamily,
        candidates: buildCandidateList(
          "player",
          peerCapitalKeys,
          logiKeys[1],
          logiKeys[0],
          logiKeys[2],
        ),
      });
    }
    if (hullModules[0]) {
      modulePlans.push({
        moduleID: hullModules[0].itemID,
        family: hullModules[0].rrFamily,
        candidates: buildCandidateList(
          "player",
          peerCapitalKeys,
          logiKeys[0],
          logiKeys[1],
          logiKeys[2],
        ),
      });
    }
    if (capModules[0]) {
      modulePlans.push({
        moduleID: capModules[0].itemID,
        family: capModules[0].rrFamily,
        candidates: buildCandidateList(
          "player",
          peerCapitalKeys,
          logiKeys[0],
          logiKeys[1],
          logiKeys[2],
        ),
      });
    }
    if (capModules[1]) {
      modulePlans.push({
        moduleID: capModules[1].itemID,
        family: capModules[1].rrFamily,
        candidates: buildCandidateList(
          peerCapitalKeys,
          logiKeys[0],
          "player",
          logiKeys[1],
          logiKeys[2],
        ),
      });
    }
  }

  if (blueprint.role === "super") {
    if (repairModules[0]) {
      modulePlans.push({
        moduleID: repairModules[0].itemID,
        family: repairModules[0].rrFamily,
        candidates: buildCandidateList(
          primaryAnchorKey,
          peerCapitalKeys,
          "player",
          logiKeys[0],
          logiKeys[1],
          logiKeys[2],
        ),
      });
    }
    if (repairModules[1]) {
      modulePlans.push({
        moduleID: repairModules[1].itemID,
        family: repairModules[1].rrFamily,
        candidates: buildCandidateList(
          "player",
          primaryAnchorKey,
          peerCapitalKeys,
          logiKeys[0],
          logiKeys[1],
          logiKeys[2],
        ),
      });
    }
    if (hullModules[0]) {
      modulePlans.push({
        moduleID: hullModules[0].itemID,
        family: hullModules[0].rrFamily,
        candidates: buildCandidateList(
          "player",
          primaryAnchorKey,
          peerCapitalKeys,
          logiKeys[0],
          logiKeys[1],
        ),
      });
    }
    if (capModules[0]) {
      modulePlans.push({
        moduleID: capModules[0].itemID,
        family: capModules[0].rrFamily,
        candidates: buildCandidateList(
          "player",
          primaryAnchorKey,
          peerCapitalKeys,
          logiKeys[0],
          logiKeys[1],
        ),
      });
    }
    if (capModules[1]) {
      modulePlans.push({
        moduleID: capModules[1].itemID,
        family: capModules[1].rrFamily,
        candidates: buildCandidateList(
          primaryAnchorKey,
          peerCapitalKeys,
          "player",
          logiKeys[1],
          logiKeys[0],
        ),
      });
    }
  }

  return modulePlans;
}

function buildControllerEntries(spawnedEntries, ownerEntity = null) {
  const wingState = buildWingEntryState(spawnedEntries);
  let commandPhaseIndex = 0;

  return spawnedEntries.map((entry) => {
    const orbitStrategy = String(entry.blueprint.orbitStrategy || "hold");
    const wing = wingState[entry.blueprint.wing] || {
      anchorKeys: [],
      superKeys: [],
      primaryAnchorKey: null,
      primarySuperKey: null,
      logiKeys: [],
    };
    const currentLogiIndex = wing.logiKeys.indexOf(entry.blueprint.key);
    const previousLogiKey =
      currentLogiIndex > 0
        ? wing.logiKeys[currentLogiIndex - 1] || null
        : null;
    const commandEntryPhaseIndex =
      entry.blueprint.role === "command"
        ? commandPhaseIndex++
        : -1;
    const wingMovementPhaseOffsetMs =
      entry.blueprint.wing === "right"
        ? Math.trunc(REMOTE_REPAIR_PRIMARY_ANCHOR_DRIFT_PERIOD_MS / 2)
        : entry.blueprint.wing === "center"
          ? Math.trunc(REMOTE_REPAIR_PRIMARY_ANCHOR_DRIFT_PERIOD_MS / 4)
          : 0;
    const roleMovementPhaseOffsetMs =
      entry.blueprint.role === "command"
        ? commandEntryPhaseIndex * REMOTE_REPAIR_MOVEMENT_PHASE_STEP_MS
        : entry.blueprint.role === "super"
          ? Math.max(0, toInt(entry.blueprint.capitalIndex, 1) - 1) * REMOTE_REPAIR_MOVEMENT_PHASE_STEP_MS
          : entry.blueprint.role === "anchor"
            ? Math.max(0, toInt(entry.blueprint.capitalIndex, 1) - 1) * Math.trunc(REMOTE_REPAIR_MOVEMENT_PHASE_STEP_MS / 2)
            : Math.max(0, toInt(entry.blueprint.logiIndex, 1) - 1) * Math.trunc(REMOTE_REPAIR_MOVEMENT_PHASE_STEP_MS / 3);
    const isPrimaryAnchor =
      entry.blueprint.role === "anchor" &&
      String(entry.blueprint.key || "") === String(wing.primaryAnchorKey || "");
    const commandShipModulePlans = buildRepairModulePlansForEntry(
      entry.blueprint,
      entry.entity,
      wingState,
    ).map((plan, modulePlanIndex) => (
      plan && plan.targetless === true
        ? {
          ...plan,
          notBeforeOffsetMs:
            (commandEntryPhaseIndex >= 0 ? commandEntryPhaseIndex : 0) * REMOTE_REPAIR_BURST_STAGGER_STEP_MS +
            (modulePlanIndex * REMOTE_REPAIR_BURST_MODULE_STAGGER_STEP_MS),
        }
        : plan
    ));
    const orbitTargetCandidates =
      orbitStrategy === "wingAnchor"
        ? [wing.primaryAnchorKey, previousLogiKey, wing.primarySuperKey]
        : orbitStrategy === "previousLogi"
          ? [previousLogiKey, wing.primaryAnchorKey, wing.primarySuperKey]
          : orbitStrategy === "player"
            ? ["player"]
            : [];
    return {
      key: entry.blueprint.key,
      entityID: entry.entity.itemID,
      role: entry.blueprint.role,
      wing: entry.blueprint.wing,
      blueprint: { ...entry.blueprint },
      movementProfile: isPrimaryAnchor ? "anchorDrift" : "orbitBand",
      movementPhaseOffsetMs: wingMovementPhaseOffsetMs + roleMovementPhaseOffsetMs,
      baseOrbitDistance: toFiniteNumber(entry.blueprint.orbitDistance, 0),
      orbitTargetCandidates,
      orbitDistance: toFiniteNumber(entry.blueprint.orbitDistance, 0),
      orbitPulseAmplitudeMeters:
        entry.blueprint.role === "command"
          ? 900
          : entry.blueprint.role === "super"
            ? 800
            : entry.blueprint.role === "anchor"
              ? 650
              : 450,
      orbitPulsePeriodMs:
        entry.blueprint.role === "command"
          ? REMOTE_REPAIR_COMMAND_ORBIT_PULSE_PERIOD_MS
          : REMOTE_REPAIR_ORBIT_PULSE_PERIOD_MS,
      orbitRetuneThresholdMeters:
        entry.blueprint.role === "command"
          ? 350
          : 225,
      orbitRetuneIntervalMs:
        entry.blueprint.role === "command"
          ? 1_500
          : 2_000,
      anchorShellDistanceMeters:
        isPrimaryAnchor
          ? distanceBetweenVectors(
            entry.entity.position,
            ownerEntity && ownerEntity.position,
          )
          : 0,
      anchorDriftPeriodMs: REMOTE_REPAIR_PRIMARY_ANCHOR_DRIFT_PERIOD_MS,
      anchorDriftForwardAmplitudeMeters: REMOTE_REPAIR_PRIMARY_ANCHOR_DRIFT_FORWARD_METERS,
      anchorDriftVerticalAmplitudeMeters: REMOTE_REPAIR_PRIMARY_ANCHOR_DRIFT_VERTICAL_METERS,
      modulePlans: commandShipModulePlans,
    };
  });
}

function getActiveRemoteRepairShowController(scene, ownerShipID) {
  const controller = scene && scene.remoteRepairShowController;
  if (!controller || controller.active !== true) {
    return null;
  }
  if (toInt(controller.ownerShipID, 0) !== toInt(ownerShipID, 0)) {
    return null;
  }
  return controller;
}

function buildRemoteRepairFighterLaunchSpaceState(parentEntity, launchIndex = 0) {
  const shipDirection = normalizeVector(parentEntity && parentEntity.direction, { x: 1, y: 0, z: 0 });
  const basis = buildFormationBasis(shipDirection);
  const launchDistance =
    Math.max(toFiniteNumber(parentEntity && parentEntity.radius, 0), 1) +
    REMOTE_REPAIR_FIGHTER_LAUNCH_OFFSET_METERS;
  const lateralOffset = (Math.max(0, toInt(launchIndex, 0)) % Math.max(FIGHTER_TUBE_FLAGS.length, 1)) * 85;
  const signedSide = toInt(launchIndex, 0) % 2 === 0 ? 1 : -1;
  const verticalSign = toInt(launchIndex, 0) % 3 === 0 ? 1 : -1;
  const position = addVectors(
    addVectors(
      cloneVector(parentEntity && parentEntity.position),
      scaleVector(basis.forward, launchDistance),
    ),
    addVectors(
      scaleVector(basis.right, lateralOffset * signedSide),
      scaleVector(basis.up, 75 * verticalSign),
    ),
  );

  return {
    systemID: toInt(parentEntity && parentEntity.systemID, 0),
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: shipDirection,
    targetPoint: cloneVector(position),
    speedFraction: 0,
    mode: "STOP",
    targetEntityID: null,
    followRange: 0,
    orbitDistance: 0,
    orbitNormal: cloneVector(basis.up),
    orbitSign: 1,
    pendingWarp: null,
    warpState: null,
  };
}

function resolveFighterTubeCountForEntity(entity) {
  const configuredTubes = Math.max(
    0,
    toInt(
      getTypeAttributeValue(
        toInt(entity && entity.typeID, 0),
        "fighterTubes",
      ),
      0,
    ),
  );
  return Math.min(configuredTubes, FIGHTER_TUBE_FLAGS.length);
}

function resolveRemoteRepairFighterLoadoutNames(entity, tubeCount) {
  const hullName = String(entity && entity.itemName || "").trim();
  const configured = REMOTE_REPAIR_FIGHTER_LOADOUTS[hullName];
  if (Array.isArray(configured) && configured.length > 0) {
    return configured.slice(0, Math.max(0, toInt(tubeCount, 0)));
  }
  const fallbackName =
    hullName === "Wyvern" || hullName === "Chimera"
      ? "Dragonfly II"
      : "Templar II";
  return Array.from({ length: Math.max(0, toInt(tubeCount, 0)) }, () => fallbackName);
}

function resolveFighterOrbitProfile(fighterType) {
  const groupName = String(fighterType && fighterType.groupName || "").trim().toLowerCase();
  if (groupName.includes("heavy")) {
    return {
      orbitDistance: REMOTE_REPAIR_FIGHTER_HEAVY_ORBIT_DISTANCE_METERS,
      coverOrbitDistance: REMOTE_REPAIR_FIGHTER_COVER_HEAVY_ORBIT_DISTANCE_METERS,
    };
  }
  if (groupName.includes("support")) {
    return {
      orbitDistance: REMOTE_REPAIR_FIGHTER_SUPPORT_ORBIT_DISTANCE_METERS,
      coverOrbitDistance: REMOTE_REPAIR_FIGHTER_COVER_SUPPORT_ORBIT_DISTANCE_METERS,
    };
  }
  return {
    orbitDistance: REMOTE_REPAIR_FIGHTER_LIGHT_ORBIT_DISTANCE_METERS,
    coverOrbitDistance: REMOTE_REPAIR_FIGHTER_COVER_LIGHT_ORBIT_DISTANCE_METERS,
  };
}

function applyCoverFormationToController(scene, controller, ownerEntity, nowMs) {
  if (!scene || !controller || !ownerEntity) {
    return {
      success: false,
      message: "Active ship was not found in the current scene.",
    };
  }

  controller.formationMode = "cover";
  controller.coverActivatedAtMs = toFiniteNumber(nowMs, 0);

  for (const entry of Array.isArray(controller.entries) ? controller.entries : []) {
    const blueprint = entry && entry.blueprint && typeof entry.blueprint === "object"
      ? entry.blueprint
      : {
        key: entry && entry.key,
        role: entry && entry.role,
        wing: entry && entry.wing,
      };
    const wingSign =
      String(blueprint && blueprint.wing || "") === "right"
        ? 1
        : String(blueprint && blueprint.wing || "") === "left"
          ? -1
          : 0;
    const capitalIndex = Math.max(1, toInt(blueprint && blueprint.capitalIndex, 1));
    const logiIndex = Math.max(1, toInt(blueprint && blueprint.logiIndex, 1));
    const commandIndex = Math.max(0, toInt(blueprint && blueprint.commandIndex, 0));
    const logiBandIndex = Math.floor((logiIndex - 1) / 4);
    const logiBandSlot = (logiIndex - 1) % 4;

    let forwardOffset = 0;
    let lateralOffset = 0;
    let verticalOffset = 0;
    let lateralDrift = 0;
    let forwardDrift = 0;
    let verticalDrift = 0;
    let holdRadius = 900;
    let refreshInterval = REMOTE_REPAIR_COVER_REFRESH_INTERVAL_MS;

    if (blueprint.role === "super") {
      forwardOffset = 18_000 + ((capitalIndex - 1) * 3_200);
      lateralOffset = wingSign * (11_500 + ((capitalIndex - 1) * 2_400));
      verticalOffset = capitalIndex % 2 === 0 ? 1_250 : -1_250;
      lateralDrift = 900;
      forwardDrift = 1_400;
      verticalDrift = 500;
      holdRadius = 1_600;
      refreshInterval = 1_700;
    } else if (blueprint.role === "anchor") {
      forwardOffset = 11_500 + ((capitalIndex - 1) * 2_200);
      lateralOffset = wingSign * (8_000 + ((capitalIndex - 1) * 1_800));
      verticalOffset = capitalIndex % 2 === 0 ? 850 : -850;
      lateralDrift = 650;
      forwardDrift = 900;
      verticalDrift = 400;
      holdRadius = 1_250;
      refreshInterval = 1_900;
    } else if (blueprint.role === "logi") {
      forwardOffset = 4_200 - (logiBandIndex * 1_500);
      lateralOffset = wingSign * (5_000 + (logiBandSlot * 1_350) + (logiBandIndex * 900));
      verticalOffset = logiBandSlot % 2 === 0 ? 320 : -320;
      lateralDrift = 350;
      forwardDrift = 275;
      verticalDrift = 180;
      holdRadius = 650;
      refreshInterval = 2_450;
    } else if (blueprint.role === "command") {
      forwardOffset = blueprint.wing === "center" ? 1_500 : 2_400;
      lateralOffset = wingSign * 3_600;
      if (blueprint.wing === "center") {
        lateralOffset = (commandIndex % 2 === 0 ? -1 : 1) * 2_600;
      }
      verticalOffset = commandIndex % 2 === 0 ? 420 : -420;
      lateralDrift = 250;
      forwardDrift = 200;
      verticalDrift = 120;
      holdRadius = 600;
      refreshInterval = 2_700;
    }

    entry.movementProfile = "coverSlot";
    entry.coverOffsetForwardMeters = forwardOffset;
    entry.coverOffsetLateralMeters = lateralOffset;
    entry.coverOffsetVerticalMeters = verticalOffset;
    entry.coverDriftForwardAmplitudeMeters = forwardDrift;
    entry.coverDriftLateralAmplitudeMeters = lateralDrift;
    entry.coverDriftVerticalAmplitudeMeters = verticalDrift;
    entry.coverDriftPeriodMs = REMOTE_REPAIR_COVER_DRIFT_PERIOD_MS;
    entry.coverHoldRadiusMeters = holdRadius;
    entry.coverRefreshIntervalMs = refreshInterval;
    entry.coverRefreshJitterMs =
      Math.max(0, Math.trunc(Math.abs(toFiniteNumber(entry.movementPhaseOffsetMs, 0)) % 700));
    entry.coverRetargetThresholdMeters = Math.max(200, holdRadius * 0.4);
    entry.baseOrbitDistance = 0;
    entry.orbitDistance = 0;
    entry.orbitTargetCandidates = [];
    delete entry.lastOrbitRetuneAtMs;
    delete entry.lastResolvedOrbitDistance;
    delete entry.lastCoverCommandAtMs;
    delete entry.lastCoverIssuedTargetPoint;
  }

  return {
    success: true,
    message: [
      "RemoteRepShow cover pattern engaged.",
      "Supercarriers are driving the forward screen, carriers are stacking in behind them, and the support wings are pulling into rear cover lanes.",
    ].join(" "),
  };
}

function deployRemoteRepairShowFighters(scene, controller, session, ownerEntity, nowMs) {
  if (!scene || !controller || !session || !ownerEntity) {
    return {
      success: false,
      message: "Active ship was not found in the current scene.",
    };
  }

  clearRemoteRepairShowFighters(scene, {
    nowMs,
  });

  const fighterEntries = [];
  const createdFighterItemIDs = [];
  const launchedByRole = {
    super: 0,
    anchor: 0,
  };

  const cleanupFailedLaunches = () => {
    clearRemoteRepairShowFighters(scene, {
      nowMs,
    });
    for (const itemID of createdFighterItemIDs) {
      removeInventoryItem(itemID, {
        removeContents: true,
      });
    }
  };

  for (const entry of Array.isArray(controller.entries) ? controller.entries : []) {
    const carrierEntity = scene.getEntityByID(toInt(entry && entry.entityID, 0));
    if (!carrierEntity || (entry.role !== "super" && entry.role !== "anchor")) {
      continue;
    }

    const tubeCount = resolveFighterTubeCountForEntity(carrierEntity);
    if (tubeCount <= 0) {
      continue;
    }
    const loadoutNames = resolveRemoteRepairFighterLoadoutNames(carrierEntity, tubeCount);
    const roleBaseOrbitProfile =
      entry.role === "super"
        ? {
          orbitDistanceBonus: 900,
          coverOrbitDistanceBonus: 1_250,
        }
        : {
          orbitDistanceBonus: 0,
          coverOrbitDistanceBonus: 0,
        };

    for (let launchIndex = 0; launchIndex < tubeCount; launchIndex += 1) {
      const fighterTypeName = loadoutNames[launchIndex] || loadoutNames[loadoutNames.length - 1] || null;
      const fighterType = resolveExactItem(fighterTypeName);
      if (!fighterType) {
        cleanupFailedLaunches();
        return {
          success: false,
          message: `Could not resolve '${fighterTypeName}' from local item data for /rr fighter.`,
        };
      }

      const tubeFlagID = FIGHTER_TUBE_FLAGS[launchIndex];
      const spaceState = buildRemoteRepairFighterLaunchSpaceState(carrierEntity, launchIndex);
      const createResult = grantItemToCharacterLocation(
        session.characterID,
        scene.systemID,
        0,
        fighterType,
        1,
        {
          singleton: 1,
          transient: true,
          itemName: fighterType.name,
          createdAtMs: nowMs,
          launcherID: carrierEntity.itemID,
          spaceState,
          fighterState: {
            tubeFlagID,
            controllerID: carrierEntity.itemID,
            controllerOwnerID: session.characterID,
          },
        },
      );
      if (!createResult.success || !createResult.data || !createResult.data.items || !createResult.data.items[0]) {
        cleanupFailedLaunches();
        return {
          success: false,
          message: `Failed to create transient fighter squadron for ${carrierEntity.itemName}.`,
        };
      }

      const createdItem = createResult.data.items[0];
      createdFighterItemIDs.push(createdItem.itemID);
      const updateResult = updateInventoryItem(createdItem.itemID, (currentItem) => ({
        ...currentItem,
        singleton: 0,
        quantity: REMOTE_REPAIR_FIGHTER_SQUADRON_SIZE,
        stacksize: REMOTE_REPAIR_FIGHTER_SQUADRON_SIZE,
        locationID: scene.systemID,
        flagID: 0,
        launcherID: carrierEntity.itemID,
        spaceState,
        fighterState: {
          tubeFlagID,
          controllerID: carrierEntity.itemID,
          controllerOwnerID: session.characterID,
        },
      }));
      if (!updateResult.success || !updateResult.data) {
        cleanupFailedLaunches();
        return {
          success: false,
          message: `Failed to finalize fighter squadron state for ${carrierEntity.itemName}.`,
        };
      }

      const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(scene.systemID, createdItem.itemID, {
        broadcast: true,
      });
      if (!spawnResult.success || !spawnResult.data || !spawnResult.data.entity) {
        cleanupFailedLaunches();
        return {
          success: false,
          message: `Failed to materialize fighter squadrons for ${carrierEntity.itemName}.`,
        };
      }

      const fighterEntity = spawnResult.data.entity;
      const orbitProfile = resolveFighterOrbitProfile(fighterType);
      fighterEntity.launcherID = carrierEntity.itemID;
      fighterEntity.controllerID = carrierEntity.itemID;
      fighterEntity.controllerOwnerID = session.characterID;
      fighterEntity.tubeFlagID = tubeFlagID;
      fighterEntity.squadronSize = REMOTE_REPAIR_FIGHTER_SQUADRON_SIZE;
      fighterEntity.maxSquadronSize = REMOTE_REPAIR_FIGHTER_SQUADRON_SIZE;
      fighterEntity.remoteRepairShowTransient = true;

      fighterEntries.push({
        key: `${entry.key}:fighter:${launchIndex + 1}`,
        entityID: fighterEntity.itemID,
        parentEntityID: carrierEntity.itemID,
        parentKey: entry.key,
        parentRole: entry.role,
        wing: entry.wing,
        tubeFlagID,
        orbitDistance:
          orbitProfile.orbitDistance +
          roleBaseOrbitProfile.orbitDistanceBonus +
          (launchIndex * 175),
        coverOrbitDistance:
          orbitProfile.coverOrbitDistance +
          roleBaseOrbitProfile.coverOrbitDistanceBonus +
          (launchIndex * 250),
        movementPhaseOffsetMs:
          toFiniteNumber(entry.movementPhaseOffsetMs, 0) +
          (launchIndex * REMOTE_REPAIR_FIGHTER_PHASE_STEP_MS),
      });
      launchedByRole[entry.role] += 1;
    }
  }

  controller.fighterEntries = fighterEntries;
  controller.fightersDeployedAtMs = toFiniteNumber(nowMs, 0);
  tickRemoteRepairShowScene(scene, nowMs);

  return {
    success: true,
    message: [
      `Launched ${fighterEntries.length} transient fighter squadrons from the active RemoteRepShow capitals.`,
      `Supercarrier tubes active: ${launchedByRole.super}. Carrier tubes active: ${launchedByRole.anchor}.`,
      "These squadrons are show-only and stay bound to the /rr controller rather than touching real player fighter state.",
    ].join(" "),
  };
}

function persistSyntheticNativeCargo(entity) {
  const entityID = toInt(entity && entity.itemID, 0);
  if (entityID <= 0) {
    return {
      success: false,
      errorMsg: "NPC_NATIVE_ENTITY_ID_REQUIRED",
    };
  }

  for (const cargoItem of Array.isArray(entity && entity.nativeCargoItems) ? entity.nativeCargoItems : []) {
    const writeResult = nativeNpcStore.upsertNativeCargo({
      cargoID: toInt(cargoItem && cargoItem.itemID, 0),
      entityID,
      ownerID: toInt(cargoItem && cargoItem.ownerID, toInt(entity && entity.ownerID, 0)),
      moduleID: toInt(cargoItem && cargoItem.moduleID, 0),
      typeID: toInt(cargoItem && cargoItem.typeID, 0),
      groupID: toInt(cargoItem && cargoItem.groupID, 0),
      categoryID: toInt(cargoItem && cargoItem.categoryID, 0),
      itemName: String(cargoItem && cargoItem.itemName || ""),
      quantity: Math.max(1, toInt(cargoItem && cargoItem.quantity, 1)),
      singleton: false,
      moduleState:
        cargoItem && cargoItem.moduleState && typeof cargoItem.moduleState === "object"
          ? { ...cargoItem.moduleState }
          : null,
    }, {
      transient: entity.transient === true,
    });
    if (!writeResult.success) {
      return {
        success: false,
        errorMsg: writeResult.errorMsg || "NPC_NATIVE_CARGO_WRITE_FAILED",
      };
    }
  }

  entity.nativeCargoItems = nativeNpcStore.buildNativeCargoItems(entityID);
  return {
    success: true,
    data: {
      count: Array.isArray(entity.nativeCargoItems) ? entity.nativeCargoItems.length : 0,
    },
  };
}

function clearSpawnedEntries(scene, spawnedEntries, nowMs) {
  for (const entry of Array.isArray(spawnedEntries) ? spawnedEntries : []) {
    const entityID = toInt(entry && entry.entity && entry.entity.itemID, 0);
    if (!entityID || !scene.getEntityByID(entityID)) {
      nativeNpcStore.removeNativeEntityCascade(entityID);
      continue;
    }
    scene.removeDynamicEntity(entityID, {
      nowMs,
    });
    nativeNpcStore.removeNativeEntityCascade(entityID);
  }
}

function restoreOwnerBurstAffinity(ownerEntity, previousOwnerBurstAffinityGroupID) {
  if (!ownerEntity || ownerEntity.kind !== "ship") {
    return;
  }
  if (toInt(previousOwnerBurstAffinityGroupID, 0) > 0) {
    ownerEntity.remoteRepairBurstAffinityGroupID = toInt(previousOwnerBurstAffinityGroupID, 0);
    return;
  }
  delete ownerEntity.remoteRepairBurstAffinityGroupID;
}

function handleRemoteRepairFleetCommand(session, argumentText, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      message: "Select a character before using /rr.",
    };
  }
  if (!session._space || !session._space.systemID || !session._space.shipID) {
    return {
      success: false,
      message: "You must be in space before using /rr.",
    };
  }

  const requestedCommand = resolveRequestedFleetCommand(argumentText);
  if (!requestedCommand.success) {
    return {
      success: false,
      message: "Usage: /rr [count|cover|fighter]",
    };
  }

  const scene = spaceRuntime.getSceneForSession(session) ||
    spaceRuntime.ensureScene(session._space.systemID);
  const ownerEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!scene || !ownerEntity) {
    return {
      success: false,
      message: "Active ship was not found in the current scene.",
    };
  }

  const nowMs =
    scene.getCurrentSimTimeMs &&
    typeof scene.getCurrentSimTimeMs === "function"
      ? scene.getCurrentSimTimeMs()
      : Date.now();
  const activeController = getActiveRemoteRepairShowController(scene, ownerEntity.itemID);

  if (requestedCommand.mode === "cover") {
    if (!activeController) {
      return {
        success: false,
        message: "Spawn an active /rr fleet first, then use /rr cover.",
      };
    }
    const coverResult = applyCoverFormationToController(scene, activeController, ownerEntity, nowMs);
    if (coverResult.success) {
      tickRemoteRepairShowScene(scene, nowMs);
    }
    return coverResult;
  }

  if (requestedCommand.mode === "fighter") {
    if (!activeController) {
      return {
        success: false,
        message: "Spawn an active /rr fleet first, then use /rr fighter.",
      };
    }
    return deployRemoteRepairShowFighters(scene, activeController, session, ownerEntity, nowMs);
  }

  const requestedCount = requestedCommand;
  const selectedBlueprints = selectRosterBlueprints(requestedCount.count);
  const clearedResult = clearRemoteRepairShowController(scene, {
    nowMs,
  });
  const orphanedResult = clearOrphanedRemoteRepairEntities(scene, nowMs);
  reconcileRemoteRepairEntityIDSeed(scene);
  const formationSlots = buildFormationSlots(ownerEntity, selectedBlueprints);
  const skillMap = getCharacterSkillMap(session.characterID);
  const spawnedEntries = [];
  const burstAffinityGroupID = allocateRemoteRepairBurstAffinityID();
  const previousOwnerBurstAffinityGroupID = toInt(ownerEntity.remoteRepairBurstAffinityGroupID, 0);
  ownerEntity.remoteRepairBurstAffinityGroupID = burstAffinityGroupID;

  for (const blueprint of selectedBlueprints) {
    const slot = formationSlots[blueprint.key];
    const entityID = allocateRemoteRepairEntityID();
    const shipSpec = buildSyntheticRepairShipSpec(
      session,
      blueprint,
      cloneVector(slot && slot.position),
      cloneVector(slot && slot.direction, ownerEntity.direction),
      entityID,
      skillMap,
    );
    if (!shipSpec) {
      clearSpawnedEntries(scene, spawnedEntries, nowMs);
      restoreOwnerBurstAffinity(ownerEntity, previousOwnerBurstAffinityGroupID);
      return {
        success: false,
        message: `Could not resolve the '${blueprint.hullName}' remote-repair loadout from local item data.`,
      };
    }

    const spawnResult = spaceRuntime.spawnDynamicShip(
      session._space.systemID,
      shipSpec,
    );
    if (!spawnResult.success || !spawnResult.data || !spawnResult.data.entity) {
      clearSpawnedEntries(scene, spawnedEntries, nowMs);
      restoreOwnerBurstAffinity(ownerEntity, previousOwnerBurstAffinityGroupID);
      return {
        success: false,
        message: `Failed to spawn the remote-repair support fleet: ${spawnResult.errorMsg || "SPAWN_FAILED"}.`,
      };
    }

    spawnedEntries.push({
      blueprint,
      entity: spawnResult.data.entity,
    });

    spawnResult.data.entity.remoteRepairBurstAffinityGroupID = burstAffinityGroupID;
    spawnResult.data.entity.remoteRepairShowTransient = true;
    const cargoPersistResult = persistSyntheticNativeCargo(spawnResult.data.entity);
    if (!cargoPersistResult.success) {
      clearSpawnedEntries(scene, spawnedEntries, nowMs);
      restoreOwnerBurstAffinity(ownerEntity, previousOwnerBurstAffinityGroupID);
      return {
        success: false,
        message: `Failed to seed remote-repair support cargo: ${cargoPersistResult.errorMsg || "NPC_NATIVE_CARGO_WRITE_FAILED"}.`,
      };
    }
  }

  const controller = registerRemoteRepairShowController(scene, {
    ownerShipID: ownerEntity.itemID,
    entries: buildControllerEntries(spawnedEntries, ownerEntity),
    manageIntervalMs: 500,
    movementIntervalMs: 1000,
    previousOwnerBurstAffinityGroupID,
  });
  if (!controller) {
    clearSpawnedEntries(scene, spawnedEntries, nowMs);
    restoreOwnerBurstAffinity(ownerEntity, previousOwnerBurstAffinityGroupID);
  }
  tickRemoteRepairShowScene(scene, nowMs);

  const armorCount = spawnedEntries.filter((entry) => (
    entry.blueprint.wing === "left" &&
    entry.blueprint.role !== "command"
  )).length;
  const shieldCount = spawnedEntries.filter((entry) => (
    entry.blueprint.wing === "right" &&
    entry.blueprint.role !== "command"
  )).length;
  const commandCount = spawnedEntries.filter((entry) => entry.blueprint.role === "command").length;
  const requestedSuffix =
    requestedCount.requestedCount !== requestedCount.count
      ? ` Requested ${requestedCount.requestedCount}, clamped to ${requestedCount.count}.`
      : "";
  const replacedSuffix =
    clearedResult && clearedResult.removedCount > 0
      ? ` Replaced ${clearedResult.removedCount} older support hulls in this system.`
      : "";
  const orphanedSuffix =
    orphanedResult && orphanedResult.removedCount > 0
      ? ` Cleared ${orphanedResult.removedCount} orphaned support hull${orphanedResult.removedCount === 1 ? "" : "s"}.`
      : "";

  return {
    success: Boolean(controller),
    message: [
      `Spawned ${spawnedEntries.length} transient remote-repair support hulls around your ship.`,
      `Armor wing: ${armorCount}. Shield wing: ${shieldCount}. Command ships: ${commandCount}.`,
      "They use real remote armor, shield, hull, capacitor, and command-burst modules, keep cycling through the live runtime, and spare repair beams are assigned onto you.",
      "They clear on restart or the next /rr in this scene.",
      requestedSuffix,
      replacedSuffix,
      orphanedSuffix,
    ].filter(Boolean).join(" "),
  };
}

module.exports = {
  DEFAULT_REMOTE_REPAIR_FLEET_COUNT,
  MAX_REMOTE_REPAIR_FLEET_COUNT,
  MIN_REMOTE_REPAIR_FLEET_COUNT,
  handleRemoteRepairFleetCommand,
};
