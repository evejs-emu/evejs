const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../runtime"));
const {
  buildNpcDefinition,
  listNpcProfiles,
} = require(path.join(__dirname, "./npcData"));
const npcService = require(path.join(__dirname, "./npcService"));
const {
  buildWeaponModuleSnapshot,
} = require(path.join(__dirname, "../combat/weaponDogma"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
const {
  getNpcCapabilityTypeID,
  isNpcChargeCompatibleWithModule,
} = require(path.join(__dirname, "./npcCapabilityResolver"));

const NPCTEST_OPERATOR_KIND = "npctest";
const NPCTEST2_OPERATOR_KIND = "npctest2";
const NPCTEST_DEFAULT_AMOUNT = 5;
const NPCTEST_CLUSTER_DISTANCE_METERS = 20_000;
const NPCTEST_SPHERE_SPACING_METERS = 3_200;
const NPCTEST_PLAYER_SPHERE_SPACING_METERS = 1_800;
const NPCTEST_MIN_PLAYER_DISTANCE_METERS = 1_500;
const NPCTEST_ENGAGEMENT_RANGE_SCALE = 0.9;
const NPCTEST_AGGRESSION_RANGE_METERS = 250_000;
const NPCTEST_LOCK_PRIME_FUTURE_MS = 60_000;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = Math.sqrt(
    (resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2)
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

function magnitude(vector) {
  const resolved = cloneVector(vector);
  return Math.sqrt(
    (resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2)
  );
}

function distance(left, right) {
  return magnitude(subtractVectors(left, right));
}

function shuffle(values) {
  const results = Array.isArray(values) ? [...values] : [];
  for (let index = results.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const nextValue = results[index];
    results[index] = results[swapIndex];
    results[swapIndex] = nextValue;
  }
  return results;
}

function sampleEntries(entries, amount) {
  const pool = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const requestedAmount = Math.max(0, toPositiveInt(amount, 0));
  if (pool.length === 0 || requestedAmount <= 0) {
    return [];
  }

  const uniqueFirstPass = shuffle(pool);
  const results = [];
  for (const entry of uniqueFirstPass) {
    if (results.length >= requestedAmount) {
      break;
    }
    results.push(entry);
  }

  while (results.length < requestedAmount) {
    results.push(pool[Math.floor(Math.random() * pool.length)]);
  }

  return results;
}

function buildWeaponSnapshotsForDefinition(definition) {
  if (!definition || !definition.profile || !definition.loadout) {
    return [];
  }

  const shipItem = {
    itemID: 0,
    typeID: toPositiveInt(definition.profile.shipTypeID, 0),
  };
  if (!shipItem.typeID) {
    return [];
  }

  const modules = Array.isArray(definition.loadout.modules)
    ? definition.loadout.modules
    : [];
  const charges = Array.isArray(definition.loadout.charges)
    ? definition.loadout.charges
    : [];
  const snapshots = [];

  for (const moduleEntry of modules) {
    const moduleTypeID = toPositiveInt(moduleEntry && moduleEntry.typeID, 0);
    const capabilityTypeID = getNpcCapabilityTypeID(moduleEntry, moduleTypeID);
    if (!capabilityTypeID) {
      continue;
    }

    const moduleItem = {
      itemID: 0,
      typeID: moduleTypeID,
      npcCapabilityTypeID: capabilityTypeID,
    };
    const matchingChargeEntry = charges.find((chargeEntry) => (
      isNpcChargeCompatibleWithModule(moduleItem, toPositiveInt(chargeEntry && chargeEntry.typeID, 0))
    )) || null;
    const chargeType = matchingChargeEntry
      ? resolveItemByTypeID(toPositiveInt(matchingChargeEntry.typeID, 0))
      : null;
    const chargeItem = chargeType
      ? {
          itemID: 0,
          typeID: chargeType.typeID,
          quantity: Math.max(1, toPositiveInt(matchingChargeEntry && matchingChargeEntry.quantityPerModule, 1)),
        }
      : null;

    const snapshot = buildWeaponModuleSnapshot({
      characterID: 0,
      shipItem,
      moduleItem,
      chargeItem,
      fittedItems: [],
      skillMap: new Map(),
      activeModuleContexts: [],
    });
    if (!snapshot) {
      continue;
    }

    const engagementRangeMeters = Math.max(
      0,
      toFiniteNumber(
        snapshot.approxRange,
        toFiniteNumber(snapshot.optimalRange, 0) + toFiniteNumber(snapshot.falloff, 0),
      ),
    );
    if (engagementRangeMeters <= 0) {
      continue;
    }

    snapshots.push({
      family: String(snapshot.family || "").trim(),
      engagementRangeMeters,
      snapshot,
    });
  }

  return snapshots;
}

function buildNpcTestCombatCatalog() {
  const definitions = listNpcProfiles()
    .map((profile) => buildNpcDefinition(profile && profile.profileID))
    .filter(Boolean)
    .filter((definition) => String(definition.profile && definition.profile.entityType || "").trim().toLowerCase() === "npc")
    .filter((definition) => definition.profile && definition.profile.capitalNpc !== true);

  const catalog = [];
  for (const definition of definitions) {
    const snapshots = buildWeaponSnapshotsForDefinition(definition);
    if (snapshots.length === 0) {
      continue;
    }

    const primarySnapshot = snapshots.reduce((bestSnapshot, nextSnapshot) => (
      !bestSnapshot || nextSnapshot.engagementRangeMeters > bestSnapshot.engagementRangeMeters
        ? nextSnapshot
        : bestSnapshot
    ), null);
    if (!primarySnapshot) {
      continue;
    }

    catalog.push({
      definition,
      profileID: String(definition.profile.profileID || "").trim(),
      label: String(definition.profile.name || definition.profile.profileID || "NPC"),
      isMissile: snapshots.some((entry) => entry.family === "missileLauncher"),
      engagementRangeMeters: Math.max(0, toFiniteNumber(primarySnapshot.engagementRangeMeters, 0)),
      primaryFamily: String(primarySnapshot.family || "").trim(),
    });
  }

  return catalog;
}

function buildNpcTestPools(catalog = []) {
  const combatEntries = Array.isArray(catalog) ? catalog.filter(Boolean) : [];
  const missileEntries = combatEntries.filter((entry) => entry.isMissile);
  const nonMissileEntries = combatEntries.filter((entry) => !entry.isMissile);
  return {
    combatEntries,
    missileEntries,
    nonMissileEntries,
  };
}

function selectNpcTestDefinitions(catalog, amount) {
  const pools = buildNpcTestPools(catalog);
  const requestedAmount = Math.max(1, toPositiveInt(amount, 1));
  if (pools.combatEntries.length === 0) {
    return [];
  }

  const guaranteedMissileCount = pools.missileEntries.length > 0
    ? Math.min(
      requestedAmount,
      Math.max(1, Math.round(requestedAmount * 0.2)),
    )
    : 0;
  const selected = [
    ...sampleEntries(pools.missileEntries, guaranteedMissileCount),
    ...sampleEntries(
      pools.combatEntries,
      Math.max(0, requestedAmount - guaranteedMissileCount),
    ),
  ];
  return shuffle(selected);
}

function buildSphereShellOffsets(shellCount, radiusMeters) {
  const offsets = [];
  const total = Math.max(1, toPositiveInt(shellCount, 1));
  const radius = Math.max(0, toFiniteNumber(radiusMeters, 0));
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < total; index += 1) {
    const y = 1 - ((index + 0.5) * 2 / total);
    const radialScale = Math.sqrt(Math.max(0, 1 - (y * y)));
    const theta = goldenAngle * index;
    offsets.push({
      x: Math.cos(theta) * radialScale * radius,
      y: y * radius,
      z: Math.sin(theta) * radialScale * radius,
    });
  }

  return offsets;
}

function buildFilledSphereOffsets(count, spacingMeters = NPCTEST_SPHERE_SPACING_METERS) {
  const requestedCount = Math.max(0, toPositiveInt(count, 0));
  if (requestedCount <= 0) {
    return [];
  }

  const spacing = Math.max(1_000, toFiniteNumber(spacingMeters, NPCTEST_SPHERE_SPACING_METERS));
  const offsets = [{ x: 0, y: 0, z: 0 }];
  let remaining = requestedCount - 1;
  let shellIndex = 1;

  while (remaining > 0) {
    const shellRadius = shellIndex * spacing;
    const shellCapacity = Math.max(
      1,
      Math.round((4 * Math.PI * (shellRadius ** 2)) / (spacing ** 2)),
    );
    const shellCount = Math.min(remaining, shellCapacity);
    offsets.push(...buildSphereShellOffsets(shellCount, shellRadius));
    remaining -= shellCount;
    shellIndex += 1;
  }

  return offsets.slice(0, requestedCount);
}

function buildShellSphereOffsets(count, spacingMeters = NPCTEST_SPHERE_SPACING_METERS) {
  const requestedCount = Math.max(0, toPositiveInt(count, 0));
  if (requestedCount <= 0) {
    return [];
  }
  if (requestedCount === 1) {
    return [{ x: 0, y: 0, z: 0 }];
  }

  const spacing = Math.max(1_000, toFiniteNumber(spacingMeters, NPCTEST_SPHERE_SPACING_METERS));
  const shellRadius = Math.max(
    spacing,
    Math.sqrt((requestedCount * (spacing ** 2)) / (4 * Math.PI)),
  );
  return buildSphereShellOffsets(requestedCount, shellRadius);
}

function resolveShipForwardVector(shipEntity) {
  const forwardFromDirection = normalizeVector(
    shipEntity && shipEntity.direction,
    { x: 0, y: 0, z: 0 },
  );
  if (magnitude(forwardFromDirection) > 0) {
    return forwardFromDirection;
  }

  return normalizeVector(
    shipEntity && shipEntity.velocity,
    { x: 1, y: 0, z: 0 },
  );
}

function clampPlayerEngagementPosition(playerPosition, desiredPosition, engagementRangeMeters) {
  const desiredOffset = subtractVectors(desiredPosition, playerPosition);
  const desiredDirection = normalizeVector(desiredOffset, { x: 1, y: 0, z: 0 });
  const desiredDistance = magnitude(desiredOffset);
  const maxDistance = Math.max(
    NPCTEST_MIN_PLAYER_DISTANCE_METERS,
    Math.min(
      desiredDistance,
      Math.max(
        NPCTEST_MIN_PLAYER_DISTANCE_METERS,
        toFiniteNumber(engagementRangeMeters, desiredDistance) * NPCTEST_ENGAGEMENT_RANGE_SCALE,
      ),
    ),
  );

  return addVectors(
    playerPosition,
    scaleVector(desiredDirection, maxDistance),
  );
}

function crossVectors(left, right) {
  return {
    x: (toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.z, 0))
      - (toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.y, 0)),
    y: (toFiniteNumber(left && left.z, 0) * toFiniteNumber(right && right.x, 0))
      - (toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.z, 0)),
    z: (toFiniteNumber(left && left.x, 0) * toFiniteNumber(right && right.y, 0))
      - (toFiniteNumber(left && left.y, 0) * toFiniteNumber(right && right.x, 0)),
  };
}

