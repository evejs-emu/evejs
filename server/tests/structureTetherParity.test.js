const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const sourceDataDir = path.join(repoRoot, "server/src/newDatabase/data");
const testDataDir = path.join(os.tmpdir(), `elysian-eve-structure-tether-${process.pid}`);

function copyDatabaseTableForTest(tableName) {
  const sourceFile = path.join(sourceDataDir, tableName, "data.json");
  const targetFile = path.join(testDataDir, tableName, "data.json");
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.copyFileSync(sourceFile, targetFile);
}

fs.rmSync(testDataDir, { recursive: true, force: true });
fs.mkdirSync(testDataDir, { recursive: true });
for (const tableName of [
  "structures",
  "structureTypes",
  "structureTetherRestrictions",
]) {
  copyDatabaseTableForTest(tableName);
}
process.env.EVEJS_NEWDB_DATA_DIR = testDataDir;
process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const structureTethering = require(path.join(
  repoRoot,
  "server/src/space/structureTethering",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const structureTetherRestrictionState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureTetherRestrictionState",
));
const crimewatchState = require(path.join(
  repoRoot,
  "server/src/services/security/crimewatchState",
));
const database = require(path.join(repoRoot, "server/src/newDatabase"));

test.after(() => {
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

const DEFAULT_PASSIVE_STATE = Object.freeze({
  mass: 1_000_000,
  agility: 0.5,
  maxVelocity: 300,
  maxTargetRange: 250_000,
  maxLockedTargets: 7,
  signatureRadius: 50,
  scanResolution: 500,
  cloakingTargetingDelay: 0,
  capacitorCapacity: 1000,
  capacitorRechargeRate: 1000,
  shieldCapacity: 1000,
  shieldRechargeRate: 1000,
  armorHP: 1000,
  structureHP: 1000,
});

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function buildShipEntity(scene, itemID, position, options = {}) {
  return spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID,
    typeID: options.typeID ?? 606,
    characterID: options.characterID ?? 0,
    position,
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      ...(options.passiveResourceState || {}),
    },
  }, scene.systemID);
}

