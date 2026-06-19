#!/usr/bin/env node

const assert = require("assert");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");
const movementDeliveryPolicy = require("../src/space/movement/movementDeliveryPolicy");

function buildScenePrototype() {
  runtime._testing.clearScenes();
  const scene = runtime.ensureScene(30000142, {
    refreshStargates: false,
  });
  const prototype = Object.getPrototypeOf(scene);
  runtime._testing.clearScenes();
  return prototype;
}

function createSession(overrides = {}) {
  const {
    _space: spaceOverrides = {},
    ...sessionOverrides
  } = overrides || {};
  return {
    clientID: 65450,
    characterID: 140000008,
    charID: 140000008,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      shipID: 991003010,
      simTimeMs: 1775153674000,
      simFileTime: 134196272747440000n,
      timeDilation: 1,
      historyFloorDestinyStamp: 1775153578,
      visibleDynamicEntityIDs: new Set([980000000195]),
      freshlyVisibleDynamicEntityIDs: new Set([980000000195]),
      ...spaceOverrides,
    },
    ...sessionOverrides,
  };
}

function verifyProjectedOwnerDamageClear() {
  const earlyWindow = movementDeliveryPolicy.resolveDamageStateDispatchStamp({
    visibleStamp: 1775153612,
    currentPresentedStamp: 1775153614,
    previousLastSentDestinyStamp: 1775153614,
    previousLastSentDestinyRawDispatchStamp: 1775153611,
    currentRawDispatchStamp: 1775153612,
  });
  const lateWindow = movementDeliveryPolicy.resolveDamageStateDispatchStamp({
    visibleStamp: 1775153684,
    currentPresentedStamp: 1775153685,
    previousLastSentDestinyStamp: 1775153685,
    previousLastSentDestinyRawDispatchStamp: 1775153683,
    currentRawDispatchStamp: 1775153684,
  });

  assert.strictEqual(
    earlyWindow.projectedPresentedDamageClearFloor,
    1775153615,
    "Expected funky owner damage clear floor to move onto the projected 3615 lane",
  );
  assert.strictEqual(
    earlyWindow.finalStamp,
    1775153615,
    "Expected funky owner damage to stop reusing the stale 3614 lane",
  );
  assert.strictEqual(
    lateWindow.projectedPresentedDamageClearFloor,
    1775153686,
    "Expected later funky owner damage clear floor to move onto the projected 3686 lane",
  );
  assert.strictEqual(
    lateWindow.finalStamp,
    1775153686,
    "Expected later funky owner damage to stop reusing the stale 3685 lane",
  );

  return {
    earlyWindow: {
      beforeStamp: 1775153614,
      afterStamp: earlyWindow.finalStamp,
    },
    lateWindow: {
      beforeStamp: 1775153685,
      afterStamp: lateWindow.finalStamp,
    },
  };
}

function createRemovalScene(proto, session) {
  const queued = [];
  const scene = Object.assign(Object.create(proto), {
    systemID: 30000142,
    sessions: new Map([[session.clientID, session]]),
    getCurrentSimTimeMs() {
      return 1775153674000;
    },
    getCurrentDestinyStamp() {
      return 1775153674;
    },
    getNextDestinyStamp() {
      return 1775153675;
    },
    getCurrentVisibleDestinyStampForSession(_session, baseStamp) {
      return Number(baseStamp) || 1775153674;
    },
    getCurrentVisibleSessionDestinyStamp() {
      return 1775153675;
    },
    getCurrentSessionDestinyStamp() {
      return 1775153675;
    },
    getImmediateDestinyStampForSession(_session, currentStamp = 1775153675) {
      return Math.max(0, (Number(currentStamp) || 1775153675) - 1);
    },
    getCurrentPresentedSessionDestinyStamp(_session, _nowMs, maximumLead = 0) {
      const maximumFutureLead = Number(maximumLead) || 0;
      const visible = 1775153675;
      const trustedPresented = 1775153676;
      return Math.min(
        trustedPresented,
        (visible + maximumFutureLead) >>> 0,
      ) >>> 0;
    },
    getHistorySafeSessionDestinyStamp() {
      return 1775153676;
    },
    hasActiveTickDestinyPresentationBatch() {
      return true;
    },
    queueTickDestinyPresentationUpdates(_session, updates, options = {}) {
      queued.push({
        updates,
        options,
      });
    },
    sendDestinyUpdates() {
      throw new Error("Removal verifier expected queued presentation, not direct send");
    },
    canSessionSeeDynamicEntity() {
      return true;
    },
  });
  return { scene, queued };
}