function buildForwardBasis(forward) {
  const worldUp = Math.abs(toFiniteNumber(forward && forward.y, 0)) >= 0.99
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 1, z: 0 };
  const right = normalizeVector(
    crossVectors(forward, worldUp),
    { x: 1, y: 0, z: 0 },
  );
  const up = normalizeVector(
    crossVectors(right, forward),
    { x: 0, y: 1, z: 0 },
  );
  return {
    right,
    up,
  };
}

function buildPlayerFacingSpawnPosition(playerPosition, forward, basis, offset, engagementRangeMeters) {
  const allowedDistance = Math.max(
    NPCTEST_MIN_PLAYER_DISTANCE_METERS,
    toFiniteNumber(engagementRangeMeters, NPCTEST_CLUSTER_DISTANCE_METERS) * NPCTEST_ENGAGEMENT_RANGE_SCALE,
  );
  const lateral = addVectors(
    scaleVector(basis.right, toFiniteNumber(offset && offset.x, 0)),
    scaleVector(basis.up, toFiniteNumber(offset && offset.y, 0)),
  );
  const lateralMagnitude = magnitude(lateral);
  const maxLateralMagnitude = Math.max(0, allowedDistance - 1_000);
  const clampedLateral = lateralMagnitude > maxLateralMagnitude && lateralMagnitude > 0
    ? scaleVector(lateral, maxLateralMagnitude / lateralMagnitude)
    : lateral;
  const clampedLateralMagnitude = magnitude(clampedLateral);
  const maxForwardDistanceForAllowed = Math.sqrt(
    Math.max(0, (allowedDistance ** 2) - (clampedLateralMagnitude ** 2)),
  );
  const desiredForwardDistance = Math.max(
    NPCTEST_MIN_PLAYER_DISTANCE_METERS,
    Math.min(
      NPCTEST_CLUSTER_DISTANCE_METERS + toFiniteNumber(offset && offset.z, 0),
      maxForwardDistanceForAllowed || NPCTEST_MIN_PLAYER_DISTANCE_METERS,
    ),
  );

  return addVectors(
    addVectors(
      playerPosition,
      scaleVector(forward, desiredForwardDistance),
    ),
    clampedLateral,
  );
}

