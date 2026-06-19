#!/usr/bin/env node

const assert = require("assert");

const {
  resolveOwnerMovementRestampState,
  OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
} = require("../src/space/movement/movementDeliveryPolicy");

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? Math.trunc(fallbackNumeric) : 0;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  const source =
    vector && typeof vector === "object"
      ? vector
      : fallback && typeof fallback === "object"
        ? fallback
        : { x: 0, y: 0, z: 0 };
  return {
    x: toFiniteNumber(source.x, 0),
    y: toFiniteNumber(source.y, 0),
    z: toFiniteNumber(source.z, 0),
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const source = cloneVector(vector, fallback);
  const magnitude = Math.sqrt(
    (source.x * source.x) +
    (source.y * source.y) +
    (source.z * source.z)
  );
  if (magnitude <= 0) {
    return cloneVector(fallback, { x: 1, y: 0, z: 0 });
  }
  return {
    x: source.x / magnitude,
    y: source.y / magnitude,
    z: source.z / magnitude,
  };
}

function directionsNearlyMatch(
  left,
  right,
  minimumDot = OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
) {
  const normalizedLeft = normalizeVector(left, { x: 1, y: 0, z: 0 });
  const normalizedRight = normalizeVector(right, { x: 1, y: 0, z: 0 });
  const dot =
    (normalizedLeft.x * normalizedRight.x) +
    (normalizedLeft.y * normalizedRight.y) +
    (normalizedLeft.z * normalizedRight.z);
  return dot >= minimumDot;
}

function createGotoUpdate(stamp, direction) {
  return {
    stamp,
    payload: [
      "GotoDirection",
      [991002978, direction.x, direction.y, direction.z],
    ],
  };
}

function createPendingHistorySafeStampResolver(liveOwnerSessionStamp) {
  return function getPendingHistorySafeStamp(authoredStamp, minimumLead = 0) {
    return Math.max(
      toInt(authoredStamp, 0) >>> 0,
      (
        liveOwnerSessionStamp +
        toInt(minimumLead, 0)
      ) >>> 0,
    ) >>> 0;
  };
}

function runRestamp(options) {
  return resolveOwnerMovementRestampState({
    ownerHasSteeringCommand: true,
    ownerDirectEchoLeadOverride: 2,
    quietWindowMinimumStamp: 0,
    lastFreshAcquireLifecycleStamp: 0,
    lastOwnerMissileLifecycleStamp: 0,
    lastOwnerMissileLifecycleRawDispatchStamp: 0,
    lastOwnerMissileFreshAcquireStamp: 0,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
    previousLastSentDestinyWasOwnerCritical: true,
    normalizeVector,
    directionsNearlyMatch,
    defaultRight: { x: 1, y: 0, z: 0 },
    ...options,
  });
}

