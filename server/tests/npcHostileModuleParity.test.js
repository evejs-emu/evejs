process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const npcService = require(path.join(repoRoot, "server/src/space/npc/npcService"));
const npcBehaviorLoop = require(path.join(repoRoot, "server/src/space/npc/npcBehaviorLoop"));
const {
  buildNpcDefinition,
} = require(path.join(repoRoot, "server/src/space/npc/npcData"));
const {
  getNpcHostileModules,
} = require(path.join(repoRoot, "server/src/space/npc/npcEquipment"));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));

const TEST_SYSTEM_ID = 30000142;
const TABLE_NAMES = [
  "npcEntities",
  "npcModules",
  "npcCargo",
  "npcRuntimeControllers",
];

const DEFAULT_PASSIVE_STATE = Object.freeze({
  mass: 250_000_000,
  inertia: 0.5,
  agility: 0.5,
  maxVelocity: 500,
  maxTargetRange: 250_000,
  maxLockedTargets: 8,
  signatureRadius: 500,
  scanResolution: 300,
  cloakingTargetingDelay: 0,
  capacitorCapacity: 1_000_000,
  capacitorRechargeRate: 1_000,
  shieldCapacity: 250_000,
  shieldRechargeRate: 1_000,
  armorHP: 250_000,
  structureHP: 250_000,
});

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTableSnapshot(tableName) {
  const result = database.read(tableName, "/");
  return result.success ? cloneValue(result.data) : {};
}

function writeTableSnapshot(tableName, snapshot) {
  database.write(tableName, "/", cloneValue(snapshot));
}

function snapshotAllTables() {
  return Object.fromEntries(TABLE_NAMES.map((tableName) => ([
    tableName,
    readTableSnapshot(tableName),
  ])));
}

function restoreAllTables(snapshot) {
  for (const tableName of TABLE_NAMES) {
    writeTableSnapshot(tableName, snapshot[tableName] || {});
  }
}

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  if (
    result &&
    result.errorMsg === "AMBIGUOUS_ITEM_NAME" &&
    Array.isArray(result.suggestions)
  ) {
    const publishedExactMatch = result.suggestions.find((entry) => (
      typeof entry === "string" &&
      !entry.includes("unpublished") &&
      entry.startsWith(`${name} (`)
    ));
    if (publishedExactMatch) {
      const typeIDMatch = publishedExactMatch.match(/\((\d+)\)$/);
      const typeID = Number(typeIDMatch && typeIDMatch[1]);
      const resolvedByTypeID = resolveItemByTypeID(typeID);
      if (resolvedByTypeID && resolvedByTypeID.typeID) {
        return resolvedByTypeID;
      }
    }
  }
  assert.equal(result && result.success, true, `expected item '${name}' to exist`);
  return result.match;
}

function buildRuntimeShipEntity(scene, typeName, itemID, characterID, position) {
  const type = resolveExactItem(typeName);
  return runtime._testing.buildRuntimeShipEntityForTesting({
    itemID,
    typeID: Number(type.typeID),
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: String(type.name || typeName),
    ownerID: characterID,
    characterID,
    pilotCharacterID: characterID,
    nativeNpc: false,
    position: { ...position },
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
    },
  }, scene.systemID);
}

function attachSession(scene, entity, clientID, characterID) {
  const notifications = [];
  const session = {
    clientID,
    characterID,
    charid: characterID,
    corporationID: 1000044,
    shipTypeID: entity.typeID,
    _space: {
      systemID: scene.systemID,
      shipID: entity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set(),
      visibleBubbleScopedStaticEntityIDs: new Set(),
      freshlyVisibleDynamicEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification() {},
    sendSessionChange() {},
  };

  entity.session = session;
  if (!scene.getEntityByID(entity.itemID)) {
    scene.spawnDynamicEntity(entity, { broadcast: false });
  }
  scene.sessions.set(clientID, session);
  return { session, notifications };
}

function primeTargetLock(sourceEntity, targetEntity, scene) {
  const nowMs = scene.getCurrentSimTimeMs();
  if (!(sourceEntity.lockedTargets instanceof Map)) {
    sourceEntity.lockedTargets = new Map();
  }
  if (!(targetEntity.targetedBy instanceof Set)) {
    targetEntity.targetedBy = new Set();
  }
  sourceEntity.lockedTargets.set(targetEntity.itemID, {
    targetID: targetEntity.itemID,
    lockedAtMs: nowMs,
  });
  targetEntity.targetedBy.add(sourceEntity.itemID);
}

function spawnTransientNpc(profileQuery, position) {
  const spawnResult = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
    entityType: "npc",
    amount: 1,
    profileQuery,
    transient: true,
    anchorDescriptor: {
      kind: "coordinates",
      position: { ...position },
      direction: { x: 1, y: 0, z: 0 },
    },
  });
  assert.equal(spawnResult.success, true, `expected ${profileQuery} spawn to succeed`);
  assert.ok(spawnResult.data);
  assert.equal(spawnResult.data.spawned.length, 1);
  return spawnResult.data.spawned[0].entity;
}