function buildNpcTestSpawnPlan(shipEntity, selectedEntries, mode = "player") {
  const normalizedMode = String(mode || "player").trim().toLowerCase();
  const playerPosition = cloneVector(shipEntity && shipEntity.position);
  const forward = resolveShipForwardVector(shipEntity);
  const basis = buildForwardBasis(forward);
  const centerPosition = addVectors(
    playerPosition,
    scaleVector(forward, NPCTEST_CLUSTER_DISTANCE_METERS),
  );
  const orderedEntries = normalizedMode === "ffa"
    ? [...selectedEntries]
    : [...selectedEntries].sort((left, right) => (
      toFiniteNumber(left && left.engagementRangeMeters, 0) -
      toFiniteNumber(right && right.engagementRangeMeters, 0)
    ));
  const offsets = normalizedMode === "ffa"
    ? buildShellSphereOffsets(
      orderedEntries.length,
      NPCTEST_SPHERE_SPACING_METERS,
    )
    : buildFilledSphereOffsets(
    orderedEntries.length,
    NPCTEST_PLAYER_SPHERE_SPACING_METERS,
  );

  const entries = orderedEntries.map((entry, index) => {
    const rawPosition = addVectors(
      centerPosition,
      offsets[index] || { x: 0, y: 0, z: 0 },
    );
    const spawnPosition = normalizedMode === "ffa"
      ? rawPosition
      : buildPlayerFacingSpawnPosition(
        playerPosition,
        forward,
        basis,
        offsets[index] || { x: 0, y: 0, z: 0 },
        entry && entry.engagementRangeMeters,
      );
    const facingDirection = normalizedMode === "ffa"
      ? normalizeVector(
        subtractVectors(centerPosition, spawnPosition),
        scaleVector(forward, -1),
      )
      : normalizeVector(
        subtractVectors(playerPosition, spawnPosition),
        scaleVector(forward, -1),
      );

    return {
      ...entry,
      spawnState: {
        position: spawnPosition,
        velocity: { x: 0, y: 0, z: 0 },
        direction: facingDirection,
        targetPoint: spawnPosition,
        mode: "STOP",
        speedFraction: 0,
      },
    };
  });

  return {
    centerPosition,
    entries,
  };
}

