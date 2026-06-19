const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");

const {
  resolveWeaponFamily,
  buildWeaponModuleSnapshot,
} = require(path.join(repoRoot, "server/src/space/combat/weaponDogma"));
const {
  ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_CURRENT,
  ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP,
  initializePrecursorTurretEffectState,
  advancePrecursorTurretSpool,
  resetPrecursorTurretSpool,
  buildPrecursorTurretGraphicInfo,
  applyPrecursorTurretSpoolToSnapshot,
} = require(path.join(repoRoot, "server/src/space/combat/precursorTurrets"));
const {
  resolveTurretShot,
} = require(path.join(repoRoot, "server/src/space/combat/laserTurrets"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  resolveTrigCommandPresetKey,
  resolveDevCommandShipPreset,
} = require(path.join(repoRoot, "server/src/services/ship/devCommandShipRuntime"));
const {
  resolveItemByTypeID,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));

function buildItem(typeID, itemID, extras = {}) {
  const type = resolveItemByTypeID(typeID);
  assert.ok(type, `expected type ${typeID} to exist`);
  return {
    itemID,
    typeID,
    ownerID: 1,
    locationID: Number(extras.locationID || 0),
    flagID: Number(extras.flagID || 0),
    groupID: Number(type.groupID || 0),
    categoryID: Number(type.categoryID || 0),
    itemName: type.name,
    quantity: extras.quantity ?? 1,
    stacksize: extras.stacksize ?? extras.quantity ?? 1,
    singleton: Object.prototype.hasOwnProperty.call(extras, "singleton")
      ? extras.singleton
      : true,
    moduleState: extras.moduleState || {
      online: true,
      damage: 0,
      armorDamage: 0,
      shieldCharge: 0,
      incapacitated: false,
    },
    ...extras,
  };
}

function buildRuntimeShipEntity(systemID, itemID, options = {}) {
  return spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID,
    typeID: options.typeID ?? 606,
    characterID: options.characterID ?? 0,
    ownerID: options.ownerID ?? 0,
    position: options.position ?? { x: 0, y: 0, z: 0 },
    passiveResourceState: {
      mass: options.mass ?? 1_000_000,
      agility: options.agility ?? 0.5,
      maxVelocity: options.maxVelocity ?? 300,
      maxTargetRange: options.maxTargetRange ?? 250_000,
      maxLockedTargets: options.maxLockedTargets ?? 7,
      signatureRadius: options.signatureRadius ?? 110,
      scanResolution: options.scanResolution ?? 500,
      cloakingTargetingDelay: 0,
      capacitorCapacity: 5_000,
      capacitorRechargeRate: 1_000,
      shieldCapacity: options.shieldCapacity ?? 1_000,
      shieldRechargeRate: options.shieldRechargeRate ?? 1_000,
      armorHP: options.armorHP ?? 1_000,
      structureHP: options.structureHP ?? 1_000,
    },
  }, systemID);
}

function attachSessionToShip(scene, shipEntity, clientID, characterID) {
  const notifications = [];
  const session = {
    clientID,
    characterID,
    _space: {
      systemID: scene.systemID,
      shipID: shipEntity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set(),
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
  scene.sessions.set(clientID, session);
  return { session, notifications };
}

test("standard entropic disintegrators resolve on the shared precursor turret family", () => {
  const moduleItem = buildItem(47914, 800000001, {
    locationID: 700000001,
    flagID: 27,
  });
  const chargeItem = buildItem(47924, 800000002, {
    locationID: 700000001,
    moduleID: moduleItem.itemID,
    quantity: 1,
    stacksize: 1,
    singleton: false,
    flagID: 27,
  });

  assert.equal(resolveWeaponFamily(moduleItem, chargeItem), "precursorTurret");

  const snapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem: buildItem(47269, 700000001, {
      locationID: 0,
      categoryID: 6,
    }),
    moduleItem,
    chargeItem,
    fittedItems: [moduleItem],
    skillMap: new Map(),
    activeModuleContexts: [],
  });

  assert.ok(snapshot, "expected precursor weapon snapshot");
  assert.equal(snapshot.family, "precursorTurret");
  assert.equal(snapshot.chargeMode, "stack");
  assert.equal(snapshot.effectGUID, "effects.TriglavianBeam,effects.AttackMode");
  assert.equal(snapshot.activationEffectName, "targetDisintegratorAttack");
  assert.equal(snapshot.falloff, 0);
  assert.ok(snapshot.optimalRange > 0);
  assert.ok(snapshot.rawShotDamage.thermal > 0 || snapshot.rawShotDamage.kinetic > 0);

  const shotResult = resolveTurretShot({
    attackerEntity: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      radius: 40,
      signatureRadius: 110,
    },
    targetEntity: {
      position: { x: 5_000, y: 0, z: 0 },
      velocity: { x: 0, y: 20, z: 0 },
      radius: 40,
      signatureRadius: 125,
    },
    weaponSnapshot: snapshot,
    randomValue: 0.5,
  });

  assert.equal(shotResult.hit, true);
  assert.ok(shotResult.chanceToHit > 0);
  assert.ok((shotResult.shotDamage.thermal + shotResult.shotDamage.kinetic) > 0);
});

