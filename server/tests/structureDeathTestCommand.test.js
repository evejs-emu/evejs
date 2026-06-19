const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  AVAILABLE_SLASH_COMMANDS,
  COMMANDS_HELP_TEXT,
  executeChatCommand,
} = require(path.join(repoRoot, "server/src/services/chat/chatCommands"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const structureDeathTestRuntime = require(path.join(
  repoRoot,
  "server/src/services/structure/structureDeathTestRuntime",
));
const {
  findItemById,
  resetInventoryStoreForTests,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));

const TEST_SYSTEM_ID = 30000142;

const DEFAULT_PASSIVE_STATE = Object.freeze({
  mass: 1_000_000,
  agility: 0.5,
  maxVelocity: 300,
  maxTargetRange: 250_000,
  maxLockedTargets: 7,
  signatureRadius: 50,
  scanResolution: 500,
  capacitorCapacity: 1000,
  capacitorRechargeRate: 1000,
  shieldCapacity: 1000,
  shieldRechargeRate: 1000,
  armorHP: 1000,
  structureHP: 1000,
});

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return cloneValue(result.data);
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function buildChatHub() {
  return {
    messages: [],
    sendSystemMessage(targetSession, message, channelID) {
      this.messages.push({ targetSession, message, channelID });
    },
  };
}

function buildSpaceSession(options = {}) {
  const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
  const shipID = options.shipID || 990770001;
  const characterID = options.characterID || 140000001;
  const entity = spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID: shipID,
    typeID: 606,
    characterID,
    corporationID: 1000009,
    position: options.position || { x: 0, y: 0, z: 0 },
    direction: options.direction || { x: 1, y: 0, z: 0 },
    passiveResourceState: DEFAULT_PASSIVE_STATE,
  }, TEST_SYSTEM_ID);
  const session = {
    clientID: options.clientID || 99077,
    characterID,
    charid: characterID,
    userid: characterID,
    corporationID: 1000009,
    corpid: 1000009,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    _space: {
      systemID: TEST_SYSTEM_ID,
      shipID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    socket: {
      destroyed: false,
    },
    sendNotification() {},
    sendServiceNotification() {},
  };

  entity.session = session;
  scene.spawnDynamicEntity(entity, { broadcast: false });
  scene.sessions.set(session.clientID, session);
  return {
    scene,
    session,
    entity,
  };
}

test.afterEach(() => {
  structureDeathTestRuntime._testing.clearPendingStructureDeathTests();
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();
  spaceRuntime._testing.clearScenes();
});

test("/deathstructure parser, aliases, and command authority are explicit", () => {
  structureState.clearStructureCaches();

  assert.equal(AVAILABLE_SLASH_COMMANDS.includes("deathstructure"), true);
  assert.match(COMMANDS_HELP_TEXT, /\/deathstructure/);

  const parsed = structureDeathTestRuntime.parseStructureDeathTestArgs("skyhook 99 99");
  assert.deepEqual(parsed, {
    typeToken: "skyhook",
    count: 12,
    delaySeconds: 30,
  });
  assert.deepEqual(
    structureDeathTestRuntime.parseStructureDeathTestArgs("79172 99 99"),
    {
      typeToken: "79172",
      count: 12,
      delaySeconds: 30,
    },
  );

  const skyhook = structureDeathTestRuntime.resolveStructureDeathTestType("skyhook");
  assert.equal(skyhook.success, true);
  assert.equal(skyhook.typeRecord.typeID, 81080);
  assert.equal(skyhook.wreckType.typeID, 83844);

  const sovhub = structureDeathTestRuntime.resolveStructureDeathTestType("sovhub");
  assert.equal(sovhub.success, true);
  assert.equal(sovhub.typeRecord.typeID, 32458);
  assert.equal(sovhub.wreckType.typeID, 83843);

  const astrahus = structureDeathTestRuntime.resolveStructureDeathTestType("astrahus");
  assert.equal(astrahus.success, true);
  assert.equal(astrahus.typeRecord.typeID, 35832);

  const guristas = structureDeathTestRuntime.resolveStructureDeathTestType("guristasfob");
  assert.equal(guristas.success, true);
  assert.equal(guristas.typeRecord.typeID, 46363);
  assert.equal(guristas.wreckType.typeID, 46605);

  const guristasInsurgency = structureDeathTestRuntime.resolveStructureDeathTestType("guristasinsurgencyfob");
  assert.equal(guristasInsurgency.success, true);
  assert.equal(guristasInsurgency.typeRecord.typeID, 79172);
  assert.equal(guristasInsurgency.wreckType.typeID, 79386);

  const bloodRaider = structureDeathTestRuntime.resolveStructureDeathTestType("bloodraiderfob");
  assert.equal(bloodRaider.success, true);
  assert.equal(bloodRaider.typeRecord.typeID, 46364);
  assert.equal(bloodRaider.wreckType.typeID, 46606);

  const angel = structureDeathTestRuntime.resolveStructureDeathTestType("angelfob");
  assert.equal(angel.success, true);
  assert.equal(angel.typeRecord.typeID, 78260);
  assert.equal(angel.wreckType.typeID, 79385);

  const mercDen = structureDeathTestRuntime.resolveStructureDeathTestType("mercden");
  assert.equal(mercDen.success, true);
  assert.equal(mercDen.typeRecord.typeID, 85230);
  assert.equal(mercDen.wreckType.typeID, 86175);

  const vigilance = structureDeathTestRuntime.resolveStructureDeathTestType("vigilance");
  assert.equal(vigilance.success, true);
  assert.equal(vigilance.typeRecord.typeID, 84294);
  assert.equal(vigilance.wreckType.typeID, 85057);

  const dreamer = structureDeathTestRuntime.resolveStructureDeathTestType("dreamer");
  assert.equal(dreamer.success, true);
  assert.equal(dreamer.typeRecord.typeID, 87227);
  assert.equal(dreamer.wreckType.typeID, 87312);

  const ambiguousFob = structureDeathTestRuntime.resolveStructureDeathTestType("fob");
  assert.equal(ambiguousFob.success, false);
  assert.equal(ambiguousFob.errorMsg, "FOB_ALIAS_AMBIGUOUS");
});

