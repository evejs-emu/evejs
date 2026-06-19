const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_ASTEROID_FIELDS = "true";

const repoRoot = path.join(__dirname, "..", "..");

const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const asteroidService = require(path.join(
  repoRoot,
  "server/src/space/asteroids/asteroidService",
));
const asteroidData = require(path.join(
  repoRoot,
  "server/src/space/asteroids/asteroidData",
));
const {
  TABLE,
  readStaticRows,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/referenceData",
));
const {
  resolveAnchors,
} = require(path.join(
  repoRoot,
  "server/src/space/npc/npcAnchors",
));
const ConfigService = require(path.join(
  repoRoot,
  "server/src/services/config/configService",
));

function pickAsteroidBeltSystem() {
  const belts = readStaticRows(TABLE.ASTEROID_BELTS);
  assert.ok(belts.length > 0, "expected stored asteroid belt rows");

  const firstBelt = belts[0];
  const systemID = Number(firstBelt && firstBelt.solarSystemID) || 0;
  assert.ok(systemID > 0, "expected asteroid belt system ID");

  return {
    systemID,
    belts: belts.filter((belt) => Number(belt.solarSystemID) === systemID),
  };
}

function pickMultiBeltSystem() {
  const belts = readStaticRows(TABLE.ASTEROID_BELTS);
  assert.ok(belts.length > 0, "expected stored asteroid belt rows");

  const beltsBySystem = new Map();
  for (const belt of belts) {
    const systemID = Number(belt && belt.solarSystemID) || 0;
    if (systemID <= 0) {
      continue;
    }
    if (!beltsBySystem.has(systemID)) {
      beltsBySystem.set(systemID, []);
    }
    beltsBySystem.get(systemID).push(belt);
  }

  for (const [systemID, systemBelts] of beltsBySystem.entries()) {
    if (systemBelts.length > 1) {
      return {
        systemID,
        belts: systemBelts,
      };
    }
  }

  assert.fail("expected at least one solar system with multiple asteroid belts");
}

test("scene creation loads stored asteroid belts and generated asteroid field objects", () => {
  runtime._testing.clearScenes();

  const { systemID, belts } = pickAsteroidBeltSystem();
  const profileScene = { systemID };
  const expectedAsteroidCount = belts.reduce((sum, belt) => {
    const style = asteroidData.getFieldStyleByID(belt.fieldStyleID);
    return sum + asteroidService._testing.buildCurvedFieldProfile(
      profileScene,
      belt,
      style,
      belts,
    ).count;
  }, 0);

  const scene = runtime.ensureScene(systemID);
  assert.ok(scene, "expected system scene");

  const beltEntities = scene.staticEntities.filter((entity) => entity.kind === "asteroidBelt");
  const asteroidEntities = scene.staticEntities.filter((entity) => entity.kind === "asteroid");

  assert.equal(
    beltEntities.length,
    belts.length,
    "expected all stored asteroid belt anchors to load into the scene",
  );
  assert.equal(
    asteroidEntities.length,
    expectedAsteroidCount,
    "expected deterministic asteroid field entities for every stored belt",
  );

  for (const belt of belts) {
    assert.ok(
      scene.getEntityByID(belt.itemID),
      `expected scene lookup for asteroid belt ${belt.itemID}`,
    );
  }
});

test("asteroid belts resolve as valid static NPC anchor targets", () => {
  runtime._testing.clearScenes();

  const { systemID, belts } = pickAsteroidBeltSystem();
  const result = resolveAnchors(systemID, { kind: "asteroidBelt" });

  assert.equal(result.success, true, "expected asteroid belt anchor resolution to succeed");
  assert.ok(result.data, "expected asteroid belt anchor data");
  assert.equal(
    result.data.anchors.length,
    belts.length,
    "expected every stored belt in the system to resolve as a static anchor",
  );
});

test("stored asteroid belts resolve through config multi-location lookup", () => {
  const { belts } = pickAsteroidBeltSystem();
  const belt = belts[0];
  const service = new ConfigService();
  const result = service.Handle_GetMultiLocationsEx(
    [[belt.itemID]],
    { characterID: 1, userid: 1 },
    null,
  );

  assert.ok(Array.isArray(result), "expected config location rowset payload");
  assert.ok(Array.isArray(result[1]), "expected config location rows");
  assert.equal(result[1].length, 1, "expected one resolved asteroid belt location row");

  const row = result[1][0];
  assert.equal(row[0], belt.itemID, "expected resolved location ID to match belt item ID");
  assert.equal(
    row[1],
    belt.itemName,
    "expected resolved location name to match stored asteroid belt name",
  );
  assert.equal(
    row[2],
    belt.solarSystemID,
    "expected resolved location system ID to match stored asteroid belt system",
  );
});

test("generated asteroid field objects stay bubble-scoped on grid", () => {
  runtime._testing.clearScenes();

  const { systemID } = pickMultiBeltSystem();
  const scene = runtime.ensureScene(systemID);
  const beltEntities = scene.staticEntities.filter((entity) => entity.kind === "asteroidBelt");
  const asteroidEntities = scene.staticEntities.filter((entity) => entity.kind === "asteroid");
  assert.ok(beltEntities.length > 1, "expected multiple asteroid belts in test scene");
  assert.ok(asteroidEntities.length > 0, "expected generated asteroid field entities");

  const shipEntity = {
    kind: "ship",
    itemID: 987654321000,
    position: { ...beltEntities[0].position },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    mode: "STOP",
    radius: 40,
    maxVelocity: 0,
    bubbleID: null,
  };
  scene.dynamicEntities.set(shipEntity.itemID, shipEntity);
  scene.reconcileEntityBubble(shipEntity);

  const session = {
    _space: {
      shipID: shipEntity.itemID,
    },
  };

  const visibleEntities = scene.getVisibleEntitiesForSession(session);
  const visibleEntityIDs = new Set(visibleEntities.map((entity) => entity.itemID));
  const nearAsteroid = asteroidEntities.find(
    (entity) => Number(entity.bubbleID) === Number(shipEntity.bubbleID),
  );
  const farAsteroid = asteroidEntities.find(
    (entity) => Number(entity.bubbleID) !== Number(shipEntity.bubbleID),
  );

  assert.ok(nearAsteroid, "expected at least one asteroid in the ship bubble");
  assert.ok(farAsteroid, "expected at least one asteroid outside the ship bubble");
  assert.equal(
    visibleEntityIDs.has(nearAsteroid.itemID),
    true,
    "expected nearby asteroid to stay visible on grid",
  );
  assert.equal(
    visibleEntityIDs.has(farAsteroid.itemID),
    false,
    "expected distant asteroid to be hidden from the current grid",
  );
});
