const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  executeChatCommand,
} = require(path.join(repoRoot, "server/src/services/chat/chatCommands"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const structureLocatorGeometry = require(path.join(
  repoRoot,
  "server/src/services/structure/structureLocatorGeometry",
));
const structureTetherRestrictionState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureTetherRestrictionState",
));
const structureAutoState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureAutoState",
));
const {
  resolveShipByTypeID,
} = require(path.join(repoRoot, "server/src/services/chat/shipTypeRegistry"));

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function assertNearlyEqual(actual, expected, tolerance = 0.01, label = "value") {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function assertVectorAlmostEqual(actual, expected, tolerance = 0.01, label = "vector") {
  assertNearlyEqual(actual && actual.x, expected && expected.x, tolerance, `${label}.x`);
  assertNearlyEqual(actual && actual.y, expected && expected.y, tolerance, `${label}.y`);
  assertNearlyEqual(actual && actual.z, expected && expected.z, tolerance, `${label}.z`);
}

function getVectorMagnitude(vector) {
  return Math.sqrt(
    Math.pow(Number(vector && vector.x) || 0, 2) +
    Math.pow(Number(vector && vector.y) || 0, 2) +
    Math.pow(Number(vector && vector.z) || 0, 2),
  );
}

function getUndockDummiesForScene(scene) {
  return [...scene.dynamicEntities.values()].filter(
    (entity) => entity && entity.kind === "ship" && /Undock Dummy$/.test(String(entity.itemName || "")),
  );
}

test("/upwell GM commands can seed, advance, inspect, and remove a structure lifecycle", () => {
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    structureState.clearStructureCaches();

    const session = {
      clientID: 881001,
      characterID: 140000001,
      charid: 140000001,
      userid: 140000001,
      corporationID: 1000009,
      corpid: 1000009,
      shipTypeID: 606,
      solarsystemid2: 30000142,
      solarsystemid: 30000142,
    };
    const chatHub = {
      messages: [],
      sendSystemMessage(targetSession, message, channelID) {
        this.messages.push({ targetSession, message, channelID });
      },
    };

    const seedResult = executeChatCommand(
      session,
      "/upwell seed astrahus Chat Test Astrahus",
      chatHub,
      {},
    );
    assert.equal(seedResult.handled, true, "Expected /upwell seed to be handled");
    assert.match(
      String(seedResult.message || ""),
      /Seeded/,
      "Expected /upwell seed feedback",
    );

    const structure = structureState.getStructureByName("Chat Test Astrahus");
    assert.ok(structure, "Expected /upwell seed to persist the structure");

    executeChatCommand(session, `/upwell anchor ${structure.structureID}`, chatHub, {});
    executeChatCommand(session, `/upwell ff ${structure.structureID} 1000`, chatHub, {});
    executeChatCommand(session, `/upwell core ${structure.structureID} on`, chatHub, {});
    executeChatCommand(session, `/upwell ff ${structure.structureID} 90000`, chatHub, {});
    executeChatCommand(session, `/upwell ff ${structure.structureID} 1000`, chatHub, {});

    const onlineStructure = structureState.getStructureByID(structure.structureID);
    assert.equal(
      Number(onlineStructure && onlineStructure.state) || 0,
      110,
      "Expected the structure to reach shield_vulnerable after the GM timer fast-forward cycle",
    );

    const listResult = executeChatCommand(session, "/upwell list", chatHub, {});
    assert.match(
      String(listResult.message || ""),
      /Chat Test Astrahus/,
      "Expected /upwell list to include the seeded structure",
    );

    const timerResult = executeChatCommand(
      session,
      `/upwell timer ${structure.structureID} 0.01`,
      chatHub,
      {},
    );
    assert.match(
      String(timerResult.message || ""),
      /timer scale=0.01/i,
      "Expected /upwell timer to acknowledge the dev timer override",
    );

    const updatedStructure = structureState.getStructureByID(structure.structureID);
    assert.equal(
      Number(updatedStructure.devFlags && updatedStructure.devFlags.timerScale) || 0,
      0.01,
      "Expected /upwell timer to persist the structure timer scale override",
    );

    const tetherStatusResult = executeChatCommand(
      session,
      "/upwell tether status",
      chatHub,
      {},
    );
    assert.match(
      String(tetherStatusResult.message || ""),
      /scram=off/i,
      "Expected /upwell tether status to report the current tether restriction state",
    );

    const tetherScramResult = executeChatCommand(
      session,
      "/upwell tether scram on",
      chatHub,
      {},
    );
    assert.match(
      String(tetherScramResult.message || ""),
      /scram=on/i,
      "Expected /upwell tether scram to toggle the warp scramble restriction",
    );
    assert.equal(
      structureTetherRestrictionState.getCharacterTetherRestrictionState(session.characterID).warpScrambled,
      true,
      "Expected /upwell tether scram to persist the warp scramble flag",
    );

    const tetherDelayResult = executeChatCommand(
      session,
      "/upwell tether delay 30",
      chatHub,
      {},
    );
    assert.match(
      String(tetherDelayResult.message || ""),
      /delayMs=/i,
      "Expected /upwell tether delay to acknowledge the tether delay timer",
    );
    assert.ok(
      Number(
        structureTetherRestrictionState.getCharacterTetherRestrictionState(session.characterID).tetherDelayUntilMs,
      ) > 0,
      "Expected /upwell tether delay to persist a tether delay expiry",
    );

    const tetherClearResult = executeChatCommand(
      session,
      "/upwell tether clear",
      chatHub,
      {},
    );
    assert.match(
      String(tetherClearResult.message || ""),
      /Cleared tether restrictions/i,
      "Expected /upwell tether clear to acknowledge cleanup",
    );
    const clearedTetherState = structureTetherRestrictionState.getCharacterTetherRestrictionState(
      session.characterID,
    );
    assert.equal(clearedTetherState.warpScrambled, false);
    assert.equal(clearedTetherState.tetherDelayUntilMs, 0);

    const removeResult = executeChatCommand(
      session,
      `/upwell remove ${structure.structureID}`,
      chatHub,
      {},
    );
    assert.match(
      String(removeResult.message || ""),
      /Removed structure/i,
      "Expected /upwell remove to acknowledge structure cleanup",
    );
    assert.equal(
      structureState.getStructureByID(structure.structureID),
      null,
      "Expected /upwell remove to delete the persisted structure",
    );
  } finally {
    structureAutoState._testing.clearAllJobs();
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
  }
});