test("/deathstructure skyhook spawns temporary structure records without detonation yet", () => {
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");

  try {
    writeTable("structures", {
      ...(structuresBackup || {}),
      structures: [],
    });
    structureState.clearStructureCaches();
    spaceRuntime._testing.clearScenes();

    const { session } = buildSpaceSession({
      shipID: 990770101,
      characterID: 140000101,
      clientID: 99077101,
    });
    const chatHub = buildChatHub();
    const result = executeChatCommand(
      session,
      "/deathstructure skyhook 2 30",
      chatHub,
      {},
    );

    assert.equal(result.handled, true);
    assert.match(String(result.message || ""), /Spawned 2 Orbital Skyhook structures/);
    assert.match(String(result.message || ""), /Detonation in 30\.0s/);

    const structures = structureState.listStructuresForSystem(TEST_SYSTEM_ID, {
      includeDestroyed: true,
      refresh: false,
    }).filter((structure) => (
      structure.devFlags &&
      structure.devFlags.deathTest === true &&
      Number(structure.typeID) === 81080
    ));
    assert.equal(structures.length, 2);
    assert.equal(structures.every((structure) => !structure.destroyedAt), true);
  } finally {
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    structureState.clearStructureCaches();
  }
});

test("/deathstructure guristasfob detonates into the Guristas Forward Operating Base wreck type", async () => {
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");

  try {
    writeTable("structures", {
      ...(structuresBackup || {}),
      structures: [],
    });
    structureState.clearStructureCaches();
    resetInventoryStoreForTests();
    spaceRuntime._testing.clearScenes();

    const { session } = buildSpaceSession({
      shipID: 990770201,
      characterID: 140000201,
      clientID: 99077201,
    });
    const chatHub = buildChatHub();
    const result = executeChatCommand(
      session,
      "/deathstructure guristasfob 1 0",
      chatHub,
      {},
    );

    assert.equal(result.handled, true);
    assert.match(String(result.message || ""), /Expected wreck: Guristas Forward Operating Base Wreck \(46605\)/);

    structureDeathTestRuntime._testing.processPendingStructureDeathTests();
    await new Promise((resolve) => setImmediate(resolve));

    const structures = structureState.listStructuresForSystem(TEST_SYSTEM_ID, {
      includeDestroyed: true,
      refresh: false,
    }).filter((structure) => (
      structure.devFlags &&
      structure.devFlags.deathTest === true &&
      Number(structure.typeID) === 46363
    ));
    assert.equal(structures.length, 1);
    assert.ok(structures[0].destroyedAt, "Expected the Guristas FOB test structure to be destroyed");

    const completionMessage = chatHub.messages
      .map((entry) => String(entry.message || ""))
      .find((message) => /Detonated 1\/1 Guristas Pirates Stronghold/.test(message));
    assert.ok(completionMessage, "Expected completion chat feedback");
    assert.match(completionMessage, /Wreck type: Guristas Forward Operating Base Wreck \(46605\)/);

    const destroyedStructureID = structures[0].structureID;
    const wreckItems = Object.values(readTable("items"))
      .filter((item) => (
        Number(item && item.launcherID) === Number(destroyedStructureID) &&
        Number(item && item.typeID) === 46605
      ));
    assert.equal(wreckItems.length, 1);
    assert.ok(findItemById(wreckItems[0].itemID), "Expected the Guristas FOB wreck to exist in the inventory store");
  } finally {
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    structureState.clearStructureCaches();
    resetInventoryStoreForTests();
  }
});
