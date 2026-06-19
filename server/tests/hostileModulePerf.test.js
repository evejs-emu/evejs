const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const repoRoot = path.join(__dirname, "..", "..");

const hostileModuleRuntime = require(path.join(
  repoRoot,
  "server/src/space/modules/hostileModuleRuntime",
));
const jammerModuleRuntime = require(path.join(
  repoRoot,
  "server/src/space/modules/jammerModuleRuntime",
));

function buildTarget() {
  return {
    itemID: 9000,
    kind: "ship",
    signatureRadius: 400,
    capacitorCapacity: 100_000,
    capacitorChargeRatio: 0.8,
    passiveDerivedState: {
      attributes: {
        211: 30,
      },
    },
  };
}

function buildEffectDefinitions() {
  return [
    {
      hostileFamily: "stasisWebifier",
      hostileJammingType: "webify",
      hostileMaxRangeMeters: 10_000,
      hostileFalloffMeters: 5_000,
      durationMs: 5_000,
      hostileStrengthValue: -60,
      hostileModifierAttributeID: 37,
      hostileModifierOperation: 6,
      hostileResistanceAttributeID: 2115,
      hostileStackingPenalized: true,
      hostileAffectsTargetDerivedState: true,
    },
    {
      hostileFamily: "targetPainter",
      hostileJammingType: "ewTargetPaint",
      hostileMaxRangeMeters: 10_000,
      hostileFalloffMeters: 5_000,
      durationMs: 5_000,
      hostileStrengthValue: 30,
      hostileModifierAttributeID: 552,
      hostileModifierOperation: 6,
      hostileResistanceAttributeID: 2114,
      hostileStackingPenalized: true,
      hostileAffectsTargetDerivedState: true,
    },
    {
      hostileFamily: "warpScrambler",
      hostileJammingType: "warpScramblerMWD",
      hostileMaxRangeMeters: 12_000,
      hostileFalloffMeters: 3_000,
      durationMs: 5_000,
      hostileWarpScrambleStrength: 2,
      hostileBlocksMicrowarpdrive: true,
      hostileBlocksMicroJumpDrive: true,
    },
    {
      hostileFamily: "warpDisruptor",
      hostileJammingType: "warpScrambler",
      hostileMaxRangeMeters: 24_000,
      hostileFalloffMeters: 5_000,
      durationMs: 5_000,
      hostileWarpScrambleStrength: 1,
    },
    {
      hostileFamily: "energyNeutralizer",
      hostileJammingType: "ewEnergyNeut",
      hostileMaxRangeMeters: 12_000,
      hostileFalloffMeters: 5_000,
      durationMs: 5_000,
      hostileStrengthValue: 500,
      hostileResistanceAttributeID: 2045,
      hostileEnergySignatureResolution: 0,
    },
    {
      hostileFamily: "energyNosferatu",
      hostileJammingType: "ewEnergyVampire",
      hostileMaxRangeMeters: 12_000,
      hostileFalloffMeters: 5_000,
      durationMs: 5_000,
      hostileStrengthValue: 300,
      hostileResistanceAttributeID: 2045,
      hostileEnergySignatureResolution: 0,
    },
    {
      jammerModuleEffect: true,
      hostileJammingType: "electronic",
      jammerMaxRangeMeters: 23_000,
      jammerFalloffMeters: 21_000,
      durationMs: 20_000,
      jammerStrengthBySensorType: {
        gravimetric: 2.6,
        ladar: 2.6,
        magnetometric: 2.6,
        radar: 2.6,
      },
      jammerMaxStrength: 2.6,
    },
    {
      jammerBurstEffect: true,
      jammerBreakLocksOnly: true,
      hostileJammingType: "electronic",
      jammerBurstRadiusMeters: 12_000,
      durationMs: 30_000,
      jammerStrengthBySensorType: {
        gravimetric: 7.2,
        ladar: 7.2,
        magnetometric: 7.2,
        radar: 7.2,
      },
      jammerMaxStrength: 7.2,
    },
  ];
}