test("/upwell purge removes current-system structures and supports all-systems cleanup", () => {
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    writeTable("structures", {
      ...(structuresBackup || {}),
      structures: [],
    });
    structureState.clearStructureCaches();

    const primarySession = {
      clientID: 881101,
      characterID: 140000101,
      charid: 140000101,
      userid: 140000101,
      corporationID: 1000009,
      corpid: 1000009,
      shipTypeID: 606,
      solarsystemid2: 30000142,
      solarsystemid: 30000142,
    };
    const secondarySession = {
      ...primarySession,
      clientID: 881102,
      characterID: 140000102,
      charid: 140000102,
      userid: 140000102,
      solarsystemid2: 30002187,
      solarsystemid: 30002187,
    };
    const chatHub = {
      messages: [],
      sendSystemMessage(targetSession, message, channelID) {
        this.messages.push({ targetSession, message, channelID });
      },
    };

    executeChatCommand(primarySession, "/upwell seed astrahus Purge Local One", chatHub, {});
    executeChatCommand(primarySession, "/upwell seed astrahus Purge Local Two", chatHub, {});
    executeChatCommand(secondarySession, "/upwell seed astrahus Purge Remote One", chatHub, {});

    const localBefore = structureState.listStructuresForSystem(primarySession.solarsystemid2, {
      includeDestroyed: true,
    });
    const remoteBefore = structureState.listStructuresForSystem(secondarySession.solarsystemid2, {
      includeDestroyed: true,
    });
    assert.equal(localBefore.length, 2, "Expected two local structures before purge");
    assert.equal(remoteBefore.length, 1, "Expected one remote structure before purge");

    const purgeLocalResult = executeChatCommand(
      primarySession,
      "/upwell purge",
      chatHub,
      {},
    );
    assert.match(
      String(purgeLocalResult.message || ""),
      /Purged 2 persisted structures from solar system 30000142/i,
      "Expected /upwell purge to report current-system cleanup",
    );
    assert.equal(
      structureState.listStructuresForSystem(primarySession.solarsystemid2, {
        includeDestroyed: true,
      }).length,
      0,
      "Expected /upwell purge to remove current-system structures",
    );
    assert.equal(
      structureState.listStructuresForSystem(secondarySession.solarsystemid2, {
        includeDestroyed: true,
      }).length,
      1,
      "Expected /upwell purge not to touch other systems",
    );

    const purgeAllResult = executeChatCommand(
      primarySession,
      "/upwell purge all",
      chatHub,
      {},
    );
    assert.match(
      String(purgeAllResult.message || ""),
      /Purged 1 persisted structure across 1 solar system/i,
      "Expected /upwell purge all to report global cleanup",
    );
    assert.equal(
      structureState.listStructures({
        includeDestroyed: true,
      }).length,
      0,
      "Expected /upwell purge all to remove the remaining persisted structure",
    );
  } finally {
    structureAutoState._testing.clearAllJobs();
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
  }
});

