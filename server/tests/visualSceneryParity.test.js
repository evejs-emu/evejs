const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const authoredSpaceProps = require(path.join(repoRoot, "server/src/space/authoredSpaceProps"));
const defaultEmpireScenery = require(path.join(repoRoot, "server/src/space/defaultEmpireScenery"));
const destiny = require(path.join(repoRoot, "server/src/space/destiny"));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));

const JITA_SYSTEM_ID = 30000142;
const JITA_FOUR_FOUR_STATION_ID = 60003760;
const GATE_SENTRY_ITEM_ID_BASE = 8_420_000_000_000_000;
const STATION_SENTRY_ITEM_ID_BASE = 8_430_000_000_000_000;

function getSlimEntry(entity, key) {
  const slim = destiny.buildSlimItemDict(entity);
  return new Map(slim.entries).get(key);
}

function buildStationSentryItemID(stationID, slot) {
  return STATION_SENTRY_ITEM_ID_BASE + (Number(stationID) * 100) + Number(slot);
}

function buildGateSentryItemID(gateID, slot) {
  return GATE_SENTRY_ITEM_ID_BASE + (Number(gateID) * 100) + Number(slot);
}

function addVisibilityTestShip(scene, itemID, position, options = {}) {
  const entity = runtime._testing.buildRuntimeShipEntityForTesting(
    {
      itemID,
      typeID: 606,
      groupID: 25,
      categoryID: 6,
      ownerID: Number(options.ownerID || 500006),
      characterID: 0,
      corporationID: Number(options.corporationID || 1000125),
      itemName: String(options.itemName || `Visibility Ship ${itemID}`),
      npcEntityType: options.npcEntityType || "concord",
      spaceState: {
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
    },
    JITA_SYSTEM_ID,
    {
      persistSpaceState: false,
    },
  );
  scene.dynamicEntities.set(itemID, entity);
  scene.reconcileEntityPublicGrid(entity);
  scene.reconcileEntityBubble(entity);
  return entity;
}

function buildVisibilityTestContext(position) {
  const scene = new runtime._testing.SolarSystemScene(JITA_SYSTEM_ID);
  const shipID = 8_990_000_000_000_001;
  const session = {
    characterID: 90000001,
    socket: { destroyed: false },
    _space: {
      shipID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set(),
      visibleBubbleScopedStaticEntityIDs: new Set(),
      freshlyVisibleDynamicEntityIDs: new Set(),
      pilotWarpQuietUntilStamp: 0,
      clockOffsetMs: 0,
    },
  };
  const ship = runtime._testing.buildRuntimeShipEntityForTesting(
    {
      itemID: shipID,
      typeID: 606,
      groupID: 25,
      categoryID: 6,
      ownerID: session.characterID,
      characterID: session.characterID,
      corporationID: 98000001,
      itemName: "Visibility Test Ship",
      spaceState: {
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
    },
    JITA_SYSTEM_ID,
    {
      session,
      persistSpaceState: false,
    },
  );
  ship.session = session;
  scene.dynamicEntities.set(shipID, ship);
  scene.sessions.set(session.characterID, session);
  scene.reconcileEntityPublicGrid(ship);
  scene.reconcileEntityBubble(ship);
  scene.ensurePublicGridComposition();
  return { scene, session, ship };
}

test("authored static props use Public-grid visibility and safe item IDs", () => {
  authoredSpaceProps._testing.clearCacheForTests();
  const entities = authoredSpaceProps.getConfiguredStaticEntitiesForSystem(JITA_SYSTEM_ID);
  assert.ok(entities.length > 0, "expected copied Jita authored props");

  for (const entity of entities) {
    assert.equal(entity.staticVisibilityScope, "publicgrid");
    assert.notEqual(entity.destinyBootstrapDelivery, "addBalls2");
    assert.equal(entity.destinyCollisionTail, undefined);
    assert.equal(entity.destinyCollisionTailSource, undefined);
    assert.equal(Number.isSafeInteger(entity.itemID), true);
    assert.ok(entity.itemID > 0);
    assert.ok(String(entity.authoredSpacePropSourceItemID || "").length > 0);
  }
});

test("generated empire scenery uses Public-grid visibility", () => {
  const jita = worldData.getSolarSystemByID(JITA_SYSTEM_ID);
  assert.ok(jita, "expected Jita static data");

  const entities = defaultEmpireScenery._testing.buildSystemEntities(jita);
  assert.ok(
    entities.some((entity) => entity.kind === "billboard"),
    "expected default gate billboards",
  );
  assert.ok(
    entities.some((entity) => entity.kind === "sentryGun"),
    "expected default visual sentries",
  );

  for (const entity of entities) {
    assert.equal(entity.staticVisibilityScope, "publicgrid");
    assert.notEqual(entity.destinyBootstrapDelivery, "addBalls2");
  }
});

test("generated empire scenery slim items expose entity-standin standing thresholds", () => {
  const jita = worldData.getSolarSystemByID(JITA_SYSTEM_ID);
  assert.ok(jita, "expected Jita static data");

  const entities = defaultEmpireScenery._testing.buildSystemEntities(jita);
  const billboard = entities.find((entity) => entity.kind === "billboard");
  const sentry = entities.find((entity) => entity.kind === "sentryGun");
  assert.ok(billboard, "expected a generated billboard");
  assert.ok(sentry, "expected generated sentries");

  assert.equal(getSlimEntry(billboard, "hostile_response_threshold"), -11);
  assert.equal(getSlimEntry(billboard, "friendly_response_threshold"), 11);
  assert.equal(getSlimEntry(sentry, "hostile_response_threshold"), -11);
  assert.equal(getSlimEntry(sentry, "friendly_response_threshold"), -11);
});

test("client entity standings table supplies slim item thresholds for authored types", () => {
  const stronghold = {
    kind: "structure",
    itemID: 8_550_000_000_046_364,
    typeID: 46364,
    ownerID: 1000127,
    corporationID: 1000127,
    allianceID: 0,
    warFactionID: 0,
    itemName: "Blood Raiders Stronghold",
    state: 1,
    upkeepState: 1,
    deedState: 0,
    modules: [],
  };

  assert.equal(getSlimEntry(stronghold, "hostile_response_threshold"), 11);
  assert.equal(getSlimEntry(stronghold, "friendly_response_threshold"), 11);

  const explicitStandings = {
    ...stronghold,
    itemID: stronghold.itemID + 1,
    hostileResponseThreshold: -11,
    friendlyResponseThreshold: -11,
  };
  assert.equal(getSlimEntry(explicitStandings, "hostile_response_threshold"), -11);
  assert.equal(getSlimEntry(explicitStandings, "friendly_response_threshold"), -11);
});

test("Jita 4-4 exposes all eight generated station sentries on its public grid", () => {
  const station = worldData
    .getStationsForSystem(JITA_SYSTEM_ID)
    .find((row) => Number(row.stationID) === JITA_FOUR_FOUR_STATION_ID);
  assert.ok(station, "expected Jita 4-4");

  const { scene, session } = buildVisibilityTestContext(station.undockPosition);
  const visibleIDs = new Set(
    scene.getVisibleIncrementalStaticEntitiesForSession(session)
      .map((entity) => Number(entity.itemID)),
  );
  const expectedSentryIDs = Array.from(
    { length: 8 },
    (_, index) => buildStationSentryItemID(JITA_FOUR_FOUR_STATION_ID, index + 1),
  );

  assert.deepEqual(
    expectedSentryIDs.filter((entityID) => visibleIDs.has(entityID)),
    expectedSentryIDs,
  );
});

test("pilot warp quiet window keeps scenery until the coordinated grid handoff", () => {
  const station = worldData
    .getStationsForSystem(JITA_SYSTEM_ID)
    .find((row) => Number(row.stationID) === JITA_FOUR_FOUR_STATION_ID);
  const gate = worldData.getStargatesForSystem(JITA_SYSTEM_ID)[0];
  assert.ok(station);
  assert.ok(gate);

  const { scene, session, ship } = buildVisibilityTestContext(station.undockPosition);
  const stationVisibleIDs = new Set(
    scene.getVisibleIncrementalStaticEntitiesForSession(session)
      .map((entity) => Number(entity.itemID)),
  );
  session._space.visibleBubbleScopedStaticEntityIDs = stationVisibleIDs;

  ship.position = { ...gate.position };
  ship.mode = "WARP";
  ship.warpState = {
    startTimeMs: scene.getCurrentSimTimeMs(),
    targetPoint: { ...gate.position },
  };
  scene.reconcileEntityPublicGrid(ship);
  let sends = 0;
  scene.sendDestinyUpdates = () => {
    sends += 1;
  };

  scene.syncStaticVisibilityForSession(session, scene.getCurrentSimTimeMs());

  assert.equal(sends, 0);
  assert.deepEqual(
    session._space.visibleBubbleScopedStaticEntityIDs,
    stationVisibleIDs,
  );
});

test("warp grid handoff moves static scenery and dynamic security on one stamp", () => {
  const station = worldData
    .getStationsForSystem(JITA_SYSTEM_ID)
    .find((row) => Number(row.stationID) === JITA_FOUR_FOUR_STATION_ID);
  const gate = worldData
    .getStargatesForSystem(JITA_SYSTEM_ID)
    .find((row) => Number(row.itemID) === 50001248);
  assert.ok(station);
  assert.ok(gate);

  const { scene, session, ship } = buildVisibilityTestContext(station.undockPosition);
  const sourceSecurity = addVisibilityTestShip(
    scene,
    8_980_000_000_000_001,
    station.undockPosition,
    { itemName: "Source CONCORD" },
  );
  const destinationSecurity = addVisibilityTestShip(
    scene,
    8_980_000_000_000_002,
    gate.position,
    { itemName: "Destination EverMore" },
  );
  scene.ensurePublicGridComposition();

  const sourceStaticIDs = new Set(
    scene.getVisibleIncrementalStaticEntitiesForSession(session)
      .map((entity) => Number(entity.itemID)),
  );
  session._space.visibleDynamicEntityIDs = new Set([sourceSecurity.itemID]);
  session._space.visibleBubbleScopedStaticEntityIDs = sourceStaticIDs;

  const now = scene.getCurrentSimTimeMs();
  ship.mode = "WARP";
  ship.warpState = {
    startTimeMs: now - 5_000,
    targetPoint: { ...gate.position },
    rawDestination: { ...gate.position },
  };
  scene.beginPilotWarpVisibilityHandoff(ship, ship.warpState);
  session._space.pilotWarpVisibilityHandoff.destinationPrewarmed = true;

  ship.position = { ...gate.position };
  scene.reconcileEntityPublicGrid(ship);
  scene.ensurePublicGridComposition();

  const batches = [];
  scene.advancePilotWarpVisibilityHandoff(ship, now, batches);

  assert.equal(batches.length, 1);
  assert.equal(
    new Set(batches[0].updates.map((update) => Number(update.stamp))).size,
    1,
    "static and dynamic handoff updates must share one Destiny stamp",
  );
  assert.equal(
    session._space.visibleDynamicEntityIDs.has(destinationSecurity.itemID),
    true,
  );
  assert.equal(
    session._space.visibleDynamicEntityIDs.has(sourceSecurity.itemID),
    false,
  );

  const expectedGateSentryIDs = Array.from(
    { length: 8 },
    (_, index) => buildGateSentryItemID(gate.itemID, 91 + index),
  );
  for (const entityID of expectedGateSentryIDs) {
    assert.equal(
      session._space.visibleBubbleScopedStaticEntityIDs.has(entityID),
      true,
      `expected destination gate sentry ${entityID}`,
    );
  }
  for (const entityID of sourceStaticIDs) {
    assert.equal(
      session._space.visibleBubbleScopedStaticEntityIDs.has(entityID),
      false,
      `source-grid scenery ${entityID} must leave with source security`,
    );
  }
});
