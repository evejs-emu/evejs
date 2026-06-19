const {
  getActiveShipRecord,
  getCharacterRecord,
} = require("../character/characterState");
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
  grantItemsToCharacterStationHangar,
  listContainerItems,
  moveItemTypeFromCharacterLocation,
} = require("../inventory/itemStore");
const {
  getCharacterSkillMap,
} = require("../skills/skillState");
const {
  listFittedItems,
  selectAutoFitFlagForType,
  validateFitForShip,
} = require("../fitting/liveFittingState");
const spaceRuntime = require("../../space/runtime");
const {
  boardPreparedShipInSpace,
} = require("../ship/spaceShipSwapRuntime");
const {
  pickRandomTitanSuperweaponLoadout,
  resolveTitanSuperweaponProfileByModuleTypeID,
} = require("./superweaponCatalog");
const {
  registerSuperTitanShowController,
} = require("../../space/modules/superweapons/superweaponRuntime");

const DEFAULT_HOME_STATION_ID = 60003760;
const SUPERTITAN_SHOW_DEFAULT_COUNT = 5;
const SUPERTITAN_SHOW_ENTITY_ID_START = 3950000000000000;
const SUPERTITAN_SHOW_FLEET_OFFSET_METERS = 40_000;
const SUPERTITAN_SHOW_MIDPOINT_DISTANCE_METERS = 160_000;
const SUPERTITAN_SHOW_LATERAL_SPACING_METERS = 25_000;
const SUPERTITAN_SHOW_ROW_SPACING_METERS = 22_500;
const SUPERTITAN_SHOW_APPROACH_SPEED_FRACTION = 0.3;
const SUPERTITAN_SHOW_TARGET_DELAY_MS = 4_000;
const SUPERTITAN_SHOW_REFIRE_MS = 30_000;
const SUPERTITAN_SHOW_SPAWN_BATCH_SIZE = 4;