test("representative pirate profiles receive hostile utility modules from local authority", () => {
  const expectations = [
    ["generic_hostile", [527, 13003]],
    ["blood_raider_apocalypse", [12271, 12263]],
    ["parity_sansha_beam_destroyer", [527, 448]],
    ["guristas_missile_battleship", [19806, 3244, 20199]],
    ["parity_guristas_officer_estamel_tharchon", [20207]],
  ];

  for (const [profileID, expectedTypeIDs] of expectations) {
    const definition = buildNpcDefinition(profileID);
    assert.ok(definition, `expected ${profileID} definition`);
    assert.ok(
      Array.isArray(definition.hostileUtilityTemplateIDs) &&
        definition.hostileUtilityTemplateIDs.length > 0,
      `expected ${profileID} to record hostile utility template IDs`,
    );
    const moduleTypeIDs = (definition.loadout && Array.isArray(definition.loadout.modules))
      ? definition.loadout.modules.map((entry) => Number(entry && entry.typeID || 0))
      : [];
    for (const typeID of expectedTypeIDs) {
      assert.ok(
        moduleTypeIDs.includes(typeID),
        `expected ${profileID} loadout to include hostile utility type ${typeID}`,
      );
    }
  }
});

test("native pirate NPCs activate hostile utility modules through the shared combat lane", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const cases = [
      {
        profileID: "generic_hostile",
        npcPosition: { x: 100_000, y: 0, z: 0 },
        targetOffset: { x: 4_000, y: 0, z: 0 },
        expectedFamilies: ["stasisWebifier", "energyNeutralizer"],
      },
      {
        profileID: "blood_raider_apocalypse",
        npcPosition: { x: 140_000, y: 0, z: 0 },
        targetOffset: { x: 4_000, y: 0, z: 0 },
        expectedFamilies: ["energyNeutralizer", "energyNosferatu"],
      },
      {
        profileID: "parity_sansha_beam_destroyer",
        npcPosition: { x: 180_000, y: 0, z: 0 },
        targetOffset: { x: 4_000, y: 0, z: 0 },
        expectedFamilies: ["stasisWebifier", "warpScrambler"],
      },
      {
        profileID: "guristas_missile_battleship",
        npcPosition: { x: 220_000, y: 0, z: 0 },
        targetOffset: { x: 4_000, y: 0, z: 0 },
        expectedFamilies: ["targetPainter", "warpDisruptor", "ecmJammer"],
      },
      {
        profileID: "parity_guristas_officer_estamel_tharchon",
        npcPosition: { x: 260_000, y: 0, z: 0 },
        targetOffset: { x: 4_000, y: 0, z: 0 },
        expectedFamilies: ["ecmJammer"],
      },
    ];

    cases.forEach((entry, index) => {
      const npcEntity = spawnTransientNpc(entry.profileID, entry.npcPosition);
      const targetEntity = buildRuntimeShipEntity(
        scene,
        "Orca",
        980000 + index,
        150000000 + index,
        {
          x: Number(npcEntity.position && npcEntity.position.x || 0) + Number(entry.targetOffset.x || 0),
          y: Number(npcEntity.position && npcEntity.position.y || 0) + Number(entry.targetOffset.y || 0),
          z: Number(npcEntity.position && npcEntity.position.z || 0) + Number(entry.targetOffset.z || 0),
        },
      );
      attachSession(scene, targetEntity, 680000 + index, 150000000 + index);
      primeTargetLock(npcEntity, targetEntity, scene);

      const hostileModules = getNpcHostileModules(npcEntity);
      assert.ok(hostileModules.length > 0, `expected ${entry.profileID} to fit hostile modules`);

      npcBehaviorLoop.__testing.syncNpcHostileModules(scene, npcEntity, targetEntity);

      const activeFamilies = [...(npcEntity.activeModuleEffects || new Map()).values()]
        .filter((effectState) => (
          effectState &&
          (
            effectState.hostileModuleEffect === true ||
            effectState.jammerModuleEffect === true
          )
        ))
        .map((effectState) => String(
          effectState.hostileFamily ||
          effectState.jammerFamily ||
          "",
        ));
      for (const expectedFamily of entry.expectedFamilies) {
        assert.ok(
          activeFamilies.includes(expectedFamily),
          `expected ${entry.profileID} to activate ${expectedFamily}`,
        );
      }
    });
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});