function buildNpcTestBehaviorOverrides(mode) {
  const normalizedMode = String(mode || "player").trim().toLowerCase();
  if (normalizedMode === "ffa") {
    return {
      movementMode: "hold",
      autoAggro: true,
      autoAggroTargetClasses: ["npc"],
      targetPreference: "nearestNpc",
      aggressionRangeMeters: NPCTEST_AGGRESSION_RANGE_METERS,
      autoActivateWeapons: true,
      returnToHomeWhenIdle: false,
      useChasePropulsion: false,
      allowFriendlyNpcTargets: true,
    };
  }

  return {
    movementMode: "hold",
    autoAggro: false,
    targetPreference: "preferredTargetThenNearestPlayer",
    aggressionRangeMeters: NPCTEST_AGGRESSION_RANGE_METERS,
    autoActivateWeapons: true,
    returnToHomeWhenIdle: false,
    useChasePropulsion: false,
  };
}

function destroySpawnedNpcEntries(spawnedEntries) {
  for (const entry of Array.isArray(spawnedEntries) ? spawnedEntries : []) {
    const entityID = toPositiveInt(entry && entry.entity && entry.entity.itemID, 0);
    if (!entityID) {
      continue;
    }
    npcService.destroyNpcControllerByEntityID(entityID, {
      removeContents: true,
    });
  }
}

