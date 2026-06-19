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

function createSession(overrides = {}) {
  return {
    clientID: 111,
    characterID: 222,
    socket: {
      destroyed: false,
    },
    _space: {
      initialStateSent: true,
      shipID: 9001,
      visibleDynamicEntityIDs: new Set([3001]),
      freshlyVisibleDynamicEntityIDs: new Set([3001]),
      ...((overrides && overrides._space) || {}),
    },
    ...overrides,
  };
}

function createMockScene(overrides = {}) {
  const queued = [];
  const sent = [];
  const scene = {
    systemID: 30000142,
    sessions: new Map(),
    getCurrentSimTimeMs() {
      return 1000;
    },
    getCurrentDestinyStamp() {
      return 77;
    },
    getNextDestinyStamp() {
      return 78;
    },
    getCurrentVisibleDestinyStampForSession(session, baseStamp) {
      return Number(baseStamp) || 77;
    },
    getCurrentSessionDestinyStamp() {
      return 77;
    },
    getImmediateDestinyStampForSession(_session, currentStamp = 77) {
      return (Number(currentStamp) || 77) - 1;
    },
    getHistorySafeSessionDestinyStamp(_session, _nowMs, minimumLead) {
      return Number(minimumLead) >= 2 ? 79 : 78;
    },
    getCurrentPresentedSessionDestinyStamp() {
      return 77;
    },
    hasActiveTickDestinyPresentationBatch() {
      return true;
    },
    queueTickDestinyPresentationUpdates(session, updates, options = {}) {
      queued.push({
        session,
        updates: Array.isArray(updates)
          ? updates.map((update) => ({
              stamp: Number(update && update.stamp) || 0,
              payloadName:
                update &&
                Array.isArray(update.payload) &&
                typeof update.payload[0] === "string"
                  ? update.payload[0]
                  : null,
            }))
          : [],
        options,
      });
    },
    sendDestinyUpdates(session, updates, waitForBubble, options = {}) {
      sent.push({
        session,
        waitForBubble: waitForBubble === true,
        updates: Array.isArray(updates)
          ? updates.map((update) => ({
              stamp: Number(update && update.stamp) || 0,
              payloadName:
                update &&
                Array.isArray(update.payload) &&
                typeof update.payload[0] === "string"
                  ? update.payload[0]
                  : null,
            }))
          : [],
        options,
      });
    },
    canSessionSeeDynamicEntity() {
      return false;
    },
    ...overrides,
  };
  return {
    scene,
    queued,
    sent,
  };
}

function assertQueuedPayloads(entry, expectedStamp, expectedNames) {
  assert(entry, "expected queued update entry");
  assert.deepStrictEqual(
    entry.updates.map((update) => update.stamp),
    expectedNames.map(() => expectedStamp),
  );
  assert.deepStrictEqual(
    entry.updates.map((update) => update.payloadName),
    expectedNames,
  );
}

function runDynamicExplosionScenario(proto) {
  const session = createSession();
  const { scene, queued } = createMockScene();
  scene.sessions.set(session.clientID, session);

  proto.broadcastRemoveBall.call(scene, 3001, null, {
    terminalDestructionEffectID: 3,
    visibilityEntity: {
      itemID: 3001,
      kind: "wreck",
    },
  });

  assert.strictEqual(queued.length, 1);
  assertQueuedPayloads(
    queued[0],
    78,
    ["TerminalPlayDestructionEffect", "RemoveBalls"],
  );
  assert.strictEqual(session._space.visibleDynamicEntityIDs.has(3001), false);
}

function runDynamicVisibilityScenario(proto) {
  const session = createSession();
  const { scene, queued } = createMockScene();
  scene.sessions.set(session.clientID, session);

  proto.broadcastRemoveBall.call(scene, 3001);

  assert.strictEqual(queued.length, 1);
  assertQueuedPayloads(queued[0], 77, ["RemoveBalls"]);
}

function runDynamicExplicitResolveScenario(proto) {
  const session = createSession();
  const { scene, queued } = createMockScene({
    getHistorySafeSessionDestinyStamp() {
      return 78;
    },
  });
  scene.sessions.set(session.clientID, session);

  proto.broadcastRemoveBall.call(scene, 3001, null, {
    terminalDestructionEffectID: 3,
    resolveSessionStamp() {
      return 82;
    },
  });

  assert.strictEqual(queued.length, 1);
  assertQueuedPayloads(
    queued[0],
    82,
    ["TerminalPlayDestructionEffect", "RemoveBalls"],
  );
}

function main() {
  runDynamicExplosionScenario(buildScenePrototype());
  runDynamicVisibilityScenario(buildScenePrototype());
  runDynamicExplicitResolveScenario(buildScenePrototype());
  console.log("Movement removal parity verified.");
}

main();
