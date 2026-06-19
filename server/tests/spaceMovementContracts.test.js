const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));

const TEST_SYSTEM_ID = 30000142;
const MICHELLE_PRETICK_HISTORY_SAFE_DESTINY_LEAD = 3;
const OWNER_MISSILE_CLIENT_LANE_LEAD = 2;
const PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD = 4;
const RECENT_EMITTED_OWNER_CRITICAL_MAX_LEAD =
  OWNER_MISSILE_CLIENT_LANE_LEAD +
  MICHELLE_PRETICK_HISTORY_SAFE_DESTINY_LEAD +
  PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD;

function createFakeSession(clientID, characterID, position, options = {}) {
  const notifications = [];
  const velocity = options.velocity || { x: 0, y: 0, z: 0 };
  const direction = options.direction || { x: 1, y: 0, z: 0 };
  const mode = options.mode || "STOP";
  const speedFraction =
    options.speedFraction ??
    (mode === "STOP" && velocity.x === 0 && velocity.y === 0 && velocity.z === 0
      ? 0
      : 1);

  return {
    clientID,
    characterID,
    charID: characterID,
    characterName: `char-${characterID}`,
    shipName: `ship-${characterID}`,
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendServiceNotification() {},
    shipItem: {
      itemID: clientID + 100000,
      typeID: options.typeID ?? 606,
      ownerID: characterID,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      spaceState: {
        position,
        velocity,
        direction,
        mode,
        speedFraction,
      },
    },
  };
}

function attachAndBootstrap(session) {
  const entity = spaceRuntime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
  });
  assert.ok(entity, "expected test entity to attach");
  assert.equal(
    spaceRuntime.ensureInitialBallpark(session),
    true,
    "expected test session to finish initial ballpark bootstrap",
  );
  session.notifications.length = 0;
  return entity;
}