function buildNpcPseudoSession(entity) {
  return {
    characterID: 0,
    corporationID: toPositiveInt(entity && entity.corporationID, 0),
    allianceID: toPositiveInt(entity && entity.allianceID, 0),
    _space: {
      systemID: toPositiveInt(entity && entity.systemID, 0),
      shipID: toPositiveInt(entity && entity.itemID, 0),
    },
  };
}

function resolveNearestSpawnedOpponent(spawnedEntries, sourceEntry) {
  const sourceEntityID = toPositiveInt(sourceEntry && sourceEntry.entity && sourceEntry.entity.itemID, 0);
  const sourcePosition = sourceEntry && sourceEntry.entity && sourceEntry.entity.position;
  if (!sourceEntityID || !sourcePosition) {
    return null;
  }

  let bestEntry = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidateEntry of Array.isArray(spawnedEntries) ? spawnedEntries : []) {
    const candidateEntityID = toPositiveInt(candidateEntry && candidateEntry.entity && candidateEntry.entity.itemID, 0);
    if (!candidateEntityID || candidateEntityID === sourceEntityID) {
      continue;
    }
    const candidatePosition = candidateEntry && candidateEntry.entity && candidateEntry.entity.position;
    const candidateDistance = distance(sourcePosition, candidatePosition);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestEntry = candidateEntry;
    }
  }

  return bestEntry;
}

function primeNpcDuelChaos(scene, spawnedEntries) {
  const now = scene.getCurrentSimTimeMs();
  const primeNow = now + NPCTEST_LOCK_PRIME_FUTURE_MS;
  const primedPairs = [];

  for (const sourceEntry of Array.isArray(spawnedEntries) ? spawnedEntries : []) {
    const sourceEntity = sourceEntry && sourceEntry.entity;
    const sourceEntityID = toPositiveInt(sourceEntity && sourceEntity.itemID, 0);
    if (!sourceEntityID || !sourceEntity) {
      continue;
    }

    const targetEntry = resolveNearestSpawnedOpponent(spawnedEntries, sourceEntry);
    const targetEntityID = toPositiveInt(targetEntry && targetEntry.entity && targetEntry.entity.itemID, 0);
    if (!targetEntityID) {
      continue;
    }

    const controller = npcService.getControllerByEntityID(sourceEntityID);
    if (controller) {
      controller.preferredTargetID = targetEntityID;
      controller.currentTargetID = targetEntityID;
      controller.nextThinkAtMs = 0;
    }

    scene.addTarget(buildNpcPseudoSession(sourceEntity), targetEntityID);
    primedPairs.push({
      sourceEntityID,
      targetEntityID,
    });
  }

  for (const sourceEntry of Array.isArray(spawnedEntries) ? spawnedEntries : []) {
    const entity = sourceEntry && sourceEntry.entity;
    if (!entity) {
      continue;
    }
    scene.validateEntityTargetLocks(entity, primeNow);
  }

  npcService.tickScene(scene, primeNow);
  return {
    primedPairs,
    primeNow,
  };
}

function clearNpcTestControllersInSystem(systemID, operatorKind) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  const normalizedOperatorKind = String(operatorKind || "").trim();
  if (!normalizedSystemID || !normalizedOperatorKind) {
    return 0;
  }

  const existingControllers = npcService.getNpcOperatorSummary().filter((controller) => (
    toPositiveInt(controller && controller.systemID, 0) === normalizedSystemID &&
    String(controller && controller.operatorKind || "").trim() === normalizedOperatorKind
  ));
  let removedCount = 0;

  for (const controller of existingControllers) {
    const destroyResult = npcService.destroyNpcControllerByEntityID(
      toPositiveInt(controller && controller.entityID, 0),
      {
        removeContents: true,
      },
    );
    if (destroyResult && destroyResult.success) {
      removedCount += 1;
    }
  }

  return removedCount;
}