function attachSession(scene, entity, clientID, options = {}) {
  const notifications = [];
  const serviceNotifications = [];
  const session = {
    clientID,
    userid: options.characterID || entity.characterID || clientID,
    characterID: options.characterID || entity.characterID || clientID,
    charid: options.characterID || entity.characterID || clientID,
    corporationID: options.corporationID ?? 1000009,
    corpid: options.corporationID ?? 1000009,
    shipTypeID: options.shipTypeID ?? entity.typeID,
    socket: {
      destroyed: false,
      write() {},
    },
    _space: {
      systemID: scene.systemID,
      shipID: entity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification(serviceName, methodName, payload) {
      serviceNotifications.push({ serviceName, methodName, payload });
    },
    sendRawPayload() {},
  };

  entity.session = session;
  scene.spawnDynamicEntity(entity, { broadcast: false });
  scene.sessions.set(clientID, session);
  return {
    session,
    notifications,
    serviceNotifications,
  };
}

function advanceScene(scene, deltaMs) {
  const baseWallclock = Number(scene.lastWallclockTickAt) || scene.getCurrentWallclockMs();
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function advanceSceneUntil(scene, predicate, options = {}) {
  const stepMs = Math.max(1, Number(options.stepMs) || 250);
  const maxMs = Math.max(stepMs, Number(options.maxMs) || 10_000);
  for (let elapsedMs = 0; elapsedMs <= maxMs; elapsedMs += stepMs) {
    if (predicate()) {
      return true;
    }
    advanceScene(scene, stepMs);
  }
  return Boolean(predicate());
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
  structureState.clearStructureCaches();
  crimewatchState.clearAllCrimewatchState();
});

test("structure tethering engages in range, blocks incoming locks, and breaks on targeting or weapons timers", () => {
  const structuresBackup = readTable("structures");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    const testPosition = { x: 7000000000000, y: 0, z: 180000 };
    const createResult = structureState.createStructure({
      typeID: 35832,
      name: "Tether Test Astrahus",
      itemName: "Tether Test Astrahus",
      ownerCorpID: 1000009,
      solarSystemID: 30000142,
      position: testPosition,
      state: 110,
      upkeepState: 1,
      hasQuantumCore: true,
      accessProfile: {
        docking: "public",
        tethering: "public",
      },
      serviceStates: {
        "1": 1,
      },
    });
    assert.equal(createResult.success, true, "Expected structure creation to succeed");
    const structure = createResult.data;

    const scene = spaceRuntime.ensureScene(structure.solarSystemID);
    scene.syncStructureEntitiesFromState({ broadcast: false });
    const structureEntity = scene.getEntityByID(structure.structureID);
    assert.ok(structureEntity, "Expected the structure entity to exist in the scene");

    const tetheredShip = buildShipEntity(
      scene,
      910001,
      { x: structure.position.x + structure.radius + 500, y: 0, z: structure.position.z },
      {
        characterID: 140000011,
      },
    );
    tetheredShip.conditionState = {
      ...tetheredShip.conditionState,
      damage: 0.25,
      armorDamage: 0.5,
      shieldCharge: 0.4,
      charge: 0.3,
    };
    const distantTarget = buildShipEntity(
      scene,
      910002,
      { x: structure.position.x + 120000, y: 0, z: structure.position.z + 30000 },
      {
        characterID: 140000012,
      },
    );
    const hostileShip = buildShipEntity(
      scene,
      910003,
      { x: structure.position.x + 150000, y: 0, z: structure.position.z - 35000 },
      {
        characterID: 140000013,
      },
    );

    const tetheredSession = attachSession(scene, tetheredShip, 1001, {
      characterID: 140000011,
      corporationID: 1000009,
    });
    const distantTargetSession = attachSession(scene, distantTarget, 1002, {
      characterID: 140000012,
      corporationID: 1000008,
    });
    const hostileSession = attachSession(scene, hostileShip, 1003, {
      characterID: 140000013,
      corporationID: 1000008,
    });

    structureTetherRestrictionState.clearCharacterTetherRestrictions(
      tetheredSession.session.characterID,
      {
        nowMs: scene.getCurrentSimTimeMs(),
      },
    );

    advanceScene(scene, 1000);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      true,
      "Expected the in-range ship to acquire tethering",
    );
    assert.equal(
      Number(tetheredShip.structureTether && tetheredShip.structureTether.structureID) || 0,
      structure.structureID,
      "Expected tethering to bind to the nearby structure",
    );
    assert.equal(
      Number(tetheredShip.conditionState && tetheredShip.conditionState.damage) || 0,
      0,
      "Expected tether engage to repair hull damage",
    );
    assert.equal(
      Number(tetheredShip.conditionState && tetheredShip.conditionState.armorDamage) || 0,
      0,
      "Expected tether engage to repair armor damage",
    );
    assert.equal(
      Number(tetheredShip.conditionState && tetheredShip.conditionState.shieldCharge) || 0,
      1,
      "Expected tether engage to repair shield damage",
    );

    const hostileLockResult = scene.addTarget(
      hostileSession.session,
      tetheredShip.itemID,
    );
    assert.equal(hostileLockResult.success, false);
    assert.equal(
      hostileLockResult.errorMsg,
      "TARGET_TETHERED",
      "Expected tethered ships to reject incoming target locks",
    );

    const targetAttempt = scene.addTarget(
      tetheredSession.session,
      distantTarget.itemID,
    );
    assert.equal(targetAttempt.success, true, "Expected the tethered ship to be able to initiate a lock");
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      false,
      "Expected target-lock attempts to break tether immediately",
    );

    advanceScene(scene, Number(targetAttempt.data.lockDurationMs || 0) + 100);
    advanceSceneUntil(
      scene,
      () => scene.getTargets(tetheredSession.session).includes(distantTarget.itemID),
      {
        maxMs: 5_000,
      },
    );
    assert.deepEqual(
      scene.getTargets(tetheredSession.session),
      [distantTarget.itemID],
      "Expected the lock to complete after tether break",
    );

    advanceScene(scene, 1000);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      false,
      "Expected active target locks to keep tether from re-engaging",
    );

    const removeResult = scene.removeTarget(
      tetheredSession.session,
      distantTarget.itemID,
    );
    assert.equal(removeResult.success, true, "Expected the active lock to be removable");

    advanceScene(scene, 1000);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      true,
      "Expected tether to re-engage once the ship stops targeting",
    );

    crimewatchState.setCharacterCrimewatchDebugState(
      tetheredSession.session.characterID,
      {
        weaponTimerMs: 60_000,
      },
      {
        nowMs: scene.getCurrentSimTimeMs(),
      },
    );
    advanceScene(scene, 100);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      false,
      "Expected weapon timers to break tethering",
    );

    crimewatchState.setCharacterCrimewatchDebugState(
      tetheredSession.session.characterID,
      {
        weaponTimerMs: 0,
      },
      {
        nowMs: scene.getCurrentSimTimeMs(),
      },
    );
    advanceScene(scene, 1000);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      true,
      "Expected tethering to return once the weapon timer clears",
    );

    const scramResult = structureTetherRestrictionState.setCharacterTetherRestrictionFlags(
      tetheredSession.session.characterID,
      {
        warpScrambled: true,
      },
      {
        nowMs: scene.getCurrentSimTimeMs(),
      },
    );
    assert.equal(scramResult.success, true, "Expected warp-scramble restriction seeding to succeed");
    advanceScene(scene, 100);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      false,
      "Expected warp scramble to break tethering",
    );
    assert.equal(
      spaceRuntime.canDockAtStation(tetheredSession.session, structure.structureID),
      false,
      "Expected warp-scrambled ships to be unable to dock at Upwell structures",
    );
    const scrammedDockAttempt = scene.acceptDocking(
      tetheredSession.session,
      structure.structureID,
    );
    assert.equal(
      scrammedDockAttempt.success,
      false,
      "Expected the authoritative docking accept path to reject warp-scrambled structure docking",
    );
    assert.equal(
      scrammedDockAttempt.errorMsg,
      "WARP_SCRAMBLED",
      "Expected warp scramble to surface as the structure docking failure reason",
    );
    structureTetherRestrictionState.setCharacterTetherRestrictionFlags(
      tetheredSession.session.characterID,
      {
        warpScrambled: false,
      },
      {
        nowMs: scene.getCurrentSimTimeMs(),
      },
    );
    advanceScene(scene, 1000);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      true,
      "Expected tethering to return once warp scramble is cleared",
    );

    const cynoResult = structureTetherRestrictionState.setCharacterTetherRestrictionFlags(
      tetheredSession.session.characterID,
      {
        cynoActive: true,
      },
      {
        nowMs: scene.getCurrentSimTimeMs(),
      },
    );
    assert.equal(cynoResult.success, true, "Expected cyno restriction seeding to succeed");
    advanceScene(scene, 100);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      false,
      "Expected active cynos to break tethering",
    );
    structureTetherRestrictionState.setCharacterTetherRestrictionFlags(
      tetheredSession.session.characterID,
      {
        cynoActive: false,
      },
      {
        nowMs: scene.getCurrentSimTimeMs(),
      },
    );
    advanceScene(scene, 1000);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      true,
      "Expected tethering to return once the cyno restriction clears",
    );

    const fightersResult = structureTetherRestrictionState.setCharacterTetherRestrictionFlags(
      tetheredSession.session.characterID,
      {
        fightersLaunched: true,
      },
      {
        nowMs: scene.getCurrentSimTimeMs(),
      },
    );
    assert.equal(fightersResult.success, true, "Expected fighter restriction seeding to succeed");
    advanceScene(scene, 100);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      false,
      "Expected launched fighters to break tethering",
    );
    structureTetherRestrictionState.setCharacterTetherRestrictionFlags(
      tetheredSession.session.characterID,
      {
        fightersLaunched: false,
      },
      {
        nowMs: scene.getCurrentSimTimeMs(),
      },
    );
    advanceScene(scene, 1000);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      true,
      "Expected tethering to return once fighters are no longer launched",
    );

    const fwResult = structureTetherRestrictionState.setCharacterTetherRestrictionFlags(
      tetheredSession.session.characterID,
      {
        factionalWarfareBlocked: true,
      },
      {
        nowMs: scene.getCurrentSimTimeMs(),
      },
    );
    assert.equal(fwResult.success, true, "Expected FW restriction seeding to succeed");
    advanceScene(scene, 100);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      false,
      "Expected FW-restricted ships to lose tethering",
    );
    structureTetherRestrictionState.setCharacterTetherRestrictionFlags(
      tetheredSession.session.characterID,
      {
        factionalWarfareBlocked: false,
      },
      {
        nowMs: scene.getCurrentSimTimeMs(),
      },
    );
    advanceScene(scene, 1000);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      true,
      "Expected tethering to return once FW restrictions clear",
    );

    const delayResult = structureTetherRestrictionState.setCharacterTetherDelay(
      tetheredSession.session.characterID,
      30_000,
      {
        nowMs: scene.getCurrentSimTimeMs(),
      },
    );
    assert.equal(delayResult.success, true, "Expected tether delay seeding to succeed");
    advanceScene(scene, 100);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      false,
      "Expected tether delay to break active tethering",
    );
    advanceScene(scene, 29_000);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      false,
      "Expected tether delay to keep tethering suppressed until expiry",
    );
    advanceScene(scene, 2_000);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      true,
      "Expected tethering to return once the tether delay expires",
    );

    assert.ok(
      distantTargetSession.serviceNotifications.length >= 0,
      "Expected the observer sessions to remain intact during tether testing",
    );
  } finally {
    writeTable("structures", structuresBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
  }
});