function flattenDestinyUpdates(notifications = []) {
  const updates = [];
  for (const notification of notifications) {
    if (
      !notification ||
      notification.name !== "DoDestinyUpdate" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }

    const payloadList = notification.payload[0];
    const entries = Array.isArray(payloadList && payloadList.items)
      ? payloadList.items
      : [];
    for (const entry of entries) {
      const payload = Array.isArray(entry) ? entry[1] : null;
      if (!Array.isArray(payload) || typeof payload[0] !== "string") {
        continue;
      }
      updates.push({
        stamp: Array.isArray(entry) ? entry[0] : null,
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
  }
  return updates;
}

function setPresentedDestinyLane(session, stamp, rawDispatchStamp, options = {}) {
  if (!session || !session._space) {
    return;
  }
  const normalizedStamp = Math.trunc(Number(stamp) || 0) >>> 0;
  const normalizedRawDispatchStamp = Math.trunc(Number(rawDispatchStamp) || 0) >>> 0;
  session._space.lastSentDestinyStamp = normalizedStamp;
  session._space.lastSentDestinyRawDispatchStamp = normalizedRawDispatchStamp;
  if (Object.prototype.hasOwnProperty.call(options, "wasOwnerCritical")) {
    session._space.lastSentDestinyWasOwnerCritical =
      options.wasOwnerCritical === true;
  }
  if (Object.prototype.hasOwnProperty.call(options, "onlyStaleProjectedOwnerMissileLane")) {
    session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane =
      options.onlyStaleProjectedOwnerMissileLane === true;
  }
  const authorityState = session._space.destinyAuthorityState || {};
  authorityState.lastPresentedStamp = normalizedStamp;
  authorityState.lastRawDispatchStamp = normalizedRawDispatchStamp;
  if (Object.prototype.hasOwnProperty.call(options, "wasOwnerCritical")) {
    authorityState.lastSentWasOwnerCritical = options.wasOwnerCritical === true;
  }
  if (Object.prototype.hasOwnProperty.call(options, "onlyStaleProjectedOwnerMissileLane")) {
    authorityState.lastSentOnlyStaleProjectedOwnerMissileLane =
      options.onlyStaleProjectedOwnerMissileLane === true;
  }
  session._space.destinyAuthorityState = authorityState;
}

function assertObserverMovementStampWithinSceneTickWindow(observerUpdate, currentStamp) {
  assert.ok(observerUpdate, "expected an observer movement update");
  assert.equal(
    observerUpdate.stamp >= currentStamp,
    true,
    "expected observer movement to stay on or just ahead of the live scene tick",
  );
  assert.equal(
    observerUpdate.stamp <= ((currentStamp + 1) >>> 0),
    true,
    "expected observer movement not to drift beyond the next scene tick",
  );
}

function flushQueuedMovementUpdates(scene) {
  assert.ok(scene, "expected scene to exist");
  scene.flushPendingSubwarpMovementContracts(scene.getCurrentSimTimeMs());
}

function getMovementUpdateNames(notifications = []) {
  return flattenDestinyUpdates(notifications)
    .map((entry) => entry.name)
    .filter((name) =>
      name === "GotoDirection" ||
      name === "Orbit" ||
      name === "SetSpeedFraction" ||
      name === "Stop" ||
      name === "SetBallVelocity",
    );
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("stop includes the live velocity seed for both pilot and observers", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
    {
      velocity: { x: 86.1, y: -46.6, z: -317.9 },
      direction: { x: 0.3, y: -0.1, z: -1 },
      mode: "GOTO",
      speedFraction: 1,
    },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  const ownerEntity = attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const stopResult = scene.stopShipEntity(ownerEntity);
  assert.equal(stopResult, true);

  assert.deepEqual(
    getMovementUpdateNames(ownerSession.notifications),
    ["SetSpeedFraction", "Stop", "SetBallVelocity"],
  );
  assert.deepEqual(
    getMovementUpdateNames(observerSession.notifications),
    ["SetSpeedFraction", "Stop", "SetBallVelocity"],
  );
});

test("gotoDirection suppresses duplicate heading rebroadcasts", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const firstResult = scene.gotoDirection(ownerSession, { x: 1, y: 0, z: 0 });
  assert.equal(firstResult, true);
  assert.deepEqual(
    getMovementUpdateNames(ownerSession.notifications),
    ["GotoDirection", "SetSpeedFraction"],
  );

  ownerSession.notifications.length = 0;

  const secondResult = scene.gotoDirection(ownerSession, { x: 1, y: 0, z: 0 });
  assert.equal(secondResult, true);
  assert.deepEqual(getMovementUpdateNames(ownerSession.notifications), []);
});

test("gotoDirection suppresses near-duplicate pending owner steering while the previous owner lane is still future", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
    {
      velocity: { x: 120, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "GOTO",
      speedFraction: 1,
    },
  );

  attachAndBootstrap(ownerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const firstDirection = {
    x: -0.775797436019033,
    y: -0.05910604227175866,
    z: 0.628207620164913,
  };
  const secondDirection = {
    x: -0.7768038031416594,
    y: -0.06035954968014159,
    z: 0.6268433426200399,
  };

  assert.equal(scene.gotoDirection(ownerSession, firstDirection), true);

  const firstOwnerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(firstOwnerUpdates.length, 1);

  ownerSession.notifications.length = 0;

  assert.equal(scene.gotoDirection(ownerSession, secondDirection), true);
  assert.deepEqual(
    getMovementUpdateNames(ownerSession.notifications),
    [],
    "expected a near-identical steering command to be suppressed while the prior owner lane is still pending",
  );
});

test("adjacent-dispatch distinct non-missile gotoDirection reuses the pending owner lane instead of ratcheting a new future tick", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
    {
      velocity: { x: 182.4, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "GOTO",
      speedFraction: 1,
    },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  let fixedNow = scene.getCurrentSimTimeMs();
  scene.getCurrentSimTimeMs = () => fixedNow;

  const firstDirection = { x: 0.1, y: 0.2, z: -1.0 };
  const secondDirection = { x: -0.6, y: 0.2, z: -0.7 };

  assert.equal(scene.gotoDirection(ownerSession, firstDirection), true);

  const firstOwnerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(firstOwnerUpdates.length, 1);
  const firstOwnerStamp = firstOwnerUpdates[0].stamp >>> 0;

  ownerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  fixedNow += 1000;

  assert.equal(scene.gotoDirection(ownerSession, secondDirection), true);

  const secondOwnerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const secondObserverUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(secondOwnerUpdates.length, 1);
  assert.equal(secondObserverUpdates.length, 1);
  assert.equal(
    secondOwnerUpdates[0].stamp >>> 0,
    firstOwnerStamp,
    "expected an adjacent-dispatch owner re-aim to stay on the already-pending owner future lane instead of creating a fresh ratcheted tick",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandMovementStamp >>> 0,
    firstOwnerStamp,
    "expected owner movement tracking to stay on the reused pending lane after the adjacent distinct re-aim",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandMovementRawDispatchStamp >>> 0,
    scene.getCurrentDestinyStamp(fixedNow) >>> 0,
    "expected the reused pending owner lane to refresh its raw-dispatch anchor so later restamps see the latest adjacent command",
  );
  const observerDirectionArgs = secondObserverUpdates[0].args.map((value) => (
    value && typeof value === "object" && "value" in value
      ? value.value
      : value
  ));
  assert.equal(
    observerDirectionArgs[0],
    100001,
    "expected the observer update to still target the owner's ship",
  );
  assert.equal(
    observerDirectionArgs[1] < 0,
    true,
    "expected observers to still receive the latest adjacent distinct heading even when the owner lane is reused",
  );
  assert.equal(
    observerDirectionArgs[2] > 0,
    true,
    "expected the observer heading to preserve the latest positive Y re-aim component",
  );
  assert.equal(
    observerDirectionArgs[3] < 0,
    true,
    "expected the observer heading to preserve the latest forward-negative Z component",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandDirection.x < 0,
    true,
    "expected the latest adjacent owner direction to remain tracked on the reused pending lane",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandDirection.y > 0,
    true,
    "expected the reused owner lane to keep the latest positive Y re-aim direction",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandDirection.z < 0,
    true,
    "expected the reused owner lane to keep the latest forward-negative Z heading",
  );
});

test("plain moving gotoDirection keeps the held owner lane when that lane becomes current on the next raw tick", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
    {
      velocity: { x: 182.4, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "GOTO",
      speedFraction: 1,
    },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  let fixedNow = scene.getCurrentSimTimeMs();
  scene.getCurrentSimTimeMs = () => fixedNow;

  const firstDirection = { x: 0.1, y: 0.2, z: -1.0 };
  const secondDirection = { x: -0.6, y: 0.2, z: -0.7 };
  const thirdDirection = { x: -0.2, y: 0.8, z: -0.5 };
  const fourthDirection = { x: -0.8, y: 0.1, z: -0.6 };

  assert.equal(scene.gotoDirection(ownerSession, firstDirection), true);

  const firstOwnerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(firstOwnerUpdates.length, 1);
  const firstOwnerStamp = firstOwnerUpdates[0].stamp >>> 0;

  ownerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  fixedNow += 1000;

  assert.equal(scene.gotoDirection(ownerSession, secondDirection), true);

  const secondOwnerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(secondOwnerUpdates.length, 1);
  assert.equal(
    secondOwnerUpdates[0].stamp >>> 0,
    firstOwnerStamp,
    "expected the adjacent raw re-aim to stay on the first held owner lane",
  );

  ownerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  fixedNow += 1000;

  assert.equal(scene.gotoDirection(ownerSession, thirdDirection), true);

  const thirdOwnerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const thirdObserverUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(thirdOwnerUpdates.length, 1);
  assert.equal(thirdObserverUpdates.length, 1);
  assert.equal(
    thirdOwnerUpdates[0].stamp >>> 0,
    firstOwnerStamp,
    "expected the owner lane not to ratchet again on the raw tick where the reused lane becomes current",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandMovementStamp >>> 0,
    firstOwnerStamp,
    "expected owner movement tracking to keep the same held/current lane across the extra raw tick",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandMovementRawDispatchStamp >>> 0,
    scene.getCurrentDestinyStamp(fixedNow) >>> 0,
    "expected the reused held/current owner lane to refresh its raw-dispatch anchor on the later re-aim",
  );
  const observerDirectionArgs = thirdObserverUpdates[0].args.map((value) => (
    value && typeof value === "object" && "value" in value
      ? value.value
      : value
  ));
  assert.equal(
    observerDirectionArgs[1] < 0,
    true,
    "expected observers to still receive the latest distinct negative-X heading while the owner lane is held",
  );
  assert.equal(
    observerDirectionArgs[2] > 0,
    true,
    "expected observers to still receive the latest positive-Y re-aim while the owner lane is held",
  );
  assert.equal(
    observerDirectionArgs[3] < 0,
    true,
    "expected observers to still receive the latest forward-negative Z heading while the owner lane is held",
  );

  ownerSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  assert.equal(scene.gotoDirection(ownerSession, fourthDirection), true);

  const fourthOwnerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const fourthObserverUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(
    fourthOwnerUpdates.length,
    0,
    "expected a later same-raw distinct re-aim not to ratchet a brand-new owner lane once the held/current lane has already been refreshed this raw",
  );
  assert.equal(
    fourthObserverUpdates.length,
    1,
    "expected observers to still receive the later same-raw heading even when the owner echo is suppressed",
  );
});

test("plain moving gotoDirection does not reuse a held owner lane once the visible owner clock has already moved past it", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
    {
      velocity: { x: 182.4, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "GOTO",
      speedFraction: 1,
    },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const fixedNow = scene.getCurrentSimTimeMs();
  scene.getCurrentSimTimeMs = () => fixedNow;

  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    ownerSession,
    fixedNow,
  );
  const currentRawStamp = scene.getCurrentDestinyStamp(fixedNow);
  const visibleOwnerStamp = ((currentSessionStamp + 2) >>> 0);

  ownerSession._space.historyFloorDestinyStamp = visibleOwnerStamp;
  ownerSession._space.lastPilotCommandMovementStamp = currentSessionStamp;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp =
    currentRawStamp > 0 ? ((currentRawStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandDirection = { x: 0.8, y: 0.1, z: 0.5 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.05, y: 0.55, z: 0.83 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp >= visibleOwnerStamp,
    true,
    "expected owner steering not to reuse a lane that already sits behind the visible owner clock",
  );
  assert.notEqual(
    ownerUpdates[0].stamp >>> 0,
    currentSessionStamp >>> 0,
    "expected owner steering not to replay the stale current owner lane once the visible clock has moved past it",
  );
});

test("plain moving gotoDirection does not reuse a held owner lane once a newer owner lane is already presented", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
    {
      velocity: { x: 182.4, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "GOTO",
      speedFraction: 1,
    },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const fixedNow = scene.getCurrentSimTimeMs();
  scene.getCurrentSimTimeMs = () => fixedNow;

  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    ownerSession,
    fixedNow,
  );
  const currentRawStamp = scene.getCurrentDestinyStamp(fixedNow);
  const presentedOwnerStamp = ((currentSessionStamp + 1) >>> 0);
  const previousRawStamp =
    currentRawStamp > 0 ? ((currentRawStamp - 1) >>> 0) : 0;

  ownerSession._space.lastSentDestinyStamp = presentedOwnerStamp;
  ownerSession._space.lastSentDestinyRawDispatchStamp = previousRawStamp;
  ownerSession._space.lastSentDestinyWasOwnerCritical = true;
  ownerSession._space.lastPilotCommandMovementStamp = currentSessionStamp;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = previousRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: 0.8, y: 0.1, z: 0.5 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.05, y: 0.55, z: 0.83 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp >= presentedOwnerStamp,
    true,
    "expected owner steering not to reuse a held/current lane once a newer owner lane is already being presented",
  );
  assert.notEqual(
    ownerUpdates[0].stamp >>> 0,
    currentSessionStamp >>> 0,
    "expected owner steering not to replay the stale current owner lane while Michelle is already presenting the next owner tick",
  );
});

test("plain moving gotoDirection does not keep renewing the reused held/current lane across later raw ticks", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
    {
      velocity: { x: 182.4, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "GOTO",
      speedFraction: 1,
    },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  let fixedNow = scene.getCurrentSimTimeMs();
  scene.getCurrentSimTimeMs = () => fixedNow;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0.1, y: 0.2, z: -1.0 }),
    true,
  );
  const firstOwnerStamp = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection")[0].stamp >>> 0;

  ownerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  fixedNow += 1000;
  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.6, y: 0.2, z: -0.7 }),
    true,
  );

  ownerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  fixedNow += 1000;
  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.2, y: 0.8, z: -0.5 }),
    true,
  );
  const thirdOwnerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(thirdOwnerUpdates.length, 1);
  assert.equal(
    thirdOwnerUpdates[0].stamp >>> 0,
    firstOwnerStamp,
    "expected the held owner lane to be reused once when it becomes current",
  );

  ownerSession.notifications.length = 0;
  observerSession.notifications.length = 0;
  fixedNow += 1000;
  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.8, y: 0.1, z: -0.6 }),
    true,
  );

  const laterOwnerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const laterObserverUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(laterOwnerUpdates.length, 1);
  assert.equal(laterObserverUpdates.length, 1);
  assert.equal(
    laterOwnerUpdates[0].stamp > firstOwnerStamp,
    true,
    "expected a later raw re-aim to advance beyond the once-reused held/current owner lane instead of replaying that stale lane again",
  );
});

test("gotoDirection still emits the owner startup contract when a stopped ship carries stale speedFraction", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
    {
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 1,
    },
  );

  attachAndBootstrap(ownerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 1, z: 0 }),
    true,
  );

  assert.deepEqual(
    getMovementUpdateNames(ownerSession.notifications),
    ["GotoDirection", "SetSpeedFraction"],
  );
});

test("orbitShipEntity suppresses duplicate orbit rebroadcasts", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const targetSession = createFakeSession(
    2,
    140000002,
    { x: 1500, y: 0, z: 0 },
  );

  const ownerEntity = attachAndBootstrap(ownerSession);
  const targetEntity = attachAndBootstrap(targetSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const firstResult = scene.orbitShipEntity(ownerEntity, targetEntity.itemID, 1200);
  assert.equal(firstResult, true);
  assert.deepEqual(
    getMovementUpdateNames(ownerSession.notifications),
    ["Orbit", "SetSpeedFraction"],
  );

  ownerSession.notifications.length = 0;

  const secondResult = scene.orbitShipEntity(ownerEntity, targetEntity.itemID, 1200);
  assert.equal(secondResult, true);
  assert.deepEqual(getMovementUpdateNames(ownerSession.notifications), []);
});

test("same-tick gotoDirection keeps only the first owner echo while observers still receive both headings", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");
  const fixedNow = scene.getCurrentSimTimeMs();
  scene.getCurrentSimTimeMs = () => fixedNow;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 1, y: 0, z: 0 }),
    true,
  );
  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 1, z: 0 }),
    true,
  );

  const ownerMovementUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerMovementUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(ownerMovementUpdates.length, 1);
  assert.equal(observerMovementUpdates.length, 2);
  assert.deepEqual(
    ownerMovementUpdates[0].args.map((value) => (
      value && typeof value === "object" && "value" in value
        ? value.value
        : value
    )),
    [100001, 1, 0, 0],
  );
  assert.deepEqual(
    observerMovementUpdates[1].args.map((value) => (
      value && typeof value === "object" && "value" in value
        ? value.value
        : value
    )),
    [100001, 0, 1, 0],
  );
});