test("/trig preset resolver covers all standard hull aliases and defaults to battleship", () => {
  assert.equal(resolveTrigCommandPresetKey(""), "trigleshak");
  assert.equal(resolveTrigCommandPresetKey("light"), "trigdamavik");
  assert.equal(resolveTrigCommandPresetKey("heavy"), "trigvedmak");
  assert.equal(resolveTrigCommandPresetKey("supratidal"), "trigleshak");
  assert.equal(resolveTrigCommandPresetKey("ultratidal"), "trigzirnitra");
  assert.equal(resolveTrigCommandPresetKey("damavik"), "trigdamavik");
  assert.equal(resolveTrigCommandPresetKey("vedmak"), "trigvedmak");
  assert.equal(resolveTrigCommandPresetKey("zirnitra"), "trigzirnitra");
  assert.equal(resolveTrigCommandPresetKey("assault frigate"), "trignergal");
  assert.equal(resolveTrigCommandPresetKey("unknown-hull"), null);

  const preset = resolveDevCommandShipPreset("trigleshak");
  assert.ok(preset, "expected /trig default preset");
  assert.equal(preset.commandName, "/trig");
  assert.equal(preset.shipName, "Leshak");
});

test("precursor spool state tracks current bonus, blue-time max timestamp, and exact FX keys", () => {
  const snapshot = {
    family: "precursorTurret",
    durationMs: 3500,
    damageMultiplier: 0.96,
    rawShotDamage: {
      em: 0,
      thermal: 57,
      kinetic: 0,
      explosive: 42,
    },
    moduleAttributes: {
      2733: 0.07,
      2734: 2.125,
    },
  };
  const effectState = {
    weaponFamily: "precursorTurret",
    targetID: 12345,
    genericAttributeOverrides: {},
  };

  initializePrecursorTurretEffectState(effectState, snapshot, 10_000);
  assert.equal(effectState.precursorSpoolCurrent, 0);
  assert.equal(effectState.precursorSpoolTargetID, 12345);
  assert.equal(effectState.genericAttributeOverrides[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_CURRENT], 0);
  assert.ok(effectState.genericAttributeOverrides[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP] > 10_000);

  const graphicInfo = buildPrecursorTurretGraphicInfo(effectState);
  assert.deepEqual(graphicInfo, {
    mulitplierBonusPerCycle: 0.07,
    multiplierBonusPerCycle: 0.07,
    multiplierBonusMax: 2.125,
  });

  advancePrecursorTurretSpool(effectState, snapshot, 13_500);
  assert.equal(effectState.precursorSpoolCurrent, 0.07);
  assert.ok(effectState.genericAttributeOverrides[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP] > 13_500);

  const spooledSnapshot = applyPrecursorTurretSpoolToSnapshot(snapshot, effectState);
  assert.equal(spooledSnapshot.spoolMultiplier, 1.07);
  assert.equal(spooledSnapshot.rawShotDamage.thermal, 60.99);
  assert.equal(spooledSnapshot.rawShotDamage.explosive, 44.94);

  resetPrecursorTurretSpool(effectState);
  assert.equal(effectState.precursorSpoolCurrent, 0);
  assert.equal(effectState.genericAttributeOverrides[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_CURRENT], 0);
  assert.equal(effectState.genericAttributeOverrides[ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP], 0);
});

