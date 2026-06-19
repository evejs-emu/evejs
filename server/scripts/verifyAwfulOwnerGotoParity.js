#!/usr/bin/env node

const assert = require("assert");

const {
  resolveOwnerMovementRestampState,
  OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
} = require("../src/space/movement/movementDeliveryPolicy");
const {
  createMovementSubwarpCommands,
} = require("../src/space/movement/commands/movementSubwarpCommands");

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

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * toFiniteNumber(scalar, 0),
    y: toFiniteNumber(vector && vector.y, 0) * toFiniteNumber(scalar, 0),
    z: toFiniteNumber(vector && vector.z, 0) * toFiniteNumber(scalar, 0),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
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

function buildDirectedMovementUpdates(entity, direction, speedFractionChanged, stamp) {
  const updates = [{
    stamp,
    payload: ["GotoDirection", [entity.itemID, direction.x, direction.y, direction.z]],
  }];
  if (speedFractionChanged) {
    updates.push({
      stamp,
      payload: ["SetSpeedFraction", [entity.itemID, 1]],
    });
  }
  return updates;
}

function createSubwarpHarness() {
  return createMovementSubwarpCommands({
    addVectors,
    armMovementTrace() {},
    buildDirectedMovementUpdates,
    buildPointMovementUpdates() {
      return [];
    },
    buildPerpendicular() {
      return { x: 0, y: 1, z: 0 };
    },
    clearTrackingState() {},
    cloneVector,
    crossProduct() {
      return { x: 0, y: 0, z: 1 };
    },
    directionsNearlyMatch,
    getShipDockingDistanceToStation() {
      return 0;
    },
    getTargetMotionPosition() {
      return { x: 0, y: 0, z: 0 };
    },
    logMovementDebug() {},
    normalizeVector,
    persistShipEntity() {},
    roundNumber(value) {
      return value;
    },
    scaleVector,
    subtractVectors,
    summarizeVector(vector) {
      return cloneVector(vector);
    },
    toFiniteNumber,
    toInt,
    DEFAULT_UP: { x: 0, y: 1, z: 0 },
    OWNER_PENDING_GOTO_DUPLICATE_ALIGNMENT,
  });
}

function verifyGotoLeadPlumbing() {
  const movementSubwarpCommands = createSubwarpHarness();
  function captureLeadOverride(commandSource, ownerLocallyPredictsHeading) {
    const captured = [];
    const entity = {
      itemID: 991002978,
      position: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      targetPoint: { x: 0, y: 1.0e16, z: 0 },
      targetEntityID: null,
      speedFraction: 1,
      mode: "GOTO",
      pendingDock: null,
    };
    const session = {
      characterID: 140000002,
      socket: { destroyed: false },
      _space: {
        shipID: entity.itemID,
        lastPilotCommandMovementStamp: 0,
        lastPilotCommandMovementAnchorStamp: 0,
        lastPilotCommandMovementRawDispatchStamp: 0,
        lastPilotCommandDirection: null,
      },
    };
    const runtimeMock = {
      getShipEntityForSession() {
        return entity;
      },
      getCurrentSimTimeMs() {
        return 1775081887000;
      },
      getCurrentDestinyStamp() {
        return 1775081887;
      },
      getCurrentSessionDestinyStamp() {
        return 1775081887;
      },
      getMovementStamp() {
        return 1775081887;
      },
      dispatchConfiguredSubwarpMovement(_entity, buildUpdates, now, options) {
        captured.push({
          now,
          options,
          previewUpdates: buildUpdates(1775081887),
        });
        return true;
      },
      broadcastMovementUpdates() {
        throw new Error("owner echo should not be suppressed in this scenario");
      },
      scheduleWatcherMovementAnchor() {},
    };

    movementSubwarpCommands.gotoDirection(
      runtimeMock,
      session,
      { x: -0.4, y: 0, z: -0.9 },
      {
        commandSource,
        ownerLocallyPredictsHeading,
      },
    );

    assert.strictEqual(captured.length, 1);
    return captured[0].options.ownerDirectEchoLeadOverride;
  }

  const gotoLeadOverride = captureLeadOverride("CmdGotoDirection", false);
  const steerLeadOverride = captureLeadOverride("CmdSteerDirection", true);

  assert.strictEqual(gotoLeadOverride, 2);
  assert.strictEqual(steerLeadOverride, undefined);

  return {
    gotoDirectionLeadOverride: toInt(gotoLeadOverride, 0) >>> 0,
    steerDirectionLeadOverride:
      steerLeadOverride === undefined ? "default" : steerLeadOverride,
  };
}