test("same-tick gotoDirection startup speed contract only appears on the first owner echo", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");
  const fixedNow = scene.getCurrentSimTimeMs();
  scene.getCurrentSimTimeMs = () => fixedNow;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 1, y: 0, z: 0 }),
    true,
  );
  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 1, z: 0 }),
    true,
  );

  assert.deepEqual(
    getMovementUpdateNames(ownerSession.notifications),
    ["GotoDirection", "SetSpeedFraction"],
  );
  assert.deepEqual(
    getMovementUpdateNames(observerSession.notifications),
    ["GotoDirection", "SetSpeedFraction", "GotoDirection"],
  );
  const movementUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(movementUpdates.length, 2);
  assert.deepEqual(
    movementUpdates[1].args.map((value) => (
      value && typeof value === "object" && "value" in value
        ? value.value
        : value
    )),
    [100001, 0, 1, 0],
  );
});

test("same-tick distinct gotoDirection commands do not ratchet the owner lane above the first direct echo", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");
  const fixedNow = scene.getCurrentSimTimeMs();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    ownerSession,
    fixedNow,
  );
  scene.getCurrentSimTimeMs = () => fixedNow;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0.7, y: -0.2, z: -0.7 }),
    true,
  );
  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0.1, y: -0.4, z: -0.9 }),
    true,
  );
  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.4, y: -0.3, z: -0.8 }),
    true,
  );

  const ownerMovementUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerMovementUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerMovementUpdates.length, 1);
  assert.equal(observerMovementUpdates.length, 3);
  assert.equal(
    ownerMovementUpdates[0].stamp,
    ((currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0),
    "expected repeated same-tick owner steering to stay on the first direct owner echo instead of ratcheting farther into the future",
  );
});

test("gotoDirection does not leave a queued subwarp contract behind", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 0, z: -1 }),
    true,
  );
  assert.equal(
    scene.pendingSubwarpMovementContracts.has(100001),
    false,
  );
});

test("gotoDirection defers the owner echo into the presentation batch while missile pressure is active", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );

  const ownerEntity = attachAndBootstrap(ownerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentRawDispatchStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  ownerSession._space.lastMissileLifecycleStamp =
    (currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0;
  ownerSession._space.lastMissileLifecycleRawDispatchStamp =
    currentRawDispatchStamp;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 0, z: -1 }),
    true,
  );
  assert.equal(
    flattenDestinyUpdates(ownerSession.notifications).length,
    0,
    "expected missile-active owner movement to defer the direct owner echo instead of sending it immediately",
  );
  assert.equal(
    scene.pendingSubwarpMovementContracts.has(ownerEntity.itemID),
    true,
    "expected missile-active owner movement to queue a subwarp contract for the next presentation flush",
  );

  scene.beginTickDestinyPresentationBatch();
  scene.flushPendingSubwarpMovementContracts(scene.getCurrentSimTimeMs());
  assert.equal(
    flattenDestinyUpdates(ownerSession.notifications).length,
    0,
    "expected queued missile-active owner movement to remain buffered until the presentation batch flushes",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandMovementStamp > currentSessionStamp,
    true,
    "expected the queued missile-pressure owner movement to update owner steering bookkeeping before the batch flushes",
  );
  assert.equal(
    ownerSession._space.lastOwnerNonMissileCriticalStamp > currentSessionStamp,
    true,
    "expected queued missile-pressure owner movement to advance the owner non-missile lane bookkeeping too",
  );
  assert.equal(
    scene.pendingSubwarpMovementContracts.has(ownerEntity.itemID),
    false,
    "expected the queued missile-pressure movement contract to be consumed during the flush",
  );

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 0, z: -1 }),
    true,
  );
  assert.equal(
    scene.pendingSubwarpMovementContracts.has(ownerEntity.itemID),
    false,
    "expected a same-dispatch duplicate goto to be suppressed after the queued owner lane has been recorded",
  );
  assert.equal(
    flattenDestinyUpdates(ownerSession.notifications).length,
    0,
    "expected the suppressed duplicate goto not to emit or queue another owner update before the batch flush",
  );

  scene.flushTickDestinyPresentationBatch();

  const movementUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(movementUpdates.length, 1);
  assert.equal(
    movementUpdates[0].stamp >= ((currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0),
    true,
    "expected the deferred owner echo to stay on Michelle's held future lane once flushed",
  );
});

test("gotoDirection uses Michelle's held-future owner lane instead of a current-tick echo", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  ownerSession._space.lastSentDestinyStamp =
    currentStamp > 0 ? ((currentStamp - 1) >>> 0) : 0;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 0, z: -1 }),
    true,
  );

  const movementUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(movementUpdates.length, 1);
  assert.equal(
    movementUpdates[0].stamp,
    (
      currentSessionStamp +
      OWNER_MISSILE_CLIENT_LANE_LEAD
    ) >>> 0,
  );
});

test("gotoDirection ignores an inflated visible barrier and keeps the live owner lane", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const currentPresentedStamp = scene.getCurrentPresentedSessionDestinyStamp(
    ownerSession,
  );
  const inflatedVisibleBarrier = (currentSessionStamp + 20) >>> 0;
  ownerSession._space.lastSentDestinyStamp = inflatedVisibleBarrier;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 1, z: 0 }),
    true,
  );

  const movementUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(movementUpdates.length, 1);
  assert.equal(movementUpdates[0].stamp >= currentSessionStamp, true);
  assert.equal(
    movementUpdates[0].stamp <= (
      (
        currentSessionStamp +
        OWNER_MISSILE_CLIENT_LANE_LEAD +
        1
      ) >>> 0
    ),
    true,
  );
  assert.equal(movementUpdates[0].stamp < inflatedVisibleBarrier, true);
});

test("gotoDirection does not fall back to a raw owner broadcast when a prior owner lane sits beyond the presented trust window", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 0 ? ((currentStamp - 1) >>> 0) : currentStamp;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const priorOwnerLane = (currentSessionStamp + 5) >>> 0;
  ownerSession._space.lastSentDestinyStamp = priorOwnerLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandMovementStamp = priorOwnerLane;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: 0, y: 1, z: 0 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 1, z: 0 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp >= priorOwnerLane,
    true,
    "expected owner gotoDirection to stay on the direct owner lane instead of dropping back to a raw current-tick broadcast",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
  assert.equal(ownerUpdates[0].stamp > observerUpdates[0].stamp, true);
});

test("gotoDirection clears a recent owner-presented future stamp after warp recovery", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 0 ? ((currentStamp - 1) >>> 0) : currentStamp;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const recentPresentedStamp = (currentSessionStamp + 4) >>> 0;
  ownerSession._space.lastSentDestinyStamp = recentPresentedStamp;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.historyFloorDestinyStamp = currentSessionStamp;
  ownerSession._space.pilotWarpQuietUntilStamp = 0;
  ownerSession._space.lastPilotCommandMovementStamp = recentPresentedStamp;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: 1, y: 0, z: 0 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 1, y: 0, z: 0 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(ownerUpdates[0].stamp >= recentPresentedStamp, true);
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
  assert.equal(ownerUpdates[0].stamp > observerUpdates[0].stamp, true);
});

test("same-tick repeated gotoDirection recovery commands keep the recovered owner lane without a second owner echo", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const fixedNow = scene.getCurrentSimTimeMs();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(
    ownerSession,
    fixedNow,
  );
  scene.getCurrentSimTimeMs = () => fixedNow;
  const currentStamp = scene.getCurrentDestinyStamp(fixedNow);
  const priorRawStamp =
    currentStamp > 0 ? ((currentStamp - 1) >>> 0) : currentStamp;
  const recentPresentedStamp = (currentSessionStamp + 4) >>> 0;
  ownerSession._space.lastSentDestinyStamp = recentPresentedStamp;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.historyFloorDestinyStamp = currentSessionStamp;
  ownerSession._space.pilotWarpQuietUntilStamp = 0;
  ownerSession._space.lastPilotCommandMovementStamp = recentPresentedStamp;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: 1, y: 0, z: 0 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 1, y: 0, z: 0 }),
    true,
  );
  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 1, z: 0 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 2);
  assert.equal(ownerUpdates[0].stamp >= recentPresentedStamp, true);
  assert.equal(
    ownerSession._space.lastPilotCommandMovementStamp,
    ownerUpdates[0].stamp,
    "expected same-tick recovery re-aims to keep the first recovered owner lane instead of ratcheting another owner echo",
  );
  assert.deepEqual(
    observerUpdates[1].args.map((value) => (
      value && typeof value === "object" && "value" in value
        ? value.value
        : value
    )),
    [100001, 0, 1, 0],
    "expected observers to still receive the latest recovery heading even when the owner echo is suppressed inside the same raw tick",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandDirection.y > 0,
    true,
    "expected the latest same-tick recovery heading to remain tracked for the next owner restamp decision",
  );
});