test("structure tether FX replays once a tethered session becomes destiny-ready", () => {
  const structuresBackup = readTable("structures");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    const createResult = structureState.createStructure({
      typeID: 35832,
      name: "Tether Replay Astrahus",
      itemName: "Tether Replay Astrahus",
      ownerCorpID: 1000009,
      solarSystemID: 30000142,
      position: { x: 310000, y: 0, z: 210000 },
      state: 110,
      upkeepState: 1,
      hasQuantumCore: true,
      accessProfile: {
        docking: "public",
        tethering: "public",
      },
      serviceStates: {
        "1": 1,
      },
    });
    assert.equal(createResult.success, true, "Expected structure creation to succeed");
    const structure = createResult.data;

    const scene = spaceRuntime.ensureScene(structure.solarSystemID);
    scene.syncStructureEntitiesFromState({ broadcast: false });

    const tetheredShip = buildShipEntity(
      scene,
      910101,
      { x: structure.position.x + structure.radius + 500, y: 0, z: structure.position.z },
      {
        characterID: 140000101,
      },
    );
    const tetheredSession = attachSession(scene, tetheredShip, 1101, {
      characterID: 140000101,
      corporationID: 1000009,
    });
    tetheredSession.session._space.initialStateSent = false;

    const capturedPayloads = [];
    const originalSendDestinyUpdates = scene.sendDestinyUpdates.bind(scene);
    scene.sendDestinyUpdates = (session, payloads, waitForBubble, options) => {
      if (session === tetheredSession.session) {
        capturedPayloads.push(
          ...payloads.map((entry) => entry && entry.payload).filter(Boolean),
        );
      }
      return originalSendDestinyUpdates(session, payloads, waitForBubble, options);
    };

    advanceScene(scene, 1000);
    assert.equal(
      structureTethering.isEntityStructureTethered(tetheredShip),
      true,
      "Expected the ship to tether even before the session is destiny-ready",
    );
    assert.equal(
      capturedPayloads.some((payload) => Array.isArray(payload) && payload[0] === "OnSpecialFX"),
      false,
      "Expected no tether FX packet while the session is not destiny-ready",
    );

    tetheredSession.session._space.initialStateSent = true;
    const replayResult = scene.syncSessionStructureTetherState(
      tetheredSession.session,
      {
        forceReplayFx: true,
      },
    );
    assert.equal(replayResult.success, true, "Expected tether FX replay to succeed");

    const repairFxPayload = capturedPayloads.find(
      (payload) =>
        Array.isArray(payload) &&
        payload[0] === "OnSpecialFX" &&
        payload[1][5] === structureTethering.TETHER_REPAIR_FX_GUID,
    );
    assert.ok(repairFxPayload, "Expected tether repair FX replay to emit OnSpecialFX");
    assert.equal(repairFxPayload[1][0], tetheredShip.itemID);
    assert.equal(repairFxPayload[1][3], null);
    assert.equal(repairFxPayload[1][7], 1);
    assert.equal(repairFxPayload[1][8], 1);
    assert.equal(repairFxPayload[1][9], structureTethering.TETHER_REPAIR_DURATION_MS);
    assert.equal(repairFxPayload[1][10], structureTethering.TETHER_REPAIR_REPEAT);
    assert.deepEqual(repairFxPayload[1][13], { type: "dict", entries: [] });

    const tetherFxPayload = capturedPayloads.find(
      (payload) =>
        Array.isArray(payload) &&
        payload[0] === "OnSpecialFX" &&
        payload[1][5] === structureTethering.TETHER_FX_GUID,
    );
    assert.ok(tetherFxPayload, "Expected tether FX replay to emit OnSpecialFX");
    assert.equal(tetherFxPayload[1][0], tetheredShip.itemID);
    assert.equal(tetherFxPayload[1][3], structure.structureID);
    assert.equal(tetherFxPayload[1][5], structureTethering.TETHER_FX_GUID);
    assert.equal(tetherFxPayload[1][7], 1);
    assert.equal(tetherFxPayload[1][8], 1);
    assert.equal(tetherFxPayload[1][9], structureTethering.TETHER_LINK_DURATION_MS);
    assert.equal(tetherFxPayload[1][13].type, "dict");
    assert.equal(
      new Map(tetherFxPayload[1][13].entries).get("targetRadius"),
      structure.radius,
    );
    assert.equal(
      new Map(tetherFxPayload[1][13].entries).get("linkBarrier"),
      structure.radius + structure.tetheringRange,
    );
  } finally {
    writeTable("structures", structuresBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
  }
});