test("/upwellauto can bring a seeded structure fully online and then destroy it without manual attacks", () => {
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    structureState.clearStructureCaches();
    structureAutoState._testing.clearAllJobs();

    const session = {
      clientID: 881201,
      characterID: 140000201,
      charid: 140000201,
      userid: 140000201,
      corporationID: 1000009,
      corpid: 1000009,
      shipTypeID: 606,
      solarsystemid2: 30000142,
      solarsystemid: 30000142,
    };
    const chatHub = {
      messages: [],
      sendSystemMessage(targetSession, message, channelID) {
        this.messages.push({ targetSession, message, channelID });
      },
    };

    const autoOnlineResult = executeChatCommand(
      session,
      "/upwellauto astrahus Auto Flow Astrahus",
      chatHub,
      {},
    );
    assert.equal(autoOnlineResult.handled, true, "Expected /upwellauto astrahus to be handled");
    assert.match(
      String(autoOnlineResult.message || ""),
      /Started Upwell online automation/i,
      "Expected /upwellauto astrahus to acknowledge the automation start",
    );

    const seededStructure = structureState.getStructureByName("Auto Flow Astrahus");
    assert.ok(seededStructure, "Expected /upwellauto astrahus to seed a structure");
    const structureID = seededStructure.structureID;

    for (let step = 0; step < 8; step += 1) {
      const activeJob = structureAutoState._testing.getJobByStructureID(structureID);
      if (!activeJob) {
        break;
      }
      structureAutoState._testing.runJobNow(activeJob.jobID);
    }

    const onlineStructure = structureState.getStructureByID(structureID);
    assert.equal(
      Number(onlineStructure && onlineStructure.state) || 0,
      110,
      "Expected /upwellauto online flow to reach shield_vulnerable",
    );
    assert.equal(
      Number(onlineStructure && onlineStructure.serviceStates && onlineStructure.serviceStates["1"]) || 0,
      1,
      "Expected /upwellauto online flow to leave docking online",
    );
    assert.equal(
      structureAutoState._testing.getJobByStructureID(structureID),
      null,
      "Expected the online automation job to stop once the structure is ready",
    );

    const autoDestroyResult = executeChatCommand(
      session,
      `/upwellauto ${structureID}`,
      chatHub,
      {},
    );
    assert.equal(autoDestroyResult.handled, true, "Expected /upwellauto <id> to be handled");
    assert.match(
      String(autoDestroyResult.message || ""),
      /No manual attack is required/i,
      "Expected /upwellauto <id> to explain that it uses GM damage internally",
    );

    for (let step = 0; step < 12; step += 1) {
      const activeJob = structureAutoState._testing.getJobByStructureID(structureID);
      if (!activeJob) {
        break;
      }
      structureAutoState._testing.runJobNow(activeJob.jobID);
    }

    const destroyedStructure = structureState.getStructureByID(structureID);
    assert.ok(
      Number(destroyedStructure && destroyedStructure.destroyedAt) > 0,
      "Expected /upwellauto <id> destruction flow to fully destroy the structure",
    );
    assert.equal(
      structureAutoState._testing.getJobByStructureID(structureID),
      null,
      "Expected the destruction automation job to stop after the structure is destroyed",
    );
  } finally {
    structureAutoState._testing.clearAllJobs();
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
  }
});