function verifyJolty99Windows() {
  const firstWindow = runRestamp({
    ownerMovementUpdates: [
      createGotoUpdate(1775126038, { x: -1, y: -0.2, z: -0.2 }),
    ],
    currentRawDispatchStamp: 1775126038,
    liveOwnerSessionStamp: 1775126038,
    currentVisibleOwnerStamp: 1775126038,
    currentPresentedOwnerStamp: 1775126039,
    lastOwnerNonMissileCriticalStamp: 1775126039,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775126037,
    previousOwnerPilotCommandStamp: 1775126039,
    previousOwnerPilotCommandAnchorStamp: 1775126037,
    previousOwnerPilotCommandRawDispatchStamp: 1775126037,
    previousOwnerPilotCommandDirectionRaw: { x: -1, y: -0.1, z: -0.1 },
    getPendingHistorySafeStamp: createPendingHistorySafeStampResolver(1775126038),
  });

  const firstWindowStamp =
    toInt(firstWindow.ownerUpdates && firstWindow.ownerUpdates[0] && firstWindow.ownerUpdates[0].stamp, 0) >>> 0;
  assert.strictEqual(firstWindowStamp, 1775126040);
  assert.strictEqual(toInt(firstWindow.reusableHeldOwnerPilotCommandLane, 0) >>> 0, 0);
  assert.strictEqual(toInt(firstWindow.nextDistinctOwnerPilotCommandLane, 0) >>> 0, 1775126040);

  const sameHeadingFollowup = runRestamp({
    ownerMovementUpdates: [
      createGotoUpdate(1775126039, { x: -1, y: -0.2, z: -0.2 }),
    ],
    currentRawDispatchStamp: 1775126039,
    liveOwnerSessionStamp: 1775126039,
    currentVisibleOwnerStamp: 1775126039,
    currentPresentedOwnerStamp: 1775126040,
    lastOwnerNonMissileCriticalStamp: 1775126040,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775126038,
    previousOwnerPilotCommandStamp: 1775126040,
    previousOwnerPilotCommandAnchorStamp: 1775126038,
    previousOwnerPilotCommandRawDispatchStamp: 1775126038,
    previousOwnerPilotCommandDirectionRaw: { x: -1, y: -0.2, z: -0.2 },
    getPendingHistorySafeStamp: createPendingHistorySafeStampResolver(1775126039),
  });

  const sameHeadingFollowupStamp =
    toInt(sameHeadingFollowup.ownerUpdates && sameHeadingFollowup.ownerUpdates[0] && sameHeadingFollowup.ownerUpdates[0].stamp, 0) >>> 0;
  assert.strictEqual(sameHeadingFollowupStamp, 1775126040);
  assert.strictEqual(
    toInt(sameHeadingFollowup.reusableHeldOwnerPilotCommandLane, 0) >>> 0,
    1775126040,
  );

  const secondWindow = runRestamp({
    ownerMovementUpdates: [
      createGotoUpdate(1775126053, { x: -0.5, y: -0.1, z: 0.9 }),
    ],
    currentRawDispatchStamp: 1775126053,
    liveOwnerSessionStamp: 1775126053,
    currentVisibleOwnerStamp: 1775126053,
    currentPresentedOwnerStamp: 1775126054,
    lastOwnerNonMissileCriticalStamp: 1775126054,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775126052,
    previousOwnerPilotCommandStamp: 1775126054,
    previousOwnerPilotCommandAnchorStamp: 1775126052,
    previousOwnerPilotCommandRawDispatchStamp: 1775126052,
    previousOwnerPilotCommandDirectionRaw: { x: -0.6, y: -0.1, z: 0.8 },
    getPendingHistorySafeStamp: createPendingHistorySafeStampResolver(1775126053),
  });

  const secondWindowStamp =
    toInt(secondWindow.ownerUpdates && secondWindow.ownerUpdates[0] && secondWindow.ownerUpdates[0].stamp, 0) >>> 0;
  assert.strictEqual(secondWindowStamp, 1775126055);
  assert.strictEqual(toInt(secondWindow.reusableHeldOwnerPilotCommandLane, 0) >>> 0, 0);
  assert.strictEqual(toInt(secondWindow.nextDistinctOwnerPilotCommandLane, 0) >>> 0, 1775126055);

  const thirdWindow = runRestamp({
    ownerMovementUpdates: [
      createGotoUpdate(1775126054, { x: -0.3, y: -0.1, z: 0.9 }),
    ],
    currentRawDispatchStamp: 1775126054,
    liveOwnerSessionStamp: 1775126054,
    currentVisibleOwnerStamp: 1775126054,
    currentPresentedOwnerStamp: 1775126055,
    lastOwnerNonMissileCriticalStamp: 1775126055,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775126053,
    previousOwnerPilotCommandStamp: 1775126055,
    previousOwnerPilotCommandAnchorStamp: 1775126053,
    previousOwnerPilotCommandRawDispatchStamp: 1775126053,
    previousOwnerPilotCommandDirectionRaw: { x: -0.5, y: -0.1, z: 0.9 },
    getPendingHistorySafeStamp: createPendingHistorySafeStampResolver(1775126054),
  });

  const thirdWindowStamp =
    toInt(thirdWindow.ownerUpdates && thirdWindow.ownerUpdates[0] && thirdWindow.ownerUpdates[0].stamp, 0) >>> 0;
  assert.strictEqual(thirdWindowStamp, 1775126056);
  assert.strictEqual(toInt(thirdWindow.reusableHeldOwnerPilotCommandLane, 0) >>> 0, 0);
  assert.strictEqual(toInt(thirdWindow.nextDistinctOwnerPilotCommandLane, 0) >>> 0, 1775126056);

  const nearDuplicateReuse = runRestamp({
    ownerMovementUpdates: [
      createGotoUpdate(100, { x: -1, y: -0.10001, z: -0.10001 }),
    ],
    currentRawDispatchStamp: 100,
    liveOwnerSessionStamp: 100,
    currentVisibleOwnerStamp: 100,
    currentPresentedOwnerStamp: 101,
    lastOwnerNonMissileCriticalStamp: 101,
    lastOwnerNonMissileCriticalRawDispatchStamp: 99,
    previousOwnerPilotCommandStamp: 101,
    previousOwnerPilotCommandAnchorStamp: 99,
    previousOwnerPilotCommandRawDispatchStamp: 99,
    previousOwnerPilotCommandDirectionRaw: { x: -1, y: -0.1, z: -0.1 },
    getPendingHistorySafeStamp: createPendingHistorySafeStampResolver(100),
  });

  const nearDuplicateStamp =
    toInt(nearDuplicateReuse.ownerUpdates && nearDuplicateReuse.ownerUpdates[0] && nearDuplicateReuse.ownerUpdates[0].stamp, 0) >>> 0;
  assert.strictEqual(nearDuplicateStamp, 101);
  assert.strictEqual(
    toInt(nearDuplicateReuse.reusableHeldOwnerPilotCommandLane, 0) >>> 0,
    101,
  );

  return {
    jolty99_6038: {
      beforeStamp: 1775126039,
      afterStamp: firstWindowStamp,
    },
    jolty99_6039_followup: {
      beforeStamp: 1775126039,
      afterStamp: sameHeadingFollowupStamp,
    },
    jolty99_6053: {
      beforeStamp: 1775126054,
      afterStamp: secondWindowStamp,
    },
    jolty99_6054: {
      beforeStamp: 1775126054,
      afterStamp: thirdWindowStamp,
    },
    nearDuplicateReuseStillWorks: {
      beforeStamp: 101,
      afterStamp: nearDuplicateStamp,
    },
  };
}

function main() {
  const result = {
    jolty99: verifyJolty99Windows(),
  };
  console.log(`${JSON.stringify(result, null, 2)}\n`);
}

main();