test("structure tether repair FX can be configured for both shield and armor visuals", () => {
  const structuresBackup = readTable("structures");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    const createResult = structureState.createStructure({
      typeID: 35832,
      name: "Dual Repair Tether Astrahus",
      itemName: "Dual Repair Tether Astrahus",
      ownerCorpID: 1000009,
      solarSystemID: 30000142,
      position: { x: 420000, y: 0, z: 250000 },
      state: 110,
      upkeepState: 1,
      hasQuantumCore: true,
      tetherRepairEffectMode: "both",
      accessProfile: {
        docking: "public",
        tethering: "public",
      },
      serviceStates: {
        "1": 1,
      },
    });
    assert.equal(createResult.success, true, "Expected structure creation to succeed");
    const structure = createResult.data;
    assert.equal(structure.tetherRepairEffectMode, "both");

    const scene = spaceRuntime.ensureScene(structure.solarSystemID);
    scene.syncStructureEntitiesFromState({ broadcast: false });

    const tetheredShip = buildShipEntity(
      scene,
      910201,
      { x: structure.position.x + structure.radius + 500, y: 0, z: structure.position.z },
      {
        characterID: 140000201,
      },
    );
    const tetheredSession = attachSession(scene, tetheredShip, 1201, {
      characterID: 140000201,
      corporationID: 1000009,
    });
    tetheredSession.session._space.initialStateSent = false;

    const capturedPayloads = [];
    const originalSendDestinyUpdates = scene.sendDestinyUpdates.bind(scene);
    scene.sendDestinyUpdates = (session, payloads, waitForBubble, options) => {
      if (session === tetheredSession.session) {
        capturedPayloads.push(
          ...payloads.map((entry) => entry && entry.payload).filter(Boolean),
        );
      }
      return originalSendDestinyUpdates(session, payloads, waitForBubble, options);
    };

    advanceScene(scene, 1000);
    tetheredSession.session._space.initialStateSent = true;
    const replayResult = scene.syncSessionStructureTetherState(
      tetheredSession.session,
      {
        forceReplayFx: true,
      },
    );
    assert.equal(replayResult.success, true, "Expected tether FX replay to succeed");

    const emittedGuids = capturedPayloads
      .filter((payload) => Array.isArray(payload) && payload[0] === "OnSpecialFX")
      .map((payload) => payload[1][5]);
    assert.equal(emittedGuids.includes(structureTethering.TETHER_SHIELD_REPAIR_FX_GUID), true);
    assert.equal(emittedGuids.includes(structureTethering.TETHER_ARMOR_REPAIR_FX_GUID), true);
    assert.equal(emittedGuids.includes(structureTethering.TETHER_REPAIR_FX_GUID), false);
    assert.equal(emittedGuids.includes(structureTethering.TETHER_FX_GUID), true);
  } finally {
    writeTable("structures", structuresBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
  }
});

