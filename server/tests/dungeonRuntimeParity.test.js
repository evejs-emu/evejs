const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const dungeonAuthority = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonAuthority",
));
const dungeonRuntime = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonRuntime",
));
const dungeonRuntimeState = require(path.join(
  repoRoot,
  "server/src/services/dungeon/dungeonRuntimeState",
));

const SNAPSHOT_TABLES = [
  "dungeonRuntimeState",
];

function readTable(tableName) {
  const result = database.read(tableName, "/");
  return result && result.success ? JSON.parse(JSON.stringify(result.data)) : {};
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to restore ${tableName}`);
}

function withSnapshots(fn) {
  return async () => {
    const snapshots = Object.fromEntries(
      SNAPSHOT_TABLES.map((tableName) => [tableName, readTable(tableName)]),
    );
    try {
      dungeonAuthority.clearCache();
      dungeonRuntime.resetRuntimeForTests();
      await fn();
    } finally {
      for (const [tableName, payload] of Object.entries(snapshots)) {
        writeTable(tableName, payload);
      }
      dungeonRuntime.clearRuntimeCache();
      dungeonAuthority.clearCache();
    }
  };
}

function findTemplateID(predicate, description) {
  const payload = dungeonAuthority.getPayload();
  for (const [templateID, template] of Object.entries(payload.templatesByID || {})) {
    if (predicate(template)) {
      return templateID;
    }
  }
  assert.fail(`Expected dungeon authority to contain template for ${description}`);
}

test("dungeon runtime creates cached persisted instances from authority templates", withSnapshots(() => {
  const created = dungeonRuntime.createInstance({
    templateID: "client-dungeon:43",
    solarSystemID: 30000142,
    siteKey: "sig:test:43",
    position: { x: 11, y: 22, z: 33 },
    lifecycleState: "active",
    characterID: 140000001,
    visibilityScope: "owner",
    metadata: { source: "test" },
    runtimeFlags: { seeded: true },
    nowMs: 1234567890,
  });

  assert.equal(created.instanceID > 0, true);
  assert.equal(created.templateID, "client-dungeon:43");
  assert.equal(created.siteFamily, dungeonAuthority.getTemplateByID("client-dungeon:43").siteFamily);
  assert.equal(created.ownership.characterID, 140000001);
  assert.equal(created.position.x, 11);

  const bySystem = dungeonRuntime.listInstancesBySystem(30000142);
  const byFamily = dungeonRuntime.listInstancesByFamily(created.siteFamily);
  const byTemplate = dungeonRuntime.listInstancesByTemplate("client-dungeon:43");
  const bySiteKey = dungeonRuntime.findInstanceBySiteKey("sig:test:43");

  assert.equal(bySystem.length, 1);
  assert.equal(byTemplate.length, 1);
  assert.equal(byFamily.some((entry) => entry.instanceID === created.instanceID), true);
  assert.equal(bySiteKey.instanceID, created.instanceID);
  assert.equal(dungeonRuntime.listActiveInstancesBySystem(30000142).length, 1);
}));

test("dungeon runtime seeds rooms gates objectives and environment from authority templates and supports progression updates", withSnapshots(() => {
  const roomTemplateID = findTemplateID((template) => (
    Array.isArray(template && template.connections) &&
    template.connections.length > 0 &&
    template.environmentTemplates &&
    template.environmentTemplates.roomTemplates &&
    Object.keys(template.environmentTemplates.roomTemplates).length > 0
  ), "room/gate/environment seeding");
  const objectiveTemplateID = findTemplateID((template) => (
    template &&
    template.clientObjectives &&
    Number(template.clientObjectives.objectiveChainID) > 0 &&
    Number(template.clientObjectives.nodeGraphID) > 0
  ), "objective-chain seeding");

  const roomInstance = dungeonRuntime.createInstance({
    templateID: roomTemplateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:seeded-progression",
    lifecycleState: "active",
    nowMs: 5000,
  });

  assert.ok(roomInstance.roomStatesByKey["room:entry"]);
  assert.equal(roomInstance.roomStatesByKey["room:entry"].state, "active");
  const extraRoomKeys = Object.keys(roomInstance.roomStatesByKey).filter((key) => key !== "room:entry");
  assert.equal(extraRoomKeys.length > 0, true);
  const firstExtraRoomKey = extraRoomKeys.sort()[0];
  assert.equal(roomInstance.roomStatesByKey[firstExtraRoomKey].state, "pending");

  const gateKeys = Object.keys(roomInstance.gateStatesByKey || {});
  assert.equal(gateKeys.length > 0, true);
  const firstGateKey = gateKeys.sort()[0];
  assert.equal(roomInstance.gateStatesByKey[firstGateKey].state, "locked");
  assert.equal(
    roomInstance.gateStatesByKey[firstGateKey].metadata.seededFromTemplate,
    true,
  );
  assert.equal(
    roomInstance.gateStatesByKey[firstGateKey].destinationRoomKey,
    firstExtraRoomKey,
  );
  assert.ok(roomInstance.environmentState);
  assert.ok(roomInstance.environmentState.templates);

  dungeonRuntime.activateRoom(roomInstance.instanceID, firstExtraRoomKey, {
    nowMs: 5100,
  });
  dungeonRuntime.unlockGate(roomInstance.instanceID, firstGateKey, {
    nowMs: 5200,
    destinationRoomKey: firstExtraRoomKey,
  });
  dungeonRuntime.recordGateUse(roomInstance.instanceID, firstGateKey, {
    nowMs: 5300,
    state: "used",
  });

  const progressedRoomInstance = dungeonRuntime.getInstance(roomInstance.instanceID);
  assert.equal(progressedRoomInstance.roomStatesByKey[firstExtraRoomKey].state, "active");
  assert.equal(progressedRoomInstance.gateStatesByKey[firstGateKey].state, "used");
  assert.equal(progressedRoomInstance.gateStatesByKey[firstGateKey].usesCount, 1);
  assert.equal(progressedRoomInstance.gateStatesByKey[firstGateKey].destinationRoomKey, firstExtraRoomKey);

  const objectiveInstance = dungeonRuntime.createInstance({
    templateID: objectiveTemplateID,
    solarSystemID: 30000142,
    siteKey: "sig:test:objective-progression",
    lifecycleState: "active",
    nowMs: 6000,
  });

  assert.equal(objectiveInstance.objectiveState.state, "seeded");
  assert.equal(Number(objectiveInstance.objectiveState.currentObjectiveID) > 0, true);
  assert.equal(Number(objectiveInstance.objectiveState.currentNodeID) > 0, true);
  assert.equal(Boolean(objectiveInstance.objectiveState.currentObjectiveKey), true);
  assert.equal(Number(objectiveInstance.objectiveState.currentObjectiveTypeID) > 0, true);
  assert.equal(
    Array.isArray(objectiveInstance.objectiveState.metadata.objectiveTypeIDs) &&
      objectiveInstance.objectiveState.metadata.objectiveTypeIDs.length > 0,
    true,
  );
  assert.equal(
    Array.isArray(objectiveInstance.objectiveState.metadata.nodeTypeIDs) &&
      objectiveInstance.objectiveState.metadata.nodeTypeIDs.length > 0,
    true,
  );
  assert.equal(
    Boolean(
      objectiveInstance.objectiveState.metadata.objectiveSummary &&
      Array.isArray(objectiveInstance.objectiveState.metadata.objectiveSummary.objectiveKeys) &&
      objectiveInstance.objectiveState.metadata.objectiveSummary.objectiveKeys.length > 0,
    ),
    true,
  );
  const seededObjectiveID = Number(objectiveInstance.objectiveState.currentObjectiveID);
  const seededNodeID = Number(objectiveInstance.objectiveState.currentNodeID);

  dungeonRuntime.advanceObjective(objectiveInstance.instanceID, {
    state: "completed",
    completedObjectiveID: seededObjectiveID,
    completedNodeID: seededNodeID,
  }, {
    nowMs: 6100,
  });

  const progressedObjectiveInstance = dungeonRuntime.getInstance(objectiveInstance.instanceID);
  assert.equal(progressedObjectiveInstance.objectiveState.state, "completed");
  assert.deepEqual(
    progressedObjectiveInstance.objectiveState.completedObjectiveIDs,
    [seededObjectiveID],
  );
  assert.deepEqual(
    progressedObjectiveInstance.objectiveState.completedNodeIDs,
    [seededNodeID],
  );
  assert.equal(
    Number(progressedObjectiveInstance.objectiveState.metadata.lastAdvancedAtMs),
    6100,
  );
}));

test("dungeon runtime room gate and objective state survives cache reload", withSnapshots(() => {
  const created = dungeonRuntime.createInstance({
    templateID: "client-dungeon:47",
    solarSystemID: 30000142,
    siteKey: "sig:test:47",
    lifecycleState: "seeded",
    nowMs: 2000,
  });

  dungeonRuntime.upsertRoomState(created.instanceID, "room:alpha", {
    state: "active",
    pocketID: 9001,
    spawnedEntityIDs: [5001, 5002],
    counters: { containers: 2 },
  }, { nowMs: 2500 });
  dungeonRuntime.upsertGateState(created.instanceID, "gate:alpha-beta", {
    state: "unlocked",
    usesCount: 1,
    destinationRoomKey: "room:beta",
    allowedShipTypeIDs: [587],
  }, { nowMs: 2600 });
  dungeonRuntime.mergeObjectiveState(created.instanceID, {
    state: "in_progress",
    currentObjectiveID: 7001,
    completedObjectiveIDs: [7000],
    counters: { hacks: 1 },
  }, { nowMs: 2700 });

  dungeonRuntime.clearRuntimeCache();
  const reloaded = dungeonRuntime.getInstance(created.instanceID);

  assert.equal(reloaded.roomStatesByKey["room:alpha"].pocketID, 9001);
  assert.deepEqual(reloaded.roomStatesByKey["room:alpha"].spawnedEntityIDs, [5001, 5002]);
  assert.equal(reloaded.gateStatesByKey["gate:alpha-beta"].destinationRoomKey, "room:beta");
  assert.deepEqual(reloaded.gateStatesByKey["gate:alpha-beta"].allowedShipTypeIDs, [587]);
  assert.equal(reloaded.objectiveState.currentObjectiveID, 7001);
  assert.deepEqual(reloaded.objectiveState.completedObjectiveIDs, [7000]);
  assert.equal(reloaded.timers.lastUpdatedAtMs, 2700);
}));

test("dungeon runtime lifecycle filters exclude despawned instances from active system indexes", withSnapshots(() => {
  const created = dungeonRuntime.createInstance({
    templateID: "client-dungeon:43",
    solarSystemID: 30000142,
    siteKey: "sig:test:lifecycle",
    lifecycleState: "active",
    nowMs: 3000,
  });

  assert.equal(dungeonRuntime.listActiveInstancesBySystem(30000142).length, 1);

  dungeonRuntime.setLifecycleState(created.instanceID, "despawned", {
    lifecycleReason: "cleanup",
    despawnAtMs: 4000,
    nowMs: 4000,
  });

  const summary = dungeonRuntime.getInstanceSummary(created.instanceID);
  assert.equal(summary.lifecycleState, "despawned");
  assert.equal(summary.lifecycleReason, "cleanup");
  assert.equal(dungeonRuntime.listActiveInstancesBySystem(30000142).length, 0);
  assert.equal(dungeonRuntime.listInstancesBySystem(30000142).length, 1);

  dungeonRuntime.purgeInstance(created.instanceID);
  assert.equal(dungeonRuntime.getInstance(created.instanceID), null);
  assert.equal(dungeonRuntimeState.getStateSnapshot().nextInstanceSequence >= 2, true);
}));

test("dungeon runtime merges spawn hazard environment state, emits change events, and expires due instances on tick", withSnapshots(() => {
  const listenerEvents = [];
  const listener = (change) => {
    listenerEvents.push(change);
  };
  dungeonRuntime.registerInstanceChangeListener(listener);

  try {
    const created = dungeonRuntime.createInstance({
      templateID: "client-dungeon:43",
      solarSystemID: 30000142,
      siteKey: "sig:test:tick-expiry",
      lifecycleState: "active",
      expiresAtMs: 5000,
      nowMs: 1000,
    });

    dungeonRuntime.mergeSpawnState(created.instanceID, {
      wave: 1,
      containersRemaining: 3,
    }, { nowMs: 2000 });
    dungeonRuntime.mergeHazardState(created.instanceID, {
      timerEndsAtMs: 4500,
      trapArmed: true,
    }, { nowMs: 2500 });
    dungeonRuntime.mergeEnvironmentState(created.instanceID, {
      activePocketKey: "room:entry",
    }, { nowMs: 3000 });
    dungeonRuntime.synchronizeInstancePosition(created.instanceID, {
      x: 111,
      y: 222,
      z: 333,
    }, { nowMs: 3500 });

    const tickSummary = dungeonRuntime.tickRuntime({ nowMs: 5000 });
    const reloaded = dungeonRuntime.getInstance(created.instanceID);

    assert.equal(tickSummary.expiredCount, 1);
    assert.deepEqual(tickSummary.expiredInstanceIDs, [created.instanceID]);
    assert.equal(reloaded.lifecycleState, "despawned");
    assert.equal(reloaded.lifecycleReason, "expired");
    assert.equal(reloaded.spawnState.wave, 1);
    assert.equal(reloaded.hazardState.trapArmed, true);
    assert.equal(reloaded.environmentState.activePocketKey, "room:entry");
    assert.deepEqual(reloaded.position, { x: 111, y: 222, z: 333 });

    assert.equal(
      listenerEvents.some((change) => change.changeType === "created"),
      true,
    );
    assert.equal(
      listenerEvents.some((change) => (
        change.changeType === "updated" &&
        change.metadata &&
        change.metadata.source === "merge:spawnState"
      )),
      true,
    );
    assert.equal(
      listenerEvents.some((change) => (
        change.changeType === "updated" &&
        change.metadata &&
        change.metadata.transition === "expired"
      )),
      true,
    );
  } finally {
    dungeonRuntime.unregisterInstanceChangeListener(listener);
  }
}));

test("dungeon runtime batches persistent universe rotations without changing site replacement behavior", withSnapshots(() => {
  const listenerEvents = [];
  const listener = (change) => {
    listenerEvents.push(change);
  };
  dungeonRuntime.registerInstanceChangeListener(listener);

  try {
    const first = dungeonRuntime.createInstance({
      templateID: "client-dungeon:43",
      solarSystemID: 30000142,
      siteKey: "sig:test:rotate:1",
      lifecycleState: "despawned",
      siteFamily: "combat",
      siteKind: "signature",
      siteOrigin: "universe_dungeon",
      runtimeFlags: {
        universePersistent: true,
        universeSeeded: true,
      },
      metadata: {
        spawnFamilyKey: "combat",
      },
      spawnState: {
        spawnFamilyKey: "combat",
        slotIndex: 0,
        rotationIndex: 0,
      },
      nowMs: 1000,
    });
    const second = dungeonRuntime.createInstance({
      templateID: "client-dungeon:43",
      solarSystemID: 30000142,
      siteKey: "sig:test:rotate:2",
      lifecycleState: "completed",
      siteFamily: "combat",
      siteKind: "signature",
      siteOrigin: "universe_dungeon",
      runtimeFlags: {
        universePersistent: true,
        universeSeeded: true,
      },
      metadata: {
        spawnFamilyKey: "combat",
      },
      spawnState: {
        spawnFamilyKey: "combat",
        slotIndex: 1,
        rotationIndex: 0,
      },
      nowMs: 1000,
    });

    const summary = dungeonRuntime.rotateUniversePersistentInstances([
      {
        existingInstance: first,
        nextDefinition: {
          templateID: "client-dungeon:43",
          solarSystemID: 30000142,
          siteKey: "sig:test:rotate:1",
          lifecycleState: "seeded",
          siteFamily: "combat",
          siteKind: "signature",
          siteOrigin: "universe_dungeon",
          runtimeFlags: {
            universePersistent: true,
            universeSeeded: true,
          },
          metadata: {
            spawnFamilyKey: "combat",
          },
          spawnState: {
            spawnFamilyKey: "combat",
            slotIndex: 0,
            rotationIndex: 1,
          },
        },
      },
      {
        existingInstance: second,
        nextDefinition: {
          templateID: "client-dungeon:43",
          solarSystemID: 30000142,
          siteKey: "sig:test:rotate:2",
          lifecycleState: "seeded",
          siteFamily: "combat",
          siteKind: "signature",
          siteOrigin: "universe_dungeon",
          runtimeFlags: {
            universePersistent: true,
            universeSeeded: true,
          },
          metadata: {
            spawnFamilyKey: "combat",
          },
          spawnState: {
            spawnFamilyKey: "combat",
            slotIndex: 1,
            rotationIndex: 1,
          },
        },
      },
    ], { nowMs: 2000 });

    assert.equal(summary.rotatedCount, 2);
    assert.equal(summary.createdCount, 2);
    assert.equal(summary.removedCount, 2);
    assert.equal(dungeonRuntime.getInstance(first.instanceID), null);
    assert.equal(dungeonRuntime.getInstance(second.instanceID), null);

    const rotatedFirst = dungeonRuntime.findInstanceBySiteKey("sig:test:rotate:1", { full: true });
    const rotatedSecond = dungeonRuntime.findInstanceBySiteKey("sig:test:rotate:2", { full: true });
    assert.ok(rotatedFirst);
    assert.ok(rotatedSecond);
    assert.notEqual(rotatedFirst.instanceID, first.instanceID);
    assert.notEqual(rotatedSecond.instanceID, second.instanceID);
    assert.equal(rotatedFirst.spawnState.rotationIndex, 1);
    assert.equal(rotatedSecond.spawnState.rotationIndex, 1);

    const removedEvents = listenerEvents.filter((change) => change.changeType === "removed");
    const createdEvents = listenerEvents.filter((change) => change.changeType === "created");
    assert.equal(removedEvents.length, 2);
    assert.equal(createdEvents.length >= 4, true);
    assert.equal(
      removedEvents.every((change) => (
        change.metadata &&
        change.metadata.source === "rotateUniversePersistentInstances"
      )),
      true,
    );
    assert.equal(
      createdEvents.slice(-2).every((change) => (
        change.metadata &&
        change.metadata.source === "rotateUniversePersistentInstances"
      )),
      true,
    );
  } finally {
    dungeonRuntime.unregisterInstanceChangeListener(listener);
  }
}));

test("dungeon runtime can expire due instances without emitting per-instance change events", withSnapshots(() => {
  const listenerEvents = [];
  const listener = (change) => {
    listenerEvents.push(change);
  };
  dungeonRuntime.registerInstanceChangeListener(listener);

  try {
    const created = dungeonRuntime.createInstance({
      templateID: "client-dungeon:43",
      solarSystemID: 30000142,
      siteKey: "sig:test:tick-no-events",
      lifecycleState: "active",
      expiresAtMs: 5000,
      nowMs: 1000,
    });

    listenerEvents.length = 0;
    const tickSummary = dungeonRuntime.tickRuntime({
      nowMs: 5000,
      lifecycleReason: "startup-resume",
      emitChanges: false,
    });

    assert.equal(tickSummary.expiredCount, 1);
    assert.equal(dungeonRuntime.getInstance(created.instanceID).lifecycleState, "despawned");
    assert.deepEqual(listenerEvents, []);
  } finally {
    dungeonRuntime.unregisterInstanceChangeListener(listener);
  }
}));