test("same-tick distinct non-missile gotoDirection commands keep only the first owner echo while observers still get the latest heading", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const nowMs = scene.getCurrentSimTimeMs();
  const authoredStamp = scene.getMovementStamp(nowMs);

  const directions = [
    { x: -0.5, y: 0.0, z: -0.8 },
    { x: -0.6, y: 0.0, z: -0.8 },
    { x: -0.6, y: 0.1, z: -0.7 },
    { x: -0.4, y: -0.1, z: -0.9 },
  ];

  for (const direction of directions) {
    assert.equal(
      scene.broadcastPilotCommandMovementUpdates(
        ownerSession,
        [
          {
            stamp: authoredStamp,
            payload: [
              "GotoDirection",
              [
                ownerSession.shipItem.itemID,
                direction.x,
                direction.y,
                direction.z,
              ],
            ],
          },
        ],
        nowMs,
      ),
      true,
    );
  }

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, directions.length);
  assert.equal(
    ownerUpdates[0].stamp >= (
      (currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0
    ),
    true,
    "expected the first owner gotoDirection echo to stay on Michelle's direct owner floor",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandMovementStamp >>> 0,
    ownerUpdates[0].stamp >>> 0,
    "expected same-tick distinct owner gotoDirection commands to keep the first owner echo instead of ratcheting later owner ticks",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandMovementAnchorStamp >>> 0,
    currentSessionStamp >>> 0,
    "expected the owner pilot-command anchor to stay on the current owner tick after same-tick distinct gotoDirection commands",
  );
  assert.deepEqual(
    observerUpdates[observerUpdates.length - 1].args.map((value) => (
      value && typeof value === "object" && "value" in value
        ? value.value
        : value
    )),
    [100001, -0.4, -0.1, -0.9],
    "expected observers to still receive the latest same-tick steering heading even when the owner echo is suppressed",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandDirection.z < 0,
    true,
    "expected the latest same-tick gotoDirection heading to remain tracked for the next owner restamp decision",
  );
});

test("gotoDirection raises the owner stamp above an advanced visible history floor", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const historyFloorStamp = (scene.getCurrentSessionDestinyStamp(ownerSession) + 4) >>> 0;
  ownerSession._space.historyFloorDestinyStamp = historyFloorStamp;
  ownerSession._space.pilotWarpQuietUntilStamp = 0;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 1, z: 0 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(ownerUpdates[0].stamp >= historyFloorStamp, true);
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
  assert.equal(ownerUpdates[0].stamp > observerUpdates[0].stamp, true);
});

test("gotoDirection clears a recent owner missile lifecycle lane instead of reusing the stale launch tick", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  ownerSession._space.lastSentDestinyStamp = currentSessionStamp;
  ownerSession._space.lastOwnerMissileLifecycleStamp = currentSessionStamp;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 1, z: 0 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp >=
      ((currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0),
    true,
    "expected owner gotoDirection to clear the recent owner missile lane instead of reusing its stale tick",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
  assert.equal(ownerUpdates[0].stamp > observerUpdates[0].stamp, true);
});

test("gotoDirection reuses the shared owner missile lane instead of leapfrogging above it", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const sharedOwnerMissileLane = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  ownerSession._space.lastSentDestinyStamp = sharedOwnerMissileLane;
  ownerSession._space.lastOwnerMissileLifecycleStamp = sharedOwnerMissileLane;
  ownerSession._space.lastPilotCommandMovementStamp = currentSessionStamp;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 1, z: 0 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp,
    sharedOwnerMissileLane >>> 0,
    "expected owner gotoDirection to reuse the active owner missile lane instead of manufacturing another future step above it",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("adjacent-dispatch missile-active gotoDirection does not backstep under the trusted owner missile lane", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 0 ? ((currentStamp - 1) >>> 0) : currentStamp;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const trustedOwnerMissileLane = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    Math.floor(PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD / 2)
  ) >>> 0;

  ownerSession._space.lastSentDestinyStamp = trustedOwnerMissileLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastOwnerMissileLifecycleStamp = trustedOwnerMissileLane;
  ownerSession._space.lastOwnerMissileLifecycleAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandMovementStamp = (
    currentSessionStamp + 1
  ) >>> 0;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: -0.5, y: -0.8, z: -0.4 };
  ownerSession._space.lastOwnerNonMissileCriticalStamp = (
    currentSessionStamp + 1
  ) >>> 0;
  ownerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp = priorRawStamp;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.9, y: -0.4, z: -0.1 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp,
    trustedOwnerMissileLane,
    "expected adjacent-dispatch missile-active owner movement to stay on the trusted owner missile lane instead of backstepping underneath it",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("same-tick distinct missile-active gotoDirection commands keep only the first owner echo while observers still get the latest heading", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const nowMs = scene.getCurrentSimTimeMs();
  const authoredStamp = scene.getMovementStamp(nowMs);
  ownerSession._space.lastOwnerMissileLifecycleStamp = currentSessionStamp;

  const directions = [
    { x: 0.1, y: 0.5, z: -0.9 },
    { x: 0.2, y: 0.5, z: -0.8 },
    { x: 0.3, y: 0.6, z: -0.7 },
    { x: -0.3, y: 0.5, z: -0.8 },
  ];

  for (const direction of directions) {
    assert.equal(
      scene.broadcastPilotCommandMovementUpdates(
        ownerSession,
        [
          {
            stamp: authoredStamp,
            payload: [
              "GotoDirection",
              [
                ownerSession.shipItem.itemID,
                direction.x,
                direction.y,
                direction.z,
              ],
            ],
          },
        ],
        nowMs,
      ),
      true,
    );
  }

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, directions.length);
  assert.equal(
    ownerUpdates[0].stamp >= (
      (currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0
    ),
    true,
    "expected the first missile-active owner gotoDirection echo to stay on Michelle's direct owner floor",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandMovementStamp >>> 0,
    ownerUpdates[0].stamp >>> 0,
    "expected same-tick distinct missile-active gotoDirection commands to keep the first owner echo instead of ratcheting later owner ticks",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandMovementAnchorStamp >>> 0,
    currentSessionStamp >>> 0,
    "expected the owner pilot-command anchor to stay on the current owner tick after same-tick distinct missile-active gotoDirection commands",
  );
  assert.deepEqual(
    observerUpdates[observerUpdates.length - 1].args.map((value) => (
      value && typeof value === "object" && "value" in value
        ? value.value
        : value
    )),
    [100001, -0.3, 0.5, -0.8],
    "expected observers to still receive the latest same-tick missile-active steering heading even when the owner echo is suppressed",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandDirection.x < 0,
    true,
    "expected the latest same-tick missile-active gotoDirection heading to remain tracked for the next owner restamp decision",
  );
});