function spawnNpcTestForSession(session, options = {}) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const systemID = toPositiveInt(session._space.systemID, 0);
  const shipID = toPositiveInt(session._space.shipID, 0);
  if (!systemID || !shipID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const scene = spaceRuntime.ensureScene(systemID);
  const shipEntity = spaceRuntime.getEntity(session, shipID);
  if (!scene || !shipEntity) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const normalizedMode = String(options.mode || "player").trim().toLowerCase();
  const operatorKind = normalizedMode === "ffa"
    ? NPCTEST2_OPERATOR_KIND
    : NPCTEST_OPERATOR_KIND;
  const amount = Math.max(
    1,
    toPositiveInt(options.amount, NPCTEST_DEFAULT_AMOUNT),
  );
  const catalog = buildNpcTestCombatCatalog();
  if (catalog.length === 0) {
    return {
      success: false,
      errorMsg: "NPC_TEST_POOL_EMPTY",
    };
  }

  const selectedEntries = selectNpcTestDefinitions(catalog, amount);
  const plan = buildNpcTestSpawnPlan(shipEntity, selectedEntries, normalizedMode);
  const clearedCount = clearNpcTestControllersInSystem(systemID, operatorKind);
  const spawnedEntries = [];
  const behaviorOverrides = buildNpcTestBehaviorOverrides(normalizedMode);

  for (const plannedEntry of plan.entries) {
    const spawnResult = npcService.spawnNpcBatchInSystem(systemID, {
      profileQuery: plannedEntry.profileID,
      amount: 1,
      preferPools: false,
      transient: true,
      broadcast: false,
      skipInitialBehaviorTick: true,
      operatorKind,
      preferredTargetID: normalizedMode === "ffa" ? 0 : shipID,
      behaviorOverrides,
      anchorDescriptor: {
        kind: "coordinates",
        name: normalizedMode === "ffa" ? "NPC Test Duel Sphere" : "NPC Test Aggro Sphere",
        position: cloneVector(plannedEntry.spawnState.position),
        direction: cloneVector(plannedEntry.spawnState.direction, { x: 1, y: 0, z: 0 }),
      },
      spawnStateOverride: plannedEntry.spawnState,
    });
    if (
      !spawnResult.success ||
      !spawnResult.data ||
      !Array.isArray(spawnResult.data.spawned) ||
      spawnResult.data.spawned.length === 0
    ) {
      destroySpawnedNpcEntries(spawnedEntries);
      return {
        success: false,
        errorMsg: spawnResult.errorMsg || "NPC_TEST_SPAWN_FAILED",
        suggestions: spawnResult.suggestions || [],
      };
    }

    spawnedEntries.push({
      ...spawnResult.data.spawned[0],
      plannedEntry,
    });
  }

  scene.broadcastAddBalls(
    spawnedEntries
      .map((entry) => entry && entry.entity)
      .filter(Boolean),
    null,
    {
      freshAcquire: true,
      minimumLeadFromCurrentHistory: 2,
    },
  );

  const wakeAtMs = scene.getCurrentSimTimeMs();
  for (const spawnedEntry of spawnedEntries) {
    const entityID = toPositiveInt(spawnedEntry && spawnedEntry.entity && spawnedEntry.entity.itemID, 0);
    if (!entityID) {
      continue;
    }
    npcService.wakeNpcController(entityID, wakeAtMs);
  }

  let duelPrime = null;
  if (normalizedMode === "ffa") {
    duelPrime = primeNpcDuelChaos(scene, spawnedEntries);
  } else {
    npcService.tickScene(scene, scene.getCurrentSimTimeMs());
  }

  return {
    success: true,
    data: {
      mode: normalizedMode,
      operatorKind,
      requestedAmount: amount,
      spawnedAmount: spawnedEntries.length,
      clearedCount,
      centerPosition: plan.centerPosition,
      combatProfileCount: catalog.length,
      missileProfileCount: catalog.filter((entry) => entry.isMissile).length,
      missileSpawnCount: spawnedEntries.filter((entry) => entry && entry.plannedEntry && entry.plannedEntry.isMissile).length,
      duelPrime,
      spawned: spawnedEntries,
    },
  };
}

module.exports = {
  NPCTEST_OPERATOR_KIND,
  NPCTEST2_OPERATOR_KIND,
  NPCTEST_DEFAULT_AMOUNT,
  spawnNpcTestForSession,
  __testing: {
    buildNpcTestCombatCatalog,
    buildNpcTestPools,
    selectNpcTestDefinitions,
    buildFilledSphereOffsets,
    buildShellSphereOffsets,
    buildNpcTestSpawnPlan,
    resolveNearestSpawnedOpponent,
  },
};