test("/upwellauto status and stop can inspect and cancel active Upwell automation jobs", () => {
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    structureState.clearStructureCaches();
    structureAutoState._testing.clearAllJobs();

    const session = {
      clientID: 881301,
      characterID: 140000301,
      charid: 140000301,
      userid: 140000301,
      corporationID: 1000009,
      corpid: 1000009,
      shipTypeID: 606,
      solarsystemid2: 30000142,
      solarsystemid: 30000142,
    };
    const chatHub = {
      messages: [],
      sendSystemMessage(targetSession, message, channelID) {
        this.messages.push({ targetSession, message, channelID });
      },
    };

    executeChatCommand(session, "/upwellauto astrahus Auto Stop Astrahus", chatHub, {});
    const structure = structureState.getStructureByName("Auto Stop Astrahus");
    assert.ok(structure, "Expected automation setup to seed a structure for stop testing");

    const statusResult = executeChatCommand(session, "/upwellauto status", chatHub, {});
    assert.match(
      String(statusResult.message || ""),
      /mode=online/i,
      "Expected /upwellauto status to list the active automation job",
    );

    const stopResult = executeChatCommand(session, `/upwellauto stop ${structure.structureID}`, chatHub, {});
    assert.match(
      String(stopResult.message || ""),
      /Stopped Upwell automation/i,
      "Expected /upwellauto stop to acknowledge cancellation",
    );
    assert.equal(
      structureAutoState._testing.getJobByStructureID(structure.structureID),
      null,
      "Expected /upwellauto stop to remove the active job",
    );
  } finally {
    structureAutoState._testing.clearAllJobs();
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
  }
});

