const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const destiny = require(path.join(repoRoot, "server/src/space/destiny"));
const {
  buildLiveDamageState,
} = require(path.join(repoRoot, "server/src/space/combat/damage"));

function buildClockSession(scene) {
  const notifications = [];
  const session = {
    clientID: 65450,
    socket: {
      destroyed: false,
    },
    _space: {
      systemID: scene.systemID,
      shipID: 140000333,
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
      beyonceBound: false,
      initialStateSent: false,
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  scene.sessions.set(session.clientID, session);
  return { session, notifications };
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("buildDamageState honors a supplied scene sim filetime", () => {
  const simFileTime = 123456789n;
  const state = destiny.buildDamageState({
    kind: "ship",
    conditionState: {
      shieldCharge: 0.5,
      armorDamage: 0.2,
      damage: 0.1,
    },
    shieldRechargeRate: 1000,
  }, simFileTime);

  assert.equal(state[0][0].type, "real");
  assert.equal(state[0][1].type, "real");
  assert.equal(state[1].type, "real");
  assert.equal(state[2].type, "real");
  assert.equal(state[0][2].value, simFileTime);
});

test("buildLiveDamageState emits Michelle-format damage tuples for live damage notifications", () => {
  const state = buildLiveDamageState({
    kind: "ship",
    conditionState: {
      shieldCharge: 0.5,
      armorDamage: 0.2,
      damage: 0.1,
    },
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
    shieldRechargeRate: 1000,
  });

  assert.ok(Array.isArray(state[0]));
  assert.equal(state[0][0].type, "real");
  assert.equal(state[0][1].type, "real");
  assert.equal(state[0][2].type, "long");
  assert.equal(state[1].type, "real");
  assert.equal(state[2].type, "real");
  assert.equal(state[0][0].value, 0.5);
  assert.equal(state[1].value, 0.8);
  assert.equal(state[2].value, 0.9);
});

test("markBeyonceBound no longer emits an extra sim-clock rebase", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const { session, notifications } = buildClockSession(scene);

  scene.markBeyonceBound(session);

  assert.equal(session._space.beyonceBound, true);
  assert.equal(
    notifications.filter((entry) => entry.name === "DoSimClockRebase").length,
    0,
  );
});

test("scene ticks do not spam DoSimClockRebase notifications", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const { notifications } = buildClockSession(scene);

  scene.tick(scene.getCurrentWallclockMs() + 1000);

  assert.equal(
    notifications.filter((entry) => entry.name === "DoSimClockRebase").length,
    0,
  );
});

test("explicit time dilation changes still force a client rebase", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const { notifications } = buildClockSession(scene);

  const result = scene.setTimeDilation(0.5, {
    syncSessions: true,
    forceRebase: true,
  });

  assert.equal(result.factor, 0.5);
  assert.equal(
    notifications.filter((entry) => entry.name === "DoSimClockRebase").length,
    1,
  );
});
