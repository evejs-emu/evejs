const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  applyCharacterToSession,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));

const FILETIME_EPOCH_OFFSET = 116444736000000000n;

function msToFileTime(value) {
  return BigInt(Math.trunc(Number(value))) * 10000n + FILETIME_EPOCH_OFFSET;
}

function withMockedNow(initialNowMs, callback) {
  const realDateNow = Date.now;
  let currentNowMs = initialNowMs;
  Date.now = () => currentNowMs;
  try {
    return callback({
      getNow() {
        return currentNowMs;
      },
      setNow(value) {
        currentNowMs = Number(value);
      },
    });
  } finally {
    Date.now = realDateNow;
  }
}

function buildSession() {
  const notifications = [];
  return {
    clientID: 65452,
    characterID: 0,
    _notifications: notifications,
    socket: {
      destroyed: false,
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function attachCharacterToScene(systemID = 30000142) {
  const scene = spaceRuntime.ensureScene(systemID);
  const session = buildSession();

  const applyResult = applyCharacterToSession(session, 140000004, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const shipItem = getActiveShipRecord(session.characterID);
  assert.ok(shipItem);

  const shipEntity = scene.attachSession(session, shipItem, {
    broadcast: false,
    emitSimClockRebase: false,
    spawnStopped: true,
  });
  assert.ok(shipEntity);

  return { scene, session, shipItem, shipEntity };
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("attachSession honors an explicit previousSimTimeMs override", () => {
  const { scene, session, shipItem } = attachCharacterToScene();
  const explicitPreviousSimTimeMs = scene.getCurrentSimTimeMs() - 60000;

  session._notifications.length = 0;
  const attachedEntity = spaceRuntime.attachSession(session, shipItem, {
    systemID: scene.systemID,
    broadcast: false,
    emitSimClockRebase: true,
    forceSimClockRebase: true,
    previousSimTimeMs: explicitPreviousSimTimeMs,
  });

  assert.ok(attachedEntity);
  const rebaseNotifications = session._notifications.filter(
    (entry) => entry.name === "DoSimClockRebase",
  );
  assert.equal(rebaseNotifications.length, 1);
  assert.equal(
    rebaseNotifications[0].payload[0][0].value,
    msToFileTime(explicitPreviousSimTimeMs),
  );
  assert.notEqual(
    rebaseNotifications[0].payload[0][0].value,
    rebaseNotifications[0].payload[0][1].value,
  );
});

test("ensureInitialBallpark skips a one-shot bootstrap rebase only when requested", () => {
  const skipped = attachCharacterToScene();
  skipped.session._skipNextInitialBallparkRebase = true;
  skipped.scene.tick(skipped.scene.getCurrentWallclockMs() + 2500);

  skipped.scene.ensureInitialBallpark(skipped.session);

  assert.equal(
    skipped.session._notifications.filter((entry) => entry.name === "DoSimClockRebase").length,
    0,
  );
  assert.equal(skipped.session._skipNextInitialBallparkRebase, false);

  const ordinary = attachCharacterToScene(30000144);
  ordinary.scene.tick(ordinary.scene.getCurrentWallclockMs() + 2500);
  ordinary.scene.ensureInitialBallpark(ordinary.session);

  assert.equal(
    ordinary.session._notifications.filter((entry) => entry.name === "DoSimClockRebase").length,
    1,
  );
});

test("ensureInitialBallpark uses a preserved pre-jump clock after a delayed bootstrap", () => {
  const staged = attachCharacterToScene(30000145);
  const preservedPreviousSimTimeMs = staged.scene.getCurrentSimTimeMs() - 60000;

  staged.session._nextInitialBallparkPreviousSimTimeMs = preservedPreviousSimTimeMs;
  staged.scene.tick(staged.scene.getCurrentWallclockMs() + 2500);
  staged.scene.ensureInitialBallpark(staged.session);

  const rebaseNotifications = staged.session._notifications.filter(
    (entry) => entry.name === "DoSimClockRebase",
  );
  assert.equal(rebaseNotifications.length, 1);
  assert.equal(
    rebaseNotifications[0].payload[0][0].value,
    msToFileTime(preservedPreviousSimTimeMs),
  );
  assert.equal(
    rebaseNotifications[0].payload[0][0].value,
    rebaseNotifications[0].payload[0][1].value,
  );
});

test("ensureInitialBallpark advances a preserved jump clock by elapsed old-TiDi wallclock time", () => {
  withMockedNow(1773765000000, ({ getNow, setNow }) => {
    const staged = attachCharacterToScene(30000146);
    const preservedPreviousSimTimeMs = staged.scene.getCurrentSimTimeMs() - 60000;

    staged.session._nextInitialBallparkPreviousSimTimeMs = preservedPreviousSimTimeMs;
    staged.session._nextInitialBallparkPreviousTimeDilation = 0.5;
    staged.session._nextInitialBallparkPreviousCapturedAtWallclockMs = getNow();

    setNow(getNow() + 2200);
    staged.scene.tick(staged.scene.getCurrentWallclockMs() + 2500);
    staged.scene.ensureInitialBallpark(staged.session);

    const rebaseNotifications = staged.session._notifications.filter(
      (entry) => entry.name === "DoSimClockRebase",
    );
    assert.equal(rebaseNotifications.length, 1);
    assert.equal(
      rebaseNotifications[0].payload[0][0].value,
      msToFileTime(preservedPreviousSimTimeMs + 1100),
    );
  });
});