function verifyExplodingRemovalQueue(proto) {
  const session = createSession({
    _space: {
      lastSentDestinyStamp: 1775153676,
      lastSentDestinyRawDispatchStamp: 1775153674,
      lastSentDestinyWasOwnerCritical: true,
    },
  });
  const { scene, queued } = createRemovalScene(proto, session);

  proto.broadcastRemoveBall.call(scene, 980000000195, null, {
    terminalDestructionEffectID: 3,
    visibilityEntity: {
      itemID: 980000000195,
      kind: "ship",
      bubbleID: 4,
    },
  });

  assert.strictEqual(queued.length, 1, "Expected one queued exploding removal bundle");
  const queuedEntry = queued[0];
  assert(
    queuedEntry.options &&
      queuedEntry.options.sendOptions &&
      queuedEntry.options.sendOptions.historyLeadUsesPresentedSessionStamp === true,
    "Expected exploding removal queue to use presented-session aligned send options",
  );

  scene.getCurrentPresentedSessionDestinyStamp = (_session, _nowMs, maximumLead = 0) => {
    const maximumFutureLead = Number(maximumLead) || 0;
    const visible = 1775153675;
    const trustedPresented = 1775153677;
    return Math.min(
      trustedPresented,
      (visible + maximumFutureLead) >>> 0,
    ) >>> 0;
  };

  const emittedStamp = scene.resolveDestinyDeliveryStampForSession(
    session,
    queuedEntry.updates[0].stamp,
    scene.getCurrentSimTimeMs(),
    queuedEntry.options.sendOptions,
  );

  assert.strictEqual(
    queuedEntry.updates[0].stamp,
    1775153676,
    "Expected authored exploding removal stamp to match the live funky kill lane",
  );
  assert.strictEqual(
    emittedStamp,
    1775153677,
    "Expected queued exploding removal to clear onto the presented 3677 lane",
  );

  return {
    beforeStamp: 1775153676,
    afterStamp: emittedStamp,
  };
}

function verifyTargetStopClamp(proto) {
  const captured = [];
  const session = createSession();
  const scene = Object.assign(Object.create(proto), {
    getCurrentSimTimeMs() {
      return 1775153674000;
    },
    finalizeGenericModuleDeactivation(_session, moduleID, options = {}) {
      captured.push({
        kind: "generic",
        moduleID,
        options,
      });
      return { success: true };
    },
    finalizePropulsionModuleDeactivation(_session, moduleID, options = {}) {
      captured.push({
        kind: "propulsion",
        moduleID,
        options,
      });
      return { success: true };
    },
  });
  const sourceEntity = {
    itemID: 991003010,
    session,
    activeModuleEffects: new Map([
      [991003014, {
        moduleID: 991003014,
        targetID: 980000000100,
        isGeneric: true,
      }],
      [991003015, {
        moduleID: 991003015,
        targetID: 980000000100,
        isGeneric: false,
      }],
    ]),
  };

  proto.stopTargetedModuleEffects.call(scene, sourceEntity, 980000000100, {
    reason: "target",
    nowMs: 1775153674000,
  });

  assert.strictEqual(captured.length, 2, "Expected both targeted effects to be stopped");
  for (const entry of captured) {
    assert.strictEqual(
      entry.options.clampToVisibleStamp,
      true,
      "Expected target-stop module cleanup to clamp the owner stop notification to the visible lane",
    );
  }

  return {
    genericModuleID: captured[0].moduleID,
    propulsionModuleID: captured[1].moduleID,
    clampToVisibleStamp: true,
  };
}

function main() {
  const proto = buildScenePrototype();
  const result = {
    ownerDamage: verifyProjectedOwnerDamageClear(),
    explodingRemoval: verifyExplodingRemovalQueue(proto),
    targetStopClamp: verifyTargetStopClamp(proto),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