test("missile-active gotoDirection clears an older owner movement lane instead of reusing its stale stamp", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const staleOwnerMovementLane = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  ownerSession._space.lastSentDestinyStamp = staleOwnerMovementLane;
  ownerSession._space.lastOwnerMissileLifecycleStamp = currentSessionStamp;
  ownerSession._space.lastPilotCommandMovementStamp = staleOwnerMovementLane;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandDirection = { x: -0.8, y: 0.4, z: -0.5 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0.5, y: -0.9, z: -0.1 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp > staleOwnerMovementLane,
    true,
    "expected a later missile-active owner gotoDirection to clear the older owner lane instead of reusing the consumed stamp",
  );
  assert.equal(
    ownerUpdates[0].stamp >=
      ((currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0),
    true,
    "expected the cleared missile-active owner gotoDirection lane to stay at or above Michelle's direct owner echo floor",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection clears an adjacent earlier-tick owner movement lane when the new steering echo would collide with it", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const priorOwnerMovementLane = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  ownerSession._space.lastSentDestinyStamp = priorOwnerMovementLane;
  ownerSession._space.lastPilotCommandMovementStamp = priorOwnerMovementLane;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandDirection = { x: 0.4, y: -0.4, z: -0.8 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.6, y: -0.5, z: -0.6 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp > priorOwnerMovementLane,
    true,
    "expected a new owner steering echo on the next owner tick to clear an earlier pending owner movement lane instead of reusing the colliding stamp",
  );
  assert.equal(
    ownerUpdates[0].stamp >=
      ((currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0),
    true,
    "expected the cleared owner steering echo to stay at or above Michelle's direct owner echo floor",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection clears a nearby earlier-tick owner movement lane when the steering vector changes", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const priorOwnerMovementLane = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    1
  ) >>> 0;
  ownerSession._space.lastSentDestinyStamp = priorOwnerMovementLane;
  ownerSession._space.lastPilotCommandMovementStamp = priorOwnerMovementLane;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandDirection = { x: -0.6, y: 0.1, z: -0.8 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.6, y: -0.2, z: -0.7 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp,
    ((priorOwnerMovementLane + 1) >>> 0),
    "expected a changed owner steering echo from the next raw dispatch to clear the previously sent pending owner lane instead of reusing Michelle's colliding tick",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection does not backstep under an immediately prior owner movement lane when the steering vector repeats", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 0 ? ((currentStamp - 1) >>> 0) : currentStamp;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const priorOwnerMovementLane = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD -
    1
  ) >>> 0;
  ownerSession._space.lastSentDestinyStamp = priorOwnerMovementLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandMovementStamp = priorOwnerMovementLane;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: -0.7, y: -0.3, z: -0.7 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.7, y: -0.3, z: -0.7 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp,
    priorOwnerMovementLane,
    "expected a repeated owner steering echo on the next raw dispatch to stay on the immediately prior owner movement lane instead of backstepping to the lower direct-echo floor",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection does not backstep under an immediately prior overall owner lane", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 0 ? ((currentStamp - 1) >>> 0) : currentStamp;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const recentOverallOwnerLane = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD
  ) >>> 0;
  ownerSession._space.lastSentDestinyStamp = recentOverallOwnerLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastOwnerNonMissileCriticalStamp = recentOverallOwnerLane;
  ownerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandMovementStamp = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: -0.7, y: -0.3, z: -0.7 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.8, y: 0.1, z: -0.5 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp >= recentOverallOwnerLane,
    true,
    "expected owner steering on the next raw dispatch not to backstep under a recently sent overall owner lane such as SetState",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection ignores a recent overall owner lane when it was established by owner missile lifecycle", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 0 ? ((currentStamp - 1) >>> 0) : currentStamp;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const recentMissileEstablishedOwnerLane = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD
  ) >>> 0;
  ownerSession._space.lastSentDestinyStamp = recentMissileEstablishedOwnerLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastOwnerMissileLifecycleStamp =
    recentMissileEstablishedOwnerLane;
  ownerSession._space.lastOwnerMissileLifecycleAnchorStamp =
    currentSessionStamp;
  ownerSession._space.lastOwnerMissileLifecycleRawDispatchStamp =
    priorRawStamp;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 1, z: 0 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp,
    recentMissileEstablishedOwnerLane,
    "expected owner steering to stay on the trusted active owner missile lane instead of dropping underneath it during missile-active movement",
  );
  assert.equal(
    ownerUpdates[0].stamp >= ((currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0),
    true,
    "expected owner steering to remain at or above the direct owner echo lane during missile-active movement",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("same-raw gotoDirection does not backstep under an already-sent owner missile lane", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const sameRawOwnerMissileLane = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD
  ) >>> 0;

  ownerSession._space.lastSentDestinyStamp = sameRawOwnerMissileLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = currentStamp;
  ownerSession._space.lastOwnerMissileLifecycleStamp = sameRawOwnerMissileLane;
  ownerSession._space.lastOwnerMissileLifecycleAnchorStamp = currentSessionStamp;
  ownerSession._space.lastOwnerMissileLifecycleRawDispatchStamp = currentStamp;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0.5, y: 0.7, z: -0.4 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp,
    sameRawOwnerMissileLane,
    "expected a same-raw owner steering echo not to backstep under an already-sent owner missile lane from the current raw dispatch",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("same-raw owner missile movement clamps persist the final emitted owner lane", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 0 ? ((currentStamp - 1) >>> 0) : currentStamp;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const sameRawOwnerMissileLane = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD
  ) >>> 0;
  const lowerTrackedOwnerMovementLane = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    1
  ) >>> 0;
  const repeatedDirection = { x: -0.2, y: -0.1, z: -1 };

  ownerSession._space.lastSentDestinyStamp = sameRawOwnerMissileLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = currentStamp;
  ownerSession._space.lastOwnerMissileLifecycleStamp = sameRawOwnerMissileLane;
  ownerSession._space.lastOwnerMissileLifecycleAnchorStamp = currentSessionStamp;
  ownerSession._space.lastOwnerMissileLifecycleRawDispatchStamp = currentStamp;
  ownerSession._space.lastPilotCommandMovementStamp =
    lowerTrackedOwnerMovementLane;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastOwnerNonMissileCriticalStamp =
    lowerTrackedOwnerMovementLane;
  ownerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp =
    priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = repeatedDirection;

  assert.equal(
    scene.gotoDirection(ownerSession, repeatedDirection),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp,
    sameRawOwnerMissileLane,
    "expected the same-raw owner missile monotonic clamp to raise the owner gotoDirection onto the already-sent owner missile lane",
  );
  assert.equal(
    ownerSession._space.lastPilotCommandMovementStamp,
    sameRawOwnerMissileLane,
    "expected owner movement tracking to persist the final emitted owner movement lane after same-raw missile monotonic restamping",
  );
  assert.equal(
    ownerSession._space.lastOwnerNonMissileCriticalStamp,
    sameRawOwnerMissileLane,
    "expected owner non-missile critical tracking to persist the final emitted owner movement lane after same-raw missile monotonic restamping",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection does not backstep under a recent two-dispatch overall owner lane", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 1 ? ((currentStamp - 2) >>> 0) : 0;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const recentOverallOwnerLane = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD +
    4
  ) >>> 0;
  ownerSession._space.lastSentDestinyStamp = recentOverallOwnerLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastOwnerNonMissileCriticalStamp = recentOverallOwnerLane;
  ownerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandMovementStamp = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 1 ? ((currentSessionStamp - 2) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: -0.7, y: -0.3, z: -0.7 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.8, y: 0.1, z: -0.5 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp >= recentOverallOwnerLane,
    true,
    "expected owner steering two raw dispatches later not to backstep under a real recently sent owner lane such as SetState",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection follows a recent emitted owner-critical lane even when the server presented clock still lags behind it", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 1 ? ((currentStamp - 2) >>> 0) : 0;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const recentBufferedOwnerCriticalLane = (
    currentSessionStamp +
    RECENT_EMITTED_OWNER_CRITICAL_MAX_LEAD -
    1
  ) >>> 0;
  const lowerRecentOwnerLane = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD
  ) >>> 0;

  ownerSession._space.lastSentDestinyStamp = recentBufferedOwnerCriticalLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane = false;
  ownerSession._space.lastSentDestinyWasOwnerCritical = true;
  ownerSession._space.lastOwnerNonMissileCriticalStamp = lowerRecentOwnerLane;
  ownerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandMovementStamp = lowerRecentOwnerLane;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 1 ? ((currentSessionStamp - 2) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: -0.7, y: -0.3, z: -0.7 };
  ownerSession._space.lastOwnerMissileLifecycleStamp = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  ownerSession._space.lastOwnerMissileLifecycleAnchorStamp =
    currentSessionStamp > 1 ? ((currentSessionStamp - 2) >>> 0) : 0;
  ownerSession._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastOwnerMissileFreshAcquireStamp = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  ownerSession._space.lastOwnerMissileFreshAcquireAnchorStamp =
    currentSessionStamp > 1 ? ((currentSessionStamp - 2) >>> 0) : 0;
  ownerSession._space.lastOwnerMissileFreshAcquireRawDispatchStamp = priorRawStamp;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.8, y: 0.1, z: -0.5 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp,
    recentBufferedOwnerCriticalLane,
    "expected owner steering not to backstep under a recently emitted owner-critical lane that the server has already delivered, even when the local presented clock has not caught up to it yet",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection does not backstep under a presented owner missile lane three dispatches later", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 2 ? ((currentStamp - 3) >>> 0) : 0;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const presentedOwnerMissileLane = (
    currentSessionStamp + PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD
  ) >>> 0;

  ownerSession._space.lastSentDestinyStamp = presentedOwnerMissileLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane = false;
  ownerSession._space.lastSentDestinyWasOwnerCritical = true;
  ownerSession._space.lastOwnerMissileLifecycleStamp = presentedOwnerMissileLane;
  ownerSession._space.lastOwnerMissileLifecycleAnchorStamp =
    currentSessionStamp > 2 ? ((currentSessionStamp - 3) >>> 0) : 0;
  ownerSession._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandMovementStamp = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 2 ? ((currentSessionStamp - 3) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: -0.7, y: -0.3, z: -0.7 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.8, y: 0.1, z: -0.5 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp >= presentedOwnerMissileLane,
    true,
    "expected owner steering three raw dispatches later not to backstep under the still-presented owner missile lane the client already buffered",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection follows a still-buffered owner-critical lane three dispatches later even when it sits beyond the presented helper window", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 2 ? ((currentStamp - 3) >>> 0) : 0;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const lowerDirectOwnerLane = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  const bufferedOwnerCriticalLane = (
    currentSessionStamp + RECENT_EMITTED_OWNER_CRITICAL_MAX_LEAD - 1
  ) >>> 0;

  ownerSession._space.lastSentDestinyStamp = bufferedOwnerCriticalLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane = false;
  ownerSession._space.lastSentDestinyWasOwnerCritical = true;
  ownerSession._space.lastOwnerNonMissileCriticalStamp = lowerDirectOwnerLane;
  ownerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastOwnerMissileLifecycleStamp = lowerDirectOwnerLane;
  ownerSession._space.lastOwnerMissileLifecycleAnchorStamp =
    currentSessionStamp > 2 ? ((currentSessionStamp - 3) >>> 0) : 0;
  ownerSession._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastOwnerMissileFreshAcquireStamp = lowerDirectOwnerLane;
  ownerSession._space.lastOwnerMissileFreshAcquireAnchorStamp =
    currentSessionStamp > 2 ? ((currentSessionStamp - 3) >>> 0) : 0;
  ownerSession._space.lastOwnerMissileFreshAcquireRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandMovementStamp = lowerDirectOwnerLane;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 2 ? ((currentSessionStamp - 3) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: -0.7, y: -0.3, z: -0.7 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.8, y: 0.1, z: -0.5 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp,
    bufferedOwnerCriticalLane,
    "expected owner steering three raw dispatches later to stay on the still-buffered emitted owner-critical lane instead of falling back to the lower direct owner echo lane",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection ignores a recent overall owner lane when it only comes from a stale prior owner missile lane", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 1 ? ((currentStamp - 2) >>> 0) : 0;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const staleMissileOnlyLane = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD +
    5
  ) >>> 0;
  ownerSession._space.lastSentDestinyStamp = staleMissileOnlyLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastOwnerMissileLifecycleStamp = staleMissileOnlyLane;
  ownerSession._space.lastOwnerMissileLifecycleAnchorStamp =
    currentSessionStamp > 1 ? ((currentSessionStamp - 2) >>> 0) : 0;
  ownerSession._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastOwnerNonMissileCriticalStamp = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  ownerSession._space.lastOwnerNonMissileCriticalRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandMovementStamp = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 1 ? ((currentSessionStamp - 2) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: -0.7, y: -0.3, z: -0.7 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.8, y: 0.1, z: -0.5 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp < staleMissileOnlyLane,
    true,
    "expected owner steering not to inherit a stale overall lane when that lane only comes from an older owner missile lifecycle stamp",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection ignores a presented stale projected owner missile lane three dispatches later", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const priorRawStamp =
    currentStamp > 2 ? ((currentStamp - 3) >>> 0) : 0;
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const stalePresentedOwnerMissileLane = (
    currentSessionStamp +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD +
    1
  ) >>> 0;

  ownerSession._space.lastSentDestinyStamp = stalePresentedOwnerMissileLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane = true;
  ownerSession._space.lastSentDestinyWasOwnerCritical = true;
  ownerSession._space.lastOwnerMissileLifecycleStamp =
    stalePresentedOwnerMissileLane;
  ownerSession._space.lastOwnerMissileLifecycleAnchorStamp =
    currentSessionStamp > 2 ? ((currentSessionStamp - 3) >>> 0) : 0;
  ownerSession._space.lastOwnerMissileLifecycleRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandMovementStamp = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 2 ? ((currentSessionStamp - 3) >>> 0) : 0;
  ownerSession._space.lastPilotCommandMovementRawDispatchStamp = priorRawStamp;
  ownerSession._space.lastPilotCommandDirection = { x: -0.7, y: -0.3, z: -0.7 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: -0.8, y: 0.1, z: -0.5 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp < stalePresentedOwnerMissileLane,
    true,
    "expected owner steering not to inherit a still-presented lane when that lane only exists because of a stale projected owner missile floor",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("missile-active gotoDirection ignores a stale far-ahead earlier-tick owner movement lane", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const staleFarAheadOwnerMovementLane = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD +
    1
  ) >>> 0;
  ownerSession._space.lastSentDestinyStamp = staleFarAheadOwnerMovementLane;
  ownerSession._space.lastOwnerMissileLifecycleStamp = currentSessionStamp;
  ownerSession._space.lastPilotCommandMovementStamp = staleFarAheadOwnerMovementLane;
  ownerSession._space.lastPilotCommandMovementAnchorStamp =
    currentSessionStamp > 0 ? ((currentSessionStamp - 1) >>> 0) : 0;
  ownerSession._space.lastPilotCommandDirection = { x: -0.8, y: 0.4, z: -0.5 };

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0.5, y: -0.9, z: -0.1 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp,
    ((currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0),
    "expected missile-active owner gotoDirection to ignore a stale far-ahead earlier-tick owner lane instead of ratcheting it forward",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection ignores a missile-active presented owner lane and stays on the live session lane", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const stalePresentedOwnerLane = (
    currentSessionStamp + PILOT_WARP_HISTORY_SAFE_DESTINY_LEAD
  ) >>> 0;
  ownerSession._space.lastSentDestinyStamp = stalePresentedOwnerLane;
  ownerSession._space.lastOwnerMissileLifecycleStamp = currentSessionStamp;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 1, z: 0 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(
    ownerUpdates[0].stamp >=
      ((currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0),
    true,
    "expected owner gotoDirection to clear the live current owner lane during missile-active movement",
  );
  assert.equal(
    ownerUpdates[0].stamp < stalePresentedOwnerLane,
    true,
    "expected owner gotoDirection not to ratchet onto the stale presented owner lane while missiles are active",
  );
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
});

test("gotoDirection uses a history-safe owner stamp during the post-warp quiet window", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  const quietUntilStamp = (scene.getCurrentSessionDestinyStamp(ownerSession) + 4) >>> 0;
  ownerSession._space.pilotWarpQuietUntilStamp = quietUntilStamp;

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 0, z: -1 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
  assert.equal(ownerUpdates[0].stamp >= quietUntilStamp, true);
  assertObserverMovementStampWithinSceneTickWindow(
    observerUpdates[0],
    currentStamp,
  );
  assert.equal(ownerUpdates[0].stamp > observerUpdates[0].stamp, true);
});

