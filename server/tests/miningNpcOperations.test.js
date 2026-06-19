const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const {
  appendNpcMiningCargo,
  clearNpcMiningCargo,
  getNpcOreCargoSummary,
  _testing,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningNpcOperations",
));
const config = require(path.join(repoRoot, "server/src/config"));
const npcService = require(path.join(
  repoRoot,
  "server/src/space/npc",
));
const {
  tickControllersByEntityID,
} = require(path.join(
  repoRoot,
  "server/src/space/npc/npcBehaviorLoop",
));
const {
  clearControllers,
  registerController,
} = require(path.join(
  repoRoot,
  "server/src/space/npc/npcRegistry",
));
const worldData = require(path.join(
  repoRoot,
  "server/src/space/worldData",
));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const miningRuntime = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntime",
));
const {
  clearPersistedSystemState,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntimeState",
));
const {
  updateCharacterRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const database = require(path.join(repoRoot, "server/src/newDatabase"));

test.afterEach(() => {
  clearControllers();
});

function pickCharacterID() {
  const result = database.read("characters", "/");
  const characters = result && result.success && result.data ? result.data : {};
  const firstKey = Object.keys(characters)[0];
  assert.ok(firstKey, "expected at least one character record");
  return Number(firstKey);
}

function flattenDestinyUpdates(notifications = []) {
  const updates = [];
  for (const notification of notifications) {
    if (
      !notification ||
      notification.name !== "DoDestinyUpdate" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }

    const payloadList = notification.payload[0];
    const items =
      payloadList &&
      payloadList.type === "list" &&
      Array.isArray(payloadList.items)
        ? payloadList.items
        : [];
    for (const entry of items) {
      const payload = Array.isArray(entry) ? entry[1] : null;
      if (!Array.isArray(payload) || typeof payload[0] !== "string") {
        continue;
      }
      updates.push({
        stamp: Array.isArray(entry) ? entry[0] : 0,
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
  }
  return updates;
}

function distance(left = {}, right = {}) {
  const dx = Number(left.x || 0) - Number(right.x || 0);
  const dy = Number(left.y || 0) - Number(right.y || 0);
  const dz = Number(left.z || 0) - Number(right.z || 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function advanceSceneUntilSimTime(scene, targetSimTimeMs, extraMs = 0) {
  const desiredSimTimeMs =
    Math.max(0, Number(targetSimTimeMs) || 0) + Math.max(0, Number(extraMs) || 0);
  let previousSimTimeMs = scene.getCurrentSimTimeMs();
  let iterations = 0;
  while (scene.getCurrentSimTimeMs() < desiredSimTimeMs) {
    const remainingMs = Math.max(1, desiredSimTimeMs - scene.getCurrentSimTimeMs());
    const baseWallclock = Number(scene.lastWallclockTickAt) || scene.getCurrentWallclockMs();
    scene.tick(baseWallclock + Math.max(remainingMs, 50));
    const currentSimTimeMs = scene.getCurrentSimTimeMs();
    assert.ok(currentSimTimeMs > previousSimTimeMs, "expected scene sim time to advance");
    previousSimTimeMs = currentSimTimeMs;
    iterations += 1;
    assert.ok(iterations <= 30, "expected scene to reach the requested sim time promptly");
  }
}

test("transient mining cargo ignores module charges and clears only hauled ore", () => {
  const entity = {
    transient: true,
    itemID: 980000999001,
    ownerID: 140000002,
    nativeCargoItems: [{
      itemID: 980200000001,
      moduleID: 980100000001,
      typeID: 11101,
      quantity: 1,
      stacksize: 1,
      volume: 0.1,
      itemName: "Existing Charge",
    }],
  };

  appendNpcMiningCargo(entity, 34, 500);
  appendNpcMiningCargo(entity, 35, 25);

  const summary = getNpcOreCargoSummary(entity);
  assert.equal(summary.stackCount, 2);
  assert.equal(summary.quantity, 525);

  const clearedVolume = clearNpcMiningCargo(entity);
  assert.ok(clearedVolume > 0, "expected mined ore volume to be cleared");
  assert.equal(entity.nativeCargoItems.length, 1, "expected module charge to remain");
  assert.equal(entity.nativeCargoItems[0].moduleID, 980100000001);
});

test("response planning selects the hostile response table for hostile standings", (t) => {
  _testing.clearState();
  const characterID = pickCharacterID();
  const originalRecord = getCharacterRecord(characterID);
  const originalFriendlyCount = config.miningNpcFriendlyResponseCount;
  const originalNeutralCount = config.miningNpcNeutralResponseCount;
  const originalHostileCount = config.miningNpcHostileResponseCount;
  const originalFriendlyProfile = config.miningNpcFriendlyResponseProfileOrPool;
  const originalNeutralProfile = config.miningNpcNeutralResponseProfileOrPool;
  const originalHostileProfile = config.miningNpcHostileResponseProfileOrPool;

  t.after(() => {
    updateCharacterRecord(characterID, () => originalRecord);
    config.miningNpcFriendlyResponseCount = originalFriendlyCount;
    config.miningNpcNeutralResponseCount = originalNeutralCount;
    config.miningNpcHostileResponseCount = originalHostileCount;
    config.miningNpcFriendlyResponseProfileOrPool = originalFriendlyProfile;
    config.miningNpcNeutralResponseProfileOrPool = originalNeutralProfile;
    config.miningNpcHostileResponseProfileOrPool = originalHostileProfile;
    _testing.clearState();
  });

  config.miningNpcFriendlyResponseProfileOrPool = "";
  config.miningNpcFriendlyResponseCount = 0;
  config.miningNpcNeutralResponseProfileOrPool = "neutral_response_pool";
  config.miningNpcNeutralResponseCount = 2;
  config.miningNpcHostileResponseProfileOrPool = "hostile_response_pool";
  config.miningNpcHostileResponseCount = 5;

  updateCharacterRecord(characterID, (record) => ({
    ...record,
    standingData: {
      char: [
        { fromID: characterID, toID: 1000129, standing: -9 },
      ],
      corp: [],
      npc: [],
    },
  }));

  const minerEntity = {
    itemID: 980300000001,
    kind: "ship",
    corporationID: 1000129,
    ownerID: 1000129,
    hostileResponseThreshold: 11,
    friendlyResponseThreshold: 11,
  };
  const scene = {
    getEntityByID(entityID) {
      return Number(entityID) === Number(minerEntity.itemID) ? minerEntity : null;
    },
  };
  const fleetRecord = _testing.createMiningFleetRecord({
    systemID: 30000142,
    minerEntityIDs: [minerEntity.itemID],
  });
  const responsePlan = _testing.resolveResponsePlan(
    scene,
    fleetRecord,
    {
      kind: "ship",
      itemID: 980300000999,
      session: {
        characterID,
      },
    },
  );

  assert.equal(responsePlan.profileQuery, "hostile_response_pool");
  assert.equal(responsePlan.amount, 5);
  assert.equal(responsePlan.standingProfile.standingClass, "hostile");
});

test("security-band mining queries resolve to authored fleet and hauler groups", () => {
  const systems = worldData.getSolarSystems();
  const highsecSystem = systems.find((entry) => Number(entry && entry.security) >= 0.45);
  const lowsecSystem = systems.find((entry) => Number(entry && entry.security) >= 0 && Number(entry && entry.security) < 0.45);
  assert.ok(highsecSystem, "expected a high-security system");
  assert.ok(lowsecSystem, "expected a low-security system");
  const originalFleetQuery = config.miningNpcFleetProfileOrPool;
  const originalHaulerQuery = config.miningNpcHaulerProfileOrPool;

  config.miningNpcFleetProfileOrPool = "";
  config.miningNpcHaulerProfileOrPool = "";

  try {
    assert.equal(
      _testing.resolveMiningFleetQuery(null, "", highsecSystem.solarSystemID),
      "npc_mining_ops_highsec",
    );
    assert.equal(
      _testing.resolveMiningFleetQuery(null, "", lowsecSystem.solarSystemID),
      "npc_mining_ops_lowsec",
    );
    assert.equal(
      _testing.resolveMiningHaulerQuery(null, "", highsecSystem.solarSystemID),
      "npc_mining_hauler_highsec",
    );
    assert.equal(
      _testing.resolveMiningHaulerQuery(null, "", lowsecSystem.solarSystemID),
      "npc_mining_hauler_lowsec",
    );
  } finally {
    config.miningNpcFleetProfileOrPool = originalFleetQuery;
    config.miningNpcHaulerProfileOrPool = originalHaulerQuery;
  }
});

test("hauler cadence waits for the configured eligibility window before triggering", () => {
  const fleetRecord = _testing.createMiningFleetRecord({
    systemID: 30000001,
    createdAtMs: 1_000,
    minerEntityIDs: [9000001001],
    haulerEntityIDs: [9000001002],
    haulerNextArrivalAtMs: 11_000,
  });
  const minerEntity = {
    itemID: 9000001001,
    typeID: 32880,
    nativeCargoItems: [
      {
        itemID: 9000001101,
        moduleID: 0,
        typeID: 34,
        quantity: 450000,
        stacksize: 450000,
        volume: 0.01,
      },
    ],
  };
  const haulerEntity = {
    itemID: 9000001002,
    typeID: 1944,
    nativeCargoItems: [],
  };
  const entityMap = new Map([
    [minerEntity.itemID, minerEntity],
    [haulerEntity.itemID, haulerEntity],
  ]);
  const scene = {
    getEntityByID(entityID) {
      return entityMap.get(Number(entityID)) || null;
    },
  };

  assert.equal(
    _testing.shouldTriggerHauling(scene, fleetRecord, false, 10_000),
    false,
  );
  assert.equal(
    _testing.shouldTriggerHauling(scene, fleetRecord, false, 12_000),
    true,
  );
});

test("authored mining fleet groups spawn diamond miners through the native NPC path", () => {
  const candidateSystem = worldData.getSolarSystems()
    .find((system) => worldData.getAsteroidBeltsForSystem(system.solarSystemID).length > 0);
  assert.ok(candidateSystem, "expected a system with asteroid belts");
  const belt = worldData.getAsteroidBeltsForSystem(candidateSystem.solarSystemID)[0];
  assert.ok(belt && belt.position, "expected a belt anchor");

  const spawnResult = npcService.spawnNpcGroupInSystem(candidateSystem.solarSystemID, {
    spawnGroupQuery: "npc_mining_ops_highsec",
    transient: true,
    broadcast: false,
    skipInitialBehaviorTick: true,
    anchorDescriptor: {
      kind: "coordinates",
      position: belt.position,
      direction: { x: 1, y: 0, z: 0 },
      name: "Mining NPC Test Anchor",
    },
  });

  assert.equal(spawnResult.success, true, spawnResult.errorMsg || "expected mining group to spawn");
  assert.ok(spawnResult.data);
  assert.equal(spawnResult.data.selectionKind, "group");
  assert.equal(spawnResult.data.selectionID, "npc_mining_ops_highsec");
  assert.equal(spawnResult.data.spawned.length, 5);

  const profileIDs = spawnResult.data.spawned
    .map((entry) => entry && entry.definition && entry.definition.profile && entry.definition.profile.profileID)
    .filter(Boolean);
  assert.ok(profileIDs.includes("ore_mining_venture"));
  assert.ok(profileIDs.includes("ore_mining_retriever"));

  const slimNames = spawnResult.data.spawned
    .map((entry) => entry && entry.entity && entry.entity.slimName)
    .filter(Boolean);
  assert.ok(slimNames.some((name) => String(name).startsWith("\u2666")));

  const retrieverEntry = spawnResult.data.spawned.find(
    (entry) => entry && entry.definition && entry.definition.profile && entry.definition.profile.profileID === "ore_mining_retriever",
  );
  assert.ok(retrieverEntry, "expected a retriever in the authored mining group");
  const retrieverModules = Array.isArray(retrieverEntry.modules) ? retrieverEntry.modules : [];
  assert.ok(
    retrieverModules.some((moduleRecord) => Number(moduleRecord && moduleRecord.typeID) === 17482),
    "expected retriever to fit strip miners",
  );

  for (const entry of spawnResult.data.spawned) {
    const entityID = Number(entry && entry.entity && entry.entity.itemID) || 0;
    if (entityID > 0) {
      npcService.destroyNpcControllerByEntityID(entityID, {
        removeContents: true,
      });
    }
  }
});

test("manual orbit orders against asteroid targets keep mining NPCs moving instead of forcing stop", () => {
  const systemID = 30000145;
  const minerEntity = {
    itemID: 980300001001,
    kind: "ship",
    systemID,
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: 80,
    mode: "STOP",
    speedFraction: 1,
    targetEntityID: 0,
    orbitDistance: 0,
    followRange: 0,
    activeModuleEffects: new Map(),
  };
  const asteroidEntity = {
    itemID: 5005121184779,
    kind: "asteroid",
    position: { x: 2_500, y: 0, z: 0 },
    radius: 120,
  };
  const lockedTargetsByEntityID = new Map([
    [minerEntity.itemID, []],
  ]);
  const scene = {
    systemID,
    dynamicEntities: new Map([
      [minerEntity.itemID, minerEntity],
    ]),
    stopCalls: [],
    orbitCalls: [],
    addTargetCalls: [],
    getEntityByID(entityID) {
      if (Number(entityID) === Number(minerEntity.itemID)) {
        return minerEntity;
      }
      if (Number(entityID) === Number(asteroidEntity.itemID)) {
        return asteroidEntity;
      }
      return null;
    },
    getCurrentSimTimeMs() {
      return 1_000;
    },
    stop(session) {
      this.stopCalls.push(session);
      minerEntity.mode = "STOP";
      minerEntity.targetEntityID = 0;
      return true;
    },
    orbit(session, targetEntityID, orbitDistanceMeters) {
      this.orbitCalls.push({
        session,
        targetEntityID: Number(targetEntityID),
        orbitDistanceMeters: Number(orbitDistanceMeters),
      });
      minerEntity.mode = "ORBIT";
      minerEntity.targetEntityID = Number(targetEntityID);
      minerEntity.orbitDistance = Number(orbitDistanceMeters);
      return true;
    },
    followBall() {
      throw new Error("expected orbit order for in-range asteroid target");
    },
    validateEntityTargetLocks() {},
    getTargetsForEntity(entity) {
      return [...(lockedTargetsByEntityID.get(Number(entity && entity.itemID)) || [])];
    },
    getSortedPendingTargetLocks() {
      return [];
    },
    addTarget(session, targetEntityID) {
      const currentTargets = [
        ...(lockedTargetsByEntityID.get(Number(session && session._space && session._space.shipID)) || []),
      ];
      if (!currentTargets.includes(Number(targetEntityID))) {
        currentTargets.push(Number(targetEntityID));
      }
      lockedTargetsByEntityID.set(
        Number(session && session._space && session._space.shipID),
        currentTargets,
      );
      this.addTargetCalls.push(Number(targetEntityID));
      return {
        success: true,
      };
    },
    clearTargets(session) {
      lockedTargetsByEntityID.set(
        Number(session && session._space && session._space.shipID),
        [],
      );
    },
    deactivateGenericModule() {},
  };

  registerController({
    entityID: minerEntity.itemID,
    systemID,
    runtimeKind: "nativeCombat",
    nextThinkAtMs: 0,
    behaviorProfile: {
      autoAggro: false,
      autoActivateWeapons: false,
      movementMode: "orbit",
      orbitDistanceMeters: 1_000,
      followRangeMeters: 1_000,
      thinkIntervalMs: 250,
      returnToHomeWhenIdle: false,
      idleAnchorOrbit: false,
      useChasePropulsion: false,
    },
  });
  npcService.issueManualOrder(minerEntity.itemID, {
    type: "orbit",
    targetID: asteroidEntity.itemID,
    movementMode: "orbit",
    orbitDistanceMeters: 1_000,
    allowWeapons: false,
    keepLock: true,
  });

  tickControllersByEntityID(scene, [minerEntity.itemID], 1_000);

  assert.equal(scene.stopCalls.length, 0);
  assert.equal(scene.orbitCalls.length, 1);
  assert.equal(scene.orbitCalls[0].targetEntityID, asteroidEntity.itemID);
  assert.equal(scene.orbitCalls[0].orbitDistanceMeters, 1_000);
  assert.deepEqual(
    lockedTargetsByEntityID.get(minerEntity.itemID),
    [asteroidEntity.itemID],
  );
});

test("passive mining fleet overrides clear stale combat preferences from miner controllers", () => {
  const entityID = 980300001099;
  registerController({
    entityID,
    systemID: 30000145,
    runtimeKind: "nativeCombat",
    nextThinkAtMs: 0,
    preferredTargetID: 991000147,
    currentTargetID: 991000147,
    lastAggressorID: 991000147,
    manualOrder: {
      type: "attack",
      targetID: 991000147,
      allowWeapons: true,
      keepLock: true,
    },
  });

  _testing.applyPassiveMiningFleetOverrides(entityID, {
    movementMode: "orbit",
    orbitDistanceMeters: 1_200,
    followRangeMeters: 800,
    issueStopOrder: false,
    clearCombatPreference: true,
  });

  const controller = npcService.getControllerByEntityID(entityID);
  assert.ok(controller, "expected controller to remain registered");
  assert.equal(controller.preferredTargetID, 0);
  assert.equal(controller.currentTargetID, 0);
  assert.equal(controller.lastAggressorID, 0);
  assert.equal(controller.manualOrder, null);
  assert.equal(controller.nextThinkAtMs, Number.MAX_SAFE_INTEGER);
});

test("mining approach movement uses direct scene follow/orbit commands without waking combat AI", () => {
  const entity = {
    itemID: 980300001201,
    mode: "STOP",
    targetEntityID: 0,
    followRange: 0,
    orbitDistance: 0,
    position: { x: 0, y: 0, z: 0 },
    radius: 80,
  };
  const asteroid = {
    itemID: 5005121184788,
    kind: "asteroid",
    position: { x: 20_000, y: 0, z: 0 },
    radius: 150,
  };
  const scene = {
    followCalls: [],
    orbitCalls: [],
    followShipEntity(entityArg, targetID, range) {
      this.followCalls.push({
        entityID: Number(entityArg && entityArg.itemID),
        targetID: Number(targetID),
        range: Number(range),
      });
      entity.mode = "FOLLOW";
      entity.targetEntityID = Number(targetID);
      entity.followRange = Number(range);
      return true;
    },
    orbitShipEntity(entityArg, targetID, range) {
      this.orbitCalls.push({
        entityID: Number(entityArg && entityArg.itemID),
        targetID: Number(targetID),
        range: Number(range),
      });
      entity.mode = "ORBIT";
      entity.targetEntityID = Number(targetID);
      entity.orbitDistance = Number(range);
      return true;
    },
  };

  const followResult = _testing.syncMiningApproachOrder(scene, entity, asteroid, 1_000);
  assert.equal(followResult, true);
  assert.equal(scene.followCalls.length, 1);
  assert.equal(scene.orbitCalls.length, 0);

  entity.mode = "FOLLOW";
  entity.targetEntityID = asteroid.itemID;
  entity.followRange = 1_000;
  entity.position = { x: 18_820, y: 0, z: 0 };

  const orbitResult = _testing.syncMiningApproachOrder(scene, entity, asteroid, 1_000);
  assert.equal(orbitResult, true);
  assert.equal(scene.followCalls.length, 1);
  assert.equal(scene.orbitCalls.length, 1);
  assert.equal(scene.orbitCalls[0].targetID, asteroid.itemID);
  assert.equal(scene.orbitCalls[0].range, 1_000);
});

test("fleet target selection prefers an unclaimed nearby asteroid over a claimed one", () => {
  _testing.clearState();
  try {
    const systemID = 30000145;
    const minerEntity = {
      itemID: 980300001251,
      kind: "ship",
      position: { x: 100_000, y: 0, z: 0 },
      radius: 80,
      mode: "STOP",
    };
    const claimedAsteroid = {
      itemID: 5005121184801,
      kind: "asteroid",
      position: { x: 100_100, y: 0, z: 0 },
      radius: 120,
    };
    const unclaimedAsteroid = {
      itemID: 5005121184802,
      kind: "asteroid",
      position: { x: 100_300, y: 0, z: 0 },
      radius: 120,
    };
    const entityMap = new Map([
      [minerEntity.itemID, minerEntity],
      [claimedAsteroid.itemID, claimedAsteroid],
      [unclaimedAsteroid.itemID, unclaimedAsteroid],
    ]);
    const scene = {
      systemID,
      staticEntities: [claimedAsteroid, unclaimedAsteroid],
      _miningRuntimeState: {
        byEntityID: new Map([
          [claimedAsteroid.itemID, {
            entityID: claimedAsteroid.itemID,
            remainingQuantity: 10_000,
            yieldTypeID: 34,
          }],
          [unclaimedAsteroid.itemID, {
            entityID: unclaimedAsteroid.itemID,
            remainingQuantity: 10_000,
            yieldTypeID: 34,
          }],
        ]),
      },
      getEntityByID(entityID) {
        return entityMap.get(Number(entityID)) || null;
      },
    };

    const currentFleet = _testing.createMiningFleetRecord({
      source: "test",
      systemID,
      targetShipID: 0,
      minerEntityIDs: [minerEntity.itemID],
      haulerEntityIDs: [],
      originAnchor: {
        position: { x: 0, y: 0, z: 0 },
      },
    });
    _testing.createMiningFleetRecord({
      source: "test",
      systemID,
      targetShipID: 0,
      minerEntityIDs: [],
      haulerEntityIDs: [],
      activeAsteroidID: claimedAsteroid.itemID,
      originAnchor: {
        position: { x: 0, y: 0, z: 0 },
      },
    });

    const targetEntity = _testing.chooseFleetMineableTarget(scene, currentFleet);
    assert.ok(targetEntity, "expected a mineable target");
    assert.equal(
      Number(targetEntity.itemID),
      unclaimedAsteroid.itemID,
      "expected fleets to avoid piling onto a claimed asteroid when a comparable unclaimed rock is available",
    );
  } finally {
    _testing.clearState();
  }
});

test("miner target selection shares a nearby claimed asteroid before taking a far unclaimed one", () => {
  _testing.clearState();
  try {
    const systemID = 30000145;
    const minerEntity = {
      itemID: 980300001252,
      kind: "ship",
      position: { x: 100_000, y: 0, z: 0 },
      radius: 80,
      mode: "STOP",
    };
    const nearbyClaimedAsteroid = {
      itemID: 5005121184803,
      kind: "asteroid",
      position: { x: 100_400, y: 0, z: 0 },
      radius: 120,
    };
    const farUnclaimedAsteroid = {
      itemID: 5005121184804,
      kind: "asteroid",
      position: { x: 135_000, y: 0, z: 0 },
      radius: 120,
    };
    const entityMap = new Map([
      [minerEntity.itemID, minerEntity],
      [nearbyClaimedAsteroid.itemID, nearbyClaimedAsteroid],
      [farUnclaimedAsteroid.itemID, farUnclaimedAsteroid],
    ]);
    const scene = {
      systemID,
      staticEntities: [nearbyClaimedAsteroid, farUnclaimedAsteroid],
      _miningRuntimeState: {
        byEntityID: new Map([
          [nearbyClaimedAsteroid.itemID, {
            entityID: nearbyClaimedAsteroid.itemID,
            remainingQuantity: 10_000,
            yieldTypeID: 34,
          }],
          [farUnclaimedAsteroid.itemID, {
            entityID: farUnclaimedAsteroid.itemID,
            remainingQuantity: 10_000,
            yieldTypeID: 34,
          }],
        ]),
      },
      getEntityByID(entityID) {
        return entityMap.get(Number(entityID)) || null;
      },
      getEntityTargetingStats() {
        return {
          maxTargetRange: 20_000,
        };
      },
    };

    const fleetRecord = _testing.createMiningFleetRecord({
      source: "test",
      systemID,
      targetShipID: 0,
      minerEntityIDs: [minerEntity.itemID],
      haulerEntityIDs: [],
      originAnchor: {
        position: { x: 0, y: 0, z: 0 },
      },
    });
    const claimCounts = new Map([
      [nearbyClaimedAsteroid.itemID, 1],
    ]);

    const chosenTarget = _testing.chooseMineableTargetForMiner(
      scene,
      fleetRecord,
      minerEntity,
      [
        {
          entity: nearbyClaimedAsteroid,
          state: scene._miningRuntimeState.byEntityID.get(nearbyClaimedAsteroid.itemID),
        },
        {
          entity: farUnclaimedAsteroid,
          state: scene._miningRuntimeState.byEntityID.get(farUnclaimedAsteroid.itemID),
        },
      ],
      claimCounts,
    );
    assert.ok(chosenTarget, "expected a mineable target");
    assert.equal(
      Number(chosenTarget.itemID),
      nearbyClaimedAsteroid.itemID,
      "expected miners to share a nearby workable asteroid before marching to a far unclaimed rock",
    );
  } finally {
    _testing.clearState();
  }
});

test("miner target selection ignores incompatible ice targets for ore mining hulls", () => {
  _testing.clearState();
  try {
    const systemID = 30000145;
    const minerEntity = {
      itemID: 980300001253,
      kind: "ship",
      position: { x: 100_000, y: 0, z: 0 },
      radius: 80,
      mode: "STOP",
    };
    const iceTarget = {
      itemID: 5005121184805,
      kind: "iceChunk",
      position: { x: 100_100, y: 0, z: 0 },
      radius: 120,
    };
    const oreTarget = {
      itemID: 5005121184806,
      kind: "asteroid",
      position: { x: 100_400, y: 0, z: 0 },
      radius: 120,
    };
    const fleetRecord = _testing.createMiningFleetRecord({
      source: "test",
      systemID,
      targetShipID: 0,
      minerEntityIDs: [minerEntity.itemID],
      haulerEntityIDs: [],
      originAnchor: {
        position: { x: 100_000, y: 0, z: 0 },
      },
    });
    const chosenTarget = _testing.chooseMineableTargetForMiner(
      {
        systemID,
        getEntityTargetingStats() {
          return {
            maxTargetRange: 20_000,
          };
        },
      },
      fleetRecord,
      minerEntity,
      [
        {
          entity: iceTarget,
          state: {
            entityID: iceTarget.itemID,
            remainingQuantity: 10_000,
            yieldTypeID: 16262,
            yieldKind: "ice",
          },
        },
        {
          entity: oreTarget,
          state: {
            entityID: oreTarget.itemID,
            remainingQuantity: 10_000,
            yieldTypeID: 34,
            yieldKind: "ore",
          },
        },
      ],
      new Map(),
      {
        family: "ore",
      },
      {
        isMiningSnapshotCompatibleWithState(snapshot, mineableState) {
          return snapshot.family === mineableState.yieldKind;
        },
      },
    );
    assert.ok(chosenTarget, "expected a compatible mineable target");
    assert.equal(
      Number(chosenTarget.itemID),
      oreTarget.itemID,
      "expected ore miners to skip incompatible ice targets during target selection",
    );
  } finally {
    _testing.clearState();
  }
});

test("fleet target selection stays within the local mining bubble", () => {
  _testing.clearState();
  try {
    const systemID = 30000145;
    const localAsteroid = {
      itemID: 5005121184807,
      kind: "asteroid",
      bubbleID: 1001,
      position: { x: 100_000, y: 0, z: 0 },
      radius: 120,
    };
    const remoteIceField = {
      itemID: 5005121184808,
      kind: "iceChunk",
      bubbleID: 1002,
      position: { x: 400_000, y: 0, z: 0 },
      radius: 120,
    };
    const fleetRecord = _testing.createMiningFleetRecord({
      source: "test",
      systemID,
      targetShipID: 0,
      minerEntityIDs: [],
      haulerEntityIDs: [],
      originAnchor: {
        position: { x: 100_000, y: 0, z: 0 },
      },
    });
    const scene = {
      systemID,
      staticEntities: [localAsteroid, remoteIceField],
      _miningRuntimeState: {
        byEntityID: new Map([
          [localAsteroid.itemID, {
            entityID: localAsteroid.itemID,
            remainingQuantity: 10_000,
            yieldTypeID: 34,
            yieldKind: "ore",
          }],
          [remoteIceField.itemID, {
            entityID: remoteIceField.itemID,
            remainingQuantity: 10_000,
            yieldTypeID: 16262,
            yieldKind: "ice",
          }],
        ]),
      },
      getEntityByID(entityID) {
        if (Number(entityID) === localAsteroid.itemID) {
          return localAsteroid;
        }
        if (Number(entityID) === remoteIceField.itemID) {
          return remoteIceField;
        }
        return null;
      },
      getBubbleScopedStaticEntitiesForPosition(position) {
        if (Number(position && position.x) === 100_000) {
          return [localAsteroid];
        }
        return [];
      },
    };

    const targetEntity = _testing.chooseFleetMineableTarget(scene, fleetRecord);
    assert.ok(targetEntity, "expected a local mineable target");
    assert.equal(
      Number(targetEntity.itemID),
      localAsteroid.itemID,
      "expected fleet selection to stay inside the local mining bubble instead of drifting to a remote site",
    );
  } finally {
    _testing.clearState();
  }
});

test("mining target lock sync clears stale asteroid locks before retargeting", () => {
  const minerEntity = {
    itemID: 980300001261,
    kind: "ship",
    position: { x: 0, y: 0, z: 0 },
    radius: 80,
  };
  const previousAsteroid = {
    itemID: 5005121184811,
    kind: "asteroid",
    position: { x: 5_000, y: 0, z: 0 },
    radius: 120,
  };
  const nextAsteroid = {
    itemID: 5005121184812,
    kind: "asteroid",
    position: { x: 6_000, y: 0, z: 0 },
    radius: 120,
  };
  const entityMap = new Map([
    [minerEntity.itemID, minerEntity],
    [previousAsteroid.itemID, previousAsteroid],
    [nextAsteroid.itemID, nextAsteroid],
  ]);
  const lockedTargetsByEntityID = new Map([
    [minerEntity.itemID, [previousAsteroid.itemID]],
  ]);
  const scene = {
    _miningRuntimeState: {
      byEntityID: new Map([
        [previousAsteroid.itemID, {
          entityID: previousAsteroid.itemID,
          remainingQuantity: 10_000,
          yieldTypeID: 34,
        }],
        [nextAsteroid.itemID, {
          entityID: nextAsteroid.itemID,
          remainingQuantity: 10_000,
          yieldTypeID: 34,
        }],
      ]),
    },
    removedTargetIDs: [],
    getEntityByID(entityID) {
      return entityMap.get(Number(entityID)) || null;
    },
    getSortedPendingTargetLocks() {
      return [];
    },
    removeLockedTarget(entity, targetID) {
      const currentTargets = [
        ...(lockedTargetsByEntityID.get(Number(entity && entity.itemID)) || []),
      ].filter((entry) => Number(entry) !== Number(targetID));
      lockedTargetsByEntityID.set(Number(entity && entity.itemID), currentTargets);
      this.removedTargetIDs.push(Number(targetID));
      return true;
    },
    finalizeTargetLock(entity, targetEntity) {
      const entityID = Number(entity && entity.itemID);
      const targetID = Number(targetEntity && targetEntity.itemID);
      const currentTargets = [
        ...(lockedTargetsByEntityID.get(entityID) || []),
      ];
      if (currentTargets.length >= 1 && !currentTargets.includes(targetID)) {
        return {
          success: false,
          errorMsg: "TARGET_LOCK_LIMIT_REACHED",
        };
      }
      if (!currentTargets.includes(targetID)) {
        currentTargets.push(targetID);
      }
      lockedTargetsByEntityID.set(entityID, currentTargets);
      return {
        success: true,
        data: {
          targets: currentTargets,
        },
      };
    },
  };

  const lockResult = _testing.syncMiningTargetLock(
    scene,
    minerEntity,
    nextAsteroid,
    1_000,
    {
      getTargetsForEntity(runtimeScene, entity) {
        return [...(lockedTargetsByEntityID.get(Number(entity && entity.itemID)) || [])];
      },
    },
  );

  assert.equal(lockResult.success, true);
  assert.deepEqual(scene.removedTargetIDs, [previousAsteroid.itemID]);
  assert.deepEqual(
    lockedTargetsByEntityID.get(minerEntity.itemID),
    [nextAsteroid.itemID],
  );
});

test("per-miner target selection spreads miners across multiple available asteroids", () => {
  _testing.clearState();
  try {
    const systemID = 30000145;
    const miners = [
      {
        itemID: 980300001271,
        kind: "ship",
        position: { x: 100_000, y: 0, z: 0 },
        radius: 80,
      },
      {
        itemID: 980300001272,
        kind: "ship",
        position: { x: 100_100, y: 0, z: 0 },
        radius: 80,
      },
      {
        itemID: 980300001273,
        kind: "ship",
        position: { x: 100_200, y: 0, z: 0 },
        radius: 80,
      },
      {
        itemID: 980300001274,
        kind: "ship",
        position: { x: 100_300, y: 0, z: 0 },
        radius: 80,
      },
    ];
    const asteroids = [
      {
        itemID: 5005121184821,
        kind: "asteroid",
        position: { x: 100_500, y: 0, z: 0 },
        radius: 120,
      },
      {
        itemID: 5005121184822,
        kind: "asteroid",
        position: { x: 101_200, y: 0, z: 0 },
        radius: 120,
      },
      {
        itemID: 5005121184823,
        kind: "asteroid",
        position: { x: 101_900, y: 0, z: 0 },
        radius: 120,
      },
    ];
    const entityMap = new Map([
      ...miners.map((entity) => [entity.itemID, entity]),
      ...asteroids.map((entity) => [entity.itemID, entity]),
    ]);
    const scene = {
      systemID,
      staticEntities: [...asteroids],
      _miningRuntimeState: {
        byEntityID: new Map(
          asteroids.map((entity) => [entity.itemID, {
            entityID: entity.itemID,
            remainingQuantity: 25_000,
            yieldTypeID: 34,
          }]),
        ),
      },
      getEntityByID(entityID) {
        return entityMap.get(Number(entityID)) || null;
      },
    };
    const fleetRecord = _testing.createMiningFleetRecord({
      source: "test",
      systemID,
      minerEntityIDs: miners.map((entity) => entity.itemID),
      haulerEntityIDs: [],
      originAnchor: {
        position: { x: 0, y: 0, z: 0 },
      },
    });
    const availableTargetEntries = asteroids.map((entity) => ({
      entity,
      state: scene._miningRuntimeState.byEntityID.get(entity.itemID),
    }));
    const claimCounts = new Map();

    const chosenTargetIDs = miners.map((minerEntity) => {
      const targetEntity = _testing.chooseMineableTargetForMiner(
        scene,
        fleetRecord,
        minerEntity,
        availableTargetEntries,
        claimCounts,
      );
      assert.ok(targetEntity, `expected miner ${minerEntity.itemID} to receive a target`);
      return Number(targetEntity.itemID);
    });

    assert.ok(
      new Set(chosenTargetIDs).size >= 3,
      `expected miners to spread across multiple asteroids, got ${chosenTargetIDs.join(", ")}`,
    );
  } finally {
    _testing.clearState();
  }
});

test("mining fleets activate miningLaser and emit visible mining FX once in range", (t) => {
  const systemID = 30000145;
  const belt = worldData.getAsteroidBeltsForSystem(systemID)[0];
  assert.ok(belt && belt.position, "expected a belt anchor for the mining fleet test");

  clearPersistedSystemState(systemID);
  runtime._testing.clearScenes();
  _testing.clearState();

  const spawnedEntityIDs = [];
  t.after(() => {
    for (const entityID of spawnedEntityIDs) {
      npcService.destroyNpcControllerByEntityID(entityID, {
        removeContents: true,
      });
    }
    clearPersistedSystemState(systemID);
    runtime._testing.clearScenes();
    _testing.clearState();
  });

  const scene = runtime.ensureScene(systemID);
  const notifications = [];
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 991000147,
    typeID: 22544,
    position: { ...belt.position },
  }, systemID);
  const session = {
    clientID: 65450,
    characterID: pickCharacterID(),
    _space: {
      systemID,
      shipID: shipEntity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set([shipEntity.itemID]),
      visibleBubbleScopedStaticEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  shipEntity.session = session;
  scene.spawnDynamicEntity(shipEntity, { broadcast: false });
  scene.sessions.set(session.clientID, session);

  const activationLogs = [];
  const originalActivateGenericModule = scene.activateGenericModule.bind(scene);
  scene.activateGenericModule = (pseudoSession, moduleItem, effectName, options = {}) => {
    const result = originalActivateGenericModule(pseudoSession, moduleItem, effectName, options);
    activationLogs.push({
      shipID: Number(pseudoSession && pseudoSession._space && pseudoSession._space.shipID),
      moduleID: Number(moduleItem && moduleItem.itemID),
      effectName: String(effectName || ""),
      targetID: Number(options && options.targetID),
      result,
    });
    return result;
  };
  t.after(() => {
    scene.activateGenericModule = originalActivateGenericModule;
  });

  const spawnResult = npcService.spawnNpcGroupInSystem(systemID, {
    spawnGroupQuery: "npc_mining_ops_highsec",
    transient: true,
    broadcast: false,
    skipInitialBehaviorTick: true,
    anchorDescriptor: {
      kind: "coordinates",
      position: belt.position,
      direction: { x: 1, y: 0, z: 0 },
      name: "Mining Fleet FX Test Anchor",
    },
  });
  assert.equal(spawnResult.success, true, spawnResult.errorMsg || "expected mining fleet spawn to succeed");
  assert.ok(spawnResult.data, "expected mining fleet spawn data");

  const minerEntityIDs = spawnResult.data.spawned
    .map((entry) => Number(entry && entry.entity && entry.entity.itemID) || 0)
    .filter((entityID) => entityID > 0);
  assert.ok(minerEntityIDs.length > 0, "expected spawned mining hulls");
  spawnedEntityIDs.push(...minerEntityIDs);

  const fleetRecord = _testing.createMiningFleetRecord({
    source: "test",
    systemID,
    targetShipID: shipEntity.itemID,
    minerEntityIDs,
    haulerEntityIDs: [],
    originAnchor: {
      position: { ...belt.position },
      direction: { x: 1, y: 0, z: 0 },
      name: "Mining Fleet FX Test Anchor",
    },
  });

  const asteroids = scene.staticEntities
    .filter((entity) => String(entity && entity.kind || "").toLowerCase() === "asteroid")
    .sort(
      (left, right) =>
        distance(left && left.position, belt.position) -
          distance(right && right.position, belt.position) ||
        Number(left && left.itemID) - Number(right && right.itemID),
    );
  assert.ok(asteroids.length > 0, "expected belt asteroids in the scene");
  const targetAsteroid = asteroids[0];

  for (const entityID of fleetRecord.minerEntityIDs) {
    const minerEntity = scene.getEntityByID(entityID);
    assert.ok(minerEntity, `expected miner entity ${entityID}`);
    minerEntity.pendingWarp = null;
    minerEntity.warpState = null;
    minerEntity.mode = "STOP";
    minerEntity.position = {
      x: Number(targetAsteroid.position.x) + 500,
      y: Number(targetAsteroid.position.y),
      z: Number(targetAsteroid.position.z) + 500,
    };
    session._space.visibleDynamicEntityIDs.add(entityID);
  }
  for (const entityID of fleetRecord.haulerEntityIDs) {
    session._space.visibleDynamicEntityIDs.add(entityID);
  }
  for (const staticEntity of scene.staticEntities) {
    if (staticEntity && staticEntity.staticVisibilityScope === "bubble") {
      session._space.visibleBubbleScopedStaticEntityIDs.add(Number(staticEntity.itemID));
    }
  }

  scene._miningRuntimeState = null;
  for (let tickIndex = 0; tickIndex < 3; tickIndex += 1) {
    miningRuntime.tickScene(
      scene,
      scene.getCurrentSimTimeMs() + (tickIndex * 1_000),
    );
  }

  const miningActivations = activationLogs.filter((entry) => (
    fleetRecord.minerEntityIDs.includes(entry.shipID) &&
    entry.result &&
    entry.result.success === true
  ));
  assert.ok(miningActivations.length > 0, "expected miners to activate mining modules");
  assert.ok(
    miningActivations.every((entry) => entry.effectName === "miningLaser"),
    `expected mining activations to use miningLaser, got ${miningActivations.map((entry) => entry.effectName).join(", ")}`,
  );

  const npcLaserFxUpdates = flattenDestinyUpdates(notifications).filter((update) => (
    update.name === "OnSpecialFX" &&
    String(update.args[5]) === "effects.Laser" &&
    fleetRecord.minerEntityIDs.includes(Number(update.args[0])) &&
    Number(update.args[3]) === Number(targetAsteroid.itemID) &&
    Number(update.args[7]) === 1 &&
    Number(update.args[8]) === 1
  ));
  assert.ok(
    npcLaserFxUpdates.length > 0,
    "expected the watcher session to receive NPC mining OnSpecialFX payloads",
  );
  assert.ok(
    npcLaserFxUpdates.every((update) => Number(update.args[10]) > 10),
    "expected NPC mining beams to use a long-lived repeat window instead of single-cycle restarts",
  );

  const activeMiningEffects = fleetRecord.minerEntityIDs.flatMap((entityID) => {
    const minerEntity = scene.getEntityByID(entityID);
    const activeEffects =
      minerEntity && minerEntity.activeModuleEffects instanceof Map
        ? [...minerEntity.activeModuleEffects.values()]
        : [];
    return activeEffects
      .filter((effectState) => (
        effectState &&
        effectState.miningEffect === true &&
        Number(effectState.targetID) === Number(targetAsteroid.itemID)
      ))
      .map((effectState) => ({
        entityID,
        effectState,
      }));
  });
  assert.ok(activeMiningEffects.length > 0, "expected active mining effects after fleet activation");

  const earliestCycleEffect = activeMiningEffects.reduce((best, entry) => {
    if (!best) {
      return entry;
    }
    return Number(entry.effectState.nextCycleAtMs || 0) < Number(best.effectState.nextCycleAtMs || 0)
      ? entry
      : best;
  }, null);
  assert.ok(earliestCycleEffect, "expected at least one active mining cycle");

  const initialLaserFxCount = npcLaserFxUpdates.length;
  advanceSceneUntilSimTime(
    scene,
    Number(earliestCycleEffect.effectState.nextCycleAtMs || scene.getCurrentSimTimeMs()),
    50,
  );

  const refreshedLaserFxUpdates = flattenDestinyUpdates(notifications).filter((update) => (
    update.name === "OnSpecialFX" &&
    String(update.args[5]) === "effects.Laser" &&
    fleetRecord.minerEntityIDs.includes(Number(update.args[0])) &&
    Number(update.args[3]) === Number(targetAsteroid.itemID) &&
    Number(update.args[7]) === 1 &&
    Number(update.args[8]) === 1
  ));
  assert.equal(
    refreshedLaserFxUpdates.length,
    initialLaserFxCount,
    "expected NPC mining beams to remain active across cycles without redundant start FX restarts",
  );

  const stopEntity = scene.getEntityByID(earliestCycleEffect.entityID);
  assert.ok(stopEntity, `expected miner entity ${earliestCycleEffect.entityID} to remain available`);
  const stopResult = scene.deactivateGenericModule({
    characterID: Number(stopEntity.pilotCharacterID || stopEntity.characterID || 0),
    corporationID: Number(stopEntity.corporationID || 0),
    allianceID: Number(stopEntity.allianceID || 0),
    _space: {
      systemID,
      shipID: Number(stopEntity.itemID),
    },
  }, earliestCycleEffect.effectState.moduleID, {
    reason: "manual",
    deferUntilCycle: false,
  });
  assert.equal(stopResult.success, true, "expected manual NPC mining stop to succeed");

  const stopFx = flattenDestinyUpdates(notifications).find((update) => (
    update.name === "OnSpecialFX" &&
    String(update.args[5]) === "effects.Laser" &&
    Number(update.args[0]) === Number(earliestCycleEffect.entityID) &&
    Number(update.args[3]) === Number(targetAsteroid.itemID) &&
    Number(update.args[7]) === 0 &&
    Number(update.args[8]) === 0
  ));
  assert.ok(stopFx, "expected NPC mining stop to emit a matching stop OnSpecialFX");
});

test("spawned mining fleets distribute live mining activations across multiple asteroids", (t) => {
  const systemID = 30000145;
  const belt = worldData.getAsteroidBeltsForSystem(systemID)[0];
  assert.ok(belt && belt.position, "expected a belt anchor for the mining distribution test");

  clearPersistedSystemState(systemID);
  runtime._testing.clearScenes();
  _testing.clearState();

  const spawnedEntityIDs = [];
  t.after(() => {
    for (const entityID of spawnedEntityIDs) {
      npcService.destroyNpcControllerByEntityID(entityID, {
        removeContents: true,
      });
    }
    clearPersistedSystemState(systemID);
    runtime._testing.clearScenes();
    _testing.clearState();
  });

  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 991000148,
    typeID: 22544,
    position: { ...belt.position },
  }, systemID);
  const session = {
    clientID: 65451,
    characterID: pickCharacterID(),
    _space: {
      systemID,
      shipID: shipEntity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set([shipEntity.itemID]),
      visibleBubbleScopedStaticEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    socket: { destroyed: false },
    sendNotification() {},
  };
  shipEntity.session = session;
  scene.spawnDynamicEntity(shipEntity, { broadcast: false });
  scene.sessions.set(session.clientID, session);

  const spawnResult = npcService.spawnNpcGroupInSystem(systemID, {
    spawnGroupQuery: "npc_mining_ops_highsec",
    transient: true,
    broadcast: false,
    skipInitialBehaviorTick: true,
    anchorDescriptor: {
      kind: "coordinates",
      position: belt.position,
      direction: { x: 1, y: 0, z: 0 },
      name: "Mining Fleet Spread Test Anchor",
    },
  });
  assert.equal(spawnResult.success, true, spawnResult.errorMsg || "expected mining fleet spawn to succeed");
  assert.ok(spawnResult.data, "expected mining fleet spawn data");

  const minerEntityIDs = spawnResult.data.spawned
    .map((entry) => Number(entry && entry.entity && entry.entity.itemID) || 0)
    .filter((entityID) => entityID > 0);
  assert.ok(minerEntityIDs.length > 0, "expected spawned mining hulls");
  spawnedEntityIDs.push(...minerEntityIDs);

  const fleetRecord = _testing.createMiningFleetRecord({
    source: "test",
    systemID,
    targetShipID: shipEntity.itemID,
    minerEntityIDs,
    haulerEntityIDs: [],
    originAnchor: {
      position: { ...belt.position },
      direction: { x: 1, y: 0, z: 0 },
      name: "Mining Fleet Spread Test Anchor",
    },
  });

  const asteroids = scene.staticEntities
    .filter((entity) => String(entity && entity.kind || "").toLowerCase() === "asteroid")
    .sort(
      (left, right) =>
        distance(left && left.position, belt.position) -
          distance(right && right.position, belt.position) ||
        Number(left && left.itemID) - Number(right && right.itemID),
    );
  assert.ok(asteroids.length >= 3, "expected multiple belt asteroids in the scene");
  const targetAsteroids = asteroids.slice(0, 3);

  const stagingPosition = {
    x: (
      Number(targetAsteroids[0].position.x) +
      Number(targetAsteroids[1].position.x) +
      Number(targetAsteroids[2].position.x)
    ) / 3,
    y: (
      Number(targetAsteroids[0].position.y) +
      Number(targetAsteroids[1].position.y) +
      Number(targetAsteroids[2].position.y)
    ) / 3,
    z: (
      Number(targetAsteroids[0].position.z) +
      Number(targetAsteroids[1].position.z) +
      Number(targetAsteroids[2].position.z)
    ) / 3,
  };

  for (const entityID of fleetRecord.minerEntityIDs) {
    const minerEntity = scene.getEntityByID(entityID);
    assert.ok(minerEntity, `expected miner entity ${entityID}`);
    minerEntity.pendingWarp = null;
    minerEntity.warpState = null;
    minerEntity.mode = "STOP";
    minerEntity.position = {
      x: stagingPosition.x + 250,
      y: stagingPosition.y,
      z: stagingPosition.z + 250,
    };
    session._space.visibleDynamicEntityIDs.add(entityID);
  }
  for (const staticEntity of scene.staticEntities) {
    if (staticEntity && staticEntity.staticVisibilityScope === "bubble") {
      session._space.visibleBubbleScopedStaticEntityIDs.add(Number(staticEntity.itemID));
    }
  }

  scene._miningRuntimeState = null;
  for (let tickIndex = 0; tickIndex < 4; tickIndex += 1) {
    miningRuntime.tickScene(
      scene,
      scene.getCurrentSimTimeMs() + (tickIndex * 1_000),
    );
  }

  const activeTargetIDs = fleetRecord.minerEntityIDs.flatMap((entityID) => {
    const minerEntity = scene.getEntityByID(entityID);
    if (!minerEntity || !(minerEntity.activeModuleEffects instanceof Map)) {
      return [];
    }
    return [...minerEntity.activeModuleEffects.values()]
      .filter((effectState) => effectState && effectState.miningEffect === true)
      .map((effectState) => Number(effectState.targetID));
  });

  const uniqueActiveTargetIDs = [...new Set(activeTargetIDs)];
  assert.ok(activeTargetIDs.length > 0, "expected miners to activate modules on-grid");
  assert.ok(
    uniqueActiveTargetIDs.length >= 3,
    `expected live fleet mining to spread across multiple asteroids, got ${uniqueActiveTargetIDs.join(", ")}`,
  );

  const dormantMinerIDs = fleetRecord.minerEntityIDs.filter((entityID) => {
    const minerEntity = scene.getEntityByID(entityID);
    const activeMiningCount =
      minerEntity && minerEntity.activeModuleEffects instanceof Map
        ? [...minerEntity.activeModuleEffects.values()].filter((effectState) => (
          effectState && effectState.miningEffect === true
        )).length
        : 0;
    if (activeMiningCount > 0) {
      return false;
    }
    return !(
      minerEntity &&
      Number(minerEntity.targetEntityID) > 0 &&
      (
        minerEntity.mode === "FOLLOW" ||
        minerEntity.mode === "ORBIT"
      )
    );
  });
  assert.deepEqual(
    dormantMinerIDs,
    [],
    `expected spawned mining fleets to keep every non-active miner approaching a rock instead of idling, got ${dormantMinerIDs.join(", ")}`,
  );
});

test("large mining fleets approach targets instead of idling when many miners spawn at once", (t) => {
  const systemID = 30000145;
  const belt = worldData.getAsteroidBeltsForSystem(systemID)[0];
  assert.ok(belt && belt.position, "expected a belt anchor for the large fleet approach test");

  clearPersistedSystemState(systemID);
  runtime._testing.clearScenes();
  _testing.clearState();

  const spawnedEntityIDs = [];
  t.after(() => {
    for (const entityID of spawnedEntityIDs) {
      npcService.destroyNpcControllerByEntityID(entityID, {
        removeContents: true,
      });
    }
    clearPersistedSystemState(systemID);
    runtime._testing.clearScenes();
    _testing.clearState();
  });

  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 991000150,
    typeID: 22544,
    position: { ...belt.position },
  }, systemID);
  const session = {
    clientID: 65452,
    characterID: pickCharacterID(),
    _space: {
      systemID,
      shipID: shipEntity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set([shipEntity.itemID]),
      visibleBubbleScopedStaticEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    socket: { destroyed: false },
    sendNotification() {},
  };
  shipEntity.session = session;
  scene.spawnDynamicEntity(shipEntity, { broadcast: false });
  scene.sessions.set(session.clientID, session);

  const minerEntityIDs = [];
  for (let index = 0; index < 15; index += 1) {
    const spawnResult = npcService.spawnNpcGroupInSystem(systemID, {
      spawnGroupQuery: "npc_mining_ops_highsec",
      transient: true,
      broadcast: false,
      skipInitialBehaviorTick: true,
      anchorDescriptor: {
        kind: "coordinates",
        position: belt.position,
        direction: { x: 1, y: 0, z: 0 },
        name: "Mining Fleet Large Approach Test Anchor",
      },
    });
    assert.equal(spawnResult.success, true, spawnResult.errorMsg || "expected large mining fleet spawn to succeed");
    const spawnedIDs = spawnResult.data.spawned
      .map((entry) => Number(entry && entry.entity && entry.entity.itemID) || 0)
      .filter((entityID) => entityID > 0);
    minerEntityIDs.push(...spawnedIDs);
    spawnedEntityIDs.push(...spawnedIDs);
  }
  assert.ok(minerEntityIDs.length >= 50, "expected a large mining fleet test population");

  const fleetRecord = _testing.createMiningFleetRecord({
    source: "test",
    systemID,
    targetShipID: shipEntity.itemID,
    minerEntityIDs,
    haulerEntityIDs: [],
    originAnchor: {
      position: { ...belt.position },
      direction: { x: 1, y: 0, z: 0 },
      name: "Mining Fleet Large Approach Test Anchor",
    },
  });

  const asteroids = scene.staticEntities
    .filter((entity) => String(entity && entity.kind || "").toLowerCase() === "asteroid")
    .sort(
      (left, right) =>
        distance(left && left.position, belt.position) -
          distance(right && right.position, belt.position) ||
        Number(left && left.itemID) - Number(right && right.itemID),
    );
  assert.ok(asteroids.length >= 3, "expected belt asteroids for the large fleet approach test");
  const stagingPosition = {
    x: (
      Number(asteroids[0].position.x) +
      Number(asteroids[1].position.x) +
      Number(asteroids[2].position.x)
    ) / 3,
    y: (
      Number(asteroids[0].position.y) +
      Number(asteroids[1].position.y) +
      Number(asteroids[2].position.y)
    ) / 3,
    z: (
      Number(asteroids[0].position.z) +
      Number(asteroids[1].position.z) +
      Number(asteroids[2].position.z)
    ) / 3,
  };

  for (const entityID of fleetRecord.minerEntityIDs) {
    const minerEntity = scene.getEntityByID(entityID);
    assert.ok(minerEntity, `expected miner entity ${entityID}`);
    minerEntity.pendingWarp = null;
    minerEntity.warpState = null;
    minerEntity.mode = "STOP";
    minerEntity.targetEntityID = null;
    minerEntity.position = {
      x: stagingPosition.x + 250,
      y: stagingPosition.y,
      z: stagingPosition.z + 250,
    };
  }

  scene._miningRuntimeState = null;
  for (let tickIndex = 0; tickIndex < 3; tickIndex += 1) {
    miningRuntime.tickScene(
      scene,
      scene.getCurrentSimTimeMs() + (tickIndex * 1_000),
    );
  }

  const idleMinerIDs = fleetRecord.minerEntityIDs.filter((entityID) => {
    const minerEntity = scene.getEntityByID(entityID);
    if (!minerEntity) {
      return true;
    }
    const activeMiningCount =
      minerEntity.activeModuleEffects instanceof Map
        ? [...minerEntity.activeModuleEffects.values()].filter((effectState) => (
          effectState && effectState.miningEffect === true
        )).length
        : 0;
    if (activeMiningCount > 0) {
      return false;
    }
    return !(
      Number(minerEntity.targetEntityID) > 0 &&
      (
        minerEntity.mode === "FOLLOW" ||
        minerEntity.mode === "ORBIT"
      )
    );
  });

  assert.deepEqual(
    idleMinerIDs,
    [],
    `expected large mining fleets to keep every miner either active or approaching, got ${idleMinerIDs.join(", ")}`,
  );
});