test("/upwellauto undock spawns moving dummy hulls from real structure undock locators", () => {
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    spaceRuntime._testing.clearScenes();
    structureState.clearStructureCaches();
    structureAutoState._testing.clearAllJobs();

    const session = {
      clientID: 881401,
      characterID: 140000401,
      charid: 140000401,
      userid: 140000401,
      corporationID: 1000009,
      corpid: 1000009,
      shipTypeID: 638,
      solarsystemid2: 30000142,
      solarsystemid: 30000142,
    };
    const chatHub = {
      messages: [],
      sendSystemMessage(targetSession, message, channelID) {
        this.messages.push({ targetSession, message, channelID });
      },
    };

    const createResult = structureState.createStructure({
      typeID: 35834,
      name: "Auto Undock Keepstar",
      itemName: "Auto Undock Keepstar",
      ownerCorpID: 1000009,
      solarSystemID: 30000142,
      position: { x: 250000, y: 800, z: -125000 },
      rotation: [180, 0, 0],
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

    const undockResult = executeChatCommand(
      session,
      `/upwellauto undock ${structure.structureID} 12`,
      chatHub,
      {},
    );
    assert.equal(undockResult.handled, true, "Expected /upwellauto undock to be handled");
    assert.match(
      String(undockResult.message || ""),
      /Started staggered undock wave job=/i,
      "Expected /upwellauto undock to report the staggered wave job",
    );
    assert.match(
      String(undockResult.message || ""),
      /published\+unpublished/i,
      "Expected the default undock wave to include both published and unpublished hulls in the pool",
    );
    assert.match(
      String(undockResult.message || ""),
      /launch at each hull's max velocity/i,
      "Expected /upwellauto undock to mention max-velocity launch behavior",
    );

    const scene = spaceRuntime.ensureScene(structure.solarSystemID);
    const initialDummies = getUndockDummiesForScene(scene);
    assert.ok(
      initialDummies.length > 0 && initialDummies.length < 12,
      "Expected staggered undock waves to spawn only the first batch immediately",
    );
    const initialJob = structureAutoState._testing.getJobByStructureID(structure.structureID);
    assert.ok(initialJob, "Expected /upwellauto undock to create a background automation job");
    assert.ok(
      Number(initialJob.batchSize || 0) > 0 && Number(initialJob.batchSize || 0) < 12,
      "Expected the undock job to use a partial batch size",
    );

    let activeJob = initialJob;
    for (let step = 0; step < 20 && activeJob; step += 1) {
      structureAutoState._testing.runJobNow(activeJob.jobID);
      activeJob = structureAutoState._testing.getJobByStructureID(structure.structureID);
    }
    assert.equal(activeJob, null, "Expected the staggered undock job to complete after all batches");

    const dummies = getUndockDummiesForScene(scene);
    assert.equal(dummies.length, 12, "Expected the undock command to eventually spawn 12 dummy ships");

    const uniqueShipTypes = new Set();
    const uniquePositionKeys = new Set();
    for (const entity of dummies) {
      uniqueShipTypes.add(Number(entity.typeID) || 0);
      uniquePositionKeys.add(
        [
          Number(entity.position && entity.position.x || 0).toFixed(2),
          Number(entity.position && entity.position.y || 0).toFixed(2),
          Number(entity.position && entity.position.z || 0).toFixed(2),
        ].join(":"),
      );

      assert.equal(entity.mode, "GOTO", "Expected spawned dummies to undock in GOTO mode");
      assert.equal(entity.speedFraction, 1, "Expected spawned dummies to undock at full speed");
      assert.notDeepEqual(
        entity.targetPoint,
        entity.position,
        "Expected spawned dummies to have a forward travel target",
      );
      assertNearlyEqual(
        getVectorMagnitude(entity.velocity),
        entity.maxVelocity,
        0.2,
        `dummy-${entity.itemID}.velocityMagnitude`,
      );

      const expectedUndockState = spaceRuntime.getStationUndockSpawnState(structure, {
        shipTypeID: entity.typeID,
        selectionStrategy: "hash",
        selectionKey: `${structure.structureID}:${entity.itemID}`,
      });
      assertVectorAlmostEqual(
        entity.position,
        expectedUndockState.position,
        0.05,
        `dummy-${entity.itemID}.position`,
      );
      assertVectorAlmostEqual(
        entity.direction,
        expectedUndockState.direction,
        0.0001,
        `dummy-${entity.itemID}.direction`,
      );
      assert.equal(
        expectedUndockState.locatorCategory,
        structureLocatorGeometry.getUndockCategoryByShipType(entity.typeID),
        `Expected dummy ${entity.itemID} to use the correct hull-size locator family`,
      );
    }

    assert.ok(uniqueShipTypes.size > 1, "Expected the undock wave to sample multiple hull types");
    assert.ok(uniquePositionKeys.size > 1, "Expected the undock wave to spread across multiple undock points");
  } finally {
    structureAutoState._testing.clearAllJobs();
    spaceRuntime._testing.clearScenes();
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
    structureLocatorGeometry.clearStructureLocatorGeometryCache();
  }
});

test("/upwellauto undock can restrict the dummy hull pool to unpublished ships only", () => {
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    spaceRuntime._testing.clearScenes();
    structureState.clearStructureCaches();
    structureAutoState._testing.clearAllJobs();

    const session = {
      clientID: 881402,
      characterID: 140000402,
      charid: 140000402,
      userid: 140000402,
      corporationID: 1000009,
      corpid: 1000009,
      shipTypeID: 638,
      solarsystemid2: 30000142,
      solarsystemid: 30000142,
    };
    const chatHub = {
      messages: [],
      sendSystemMessage(targetSession, message, channelID) {
        this.messages.push({ targetSession, message, channelID });
      },
    };

    const createResult = structureState.createStructure({
      typeID: 35834,
      name: "Auto Unpublished Undock Keepstar",
      itemName: "Auto Unpublished Undock Keepstar",
      ownerCorpID: 1000009,
      solarSystemID: 30000142,
      position: { x: 325000, y: 1200, z: -215000 },
      rotation: [180, 0, 0],
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

    const undockResult = executeChatCommand(
      session,
      `/upwellauto undock ${structure.structureID} 10 unpublished`,
      chatHub,
      {},
    );
    assert.equal(undockResult.handled, true, "Expected /upwellauto undock unpublished to be handled");
    assert.match(
      String(undockResult.message || ""),
      /unpublished-only/i,
      "Expected /upwellauto undock unpublished to acknowledge the restricted hull pool",
    );
    assert.match(
      String(undockResult.message || ""),
      /Started staggered undock wave job=/i,
      "Expected unpublished undock waves to use the same staggered job path",
    );

    const scene = spaceRuntime.ensureScene(structure.solarSystemID);
    const initialDummies = getUndockDummiesForScene(scene);
    assert.ok(
      initialDummies.length > 0 && initialDummies.length < 10,
      "Expected unpublished undock waves to start with a partial first batch",
    );
    let activeJob = structureAutoState._testing.getJobByStructureID(structure.structureID);
    assert.ok(activeJob, "Expected unpublished undock waves to create an active job");
    for (let step = 0; step < 20 && activeJob; step += 1) {
      structureAutoState._testing.runJobNow(activeJob.jobID);
      activeJob = structureAutoState._testing.getJobByStructureID(structure.structureID);
    }
    assert.equal(activeJob, null, "Expected the unpublished-only undock job to complete");

    const dummies = getUndockDummiesForScene(scene);
    assert.equal(dummies.length, 10, "Expected the unpublished-only undock wave to spawn 10 dummy ships");
    assert.ok(
      dummies.every((entity) => {
        const shipType = resolveShipByTypeID(entity.typeID);
        return shipType && shipType.published === false;
      }),
      "Expected every unpublished-only dummy hull to resolve to an unpublished ship type",
    );
  } finally {
    structureAutoState._testing.clearAllJobs();
    spaceRuntime._testing.clearScenes();
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
    structureLocatorGeometry.clearStructureLocatorGeometryCache();
  }
});