test("sendDestinyUpdates leaves non-owner movement stamps on the authored scene tick unless translation is explicitly requested", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const rawSceneStamp = scene.getCurrentDestinyStamp();
  ownerSession._space.clockOffsetMs = -203000;

  scene.sendDestinyUpdates(ownerSession, [
    {
      stamp: rawSceneStamp,
      payload: ["GotoDirection", [999999, 0, 1, 0]],
    },
  ]);

  const movementUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(movementUpdates.length > 0, true);
  assert.equal(movementUpdates[0].stamp >= rawSceneStamp, true);
  assert.equal(movementUpdates[0].stamp <= ((rawSceneStamp + 1) >>> 0), true);
  assert.notEqual(
    movementUpdates[0].stamp,
    scene.translateDestinyStampForSession(ownerSession, rawSceneStamp),
  );
});

test("sendDestinyUpdates clamps owner movement above Michelle's buffered owner-critical ceiling", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const authoredOverCeilingStamp = (
    currentSessionStamp +
    OWNER_MISSILE_CLIENT_LANE_LEAD +
    6
  ) >>> 0;

  scene.sendDestinyUpdates(ownerSession, [
    {
      stamp: authoredOverCeilingStamp,
      payload: ["GotoDirection", [100001, 0, 1, 0]],
    },
  ]);

  const movementUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  assert.equal(movementUpdates.length > 0, true);
  assert.equal(
    movementUpdates[0].stamp < authoredOverCeilingStamp,
    true,
    "expected owner movement sent past Michelle's buffered future window to be restamped back under the owner-critical ceiling",
  );
  assert.equal(
    movementUpdates[0].stamp <= (
      (currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD) >>> 0
    ),
    true,
    "expected owner movement not to be emitted beyond the client's +2 buffered owner-critical hold window",
  );
});

test("active pilot gotoDirection re-aim stays visible to both owner and observer", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
    {
      velocity: { x: 182.4, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "GOTO",
      speedFraction: 1,
    },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 1, z: 0 }),
    true,
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "GotoDirection");

  assert.equal(ownerUpdates.length, 1);
  assert.equal(observerUpdates.length, 1);
});

test("stop updates stay on the live movement stamp for pilot and observers", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
    {
      velocity: { x: -279.6, y: -94.7, z: -10.8 },
      direction: { x: -0.9, y: -0.3, z: 0 },
      mode: "GOTO",
      speedFraction: 1,
    },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  const ownerEntity = attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  const currentStamp = scene.getCurrentDestinyStamp();
  ownerSession._space.lastSentDestinyStamp =
    currentStamp > 0 ? ((currentStamp - 1) >>> 0) : 0;
  observerSession._space.lastSentDestinyStamp =
    currentStamp > 0 ? ((currentStamp - 1) >>> 0) : 0;

  assert.equal(scene.stopShipEntity(ownerEntity), true);

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) =>
      entry.name === "SetSpeedFraction" ||
      entry.name === "Stop",
    );
  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) =>
      entry.name === "SetSpeedFraction" ||
      entry.name === "Stop",
    );

  assert.deepEqual(ownerUpdates.map((entry) => entry.name), [
    "SetSpeedFraction",
    "Stop",
  ]);
  assert.deepEqual(observerUpdates.map((entry) => entry.name), [
    "SetSpeedFraction",
    "Stop",
  ]);
  assert.equal(
    ownerUpdates.every((entry) => entry.stamp === currentStamp),
    true,
  );
  assert.equal(
    observerUpdates.every((entry) => entry.stamp === currentStamp),
    true,
  );
});

test("gotoDirection reaches observers immediately", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  assert.equal(
    scene.gotoDirection(ownerSession, { x: 0, y: 0, z: -1 }),
    true,
  );

  assert.deepEqual(
    getMovementUpdateNames(ownerSession.notifications),
    ["GotoDirection", "SetSpeedFraction"],
  );
  assert.deepEqual(
    getMovementUpdateNames(observerSession.notifications),
    ["GotoDirection", "SetSpeedFraction"],
  );
});