let nextSuperTitanShowEntityID = SUPERTITAN_SHOW_ENTITY_ID_START;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = toInt(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeNonNegativeInteger(value, fallback = null) {
  const numeric = toInt(value, Number.NaN);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function addVectors(left, right) {
  return {
    x: Number(left && left.x || 0) + Number(right && right.x || 0),
    y: Number(left && left.y || 0) + Number(right && right.y || 0),
    z: Number(left && left.z || 0) + Number(right && right.z || 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: Number(left && left.x || 0) - Number(right && right.x || 0),
    y: Number(left && left.y || 0) - Number(right && right.y || 0),
    z: Number(left && left.z || 0) - Number(right && right.z || 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: Number(vector && vector.x || 0) * scalar,
    y: Number(vector && vector.y || 0) * scalar,
    z: Number(vector && vector.z || 0) * scalar,
  };
}

function crossVectors(left, right) {
  return {
    x: (Number(left && left.y || 0) * Number(right && right.z || 0)) -
      (Number(left && left.z || 0) * Number(right && right.y || 0)),
    y: (Number(left && left.z || 0) * Number(right && right.x || 0)) -
      (Number(left && left.x || 0) * Number(right && right.z || 0)),
    z: (Number(left && left.x || 0) * Number(right && right.y || 0)) -
      (Number(left && left.y || 0) * Number(right && right.x || 0)),
  };
}

function magnitude(vector) {
  return Math.sqrt(
    (Number(vector && vector.x || 0) ** 2) +
    (Number(vector && vector.y || 0) ** 2) +
    (Number(vector && vector.z || 0) ** 2),
  );
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = magnitude(vector);
  if (length <= 1e-9) {
    return {
      x: Number(fallback && fallback.x || 1),
      y: Number(fallback && fallback.y || 0),
      z: Number(fallback && fallback.z || 0),
    };
  }

  return {
    x: Number(vector.x || 0) / length,
    y: Number(vector.y || 0) / length,
    z: Number(vector.z || 0) / length,
  };
}

function buildFormationBasis(direction) {
  const forward = normalizeVector(direction, { x: 1, y: 0, z: 0 });
  const upReference = Math.abs(Number(forward.y || 0)) >= 0.95
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 1, z: 0 };
  const right = normalizeVector(
    crossVectors(forward, upReference),
    { x: 0, y: 0, z: 1 },
  );
  const up = normalizeVector(
    crossVectors(right, forward),
    upReference,
  );
  return { forward, right, up };
}

function resolvePreferredStationID(session) {
  const characterRecord = getCharacterRecord(session && session.characterID) || {};
  return Number(
    characterRecord.homeStationID ||
    characterRecord.cloneStationID ||
    session && (session.stationid || session.stationID) ||
    DEFAULT_HOME_STATION_ID,
  ) || DEFAULT_HOME_STATION_ID;
}

function createShipItemInHangar(characterID, stationID, shipType) {
  const createResult = grantItemToCharacterLocation(
    characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    shipType,
    1,
  );
  if (!createResult.success) {
    return createResult;
  }

  return {
    success: true,
    data: {
      shipItem: createResult.data && createResult.data.items
        ? createResult.data.items[0] || null
        : null,
      changes: createResult.data && createResult.data.changes
        ? createResult.data.changes
        : [],
    },
  };
}

function fitModuleTypeToShip(characterID, stationID, shipItem, moduleType) {
  const fittedItems = listFittedItems(characterID, shipItem.itemID);
  const nextFlagID = selectAutoFitFlagForType(
    shipItem,
    fittedItems,
    Number(moduleType && moduleType.typeID) || 0,
  );
  if (!nextFlagID) {
    return {
      success: false,
      errorMsg: "NO_SLOT_AVAILABLE",
    };
  }

  const probeItem = {
    itemID: -1,
    typeID: moduleType.typeID,
    groupID: moduleType.groupID,
    categoryID: moduleType.categoryID,
    flagID: nextFlagID,
    itemName: moduleType.name,
    stacksize: 1,
    singleton: 1,
  };
  const validation = validateFitForShip(
    characterID,
    shipItem,
    probeItem,
    nextFlagID,
    fittedItems,
  );
  if (!validation.success && validation.errorMsg !== "SKILL_REQUIRED") {
    return validation;
  }

  return moveItemTypeFromCharacterLocation(
    characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    shipItem.itemID,
    nextFlagID,
    moduleType.typeID,
    1,
  );
}

function computeMaxFuelUnitsForCargo(loadoutOrProfile) {
  const cargoCapacity = Math.max(
    0,
    Number(loadoutOrProfile && loadoutOrProfile.hullType && loadoutOrProfile.hullType.capacity) || 0,
  );
  const fuelVolume = Math.max(
    0,
    Number(loadoutOrProfile && loadoutOrProfile.fuelType && loadoutOrProfile.fuelType.volume) || 0,
  );
  const minimumFuelUnits = Math.max(
    1,
    Number(loadoutOrProfile && loadoutOrProfile.fuelPerActivation) ||
      Number(
        Math.max(
          Number(loadoutOrProfile && loadoutOrProfile.doomsdayFuelPerActivation) || 0,
          Number(loadoutOrProfile && loadoutOrProfile.lanceFuelPerActivation) || 0,
        ),
      ) ||
      1,
  );
  if (cargoCapacity <= 0 || fuelVolume <= 0) {
    return minimumFuelUnits;
  }

  return Math.max(
    minimumFuelUnits,
    Math.floor(cargoCapacity / fuelVolume),
  );
}

function seedSuperTitanShip(characterID, stationID, loadout) {
  const createResult = createShipItemInHangar(
    characterID,
    stationID,
    loadout.hullType,
  );
  if (!createResult.success || !createResult.data || !createResult.data.shipItem) {
    return {
      success: false,
      errorMsg: createResult.errorMsg || "SHIP_CREATE_FAILED",
    };
  }

  const shipItem = createResult.data.shipItem;
  const fuelUnits = computeMaxFuelUnitsForCargo(loadout);
  const grantResult = grantItemsToCharacterStationHangar(
    characterID,
    stationID,
    [
      {
        itemType: loadout.moduleType,
        quantity: 1,
      },
      {
        itemType: loadout.fuelType,
        quantity: fuelUnits,
      },
    ],
  );
  if (!grantResult.success) {
    return {
      success: false,
      errorMsg: grantResult.errorMsg || "GRANT_FAILED",
    };
  }

  const fitResult = fitModuleTypeToShip(
    characterID,
    stationID,
    shipItem,
    loadout.moduleType,
  );
  if (!fitResult.success) {
    return {
      success: false,
      errorMsg: fitResult.errorMsg || "FIT_FAILED",
      data: {
        shipItem,
      },
    };
  }

  const fuelMoveResult = moveItemTypeFromCharacterLocation(
    characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    loadout.fuelType.typeID,
    fuelUnits,
  );
  if (!fuelMoveResult.success) {
    return {
      success: false,
      errorMsg: fuelMoveResult.errorMsg || "MOVE_FAILED",
      data: {
        shipItem,
      },
    };
  }

  const cargoFuelStack = listContainerItems(
    characterID,
    shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
  ).find((item) => Number(item && item.typeID) === Number(loadout.fuelType.typeID));

  return {
    success: true,
    data: {
      shipItem,
      cargoFuelUnits: Number(cargoFuelStack && cargoFuelStack.quantity) || fuelUnits,
    },
  };
}

function allocateSuperTitanShowEntityID() {
  const allocated = nextSuperTitanShowEntityID;
  nextSuperTitanShowEntityID += 1;
  return allocated;
}

function allocateSyntheticRuntimeItemID(entityID, slotIndex) {
  return (Number(entityID) * 10) + Number(slotIndex || 0);
}

function buildSyntheticOnlineModuleItem(entityID, moduleType, flagID, slotIndex) {
  return {
    itemID: allocateSyntheticRuntimeItemID(entityID, slotIndex),
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

function buildSyntheticFuelCargoItem(entityID, loadout, quantity) {
  return {
    itemID: allocateSyntheticRuntimeItemID(entityID, 90),
    cargoID: allocateSyntheticRuntimeItemID(entityID, 90),
    locationID: entityID,
    ownerID: 0,
    typeID: Number(loadout && loadout.fuelType && loadout.fuelType.typeID) || 0,
    groupID: Number(loadout && loadout.fuelType && loadout.fuelType.groupID) || 0,
    categoryID: Number(loadout && loadout.fuelType && loadout.fuelType.categoryID) || 8,
    itemName: String(loadout && loadout.fuelType && loadout.fuelType.name || "Fuel"),
    quantity,
    stacksize: quantity,
    singleton: 0,
  };
}

function buildSyntheticShowTitanShipSpec(ownerSession, loadout, formationSlot, midpoint, entityID) {
  const modules = [
    buildSyntheticOnlineModuleItem(entityID, loadout.moduleType, 27, 1),
  ];
  const fuelQuantity = computeMaxFuelUnitsForCargo(loadout);
  return {
    itemID: entityID,
    typeID: loadout.hullType.typeID,
    groupID: loadout.hullType.groupID,
    categoryID: loadout.hullType.categoryID || 6,
    itemName: `${loadout.hullType.name}`,
    ownerID: Number(ownerSession && ownerSession.characterID || 0) || 0,
    pilotCharacterID: 0,
    characterID: 0,
    corporationID: Number(ownerSession && ownerSession.corporationID || 0) || 0,
    allianceID: Number(ownerSession && ownerSession.allianceID || 0) || 0,
    warFactionID: Number(ownerSession && ownerSession.warFactionID || 0) || 0,
    nativeNpc: true,
    transient: true,
    fittedItems: modules,
    nativeCargoItems: [buildSyntheticFuelCargoItem(entityID, loadout, fuelQuantity)],
    skillMap:
      ownerSession && ownerSession.characterID
        ? getCharacterSkillMap(ownerSession.characterID)
        : new Map(),
    position: formationSlot.position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: formationSlot.direction,
    targetPoint: midpoint,
    mode: "GOTO",
    speedFraction: SUPERTITAN_SHOW_APPROACH_SPEED_FRACTION,
    conditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
      incapacitated: false,
    },
    superweaponCycleOverrideMs: SUPERTITAN_SHOW_REFIRE_MS,
  };
}

function buildFleetSlots(count) {
  const normalizedCount = Math.max(1, normalizePositiveInteger(count, SUPERTITAN_SHOW_DEFAULT_COUNT));
  const columns = Math.max(1, Math.ceil(Math.sqrt(normalizedCount)));
  const rows = Math.ceil(normalizedCount / columns);
  const slots = [];

  for (let index = 0; index < normalizedCount; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const centeredColumn = column - ((columns - 1) / 2);
    const centeredRow = row - ((rows - 1) / 2);
    slots.push({
      lateral: centeredColumn,
      vertical: centeredRow,
    });
  }

  return slots;
}

function buildFleetFormation(center, facingDirection, count) {
  const basis = buildFormationBasis(facingDirection);
  const slots = buildFleetSlots(count);
  return slots.map((slot) => ({
    position: addVectors(
      center,
      addVectors(
        scaleVector(basis.right, slot.lateral * SUPERTITAN_SHOW_LATERAL_SPACING_METERS),
        scaleVector(basis.up, slot.vertical * SUPERTITAN_SHOW_ROW_SPACING_METERS),
      ),
    ),
    direction: basis.forward,
  }));
}

function resolveSceneTickIntervalMs(scene, fallback = 1000) {
  const tickIntervalMs = normalizePositiveInteger(
    scene && scene._tickIntervalMs,
    fallback,
  );
  return tickIntervalMs || fallback;
}

function pickTitanShowLoadout(random, config = {}) {
  if (typeof config.pickLoadout === "function") {
    return config.pickLoadout({
      random,
    }) || null;
  }

  return pickRandomTitanSuperweaponLoadout({
    random,
    requireFxGuid: true,
  });
}

function spawnShowFleetWave(
  scene,
  ownerSession,
  formation,
  fleetLabel,
  midpoint,
  config,
  startIndex = 0,
) {
  const spawned = [];
  const batchSize = Math.max(
    1,
    normalizePositiveInteger(
      config && config.spawnBatchSize,
      SUPERTITAN_SHOW_SPAWN_BATCH_SIZE,
    ),
  );
  const endIndex = Math.min(
    formation.length,
    Math.max(0, startIndex) + batchSize,
  );

  for (let index = Math.max(0, startIndex); index < endIndex; index += 1) {
    const loadout = pickTitanShowLoadout(config.random, config);
    if (!loadout) {
      continue;
    }

    const slot = formation[index];
    const entityID = allocateSuperTitanShowEntityID();
    const spawnResult = spaceRuntime.spawnDynamicShip(
      scene.systemID,
      {
        ...buildSyntheticShowTitanShipSpec(
          ownerSession,
          loadout,
          slot,
          midpoint,
          entityID,
        ),
        itemName: `${loadout.hullType.name} ${fleetLabel}${index + 1}`,
      },
      {
        // Giant synthetic show/test formations are especially prone to
        // same-tick AddBalls2 storms. Deferring the initial acquire lets the
        // next visibility sync group the whole wave into one fresh-acquire
        // pass instead of emitting one immediate AddBalls2 per hull.
        broadcastOptions: {
          deferUntilVisibilitySync: true,
        },
      },
    );
    if (!spawnResult.success || !spawnResult.data || !spawnResult.data.entity) {
      continue;
    }

    spawned.push({
      entity: spawnResult.data.entity,
      loadout,
      fleetLabel,
    });
  }

  return spawned;
}

function scheduleShowFleetSpawns(
  scene,
  ownerSession,
  formationA,
  formationB,
  midpoint,
  config,
) {
  const scheduler = config.scheduleFn;
  const fleetA = [];
  const fleetB = [];
  const batchSize = Math.max(
    1,
    normalizePositiveInteger(
      config.spawnBatchSize,
      SUPERTITAN_SHOW_SPAWN_BATCH_SIZE,
    ),
  );
  const waveIntervalMs = Math.max(
    1,
    normalizePositiveInteger(
      config.spawnWaveIntervalMs,
      resolveSceneTickIntervalMs(scene),
    ),
  );
  const waveCount = Math.max(
    Math.ceil(formationA.length / batchSize),
    Math.ceil(formationB.length / batchSize),
    1,
  );

  const runWave = (waveIndex) => {
    const startIndex = Math.max(0, waveIndex) * batchSize;
    fleetA.push(
      ...spawnShowFleetWave(
        scene,
        ownerSession,
        formationA,
        "A",
        midpoint,
        config,
        startIndex,
      ),
    );
    fleetB.push(
      ...spawnShowFleetWave(
        scene,
        ownerSession,
        formationB,
        "B",
        midpoint,
        config,
        startIndex,
      ),
    );
  };

  runWave(0);
  for (let waveIndex = 1; waveIndex < waveCount; waveIndex += 1) {
    schedule(
      () => runWave(waveIndex),
      waveIndex * waveIntervalMs,
      scheduler,
    );
  }

  return {
    fleetA,
    fleetB,
    waveCount,
    spawnCompletionDelayMs: Math.max(0, waveCount - 1) * waveIntervalMs,
  };
}

function schedule(callback, delayMs, scheduleFn) {
  const run =
    typeof scheduleFn === "function"
      ? scheduleFn
      : setTimeout;
  return run(callback, Math.max(0, toInt(delayMs, 0)));
}

function buildSuperTitanShowConfig(scene, options = {}) {
  const testing = options && options.superTitanTestConfig || {};
  const tickIntervalMs = resolveSceneTickIntervalMs(scene);
  return {
    random: typeof testing.random === "function" ? testing.random : Math.random,
    scheduleFn: typeof testing.scheduleFn === "function" ? testing.scheduleFn : setTimeout,
    targetDelayMs: normalizeNonNegativeInteger(
      testing.targetDelayMs,
      SUPERTITAN_SHOW_TARGET_DELAY_MS,
    ),
    refireMs: normalizePositiveInteger(testing.refireMs, SUPERTITAN_SHOW_REFIRE_MS),
    spawnBatchSize: normalizePositiveInteger(testing.spawnBatchSize, SUPERTITAN_SHOW_SPAWN_BATCH_SIZE),
    spawnWaveIntervalMs: normalizePositiveInteger(testing.spawnWaveIntervalMs, tickIntervalMs),
    pickLoadout: typeof testing.pickLoadout === "function" ? testing.pickLoadout : null,
  };
}

function handleSuperTitanCommand(session, argumentText, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      message: "Select a character before using /supertitan.",
    };
  }
  if (!session._space) {
    return {
      success: false,
      message: "You must be in space before using /supertitan.",
    };
  }

  const testing = options && options.superTitanTestConfig || {};
  const loadout = pickRandomTitanSuperweaponLoadout({
    random: typeof testing.random === "function" ? testing.random : Math.random,
    requireFxGuid: true,
  });
  if (!loadout) {
    return {
      success: false,
      message: "No titan superweapon loadouts could be resolved from local SDE data.",
    };
  }

  const stationID = resolvePreferredStationID(session);
  const seededResult = seedSuperTitanShip(
    session.characterID,
    stationID,
    loadout,
  );
  if (!seededResult.success || !seededResult.data || !seededResult.data.shipItem) {
    return {
      success: false,
      message: `Failed to seed the titan hull and superweapon: ${seededResult.errorMsg || "SEED_FAILED"}.`,
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      message: "Active ship not found for /supertitan.",
    };
  }

  const spaceBoardResult = boardPreparedShipInSpace(
    session,
    seededResult.data.shipItem,
  );
  if (!spaceBoardResult.success) {
    return {
      success: false,
      message: `Titan space swap failed: ${spaceBoardResult.errorMsg || "SPACE_SWAP_FAILED"}.`,
    };
  }

  const destroyedShipID = Number(
    spaceBoardResult &&
    spaceBoardResult.data &&
    spaceBoardResult.data.destroyResult &&
    spaceBoardResult.data.destroyResult.destroyedShipID,
  ) || 0;
  const actionText = destroyedShipID > 0
    ? `Destroyed ship ${destroyedShipID} and boarded`
    : "Boarded";

  return {
    success: true,
    message: [
      `${actionText} a new ${loadout.hullType.name} in space as ship ${seededResult.data.shipItem.itemID}.`,
      `Fitted 1x ${loadout.moduleType.name}.`,
      `Loaded ${Number(seededResult.data.cargoFuelUnits || 0).toLocaleString("en-US")} ${loadout.fuelType.name} into cargo (${Number(loadout.fuelPerActivation || 0).toLocaleString("en-US")} per activation).`,
    ].join(" "),
  };
}

function handleSuperTitanShowCommand(session, argumentText, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      message: "Select a character before using /supertitanshow.",
    };
  }
  if (!session._space) {
    return {
      success: false,
      message: "You must be in space before using /supertitanshow.",
    };
  }

  const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
  const scene = spaceRuntime.getSceneForSession(session);
  if (!anchorEntity || !scene) {
    return {
      success: false,
      message: "Current space scene was not found for /supertitanshow.",
    };
  }

  const trimmed = String(argumentText || "").trim();
  const requestedCount = trimmed
    ? normalizePositiveInteger(trimmed)
    : SUPERTITAN_SHOW_DEFAULT_COUNT;
  if (trimmed && !requestedCount) {
    return {
      success: false,
      message: "Usage: /supertitanshow [count]",
    };
  }

  const perFleetCount = requestedCount || SUPERTITAN_SHOW_DEFAULT_COUNT;
  const config = buildSuperTitanShowConfig(scene, options);
  const random = config.random;
  const basis = buildFormationBasis(anchorEntity.direction);
  const midpoint = addVectors(
    anchorEntity.position,
    scaleVector(basis.forward, SUPERTITAN_SHOW_MIDPOINT_DISTANCE_METERS),
  );
  const fleetACenter = addVectors(
    midpoint,
    scaleVector(basis.forward, -SUPERTITAN_SHOW_FLEET_OFFSET_METERS),
  );
  const fleetBCenter = addVectors(
    midpoint,
    scaleVector(basis.forward, SUPERTITAN_SHOW_FLEET_OFFSET_METERS),
  );
  const formationA = buildFleetFormation(
    fleetACenter,
    basis.forward,
    perFleetCount,
  );
  const formationB = buildFleetFormation(
    fleetBCenter,
    scaleVector(basis.forward, -1),
    perFleetCount,
  );
  const stagedShow = scheduleShowFleetSpawns(
    scene,
    session,
    formationA,
    formationB,
    midpoint,
    config,
  );

  if (
    (!Array.isArray(stagedShow.fleetA) || stagedShow.fleetA.length === 0) &&
    (!Array.isArray(stagedShow.fleetB) || stagedShow.fleetB.length === 0)
  ) {
    return {
      success: false,
      message: "SuperTitan show spawn failed.",
    };
  }

  const firstVolleyDelayMs =
    stagedShow.spawnCompletionDelayMs + config.targetDelayMs;

  schedule(() => {
    const controllerFleetA = stagedShow.fleetA
      .map((entry) => {
        const moduleTypeID = Number(
          entry &&
          entry.loadout &&
          entry.loadout.moduleType &&
          entry.loadout.moduleType.typeID,
        ) || 0;
        const profile = resolveTitanSuperweaponProfileByModuleTypeID(moduleTypeID);
        if (!entry || !entry.entity || !profile) {
          return null;
        }
        return {
          entityID: Number(entry.entity.itemID),
          profile,
          nextFamily: entry.loadout && entry.loadout.family,
        };
      })
      .filter(Boolean);
    const controllerFleetB = stagedShow.fleetB
      .map((entry) => {
        const moduleTypeID = Number(
          entry &&
          entry.loadout &&
          entry.loadout.moduleType &&
          entry.loadout.moduleType.typeID,
        ) || 0;
        const profile = resolveTitanSuperweaponProfileByModuleTypeID(moduleTypeID);
        if (!entry || !entry.entity || !profile) {
          return null;
        }
        return {
          entityID: Number(entry.entity.itemID),
          profile,
          nextFamily: entry.loadout && entry.loadout.family,
        };
      })
      .filter(Boolean);
    registerSuperTitanShowController(scene, {
      fleetA: controllerFleetA,
      fleetB: controllerFleetB,
      random,
      initialDelayMs: config.targetDelayMs,
      refireMs: config.refireMs,
    });
  }, stagedShow.spawnCompletionDelayMs, config.scheduleFn);

  return {
    success: true,
    message: [
      `Spawned ${perFleetCount} + ${perFleetCount} transient titan battle groups.`,
      "The fleets start 40 km either side of the midpoint so both formations have clean spacing.",
      `Staged across ${stagedShow.waveCount} waves so the client can acquire the fleets cleanly.`,
      `The first real volley begins after ${(firstVolleyDelayMs / 1000).toFixed(0)} seconds, then the fleets continue re-firing every ${(config.refireMs / 1000).toFixed(0)} seconds.`,
      `Each hull is fitted with one real racial superweapon, chosen as either a doomsday or a lance, with isotope cargo for repeated firings.`,
    ].join(" "),
  };
}

module.exports = {
  handleSuperTitanCommand,
  handleSuperTitanShowCommand,
};