test("structure tethering stays disabled while the structure quantum core is missing", () => {
  const structuresBackup = readTable("structures");

  try {
    const testPosition = { x: 7000100000000, y: 0, z: 180000 };
    const createResult = structureState.createStructure({
      typeID: 35832,
      name: "No Core Tether Test Astrahus",
      itemName: "No Core Tether Test Astrahus",
      ownerCorpID: 1000009,
      solarSystemID: 30000142,
      position: testPosition,
      state: 110,
      upkeepState: 1,
      hasQuantumCore: false,
      accessProfile: {
        docking: "public",
        tethering: "public",
      },
      serviceStates: {
        "1": 1,
      },
    });
    assert.equal(createResult.success, true, "Expected structure creation to succeed");
    const structure = createResult.data;

    const scene = spaceRuntime.ensureScene(structure.solarSystemID);
    scene.syncStructureEntitiesFromState({ broadcast: false });
    const ship = buildShipEntity(
      scene,
      910101,
      { x: structure.position.x + structure.radius + 500, y: 0, z: structure.position.z },
      {
        characterID: 140000111,
      },
    );
    attachSession(scene, ship, 1101, {
      characterID: 140000111,
      corporationID: 1000009,
    });

    advanceScene(scene, 1000);

    assert.equal(
      structureTethering.isEntityStructureTethered(ship),
      false,
      "Expected missing-core structures not to tether even with public docking and in-range positioning",
    );
  } finally {
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  }
});
