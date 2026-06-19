#!/usr/bin/env node

const assert = require("assert");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = "1";

const runtime = require("../src/space/runtime");

function buildScenePrototype() {
  runtime._testing.clearScenes();
  const scene = runtime.ensureScene(30000142, {
    refreshStargates: false,
  });
  const prototype = Object.getPrototypeOf(scene);
  runtime._testing.clearScenes();
  return prototype;
}

function createSession(spaceOverrides = {}) {
  return {
    clientID: 1065450,
    characterID: 140000008,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      shipID: 991002587,
      freshlyVisibleDynamicEntityReleaseStampByID: new Map(),
      ...spaceOverrides,
    },
  };
}

function verifyAcquireOptions() {
  const activeScene = {
    hasActiveTickDestinyPresentationBatch() {
      return true;
    },
    getCurrentSimTimeMs() {
      return 1775135423000;
    },
  };
  const inactiveScene = {
    hasActiveTickDestinyPresentationBatch() {
      return false;
    },
    getCurrentSimTimeMs() {
      return 1775135423000;
    },
  };

  const readySession = createSession();
  const unreadySession = createSession({
    initialStateSent: false,
  });

  const activeOptions =
    runtime._testing.buildDeferredOwnerMissileAcquireOptionsForTesting(
      activeScene,
      readySession,
    );
  const inactiveOptions =
    runtime._testing.buildDeferredOwnerMissileAcquireOptionsForTesting(
      inactiveScene,
      readySession,
    );
  const unreadyOptions =
    runtime._testing.buildDeferredOwnerMissileAcquireOptionsForTesting(
      activeScene,
      unreadySession,
    );

  assert.strictEqual(activeOptions.nowMs, 1775135423000);
  assert.strictEqual(activeOptions.bypassTickPresentationBatch, true);
  assert.strictEqual(
    inactiveOptions.bypassTickPresentationBatch,
    false,
  );
  assert.strictEqual(
    unreadyOptions.bypassTickPresentationBatch,
    false,
  );

  return {
    activeBypass: activeOptions.bypassTickPresentationBatch,
    inactiveBypass: inactiveOptions.bypassTickPresentationBatch,
    unreadyBypass: unreadyOptions.bypassTickPresentationBatch,
    nowMs: activeOptions.nowMs,
  };
}

function verifyPresentationQueueBypass(proto) {
  const session = createSession();
  const missileEntity = {
    itemID: 980000000351,
    sourceShipID: 991002587,
    isMissile: true,
  };
  const queuedCalls = [];
  const sentCalls = [];
  const scene = {
    hasActiveTickDestinyPresentationBatch() {
      return true;
    },
    getCurrentSimTimeMs() {
      return 1775135423000;
    },
    buildAddBallsUpdatesForSession() {
      return {
        updates: [
          {
            stamp: 1775135424,
            payload: ["AddBalls2", [{ batchIndex: 0 }]],
          },
        ],
        sendOptions: {
          skipOwnerMonotonicRestampWhenPreviousNotOwnerCritical: true,
        },
      };
    },
    prepareDestinyUpdateForSession(_session, update) {
      return update;
    },
    queueTickDestinyPresentationUpdates(_session, updates, options) {
      queuedCalls.push({
        updates,
        options,
      });
      return updates.length;
    },
    sendDestinyUpdates(_session, updates, _waitForBubble, sendOptions) {
      sentCalls.push({
        updates,
        sendOptions,
      });
      return updates.reduce(
        (highestStamp, update) =>
          Math.max(highestStamp, Number(update && update.stamp) >>> 0),
        0,
      ) >>> 0;
    },
  };

  proto.sendAddBallsToSession.call(scene, session, [missileEntity], {
    freshAcquire: true,
    nowMs: 1775135423000,
  });
  assert.strictEqual(queuedCalls.length, 1);
  assert.strictEqual(sentCalls.length, 0);

  const queuedProtectedUntilStamp =
    session._space.freshlyVisibleDynamicEntityReleaseStampByID.get(
      missileEntity.itemID,
    );
  assert.ok(Number.isFinite(queuedProtectedUntilStamp));

  session._space.freshlyVisibleDynamicEntityReleaseStampByID = new Map();

  proto.sendAddBallsToSession.call(scene, session, [missileEntity], {
    freshAcquire: true,
    nowMs: 1775135423000,
    bypassTickPresentationBatch: true,
  });
  assert.strictEqual(queuedCalls.length, 1);
  assert.strictEqual(sentCalls.length, 1);

  const bypassProtectedUntilStamp =
    session._space.freshlyVisibleDynamicEntityReleaseStampByID.get(
      missileEntity.itemID,
    );
  assert.ok(Number.isFinite(bypassProtectedUntilStamp));

  return {
    withoutBypass: {
      queuedCount: queuedCalls.length,
      sentCount: 0,
      emittedStamp: 1775135424,
    },
    withBypass: {
      queuedCount: queuedCalls.length - 1,
      sentCount: sentCalls.length,
      emittedStamp:
        Number(sentCalls[0].updates[0] && sentCalls[0].updates[0].stamp) >>> 0,
    },
  };
}

function main() {
  const proto = buildScenePrototype();
  const acquireOptions = verifyAcquireOptions();
  const queueBypass = verifyPresentationQueueBypass(proto);

  console.log(JSON.stringify({
    acquireOptions,
    queueBypass,
  }, null, 2));
}

main();