test("queued remote follow contracts stay ahead of the observer's visible history", () => {
  const observerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const remoteSession = createFakeSession(
    2,
    140000002,
    { x: 6000, y: 0, z: 0 },
  );

  const observerEntity = attachAndBootstrap(observerSession);
  const remoteEntity = attachAndBootstrap(remoteSession);

  const scene = spaceRuntime.getSceneForSession(observerSession);
  assert.ok(scene, "expected observer scene to exist");

  observerSession.notifications.length = 0;
  remoteSession.notifications.length = 0;

  const visibleStamp = scene.getCurrentVisibleSessionDestinyStamp(observerSession);
  observerSession._space.historyFloorDestinyStamp = (visibleStamp + 1) >>> 0;

  assert.equal(
    scene.followShipEntity(remoteEntity, observerEntity.itemID, 3000, {
      queueHistorySafeContract: true,
    }),
    true,
  );
  assert.equal(
    flattenDestinyUpdates(observerSession.notifications).length,
    0,
    "expected queued remote movement contracts to defer the immediate observer send",
  );
  assert.equal(scene.pendingSubwarpMovementContracts.has(remoteEntity.itemID), true);

  flushQueuedMovementUpdates(scene);

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => (
      entry.name === "FollowBall" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.deepEqual(
    observerUpdates.map((entry) => entry.name),
    ["FollowBall", "SetSpeedFraction"],
  );
  assert.equal(
    observerUpdates.every((entry) => entry.stamp >= (visibleStamp + 3)),
    true,
    "expected queued remote follow movement to clear the observer visible-history floor instead of landing on current",
  );
});

test("queued remote orbit contracts stay ahead of the observer's visible history", () => {
  const observerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const remoteSession = createFakeSession(
    2,
    140000002,
    { x: 6000, y: 0, z: 0 },
  );

  const observerEntity = attachAndBootstrap(observerSession);
  const remoteEntity = attachAndBootstrap(remoteSession);

  const scene = spaceRuntime.getSceneForSession(observerSession);
  assert.ok(scene, "expected observer scene to exist");

  observerSession.notifications.length = 0;
  remoteSession.notifications.length = 0;

  const visibleStamp = scene.getCurrentVisibleSessionDestinyStamp(observerSession);
  observerSession._space.historyFloorDestinyStamp = (visibleStamp + 1) >>> 0;

  assert.equal(
    scene.orbitShipEntity(remoteEntity, observerEntity.itemID, 3000, {
      queueHistorySafeContract: true,
    }),
    true,
  );
  assert.equal(
    flattenDestinyUpdates(observerSession.notifications).length,
    0,
    "expected queued remote orbit contracts to defer the immediate observer send",
  );
  assert.equal(scene.pendingSubwarpMovementContracts.has(remoteEntity.itemID), true);

  flushQueuedMovementUpdates(scene);

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => (
      entry.name === "Orbit" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.deepEqual(
    observerUpdates.map((entry) => entry.name),
    ["Orbit", "SetSpeedFraction"],
  );
  assert.equal(
    observerUpdates.every((entry) => entry.stamp >= (visibleStamp + 3)),
    true,
    "expected queued remote orbit movement to clear the observer visible-history floor instead of landing on current",
  );
});

test("queued remote orbit contracts do not backstep behind the observer's presented lane", () => {
  const observerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const remoteSession = createFakeSession(
    2,
    140000002,
    { x: 6000, y: 0, z: 0 },
  );

  const observerEntity = attachAndBootstrap(observerSession);
  const remoteEntity = attachAndBootstrap(remoteSession);

  const scene = spaceRuntime.getSceneForSession(observerSession);
  assert.ok(scene, "expected observer scene to exist");

  observerSession.notifications.length = 0;
  remoteSession.notifications.length = 0;

  const visibleStamp = scene.getCurrentVisibleSessionDestinyStamp(observerSession);
  observerSession._space.historyFloorDestinyStamp = (visibleStamp + 1) >>> 0;
  observerSession._space.lastSentDestinyStamp = (visibleStamp + 4) >>> 0;

  assert.equal(
    scene.orbitShipEntity(remoteEntity, observerEntity.itemID, 3000, {
      queueHistorySafeContract: true,
    }),
    true,
  );
  assert.equal(scene.pendingSubwarpMovementContracts.has(remoteEntity.itemID), true);

  flushQueuedMovementUpdates(scene);

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => (
      entry.name === "Orbit" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.deepEqual(
    observerUpdates.map((entry) => entry.name),
    ["Orbit", "SetSpeedFraction"],
  );
  assert.equal(
    observerUpdates.every(
      (entry) => entry.stamp >= observerSession._space.lastSentDestinyStamp,
    ),
    true,
    "expected queued remote orbit movement not to backstep behind the observer's already-presented missile lane",
  );
});

test("immediate remote orbit movement does not backstep behind a recently sent future observer lane", () => {
  const observerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const remoteSession = createFakeSession(
    2,
    140000002,
    { x: 6000, y: 0, z: 0 },
  );

  const observerEntity = attachAndBootstrap(observerSession);
  const remoteEntity = attachAndBootstrap(remoteSession);

  const scene = spaceRuntime.getSceneForSession(observerSession);
  assert.ok(scene, "expected observer scene to exist");

  observerSession.notifications.length = 0;
  remoteSession.notifications.length = 0;

  const currentRawDispatchStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(observerSession);
  const priorRawDispatchStamp =
    currentRawDispatchStamp > 0 ? ((currentRawDispatchStamp - 1) >>> 0) : 0;
  const recentFutureLane = (currentSessionStamp + 12) >>> 0;
  const expectedProjectedFloor = (recentFutureLane + 1) >>> 0;
  observerSession._space.lastSentDestinyStamp = recentFutureLane;
  observerSession._space.lastSentDestinyRawDispatchStamp = priorRawDispatchStamp;

  assert.equal(
    scene.orbitShipEntity(remoteEntity, observerEntity.itemID, 3000),
    true,
  );

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => (
      entry.name === "Orbit" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.deepEqual(
    observerUpdates.map((entry) => entry.name),
    ["Orbit", "SetSpeedFraction"],
  );
  assert.equal(
    observerUpdates.every((entry) => entry.stamp >= expectedProjectedFloor),
    true,
    "expected immediate remote orbit movement not to backstep beneath a recently sent future observer lane",
  );
});

test("immediate remote orbit movement does not backstep beneath a farther-ahead lane already sent earlier in the same raw dispatch", () => {
  const observerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const remoteSession = createFakeSession(
    2,
    140000002,
    { x: 6000, y: 0, z: 0 },
  );

  const observerEntity = attachAndBootstrap(observerSession);
  const remoteEntity = attachAndBootstrap(remoteSession);

  const scene = spaceRuntime.getSceneForSession(observerSession);
  assert.ok(scene, "expected observer scene to exist");

  observerSession.notifications.length = 0;
  remoteSession.notifications.length = 0;

  const currentRawDispatchStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(observerSession);
  const sameRawPublishedLane = (currentSessionStamp + 7) >>> 0;
  observerSession._space.lastSentDestinyStamp = sameRawPublishedLane;
  observerSession._space.lastSentDestinyRawDispatchStamp = currentRawDispatchStamp;

  assert.equal(
    scene.orbitShipEntity(remoteEntity, observerEntity.itemID, 3000),
    true,
  );

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => (
      entry.name === "Orbit" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.deepEqual(
    observerUpdates.map((entry) => entry.name),
    ["Orbit", "SetSpeedFraction"],
  );
  assert.equal(
    observerUpdates.every((entry) => entry.stamp >= sameRawPublishedLane),
    true,
    "expected immediate remote orbit movement not to backstep under a farther-ahead lane already published earlier in the same raw dispatch",
  );
});

test("owner movement sends do not backstep beneath a farther-ahead lane already sent earlier in the same raw dispatch when owner monotonic restamp is skipped", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );

  const ownerEntity = attachAndBootstrap(ownerSession);
  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  ownerSession.notifications.length = 0;

  const currentRawDispatchStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const sameRawPublishedLane = (currentSessionStamp + 7) >>> 0;
  const authoredStamp = (currentSessionStamp + 1) >>> 0;
  ownerSession._space.lastSentDestinyStamp = sameRawPublishedLane;
  ownerSession._space.lastSentDestinyRawDispatchStamp = currentRawDispatchStamp;

  scene.sendDestinyUpdates(
    ownerSession,
    [
      {
        stamp: authoredStamp,
        payload: ["GotoDirection", [ownerEntity.itemID, 1, 0, 0]],
      },
      {
        stamp: authoredStamp,
        payload: ["SetSpeedFraction", [ownerEntity.itemID, 1]],
      },
    ],
    false,
    {
      translateStamps: false,
      skipOwnerMonotonicRestamp: true,
    },
  );

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => (
      entry.name === "GotoDirection" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.deepEqual(
    ownerUpdates.map((entry) => entry.name),
    ["GotoDirection", "SetSpeedFraction"],
  );
  assert.equal(
    ownerUpdates.every((entry) => entry.stamp >= sameRawPublishedLane),
    true,
    "expected skipped owner monotonic restamp not to let owner movement land underneath a farther-ahead lane already published in the same raw dispatch",
  );
});

test("approach command keeps FollowBall and SetSpeedFraction on the presented owner lane", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const targetSession = createFakeSession(
    2,
    140000002,
    { x: 1500, y: 0, z: 0 },
  );

  const ownerEntity = attachAndBootstrap(ownerSession);
  const targetEntity = attachAndBootstrap(targetSession);
  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  ownerEntity.speedFraction = 0;
  ownerSession.notifications.length = 0;
  targetSession.notifications.length = 0;

  const currentRawDispatchStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(ownerSession);
  const priorRawDispatchStamp =
    currentRawDispatchStamp > 0 ? ((currentRawDispatchStamp - 1) >>> 0) : 0;
  const recentlyPresentedLane = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD
  ) >>> 0;
  setPresentedDestinyLane(
    ownerSession,
    recentlyPresentedLane,
    priorRawDispatchStamp,
    { wasOwnerCritical: false },
  );

  assert.equal(
    scene.followShipEntity(ownerEntity, targetEntity.itemID, 50),
    true,
  );
  scene.flushDirectDestinyNotificationBatch();

  const ownerUpdates = flattenDestinyUpdates(ownerSession.notifications)
    .filter((entry) => (
      entry.name === "FollowBall" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.deepEqual(
    ownerUpdates.map((entry) => entry.name),
    ["FollowBall", "SetSpeedFraction"],
  );
  assert.equal(
    ownerUpdates.every((entry) => entry.stamp >= recentlyPresentedLane),
    true,
    "expected approach owner movement not to backstep behind the lane already presented to the client",
  );
  assert.equal(
    new Set(ownerUpdates.map((entry) => entry.stamp)).size,
    1,
    "expected FollowBall and SetSpeedFraction from one approach command to remain on the same Destiny stamp",
  );
});

test("bootstrap acquire does not backstep behind the lane already presented to the session", () => {
  const observerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );

  attachAndBootstrap(observerSession);
  const scene = spaceRuntime.getSceneForSession(observerSession);
  assert.ok(scene, "expected observer scene to exist");

  const acquiredEntity = spaceRuntime._testing.buildRuntimeShipEntityForTesting({
    itemID: 990001001,
    typeID: 606,
    position: { x: 500, y: 0, z: 0 },
  }, TEST_SYSTEM_ID);
  scene.spawnDynamicEntity(acquiredEntity, { broadcast: false });

  observerSession.notifications.length = 0;
  observerSession._syncLedgerEvents = [];

  const currentRawDispatchStamp = scene.getCurrentDestinyStamp();
  const currentSessionStamp = scene.getCurrentSessionDestinyStamp(observerSession);
  const alreadyPresentedLane = (
    currentSessionStamp + OWNER_MISSILE_CLIENT_LANE_LEAD + 1
  ) >>> 0;
  setPresentedDestinyLane(
    observerSession,
    alreadyPresentedLane,
    currentRawDispatchStamp,
    { wasOwnerCritical: false },
  );

  const sendResult = scene.sendAddBallsToSession(
    observerSession,
    [acquiredEntity],
    {
      freshAcquire: true,
      nowMs: scene.getCurrentSimTimeMs(),
    },
  );
  scene.flushDirectDestinyNotificationBatch();

  assert.equal(sendResult.delivered, true, "expected bootstrap acquire send to be accepted");
  const addUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "AddBalls2");
  assert.equal(addUpdates.length, 1, "expected one AddBalls2 bootstrap acquire update");
  assert.equal(
    addUpdates[0].stamp >= alreadyPresentedLane,
    true,
    "expected bootstrap acquire not to be ceiled behind the lane already presented to the client",
  );
  assert.equal(
    (observerSession._syncLedgerEvents || [])
      .some((entry) => entry.event === "destiny.group.rejected"),
    false,
    "expected bootstrap acquire not to hit the final backstep rejection guard",
  );
});

test("immediate remote follow movement clears an observer visible-history floor", () => {
  const observerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const remoteSession = createFakeSession(
    2,
    140000002,
    { x: 6000, y: 0, z: 0 },
  );

  const observerEntity = attachAndBootstrap(observerSession);
  const remoteEntity = attachAndBootstrap(remoteSession);

  const scene = spaceRuntime.getSceneForSession(observerSession);
  assert.ok(scene, "expected observer scene to exist");

  observerSession.notifications.length = 0;
  remoteSession.notifications.length = 0;

  const baselineVisibleStamp = scene.getCurrentVisibleSessionDestinyStamp(
    observerSession,
  );
  observerSession._space.historyFloorDestinyStamp = (
    baselineVisibleStamp + 3
  ) >>> 0;

  assert.equal(
    scene.followShipEntity(remoteEntity, observerEntity.itemID, 3000),
    true,
  );

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => (
      entry.name === "FollowBall" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.deepEqual(
    observerUpdates.map((entry) => entry.name),
    ["FollowBall", "SetSpeedFraction"],
  );
  assert.equal(
    observerUpdates.every(
      (entry) => entry.stamp >= observerSession._space.historyFloorDestinyStamp,
    ),
    true,
    "expected immediate remote follow movement to avoid landing behind the observer visible-history floor",
  );
});

test("immediate remote follow movement does not backstep behind the observer's presented lane", () => {
  const observerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const remoteSession = createFakeSession(
    2,
    140000002,
    { x: 6000, y: 0, z: 0 },
  );

  const observerEntity = attachAndBootstrap(observerSession);
  const remoteEntity = attachAndBootstrap(remoteSession);

  const scene = spaceRuntime.getSceneForSession(observerSession);
  assert.ok(scene, "expected observer scene to exist");

  observerSession.notifications.length = 0;
  remoteSession.notifications.length = 0;

  const visibleStamp = scene.getCurrentVisibleSessionDestinyStamp(
    observerSession,
  );
  observerSession._space.historyFloorDestinyStamp = (visibleStamp + 1) >>> 0;
  observerSession._space.lastSentDestinyStamp = (visibleStamp + 4) >>> 0;

  assert.equal(
    scene.followShipEntity(remoteEntity, observerEntity.itemID, 3000),
    true,
  );

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => (
      entry.name === "FollowBall" ||
      entry.name === "SetSpeedFraction"
    ));
  assert.deepEqual(
    observerUpdates.map((entry) => entry.name),
    ["FollowBall", "SetSpeedFraction"],
  );
  assert.equal(
    observerUpdates.every(
      (entry) => entry.stamp >= observerSession._space.lastSentDestinyStamp,
    ),
    true,
    "expected immediate remote follow movement not to backstep behind the observer's already-presented future lane",
  );
});

test("queued remote follow contracts skip freshly acquired observers when replay suppression is requested", () => {
  const observerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const remoteSession = createFakeSession(
    2,
    140000002,
    { x: 6000, y: 0, z: 0 },
  );

  const observerEntity = attachAndBootstrap(observerSession);
  const remoteEntity = attachAndBootstrap(remoteSession);

  const scene = spaceRuntime.getSceneForSession(observerSession);
  assert.ok(scene, "expected observer scene to exist");

  observerSession.notifications.length = 0;
  remoteSession.notifications.length = 0;
  observerSession._space.visibleDynamicEntityIDs = new Set([remoteEntity.itemID]);
  observerSession._space.freshlyVisibleDynamicEntityIDs = new Set([remoteEntity.itemID]);

  assert.equal(
    scene.followShipEntity(remoteEntity, observerEntity.itemID, 3000, {
      queueHistorySafeContract: true,
      suppressFreshAcquireReplay: true,
    }),
    true,
  );

  flushQueuedMovementUpdates(scene);

  const observerUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => (
      entry.name === "FollowBall" ||
      entry.name === "SetSpeedFraction"
    ));
  const ownerUpdates = flattenDestinyUpdates(remoteSession.notifications)
    .filter((entry) => (
      entry.name === "FollowBall" ||
      entry.name === "SetSpeedFraction"
    ));

  assert.equal(
    observerUpdates.length,
    0,
    "expected replay suppression to keep queued follow contracts off freshly acquired observers",
  );
  assert.deepEqual(
    ownerUpdates.map((entry) => entry.name),
    ["FollowBall", "SetSpeedFraction"],
  );
});

test("fresh acquire AddBalls2 stays on the live scene timeline", () => {
  const ownerSession = createFakeSession(
    1,
    140000001,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    2,
    140000002,
    { x: 500, y: 0, z: 0 },
  );

  const ownerEntity = attachAndBootstrap(ownerSession);
  attachAndBootstrap(observerSession);

  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  observerSession.notifications.length = 0;
  const currentStamp = scene.getCurrentDestinyStamp();
  observerSession._space.clockOffsetMs = -203000;
  observerSession._space.lastSentDestinyStamp = currentStamp;

  scene.sendAddBallsToSession(observerSession, [ownerEntity], {
    freshAcquire: true,
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const updates = flattenDestinyUpdates(observerSession.notifications);
  const addBallsUpdate = updates.find((entry) => entry.name === "AddBalls2");
  assert.ok(addBallsUpdate, "expected a fresh-acquire AddBalls2 update");
  assert.equal(addBallsUpdate.stamp >= currentStamp, true);
  assert.equal(
    addBallsUpdate.stamp >
      scene.translateDestinyStampForSession(observerSession, currentStamp),
    true,
    "fresh acquire should not translate AddBalls2 onto the preserved previous-scene clock",
  );
  assert.equal(
    updates
      .filter((entry) => entry.name !== "AddBalls2")
      .every((entry) => entry.stamp >= addBallsUpdate.stamp),
    true,
    "follow-up prime and mode updates should not backstep behind the fresh-acquire AddBalls2 stamp",
  );
});

test("fresh ship acquires do not replay subwarp movement on top of AddBalls2 bootstrap", () => {
  const ownerSession = createFakeSession(
    11,
    140000011,
    { x: 0, y: 0, z: 0 },
    {
      velocity: { x: 150, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "FOLLOW",
      speedFraction: 1,
    },
  );
  const observerSession = createFakeSession(
    12,
    140000012,
    { x: 500, y: 0, z: 0 },
  );

  const ownerEntity = attachAndBootstrap(ownerSession);
  const observerEntity = attachAndBootstrap(observerSession);
  const scene = spaceRuntime.getSceneForSession(ownerSession);
  assert.ok(scene, "expected owner scene to exist");

  ownerEntity.mode = "FOLLOW";
  ownerEntity.targetEntityID = observerEntity.itemID;
  ownerEntity.followRange = 6500;
  ownerEntity.speedFraction = 1;
  ownerEntity.velocity = { x: 150, y: 0, z: 0 };

  observerSession.notifications.length = 0;
  scene.sendAddBallsToSession(observerSession, [ownerEntity], {
    freshAcquire: true,
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const updates = flattenDestinyUpdates(observerSession.notifications);
  const updateNames = updates.map((entry) => entry.name);
  assert.equal(
    updateNames.includes("AddBalls2"),
    true,
    "expected a fresh-acquire AddBalls2 update for the newly visible moving ship",
  );
  assert.equal(
    updateNames.includes("FollowBall"),
    false,
    "expected fresh ship acquires to rely on AddBalls2 bootstrap state instead of replaying FollowBall",
  );
  assert.equal(
    updateNames.includes("SetSpeedFraction"),
    false,
    "expected fresh ship acquires to avoid replaying SetSpeedFraction on the same bootstrap lane",
  );
});
