const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  createSpaceItemForCharacter,
  grantItemToCharacterLocation,
  removeInventoryItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

const DEFAULT_PASSIVE_STATE = Object.freeze({
  mass: 1_000_000,
  inertia: 0.5,
  agility: 0.5,
  maxVelocity: 300,
  maxTargetRange: 250_000,
  maxLockedTargets: 7,
  signatureRadius: 120,
  scanResolution: 500,
  cloakingTargetingDelay: 0,
  capacitorCapacity: 5_000,
  capacitorRechargeRate: 1_000,
  shieldCapacity: 1_000,
  shieldRechargeRate: 1_000,
  armorHP: 1_000,
  structureHP: 1_000,
});

const transientCleanups = [];
let nextTransientCharacterID = 998820000;

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert.equal(result && result.success, true, `Expected item '${name}' to exist`);
  return result.match;
}

function registerCleanup(fn) {
  transientCleanups.push(fn);
}

function createTransientCharacter(systemID) {
  const characterID = nextTransientCharacterID;
  nextTransientCharacterID += 100;
  const characterRecord = {
    characterID,
    characterName: `grouped-turret-test-${characterID}`,
    corporationID: 0,
    allianceID: 0,
    warFactionID: 0,
    solarSystemID: systemID,
    solarsystemid: systemID,
    locationID: systemID,
    locationid: systemID,
    stationID: 0,
    stationid: 0,
  };
  const writeResult = database.write("characters", `/${characterID}`, characterRecord, {
    transient: true,
  });
  assert.equal(writeResult.success, true, "Failed to create transient character");
  registerCleanup(() => {
    database.remove("characters", `/${characterID}`);
  });
  return characterRecord;
}

function buildShipEntity(scene, itemID, x, options = {}) {
  return spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID,
    typeID: options.typeID ?? 606,
    ownerID: options.ownerID ?? 0,
    characterID: options.characterID ?? 0,
    pilotCharacterID: options.characterID ?? 0,
    position: options.position ?? { x, y: 0, z: 0 },
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      ...(options.passiveResourceState || {}),
    },
  }, scene.systemID);
}

