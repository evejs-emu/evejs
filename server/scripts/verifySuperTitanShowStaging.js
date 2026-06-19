const assert = require("assert");

const spaceRuntime = require("../src/space/runtime");
const {
  handleSuperTitanShowCommand,
} = require("../src/services/superweapons/superweaponCommands");
const {
  tickScene,
} = require("../src/space/modules/superweapons/superweaponRuntime");

function cloneVector(vector) {
  return {
    x: Number(vector && vector.x || 0),
    y: Number(vector && vector.y || 0),
    z: Number(vector && vector.z || 0),
  };
}

function main() {
  const originalGetEntity = spaceRuntime.getEntity;
  const originalGetSceneForSession = spaceRuntime.getSceneForSession;
  const originalSpawnDynamicShip = spaceRuntime.spawnDynamicShip;

  const scheduled = [];
  const spawnCalls = [];
  const specialFxCalls = [];
  const activationCalls = [];
  const entities = new Map();
  let currentSimTimeMs = 1775128867000;

  const anchorEntity = {
    itemID: 991000001,
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
  };
  const scene = {
    systemID: 30000142,
    _tickIntervalMs: 1000,
    getCurrentSimTimeMs() {
      return currentSimTimeMs;
    },
    getEntityByID(entityID) {
      return entities.get(Number(entityID)) || null;
    },
    finalizeTargetLock() {},
    activateGenericModule(_session, moduleItem, _chargeItem, activationOptions = {}) {
      activationCalls.push({
        nowMs: currentSimTimeMs,
        moduleTypeID: Number(moduleItem && moduleItem.typeID || 0),
        targetID: Number(activationOptions && activationOptions.targetID || 0),
        targetPoint:
          activationOptions && activationOptions.targetPoint
            ? { ...activationOptions.targetPoint }
            : null,
      });
      return { success: true };
    },
    broadcastSpecialFx(sourceID, fxGuid, options, sourceEntity) {
      specialFxCalls.push({
        sourceID: Number(sourceID),
        fxGuid,
        options: { ...options },
        sourceEntityID: Number(sourceEntity && sourceEntity.itemID || 0),
      });
    },
  };
  const session = {
    characterID: 140000002,
    corporationID: 98000001,
    allianceID: 99000001,
    warFactionID: 0,
    _space: {
      systemID: scene.systemID,
      shipID: anchorEntity.itemID,
    },
  };
  const loadout = {
    hullType: {
      typeID: 23773,
      groupID: 30,
      categoryID: 6,
      name: "Ragnarok",
    },
    moduleType: {
      typeID: 24550,
      name: "Judgment",
    },
    fxGuid: "effects.SuperWeaponAmarr",
  };

  try {
    spaceRuntime.getEntity = () => anchorEntity;
    spaceRuntime.getSceneForSession = () => scene;
    spaceRuntime.spawnDynamicShip = (systemID, shipSpec, options = {}) => {
      const entity = {
        ...shipSpec,
        itemID: Number(shipSpec.itemID),
        position: cloneVector(shipSpec.position),
        direction: cloneVector(shipSpec.direction),
        itemName: String(shipSpec.itemName || ""),
        shieldCapacity: Number(shipSpec.shieldCapacity || 100000),
        armorHP: Number(shipSpec.armorHP || 100000),
        structureHP: Number(shipSpec.structureHP || 100000),
      };
      entities.set(entity.itemID, entity);
      spawnCalls.push({
        systemID: Number(systemID),
        itemID: entity.itemID,
        itemName: entity.itemName,
        options: { ...options },
      });
      return {
        success: true,
        data: {
          entity,
        },
      };
    };

    const result = handleSuperTitanShowCommand(
      session,
      "5",
      {
        superTitanTestConfig: {
          random: () => 0.25,
          pickLoadout: () => loadout,
          scheduleFn(callback, delayMs) {
            scheduled.push({
              callback,
              delayMs: Number(delayMs),
            });
            return scheduled.length;
          },
          targetDelayMs: 4000,
        },
      },
    );

    assert.strictEqual(result.success, true, "show command should succeed");
    assert.match(
      result.message,
      /Staged across 2 waves/,
      "show command should report staged spawning",
    );

    // Batch size defaults to 4, so a 5-per-side show should only spawn the
    // first 4 from each fleet immediately.
    assert.strictEqual(spawnCalls.length, 8, "first wave should spawn 8 hulls");
    assert(
      spawnCalls.every((entry) =>
        entry.options &&
        entry.options.broadcastOptions &&
        entry.options.broadcastOptions.deferUntilVisibilitySync === true
      ),
      "show spawns should defer initial visibility sync",
    );

    const oneTickTasks = scheduled.filter((entry) => entry.delayMs === 1000);
    assert(
      oneTickTasks.length >= 2,
      "staging should schedule both the second wave and controller registration one scene tick later",
    );

    const secondWaveTask = oneTickTasks[0];
    const controllerTask = oneTickTasks[1];

    secondWaveTask.callback();
    assert.strictEqual(spawnCalls.length, 10, "second wave should finish the 5+5 show");

    controllerTask.callback();
    assert(
      scene.superTitanShowController,
      "controller registration should happen only after staged spawning completes",
    );
    assert(
      scene.superTitanShowController.nextVolleyAtMs ===
        (scene.getCurrentSimTimeMs() + 4000),
      "controller should wait the configured target delay before the first live volley",
    );
    assert.strictEqual(
      scene.superTitanShowController.volleyBatchSize,
      4,
      "controller should default to staggered 4-activation batches",
    );
    assert.strictEqual(
      scene.superTitanShowController.volleyStepMs,
      1000,
      "controller should default to one-tick spacing between volley batches",
    );

    tickScene(scene, currentSimTimeMs + 3999, {});
    assert.strictEqual(
      activationCalls.length,
      0,
      "no titan should fire before the initial show delay elapses",
    );

    currentSimTimeMs += 4000;
    tickScene(scene, currentSimTimeMs, {});
    assert.strictEqual(
      activationCalls.length,
      4,
      "first live volley should be staggered to 4 activations in the opening tick",
    );

    currentSimTimeMs += 1000;
    tickScene(scene, currentSimTimeMs, {});
    assert.strictEqual(
      activationCalls.length,
      8,
      "second tick should deliver only the next staggered activation batch",
    );

    currentSimTimeMs += 1000;
    tickScene(scene, currentSimTimeMs, {});
    assert.strictEqual(
      activationCalls.length,
      10,
      "third tick should finish the 5+5 first volley without a one-tick superweapon wall",
    );

    const summary = {
      immediateSpawnCount: 8,
      finalSpawnCount: spawnCalls.length,
      deferredAcquireOnAllSpawns: true,
      secondWaveDelayMs: secondWaveTask.delayMs,
      controllerDelayMs: controllerTask.delayMs,
      firstVolleyLeadMs:
        scene.superTitanShowController.nextVolleyAtMs -
        scene.getCurrentSimTimeMs(),
      staggeredFirstVolleyActivations: activationCalls.length,
      firstVolleyBatchSize: 4,
      visibleStampFxCount: specialFxCalls.length,
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    spaceRuntime.getEntity = originalGetEntity;
    spaceRuntime.getSceneForSession = originalGetSceneForSession;
    spaceRuntime.spawnDynamicShip = originalSpawnDynamicShip;
  }
}

main();
