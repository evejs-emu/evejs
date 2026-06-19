#!/usr/bin/env node

const {
  resolveDestinyLifecycleRestampState,
} = require("../src/space/movement/movementDeliveryPolicy");
const {
  MICHELLE_HELD_FUTURE_DESTINY_LEAD,
  MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
} = require("../src/space/movement/movementMichelleContract");

function oldObserverMissileLifecycleFloor(options = {}) {
  const currentSessionStamp = Number(options.currentSessionStamp) >>> 0;
  const localStamp = Number(options.localStamp) >>> 0;
  const lastMissileLifecycleStamp = Number(options.lastMissileLifecycleStamp) >>> 0;
  const recentOwnerMovementLane = Number(options.recentOwnerMovementLane) >>> 0;
  const reusableMissileLifecycleLane =
    lastMissileLifecycleStamp > currentSessionStamp &&
    lastMissileLifecycleStamp <= (
      (currentSessionStamp + MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD) >>> 0
    )
      ? lastMissileLifecycleStamp
      : 0;
  return reusableMissileLifecycleLane > 0
    ? reusableMissileLifecycleLane
    : Math.max(
        localStamp,
        ((currentSessionStamp + MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD) >>> 0),
        recentOwnerMovementLane > 0
          ? ((recentOwnerMovementLane + 1) >>> 0)
          : 0,
      ) >>> 0;
}

function oldObserverMissileLifecycleCeiling(options = {}) {
  return Math.max(
    ((Number(options.currentSessionStamp) + MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD) >>> 0),
    Number(options.currentPresentedOwnerCriticalStamp) >>> 0,
  ) >>> 0;
}

function newObserverMissileLifecycleCeiling(options = {}) {
  return Math.max(
    ((Number(options.currentSessionStamp) + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0),
    Number(options.currentPresentedOwnerCriticalStamp) >>> 0,
  ) >>> 0;
}

function runScenario(name, options) {
  const actual = resolveDestinyLifecycleRestampState({
    localStamp: options.localStamp,
    currentSessionStamp: options.currentSessionStamp,
    currentImmediateSessionStamp: options.currentImmediateSessionStamp,
    currentRawDispatchStamp: options.currentRawDispatchStamp,
    isMissileLifecycleGroup: true,
    isOwnerMissileLifecycleGroup: false,
    lastMissileLifecycleStamp: options.lastMissileLifecycleStamp,
    lastOwnerPilotCommandMovementStamp: options.lastOwnerPilotCommandMovementStamp || 0,
    lastOwnerPilotCommandMovementRawDispatchStamp:
      options.lastOwnerPilotCommandMovementRawDispatchStamp || 0,
    previousLastSentDestinyStamp: options.previousLastSentDestinyStamp || 0,
    previousLastSentDestinyRawDispatchStamp:
      options.previousLastSentDestinyRawDispatchStamp || 0,
    previousLastSentDestinyWasOwnerCritical:
      options.previousLastSentDestinyWasOwnerCritical === true,
    lastOwnerMissileLifecycleStamp: options.lastOwnerMissileLifecycleStamp || 0,
    lastOwnerMissileLifecycleRawDispatchStamp:
      options.lastOwnerMissileLifecycleRawDispatchStamp || 0,
    lastOwnerMissileFreshAcquireStamp:
      options.lastOwnerMissileFreshAcquireStamp || 0,
    lastOwnerMissileFreshAcquireRawDispatchStamp:
      options.lastOwnerMissileFreshAcquireRawDispatchStamp || 0,
    lastFreshAcquireLifecycleStamp: options.lastFreshAcquireLifecycleStamp || 0,
    minimumPostFreshAcquireStamp: options.minimumPostFreshAcquireStamp || 0,
  });
  const recentOwnerMovementLane =
    Number(actual.recentOwnerMovementLane || 0) >>> 0;
  const beforeFloor = oldObserverMissileLifecycleFloor({
    currentSessionStamp: options.currentSessionStamp,
    localStamp: options.localStamp,
    lastMissileLifecycleStamp: options.lastMissileLifecycleStamp,
    recentOwnerMovementLane,
  });
  const afterFloor = Number(actual.finalStamp) >>> 0;
  const beforeCeiling = oldObserverMissileLifecycleCeiling({
    currentSessionStamp: options.currentSessionStamp,
    currentPresentedOwnerCriticalStamp:
      options.currentPresentedOwnerCriticalStamp || 0,
  });
  const afterCeiling = newObserverMissileLifecycleCeiling({
    currentSessionStamp: options.currentSessionStamp,
    currentPresentedOwnerCriticalStamp:
      options.currentPresentedOwnerCriticalStamp || 0,
  });
  return {
    name,
    input: options,
    beforeFloor,
    afterFloor,
    beforeCeiling,
    afterCeiling,
    restampState: actual,
  };
}

const scenarios = [
  runScenario("safeLeadPreserved", {
    currentSessionStamp: 70,
    currentImmediateSessionStamp: 70,
    currentRawDispatchStamp: 70,
    localStamp: 72,
    lastMissileLifecycleStamp: 0,
    currentPresentedOwnerCriticalStamp: 0,
  }),
  runScenario("postHeldReuseCleared", {
    currentSessionStamp: 70,
    currentImmediateSessionStamp: 70,
    currentRawDispatchStamp: 70,
    localStamp: 72,
    lastMissileLifecycleStamp: 73,
    currentPresentedOwnerCriticalStamp: 0,
  }),
  runScenario("jolt90Shape", {
    currentSessionStamp: 1775080746,
    currentImmediateSessionStamp: 1775080746,
    currentRawDispatchStamp: 1775080746,
    localStamp: 1775080748,
    lastMissileLifecycleStamp: 0,
    currentPresentedOwnerCriticalStamp: 0,
  }),
];

for (const scenario of scenarios) {
  if (!(scenario.beforeFloor > scenario.afterFloor)) {
    throw new Error(
      `${scenario.name} expected beforeFloor > afterFloor, got ${scenario.beforeFloor} and ${scenario.afterFloor}`,
    );
  }
  if (!(scenario.beforeCeiling > scenario.afterCeiling)) {
    throw new Error(
      `${scenario.name} expected beforeCeiling > afterCeiling, got ${scenario.beforeCeiling} and ${scenario.afterCeiling}`,
    );
  }
}

console.log(JSON.stringify({
  scenarios: scenarios.map((scenario) => ({
    name: scenario.name,
    beforeFloor: scenario.beforeFloor,
    afterFloor: scenario.afterFloor,
    beforeCeiling: scenario.beforeCeiling,
    afterCeiling: scenario.afterCeiling,
    recentOwnerMovementLane: scenario.restampState.recentOwnerMovementLane,
    missileLifecycleFloor: scenario.restampState.missileLifecycleFloor,
  })),
}, null, 2));