function attachPlayerSession(scene, entity, characterRecord) {
  const notifications = [];
  const session = {
    clientID: characterRecord.characterID + 6000,
    userid: characterRecord.characterID,
    characterID: characterRecord.characterID,
    charid: characterRecord.characterID,
    corporationID: characterRecord.corporationID || 0,
    allianceID: characterRecord.allianceID || 0,
    warFactionID: characterRecord.warFactionID || 0,
    shipID: entity.itemID,
    shipid: entity.itemID,
    activeShipID: entity.itemID,
    locationid: scene.systemID,
    solarsystemid: scene.systemID,
    solarsystemid2: scene.systemID,
    socket: { destroyed: false },
    _space: {
      systemID: scene.systemID,
      shipID: entity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set(),
      freshlyVisibleDynamicEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification() {},
  };

  entity.session = session;
  scene.spawnDynamicEntity(entity, { broadcast: false });
  scene.sessions.set(session.clientID, session);
  return {
    session,
    notifications,
  };
}

function getDestinyEvents(notifications = [], eventName) {
  return notifications
    .filter((notification) => (
      notification &&
      notification.name === "DoDestinyUpdate" &&
      Array.isArray(notification.payload)
    ))
    .flatMap((notification) => {
      const payloadList = notification.payload[0];
      const entries = Array.isArray(payloadList && payloadList.items)
        ? payloadList.items
        : [];
      return entries
        .filter((entry) => (
          Array.isArray(entry) &&
          entry[1] &&
          entry[1][0] === eventName &&
          Array.isArray(entry[1][1])
        ))
        .map((entry) => ({
          stamp: Number(entry[0]) || 0,
          args: entry[1][1],
        }));
    });
}

function advanceScene(scene, deltaMs) {
  const baseWallclock = Number(scene.lastWallclockTickAt) || scene.getCurrentWallclockMs();
  scene.tick(baseWallclock + Math.max(0, Number(deltaMs) || 0));
}

function createGroupedTurretScenario(options = {}) {
  const systemID = options.systemID ?? 30000142;
  const characterRecord = createTransientCharacter(systemID);
  const shipType = resolveExactItem(options.shipName ?? "Federation Navy Comet");
  const turretType = resolveExactItem(options.turretName ?? "Light Neutron Blaster II");
  const chargeType = resolveExactItem(options.chargeName ?? "Antimatter Charge S");

  const shipCreateResult = createSpaceItemForCharacter(
    characterRecord.characterID,
    systemID,
    shipType,
    {
      transient: true,
      position: { x: -1_500, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
      conditionState: {
        shieldCharge: 1,
        armorDamage: 0,
        structureDamage: 0,
        charge: 1,
      },
    },
  );
  assert.equal(shipCreateResult.success, true, "Failed to create transient turret ship");
  const shipItem = shipCreateResult.data;
  registerCleanup(() => {
    removeInventoryItem(shipItem.itemID, { removeContents: true });
  });

  const moduleGrantA = grantItemToCharacterLocation(
    characterRecord.characterID,
    shipItem.itemID,
    27,
    turretType,
    1,
    {
      transient: true,
      moduleState: {
        online: true,
        damage: 0,
        charge: 0,
        armorDamage: 0,
        shieldCharge: 0,
        incapacitated: false,
      },
    },
  );
  assert.equal(moduleGrantA.success, true, "Failed to grant master turret");
  const masterModuleItem = moduleGrantA.data.items[0];

  const moduleGrantB = grantItemToCharacterLocation(
    characterRecord.characterID,
    shipItem.itemID,
    28,
    turretType,
    1,
    {
      transient: true,
      moduleState: {
        online: true,
        damage: 0,
        charge: 0,
        armorDamage: 0,
        shieldCharge: 0,
        incapacitated: false,
      },
    },
  );
  assert.equal(moduleGrantB.success, true, "Failed to grant slave turret");
  const slaveModuleItem = moduleGrantB.data.items[0];

  const loadedChargeA = grantItemToCharacterLocation(
    characterRecord.characterID,
    shipItem.itemID,
    masterModuleItem.flagID,
    chargeType,
    options.loadedQuantity ?? 5,
    {
      transient: true,
      singleton: false,
    },
  );
  assert.equal(loadedChargeA.success, true, "Failed to grant master turret ammo");

  const loadedChargeB = grantItemToCharacterLocation(
    characterRecord.characterID,
    shipItem.itemID,
    slaveModuleItem.flagID,
    chargeType,
    options.loadedQuantity ?? 5,
    {
      transient: true,
      singleton: false,
    },
  );
  assert.equal(loadedChargeB.success, true, "Failed to grant slave turret ammo");

  const scene = spaceRuntime.ensureScene(systemID);
  const attacker = buildShipEntity(scene, shipItem.itemID, -1_500, {
    typeID: shipItem.typeID,
    ownerID: characterRecord.characterID,
    characterID: characterRecord.characterID,
  });
  const attackerSession = attachPlayerSession(scene, attacker, characterRecord);
  const runtimeAttacker = scene.getEntityByID(shipItem.itemID);
  assert.ok(runtimeAttacker, "expected spawned runtime attacker entity");

  const target = buildShipEntity(scene, shipItem.itemID + 1000, 1_500, {
    passiveResourceState: {
      ...DEFAULT_PASSIVE_STATE,
      shieldCapacity: 300,
      armorHP: 300,
      structureHP: 300,
    },
  });
  scene.spawnDynamicEntity(target, { broadcast: false });
  const runtimeTarget = scene.getEntityByID(target.itemID);
  assert.ok(runtimeTarget, "expected spawned runtime target entity");

  const lockResult = scene.finalizeTargetLock(runtimeAttacker, runtimeTarget, {
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(lockResult.success, true, "expected attacker to lock the target");

  return {
    scene,
    characterRecord,
    shipItem,
    attacker: runtimeAttacker,
    attackerSession,
    target: runtimeTarget,
    masterModuleItem,
    slaveModuleItem,
  };
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
  while (transientCleanups.length > 0) {
    const cleanup = transientCleanups.pop();
    try {
      cleanup();
    } catch (error) {
      assert.fail(`Cleanup failed: ${error.message}`);
    }
  }
  if (
    DogmaService &&
    DogmaService._testing &&
    typeof DogmaService._testing.clearPendingModuleReloads === "function"
  ) {
    DogmaService._testing.clearPendingModuleReloads();
  }
});

test("grouped turret banks fan start and stop FX across every module in the bank", () => {
  const {
    scene,
    attacker,
    attackerSession,
    target,
    shipItem,
    masterModuleItem,
    slaveModuleItem,
  } = createGroupedTurretScenario();
  const dogma = new DogmaService();

  const bankResult = dogma.Handle_LinkWeapons(
    [shipItem.itemID, masterModuleItem.itemID, slaveModuleItem.itemID],
    attackerSession.session,
  );
  assert.ok(bankResult, "expected grouped turret bank creation to succeed");

  attackerSession.notifications.length = 0;
  const broadcastSpecialFxCalls = [];
  const originalBroadcastSpecialFx = scene.broadcastSpecialFx.bind(scene);
  const originalRandom = Math.random;
  try {
    scene.broadcastSpecialFx = (shipID, guid, options = {}, visibilityEntity = null) => {
      broadcastSpecialFxCalls.push({
        shipID,
        guid,
        options: { ...options },
        visibilityEntity,
      });
      return originalBroadcastSpecialFx(shipID, guid, options, visibilityEntity);
    };
    Math.random = () => 0.5;

    const activationResult = dogma.Handle_Activate(
      [slaveModuleItem.itemID, "", target.itemID, 1000],
      attackerSession.session,
    );
    assert.equal(activationResult, 1, "expected grouped turret activation to succeed");

    const effectState = scene.getActiveModuleEffect(attacker.itemID, masterModuleItem.itemID);
    assert.ok(effectState, "expected grouped activation to stay keyed on the bank master");
    assert.deepEqual(
      [...new Set((effectState.bankModuleIDs || []).map((moduleID) => Number(moduleID) || 0))],
      [masterModuleItem.itemID, slaveModuleItem.itemID],
      "expected the active effect state to remember every module in the grouped turret bank",
    );

    const startFxModuleIDs = [...new Set(
      broadcastSpecialFxCalls
        .filter((entry) => (
          entry.guid === effectState.guid &&
          entry.options &&
          entry.options.start === true
        ))
        .map((entry) => Number(entry.options.moduleID) || 0)
        .filter((moduleID) => moduleID > 0),
    )].sort((left, right) => left - right);
    assert.deepEqual(
      startFxModuleIDs,
      [masterModuleItem.itemID, slaveModuleItem.itemID].sort((left, right) => left - right),
      "expected grouped turret activation to emit start FX for every banked turret module",
    );

    const startGodmaModuleIDs = [...new Set(
      attackerSession.notifications
        .filter((notification) => (
          notification &&
          notification.name === "OnGodmaShipEffect" &&
          Array.isArray(notification.payload) &&
          Number(notification.payload[3]) === 1
        ))
        .map((notification) => Number(notification.payload[0]) || 0)
        .filter((moduleID) => moduleID > 0),
    )].sort((left, right) => left - right);
    assert.deepEqual(
      startGodmaModuleIDs,
      [masterModuleItem.itemID, slaveModuleItem.itemID].sort((left, right) => left - right),
      "expected grouped turret activation to emit active OnGodmaShipEffect rows for every banked turret module",
    );

    const deactivateResult = dogma.Handle_Deactivate(
      [slaveModuleItem.itemID, ""],
      attackerSession.session,
    );
    assert.equal(deactivateResult, 1, "expected grouped turret deactivation to succeed");
    const stopAdvanceMs = Math.max(Number(effectState.durationMs) || 0, 1_000) + 150;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!scene.getActiveModuleEffect(attacker.itemID, masterModuleItem.itemID)) {
        break;
      }
      advanceScene(scene, stopAdvanceMs);
    }

    const stopFxModuleIDs = [...new Set(
      broadcastSpecialFxCalls
        .filter((entry) => (
          entry.guid === effectState.guid &&
          entry.options &&
          entry.options.start === false
        ))
        .map((entry) => Number(entry.options.moduleID) || 0)
        .filter((moduleID) => moduleID > 0),
    )].sort((left, right) => left - right);
    assert.deepEqual(
      stopFxModuleIDs,
      [masterModuleItem.itemID, slaveModuleItem.itemID].sort((left, right) => left - right),
      "expected grouped turret deactivation to emit stop FX for every banked turret module",
    );

    const stopGodmaModuleIDs = [...new Set(
      attackerSession.notifications
        .filter((notification) => (
          notification &&
          notification.name === "OnGodmaShipEffect" &&
          Array.isArray(notification.payload) &&
          Number(notification.payload[3]) === 0
        ))
        .map((notification) => Number(notification.payload[0]) || 0)
        .filter((moduleID) => moduleID > 0),
    )].sort((left, right) => left - right);
    assert.deepEqual(
      stopGodmaModuleIDs,
      [masterModuleItem.itemID, slaveModuleItem.itemID].sort((left, right) => left - right),
      "expected grouped turret deactivation to emit inactive OnGodmaShipEffect rows for every banked turret module",
    );

    const ownerFxModuleIDs = [...new Set(
      getDestinyEvents(attackerSession.notifications, "OnSpecialFX")
        .filter((entry) => String(entry.args[5] || "") === String(effectState.guid))
        .map((entry) => Number(entry.args[1]) || 0)
        .filter((moduleID) => moduleID > 0),
    )].sort((left, right) => left - right);
    assert.deepEqual(
      ownerFxModuleIDs,
      [masterModuleItem.itemID, slaveModuleItem.itemID].sort((left, right) => left - right),
      "expected the owner to receive grouped turret OnSpecialFX payloads for every bank member",
    );
  } finally {
    scene.broadcastSpecialFx = originalBroadcastSpecialFx;
    Math.random = originalRandom;
  }
});