test("precursor max timestamp attribute changes marshal as blue-time filetimes", () => {
  const session = {
    characterID: 140000001,
    _space: {
      simFileTime: 116444736000000000n,
    },
  };
  const moduleID = 900000001;
  const change = spaceRuntime._testing.buildAttributeChangeForTesting(
    session,
    moduleID,
    ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP,
    2500,
    0,
    116444736000000000n,
  );

  assert.equal(change[3], ATTRIBUTE_DAMAGE_MULTIPLIER_BONUS_MAX_TIMESTAMP);
  assert.equal(change[5], 116444736025000000n);
  assert.equal(change[6], 0);
});

test("broadcastSpecialFx still delivers player trig FX to the owner ship during visibility-cache gaps", () => {
  spaceRuntime._testing.clearScenes();
  const systemID = 30000142;
  const scene = spaceRuntime.ensureScene(systemID);
  const shipEntity = buildRuntimeShipEntity(systemID, 910000001, {
    typeID: 47273,
    characterID: 140000001,
    ownerID: 140000001,
  });
  const { notifications } = attachSessionToShip(
    scene,
    shipEntity,
    920000001,
    140000001,
  );
  const originalCanSessionSeeDynamicEntity =
    scene.canSessionSeeDynamicEntity.bind(scene);
  const originalSendDestinyUpdates = scene.sendDestinyUpdates.bind(scene);
  const destinyDispatches = [];
  scene.canSessionSeeDynamicEntity = () => false;
  scene.sendDestinyUpdates = (session, updates, preserveQueue, options) => {
    destinyDispatches.push({
      session,
      updates,
      preserveQueue,
      options,
    });
    return originalSendDestinyUpdates(session, updates, preserveQueue, options);
  };

  try {
    const result = scene.broadcastSpecialFx(
      shipEntity.itemID,
      "effects.AttackMode,effects.TriglavianBeam",
      {
        moduleID: 910000002,
        moduleTypeID: 47914,
        targetID: 910000003,
        chargeTypeID: 47924,
        start: true,
        active: true,
        duration: 4320,
        repeat: 1000,
        useCurrentVisibleStamp: true,
      },
      shipEntity,
    );

    assert.ok(result.deliveredCount > 0, "expected ego FX delivery");
    assert.ok(
      destinyDispatches.some((dispatch) => dispatch.session === shipEntity.session),
      "expected a destiny dispatch for the owner session",
    );
  } finally {
    scene.canSessionSeeDynamicEntity = originalCanSessionSeeDynamicEntity;
    scene.sendDestinyUpdates = originalSendDestinyUpdates;
    spaceRuntime._testing.clearScenes();
  }
});