function verifyAwfulWindow() {
  const commonOptions = {
    ownerMovementUpdates: [{
      stamp: 1775081887,
      payload: ["GotoDirection", [991002978, -0.4, 0, -0.9]],
    }],
    ownerHasSteeringCommand: true,
    currentRawDispatchStamp: 1775081887,
    liveOwnerSessionStamp: 1775081887,
    currentVisibleOwnerStamp: 1775081887,
    currentPresentedOwnerStamp: 1775081889,
    previousLastSentDestinyWasOwnerCritical: false,
    quietWindowMinimumStamp: 0,
    lastFreshAcquireLifecycleStamp: 1775081878,
    lastOwnerNonMissileCriticalStamp: 1775081879,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775081876,
    lastOwnerMissileLifecycleStamp: 0,
    lastOwnerMissileLifecycleRawDispatchStamp: 0,
    lastOwnerMissileFreshAcquireStamp: 0,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
    previousOwnerPilotCommandStamp: 1775081879,
    previousOwnerPilotCommandAnchorStamp: 1775081876,
    previousOwnerPilotCommandRawDispatchStamp: 1775081876,
    previousOwnerPilotCommandDirectionRaw: { x: 0, y: 0, z: 0 },
    normalizeVector,
    directionsNearlyMatch,
    getPendingHistorySafeStamp(authoredStamp, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1775081887 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
    defaultRight: { x: 1, y: 0, z: 0 },
  };

  const beforeState = resolveOwnerMovementRestampState(commonOptions);
  const afterState = resolveOwnerMovementRestampState({
    ...commonOptions,
    ownerDirectEchoLeadOverride: 2,
  });

  const beforeStamp =
    toInt(beforeState.ownerUpdates && beforeState.ownerUpdates[0] && beforeState.ownerUpdates[0].stamp, 0) >>> 0;
  const afterStamp =
    toInt(afterState.ownerUpdates && afterState.ownerUpdates[0] && afterState.ownerUpdates[0].stamp, 0) >>> 0;

  assert.strictEqual(beforeStamp, 1775081888);
  assert.strictEqual(afterStamp, 1775081890);

  return {
    beforeStamp,
    afterStamp,
    ownerDirectEchoMinimumStamp: afterState.ownerDirectEchoMinimumStamp,
    presentedNonCriticalOwnerEchoFloor: afterState.presentedNonCriticalOwnerEchoFloor,
  };
}

function verifyJolty11Windows() {
  const commonOptions = {
    ownerHasSteeringCommand: true,
    ownerDirectEchoLeadOverride: 2,
    quietWindowMinimumStamp: 0,
    lastFreshAcquireLifecycleStamp: 1775035273,
    lastOwnerMissileLifecycleStamp: 0,
    lastOwnerMissileLifecycleRawDispatchStamp: 0,
    lastOwnerMissileFreshAcquireStamp: 0,
    lastOwnerMissileFreshAcquireRawDispatchStamp: 0,
    normalizeVector,
    directionsNearlyMatch,
    defaultRight: { x: 1, y: 0, z: 0 },
  };

  const firstAfter = resolveOwnerMovementRestampState({
    ...commonOptions,
    ownerMovementUpdates: [{
      stamp: 1775035299,
      payload: ["GotoDirection", [990112367, -0.5, -0.2, 0.9]],
    }],
    currentRawDispatchStamp: 1775035299,
    liveOwnerSessionStamp: 1775035299,
    currentVisibleOwnerStamp: 1775035299,
    currentPresentedOwnerStamp: 1775035300,
    previousLastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775035292,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775035290,
    previousOwnerPilotCommandStamp: 1775035292,
    previousOwnerPilotCommandAnchorStamp: 1775035290,
    previousOwnerPilotCommandRawDispatchStamp: 1775035290,
    previousOwnerPilotCommandDirectionRaw: { x: 0, y: 0, z: 0 },
    getPendingHistorySafeStamp(authoredStamp, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1775035299 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });
  const secondBefore = resolveOwnerMovementRestampState({
    ...commonOptions,
    ownerMovementUpdates: [{
      stamp: 1775035300,
      payload: ["GotoDirection", [990112367, -0.8, -0.2, 0.5]],
    }],
    currentRawDispatchStamp: 1775035300,
    liveOwnerSessionStamp: 1775035300,
    currentVisibleOwnerStamp: 1775035300,
    currentPresentedOwnerStamp: 0,
    previousLastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775035301,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775035299,
    previousOwnerPilotCommandStamp: 1775035301,
    previousOwnerPilotCommandAnchorStamp: 1775035299,
    previousOwnerPilotCommandRawDispatchStamp: 1775035299,
    previousOwnerPilotCommandDirectionRaw: { x: -0.5, y: -0.2, z: 0.9 },
    getPendingHistorySafeStamp(authoredStamp, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1775035300 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });
  const secondAfter = resolveOwnerMovementRestampState({
    ...commonOptions,
    ownerMovementUpdates: [{
      stamp: 1775035300,
      payload: ["GotoDirection", [990112367, -0.8, -0.2, 0.5]],
    }],
    currentRawDispatchStamp: 1775035300,
    liveOwnerSessionStamp: 1775035300,
    currentVisibleOwnerStamp: 1775035300,
    currentPresentedOwnerStamp: 1775035301,
    previousLastSentDestinyWasOwnerCritical: false,
    lastOwnerNonMissileCriticalStamp: 1775035301,
    lastOwnerNonMissileCriticalRawDispatchStamp: 1775035299,
    previousOwnerPilotCommandStamp: 1775035301,
    previousOwnerPilotCommandAnchorStamp: 1775035299,
    previousOwnerPilotCommandRawDispatchStamp: 1775035299,
    previousOwnerPilotCommandDirectionRaw: { x: -0.5, y: -0.2, z: 0.9 },
    getPendingHistorySafeStamp(authoredStamp, minimumLead = 0) {
      return Math.max(
        toInt(authoredStamp, 0) >>> 0,
        (1775035300 + toInt(minimumLead, 0)) >>> 0,
      ) >>> 0;
    },
  });

  const firstAfterStamp =
    toInt(firstAfter.ownerUpdates && firstAfter.ownerUpdates[0] && firstAfter.ownerUpdates[0].stamp, 0) >>> 0;
  const secondBeforeStamp =
    toInt(secondBefore.ownerUpdates && secondBefore.ownerUpdates[0] && secondBefore.ownerUpdates[0].stamp, 0) >>> 0;
  const secondAfterStamp =
    toInt(secondAfter.ownerUpdates && secondAfter.ownerUpdates[0] && secondAfter.ownerUpdates[0].stamp, 0) >>> 0;

  assert.strictEqual(firstAfterStamp, 1775035302);
  assert.strictEqual(secondBeforeStamp, 1775035301);
  assert.strictEqual(secondAfterStamp, 1775035303);

  return {
    firstAfterStamp,
    secondBeforeStamp,
    secondAfterStamp,
  };
}

function main() {
  const snapshots = {
    gotoLeadPlumbing: verifyGotoLeadPlumbing(),
    awfulWindow: verifyAwfulWindow(),
    jolty11Windows: verifyJolty11Windows(),
  };

  console.log(JSON.stringify(snapshots, null, 2));
}

main();
