#!/usr/bin/env node

const {
  resolveDestinyLifecycleRestampState,
} = require("../src/space/movement/movementDeliveryPolicy");
const {
  MICHELLE_HELD_FUTURE_DESTINY_LEAD,
} = require("../src/space/movement/movementMichelleContract");

function oldOwnerFreshAcquireFloor(options = {}) {
  const currentSessionStamp = Number(options.currentSessionStamp) >>> 0;
  const currentImmediateSessionStamp =
    Number(options.currentImmediateSessionStamp) >>> 0;
  const localStamp = Number(options.localStamp) >>> 0;
  const lastFreshAcquireLifecycleStamp =
    Number(options.lastFreshAcquireLifecycleStamp) >>> 0;
  const recentOwnerCriticalFloor =
    Number(options.recentOwnerCriticalFloor) >>> 0;
  const minimumPostFreshAcquireStamp =
    Number(options.minimumPostFreshAcquireStamp) >>> 0;

  const reusableFreshAcquireLane =
    lastFreshAcquireLifecycleStamp > currentSessionStamp &&
    lastFreshAcquireLifecycleStamp <= (
      (currentSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0
    )
      ? lastFreshAcquireLifecycleStamp
      : 0;
  const freshAcquireHistorySafeFloor = (
    currentImmediateSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD
  ) >>> 0;
  return reusableFreshAcquireLane > 0
    ? reusableFreshAcquireLane
    : Math.max(
        localStamp,
        freshAcquireHistorySafeFloor,
        recentOwnerCriticalFloor > 0
          ? ((recentOwnerCriticalFloor + 1) >>> 0)
          : 0,
        minimumPostFreshAcquireStamp,
      ) >>> 0;
}

function runScenario(name, options) {
  const actual = resolveDestinyLifecycleRestampState({
    localStamp: options.localStamp,
    currentSessionStamp: options.currentSessionStamp,
    currentImmediateSessionStamp: options.currentImmediateSessionStamp,
    currentRawDispatchStamp: options.currentRawDispatchStamp,
    isFreshAcquireLifecycleGroup: true,
    isMissileLifecycleGroup: true,
    isOwnerMissileLifecycleGroup: true,
    minimumPostFreshAcquireStamp: options.minimumPostFreshAcquireStamp || 0,
    lastFreshAcquireLifecycleStamp: options.lastFreshAcquireLifecycleStamp || 0,
    lastMissileLifecycleStamp: options.lastMissileLifecycleStamp || 0,
    lastOwnerMissileLifecycleStamp: options.lastOwnerMissileLifecycleStamp || 0,
    lastOwnerMissileLifecycleRawDispatchStamp:
      options.lastOwnerMissileLifecycleRawDispatchStamp || 0,
    lastOwnerMissileFreshAcquireStamp:
      options.lastOwnerMissileFreshAcquireStamp || 0,
    lastOwnerMissileFreshAcquireRawDispatchStamp:
      options.lastOwnerMissileFreshAcquireRawDispatchStamp || 0,
    previousLastSentDestinyStamp: options.previousLastSentDestinyStamp || 0,
    previousLastSentDestinyRawDispatchStamp:
      options.previousLastSentDestinyRawDispatchStamp || 0,
    previousLastSentDestinyWasOwnerCritical:
      options.previousLastSentDestinyWasOwnerCritical === true,
    lastOwnerPilotCommandMovementStamp:
      options.lastOwnerPilotCommandMovementStamp || 0,
    lastOwnerPilotCommandMovementRawDispatchStamp:
      options.lastOwnerPilotCommandMovementRawDispatchStamp || 0,
  });

  const recentOwnerCriticalFloor = Math.max(
    Number(actual.recentOwnerMovementLane || 0) >>> 0,
    Number(actual.recentOwnerMissileLifecycleLane || 0) >>> 0,
    Number(actual.recentOwnerFreshAcquireLane || 0) >>> 0,
    Number(actual.recentOverallOwnerCriticalLane || 0) >>> 0,
  ) >>> 0;

  return {
    name,
    beforeFloor: oldOwnerFreshAcquireFloor({
      currentSessionStamp: options.currentSessionStamp,
      currentImmediateSessionStamp: options.currentImmediateSessionStamp,
      localStamp: options.localStamp,
      lastFreshAcquireLifecycleStamp: options.lastFreshAcquireLifecycleStamp,
      recentOwnerCriticalFloor,
      minimumPostFreshAcquireStamp: options.minimumPostFreshAcquireStamp || 0,
    }),
    afterFloor: Number(actual.finalStamp) >>> 0,
    recentOwnerCriticalFloor,
    freshAcquireFloor: actual.freshAcquireFloor,
  };
}

const scenarios = [
  runScenario("jolt222LateOwnerMissileAcquireClearsSharedLane", {
    currentSessionStamp: 1775130662,
    currentImmediateSessionStamp: 1775130661,
    currentRawDispatchStamp: 1775130662,
    localStamp: 1775130663,
    lastFreshAcquireLifecycleStamp: 1775130663,
    lastMissileLifecycleStamp: 1775130663,
    lastOwnerMissileLifecycleStamp: 1775130663,
    lastOwnerMissileLifecycleRawDispatchStamp: 1775130662,
    lastOwnerMissileFreshAcquireStamp: 1775130663,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 1775130662,
    previousLastSentDestinyStamp: 1775130663,
    previousLastSentDestinyRawDispatchStamp: 1775130662,
    previousLastSentDestinyWasOwnerCritical: true,
  }),
  runScenario("sameRawLateOwnerMissileAcquireClampsAtHeldCeiling", {
    currentSessionStamp: 1775130662,
    currentImmediateSessionStamp: 1775130661,
    currentRawDispatchStamp: 1775130662,
    localStamp: 1775130663,
    lastFreshAcquireLifecycleStamp: 1775130664,
    lastMissileLifecycleStamp: 1775130664,
    lastOwnerMissileLifecycleStamp: 1775130664,
    lastOwnerMissileLifecycleRawDispatchStamp: 1775130662,
    lastOwnerMissileFreshAcquireStamp: 1775130664,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 1775130662,
    previousLastSentDestinyStamp: 1775130664,
    previousLastSentDestinyRawDispatchStamp: 1775130662,
    previousLastSentDestinyWasOwnerCritical: true,
  }),
  runScenario("firstOwnerMissileAcquireStillKeepsSharedHeldLane", {
    currentSessionStamp: 1775130661,
    currentImmediateSessionStamp: 1775130660,
    currentRawDispatchStamp: 1775130661,
    localStamp: 1775130663,
    lastFreshAcquireLifecycleStamp: 1775130663,
    lastMissileLifecycleStamp: 1775130663,
    lastOwnerMissileLifecycleStamp: 1775130663,
    lastOwnerMissileLifecycleRawDispatchStamp: 1775130661,
    lastOwnerMissileFreshAcquireStamp: 1775130663,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 1775130661,
    previousLastSentDestinyStamp: 1775130662,
    previousLastSentDestinyRawDispatchStamp: 1775130661,
    previousLastSentDestinyWasOwnerCritical: true,
  }),
];

if (scenarios[0].beforeFloor !== 1775130663 || scenarios[0].afterFloor !== 1775130664) {
  throw new Error(
    `jolt222 scenario mismatch: before ${scenarios[0].beforeFloor}, after ${scenarios[0].afterFloor}`,
  );
}
if (scenarios[1].beforeFloor !== 1775130664 || scenarios[1].afterFloor !== 1775130664) {
  throw new Error(
    `held-ceiling clamp mismatch: before ${scenarios[1].beforeFloor}, after ${scenarios[1].afterFloor}`,
  );
}
if (scenarios[2].beforeFloor !== 1775130663 || scenarios[2].afterFloor !== 1775130663) {
  throw new Error(
    `first acquire reuse mismatch: before ${scenarios[2].beforeFloor}, after ${scenarios[2].afterFloor}`,
  );
}

console.log(JSON.stringify({
  scenarios: scenarios.map((scenario) => ({
    name: scenario.name,
    beforeFloor: scenario.beforeFloor,
    afterFloor: scenario.afterFloor,
    recentOwnerCriticalFloor: scenario.recentOwnerCriticalFloor,
    freshAcquireFloor: scenario.freshAcquireFloor,
  })),
}, null, 2));