test("NPC precursor FX stays ship-keyed while player precursor and normal turrets stay module-keyed", () => {
  spaceRuntime._testing.clearScenes();
  const systemID = 30000144;
  const scene = spaceRuntime.ensureScene(systemID);
  const shipEntity = buildRuntimeShipEntity(systemID, 910000021, {
    typeID: 47273,
    characterID: 140000021,
    ownerID: 140000021,
  });
  attachSessionToShip(
    scene,
    shipEntity,
    920000021,
    140000021,
  );
  const npcEntity = buildRuntimeShipEntity(systemID, 910000031, {
    typeID: 603,
    ownerID: 1000123,
  });
  npcEntity.nativeNpc = true;
  scene.spawnDynamicEntity(npcEntity, { broadcast: false });
  const originalSendDestinyUpdates = scene.sendDestinyUpdates.bind(scene);
  const destinyDispatches = [];
  scene.sendDestinyUpdates = (session, updates, preserveQueue, options) => {
    destinyDispatches.push({
      session,
      updates,
      preserveQueue,
      options,
    });
    return originalSendDestinyUpdates(session, updates, preserveQueue, options);
  };

  try {
    scene.broadcastSpecialFx(
      shipEntity.itemID,
      "effects.AttackMode,effects.TriglavianBeam",
      {
        moduleID: 910000022,
        moduleTypeID: 47922,
        targetID: 910000023,
        chargeTypeID: 47935,
        weaponFamily: "precursorTurret",
        start: true,
        active: true,
        duration: 4320,
        repeat: 1000,
        useCurrentVisibleStamp: true,
      },
      shipEntity,
    );

    scene.broadcastSpecialFx(
      npcEntity.itemID,
      "effects.AttackMode,effects.TriglavianBeam",
      {
        moduleID: 910000032,
        moduleTypeID: 47922,
        targetID: 910000033,
        chargeTypeID: 47935,
        weaponFamily: "precursorTurret",
        start: true,
        active: true,
        duration: 4320,
        repeat: 1000,
        useCurrentVisibleStamp: true,
      },
      npcEntity,
    );

    scene.broadcastSpecialFx(
      shipEntity.itemID,
      "effects.TurboLaser",
      {
        moduleID: 910000024,
        moduleTypeID: 2985,
        targetID: 910000025,
        chargeTypeID: 21296,
        weaponFamily: "laserTurret",
        start: true,
        active: true,
        duration: 4000,
        repeat: 1000,
        useCurrentVisibleStamp: true,
      },
      shipEntity,
    );

    const fxArgs = destinyDispatches
      .flatMap((dispatch) => dispatch.updates)
      .map((entry) => entry && entry.payload)
      .filter((payload) => Array.isArray(payload) && payload[0] === "OnSpecialFX")
      .map((payload) => payload[1]);

    const precursorArgs = fxArgs.filter((args) => (
      args[5] === "effects.AttackMode" || args[5] === "effects.TriglavianBeam"
    ));
    assert.equal(precursorArgs.length, 4);

    const playerPrecursorArgs = precursorArgs.filter((args) => args[0] === shipEntity.itemID);
    assert.equal(playerPrecursorArgs.length, 2);
    for (const args of playerPrecursorArgs) {
      assert.equal(args[0], shipEntity.itemID);
      assert.equal(args[1], 910000022);
    }

    const npcPrecursorArgs = precursorArgs.filter((args) => args[0] === npcEntity.itemID);
    assert.equal(npcPrecursorArgs.length, 2);
    for (const args of npcPrecursorArgs) {
      assert.equal(args[0], npcEntity.itemID);
      assert.equal(args[1], npcEntity.itemID);
    }

    const laserArgs = fxArgs.find((args) => args[5] === "effects.TurboLaser");
    assert.ok(laserArgs, "expected normal turret FX payload");
    assert.equal(laserArgs[0], shipEntity.itemID);
    assert.equal(laserArgs[1], 910000024);
  } finally {
    scene.sendDestinyUpdates = originalSendDestinyUpdates;
    spaceRuntime._testing.clearScenes();
  }
});

test("transient combat ships still explode and leave space when wreck creation is unavailable", () => {
  spaceRuntime._testing.clearScenes();
  const systemID = 30000143;
  const scene = spaceRuntime.ensureScene(systemID);
  const attackerEntity = buildRuntimeShipEntity(systemID, 910000011, {
    typeID: 47273,
    characterID: 140000011,
    ownerID: 140000011,
  });
  const targetEntity = buildRuntimeShipEntity(systemID, 910000012, {
    typeID: 24692,
    ownerID: 0,
    shieldCapacity: 1,
    armorHP: 1,
    structureHP: 1,
  });
  scene.spawnDynamicEntity(attackerEntity, { broadcast: false });
  scene.spawnDynamicEntity(targetEntity, { broadcast: false });

  try {
    const result = spaceRuntime.droneInterop.applyWeaponDamageToTarget(
      scene,
      attackerEntity,
      targetEntity,
      {
        thermal: 10_000,
      },
      scene.getCurrentSimTimeMs(),
    );

    assert.equal(result.damageResult.success, true);
    assert.equal(result.damageResult.data.destroyed, true);
    assert.ok(result.destroyResult && result.destroyResult.success);
    assert.equal(scene.getEntityByID(targetEntity.itemID), null);
  } finally {
    spaceRuntime._testing.clearScenes();
  }
});