test("mixed hostile cycles stay below 0.1ms average in the pure runtime path", () => {
  const target = buildTarget();
  const scene = {
    dynamicEntities: new Map(),
    getEntityByID(id) {
      return id === target.itemID ? target : null;
    },
  };
  const callbacks = {
    getEntityByID(id) {
      return id === target.itemID ? target : null;
    },
    isEntityLockedTarget() {
      return true;
    },
    getEntitySurfaceDistance() {
      return 5_000;
    },
    getEntityCapacitorAmount(entity) {
      return Number(entity.capacitorCapacity || 0) * Number(entity.capacitorChargeRatio || 0);
    },
    setEntityCapacitorRatio(entity, nextRatio) {
      entity.capacitorChargeRatio = nextRatio;
    },
    persistEntityCapacitorRatio() {},
    notifyCapacitorChangeToSession() {},
    clearOutgoingTargetLocksExcept() {},
    random() {
      return 0;
    },
  };

  const definitions = buildEffectDefinitions();
  const activeModules = [];
  for (let index = 0; index < 50; index += 1) {
    const entity = {
      itemID: 10_000 + index,
      kind: "ship",
      capacitorCapacity: 100_000,
      capacitorChargeRatio: index % 2 === 0 ? 0.9 : 0.4,
    };
    scene.dynamicEntities.set(entity.itemID, entity);
    activeModules.push({
      entity,
      effectState: {
        moduleID: 20_000 + index,
        targetID: target.itemID,
        ...definitions[index % definitions.length],
      },
    });
  }
  scene.dynamicEntities.set(target.itemID, target);

  for (let warmup = 0; warmup < 10; warmup += 1) {
    for (const activeModule of activeModules) {
      const runtimeToUse =
        activeModule.effectState && activeModule.effectState.jammerModuleEffect === true
          ? jammerModuleRuntime
          : hostileModuleRuntime;
      runtimeToUse.executeJammerBurstCycle && activeModule.effectState.jammerBurstEffect === true
        ? runtimeToUse.executeJammerBurstCycle({
          scene,
          entity: activeModule.entity,
          effectState: activeModule.effectState,
          nowMs: 1_000 + warmup,
          callbacks,
        })
        : runtimeToUse.executeHostileModuleCycle
        ? runtimeToUse.executeHostileModuleCycle({
          scene,
          entity: activeModule.entity,
          effectState: activeModule.effectState,
          nowMs: 1_000 + warmup,
          callbacks,
        })
        : runtimeToUse.executeJammerModuleCycle({
          scene,
          entity: activeModule.entity,
          effectState: activeModule.effectState,
          nowMs: 1_000 + warmup,
          callbacks,
        });
    }
  }

  const iterations = 200;
  const startedAt = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const activeModule of activeModules) {
      const runtimeToUse =
        activeModule.effectState && activeModule.effectState.jammerModuleEffect === true
          ? jammerModuleRuntime
          : hostileModuleRuntime;
      runtimeToUse.executeJammerBurstCycle && activeModule.effectState.jammerBurstEffect === true
        ? runtimeToUse.executeJammerBurstCycle({
          scene,
          entity: activeModule.entity,
          effectState: activeModule.effectState,
          nowMs: 2_000 + iteration,
          callbacks,
        })
        : runtimeToUse.executeHostileModuleCycle
        ? runtimeToUse.executeHostileModuleCycle({
          scene,
          entity: activeModule.entity,
          effectState: activeModule.effectState,
          nowMs: 2_000 + iteration,
          callbacks,
        })
        : runtimeToUse.executeJammerModuleCycle({
          scene,
          entity: activeModule.entity,
          effectState: activeModule.effectState,
          nowMs: 2_000 + iteration,
          callbacks,
        });
    }
  }
  const elapsedMs = performance.now() - startedAt;
  const averagePerCycleMs = elapsedMs / (iterations * activeModules.length);

  assert.ok(
    averagePerCycleMs < 0.1,
    `expected hostile runtime hot-path average < 0.1ms, got ${averagePerCycleMs.toFixed(6)}ms`,
  );
});
