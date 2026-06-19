const path = require("path");

const {
  buildSpawnStateForDefinition,
} = require(path.join(__dirname, "../src/space/npc/npcAnchors"));
const npcBehaviorLoop = require(path.join(__dirname, "../src/space/npc/npcBehaviorLoop"));
const npcRegistry = require(path.join(__dirname, "../src/space/npc/npcRegistry"));
const npcTestService = require(path.join(__dirname, "../src/space/npc/npcTestService"));

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    if (details) {
      error.details = details;
    }
    throw error;
  }
}

function distance(left, right) {
  const dx = Number(left && left.x || 0) - Number(right && right.x || 0);
  const dy = Number(left && left.y || 0) - Number(right && right.y || 0);
  const dz = Number(left && left.z || 0) - Number(right && right.z || 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function verifySpawnOverride() {
  const spawnState = buildSpawnStateForDefinition(
    {
      position: { x: 100, y: 200, z: 300 },
      direction: { x: 1, y: 0, z: 0 },
    },
    null,
    {
      spawnStateOverride: {
        position: { x: 1, y: 2, z: 3 },
        velocity: { x: 4, y: 5, z: 6 },
        direction: { x: 0, y: 1, z: 0 },
        targetPoint: { x: 7, y: 8, z: 9 },
        mode: "STOP",
        speedFraction: 0,
      },
    },
  );
  assert(spawnState.position.x === 1 && spawnState.position.y === 2 && spawnState.position.z === 3,
    "spawnStateOverride did not preserve exact position",
    spawnState);
  assert(spawnState.velocity.x === 4 && spawnState.velocity.y === 5 && spawnState.velocity.z === 6,
    "spawnStateOverride did not preserve exact velocity",
    spawnState);
  assert(spawnState.direction.x === 0 && spawnState.direction.y === 1 && spawnState.direction.z === 0,
    "spawnStateOverride did not preserve exact direction",
    spawnState);
  return {
    exactPosition: spawnState.position,
    exactDirection: spawnState.direction,
  };
}

function verifyHoldMovement() {
  const calls = [];
  npcBehaviorLoop.__testing.syncNpcMovement(
    {
      stop(session) {
        calls.push({
          fn: "stop",
          shipID: session && session._space && session._space.shipID,
        });
      },
      followBall() {
        calls.push({ fn: "followBall" });
      },
      orbit() {
        calls.push({ fn: "orbit" });
      },
    },
    {
      kind: "ship",
      itemID: 1001,
      systemID: 30000142,
      mode: "GOTO",
      speedFraction: 1,
    },
    {
      itemID: 2002,
      position: { x: 0, y: 0, z: 0 },
    },
    {
      movementMode: "hold",
      orbitDistanceMeters: 5_000,
      followRangeMeters: 5_000,
    },
  );
  assert(calls.length === 1 && calls[0].fn === "stop",
    "hold movement should stop the NPC instead of issuing follow/orbit",
    calls);
  return {
    calls,
  };
}

function verifyFriendlyNpcFire() {
  npcRegistry.clearControllers();
  npcRegistry.registerController({
    entityID: 501,
    systemID: 30000142,
    operatorKind: "npctest2",
    behaviorOverrides: {
      allowFriendlyNpcTargets: true,
    },
  });
  npcRegistry.registerController({
    entityID: 502,
    systemID: 30000142,
    operatorKind: "npctest2",
    behaviorOverrides: {
      allowFriendlyNpcTargets: true,
    },
  });
  const allowedPair = npcBehaviorLoop.__testing.isFriendlyCombatTarget(
    {
      kind: "ship",
      itemID: 501,
      npcEntityType: "npc",
    },
    {
      kind: "ship",
      itemID: 502,
      npcEntityType: "npc",
    },
  );
  npcRegistry.clearControllers();
  const defaultPair = npcBehaviorLoop.__testing.isFriendlyCombatTarget(
    {
      kind: "ship",
      itemID: 601,
      npcEntityType: "npc",
    },
    {
      kind: "ship",
      itemID: 602,
      npcEntityType: "npc",
    },
  );
  assert(allowedPair === false, "npctest2 NPCs should be allowed to target each other");
  assert(defaultPair === true, "ordinary NPCs should still remain friendly to each other");
  return {
    npctest2FriendlyCheck: allowedPair,
    defaultNpcFriendlyCheck: defaultPair,
  };
}

function verifyCatalogAndPlan() {
  const catalog = npcTestService.__testing.buildNpcTestCombatCatalog();
  const pools = npcTestService.__testing.buildNpcTestPools(catalog);
  assert(catalog.length > 0, "combat NPC catalog is empty");
  assert(pools.missileEntries.length > 0, "missile NPC catalog is empty");

  const selected = npcTestService.__testing.selectNpcTestDefinitions(catalog, 25);
  const missileCount = selected.filter((entry) => entry && entry.isMissile).length;
  assert(selected.length === 25, "selection did not return requested amount", {
    selectedCount: selected.length,
  });
  assert(missileCount > 0, "selection did not guarantee any missile hulls", {
    missileCount,
  });

  const shipEntity = {
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 1 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  const playerPlan = npcTestService.__testing.buildNpcTestSpawnPlan(shipEntity, selected, "player");
  const ffaPlan = npcTestService.__testing.buildNpcTestSpawnPlan(shipEntity, selected, "ffa");
  assert(
    Math.abs(distance(playerPlan.centerPosition, shipEntity.position) - 20_000) < 1,
    "player plan center was not placed 20km ahead of the ship",
    playerPlan.centerPosition,
  );
  assert(
    Math.abs(distance(ffaPlan.centerPosition, shipEntity.position) - 20_000) < 1,
    "ffa plan center was not placed 20km ahead of the ship",
    ffaPlan.centerPosition,
  );

  let minPlayerSpacing = Number.POSITIVE_INFINITY;
  let minFfaSpacing = Number.POSITIVE_INFINITY;
  let maxPlayerRangeOverflow = 0;
  let minFfaShellRadius = Number.POSITIVE_INFINITY;
  let maxFfaShellRadius = 0;
  for (let index = 0; index < selected.length; index += 1) {
    const playerDistance = distance(
      shipEntity.position,
      playerPlan.entries[index].spawnState.position,
    );
    const playerAllowedDistance = Math.max(
      1_500,
      Number(playerPlan.entries[index].engagementRangeMeters || 0) * 0.9,
    );
    maxPlayerRangeOverflow = Math.max(
      maxPlayerRangeOverflow,
      playerDistance - playerAllowedDistance,
    );
    const ffaShellRadius = distance(
      ffaPlan.centerPosition,
      ffaPlan.entries[index].spawnState.position,
    );
    minFfaShellRadius = Math.min(minFfaShellRadius, ffaShellRadius);
    maxFfaShellRadius = Math.max(maxFfaShellRadius, ffaShellRadius);
    for (let compareIndex = index + 1; compareIndex < selected.length; compareIndex += 1) {
      minPlayerSpacing = Math.min(
        minPlayerSpacing,
        distance(
          playerPlan.entries[index].spawnState.position,
          playerPlan.entries[compareIndex].spawnState.position,
        ),
      );
      minFfaSpacing = Math.min(
        minFfaSpacing,
        distance(
          ffaPlan.entries[index].spawnState.position,
          ffaPlan.entries[compareIndex].spawnState.position,
        ),
      );
    }
  }
  assert(minPlayerSpacing >= 300,
    "player plan spacing collapsed too tightly",
    { minPlayerSpacing });
  assert(minFfaSpacing >= 2_500,
    "ffa plan spacing collapsed too tightly",
    { minFfaSpacing });
  assert(maxPlayerRangeOverflow <= 1,
    "player plan placed at least one NPC outside its allowed firing distance",
    { maxPlayerRangeOverflow });
  assert(
    Math.abs(maxFfaShellRadius - minFfaShellRadius) <= 1,
    "ffa plan is not a shell sphere",
    {
      minFfaShellRadius,
      maxFfaShellRadius,
    },
  );

  const nearestTargets = ffaPlan.entries.map((entry) => (
    npcTestService.__testing.resolveNearestSpawnedOpponent(
      ffaPlan.entries.map((plannedEntry, index) => ({
        entity: {
          itemID: index + 1,
          position: plannedEntry.spawnState.position,
        },
      })),
      {
        entity: {
          itemID: ffaPlan.entries.indexOf(entry) + 1,
          position: entry.spawnState.position,
        },
      },
    )
  )).filter(Boolean);
  assert(nearestTargets.length === ffaPlan.entries.length,
    "ffa nearest-opponent seeding did not resolve a rival for every NPC",
    { nearestTargetsResolved: nearestTargets.length, entryCount: ffaPlan.entries.length });

  return {
    catalogCount: catalog.length,
    missileCatalogCount: pools.missileEntries.length,
    selectedMissileCount: missileCount,
    minPlayerSpacing,
    minFfaSpacing,
    maxPlayerRangeOverflow,
    minFfaShellRadius,
    maxFfaShellRadius,
    nearestTargetsResolved: nearestTargets.length,
  };
}

function main() {
  const results = {
    spawnOverride: verifySpawnOverride(),
    holdMovement: verifyHoldMovement(),
    friendlyNpcFire: verifyFriendlyNpcFire(),
    catalogAndPlan: verifyCatalogAndPlan(),
  };
  console.log(JSON.stringify(results, null, 2));
}

main();
