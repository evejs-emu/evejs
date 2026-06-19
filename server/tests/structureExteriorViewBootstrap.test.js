const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const BeyonceService = require(path.join(
  repoRoot,
  "server/src/services/ship/beyonceService",
));

const TEST_SYSTEM_ID = 30000142;
const TEST_STRUCTURE_ID = 1030000000000;

const originalPrepareDockedStructureView = spaceRuntime.prepareDockedStructureView;
const originalBootstrapDockedStructureView = spaceRuntime.bootstrapDockedStructureView;
const originalEnsureInitialBallpark = spaceRuntime.ensureInitialBallpark;
const originalMarkBeyonceBound = spaceRuntime.markBeyonceBound;
const originalEnsureScene = spaceRuntime.ensureScene;

function buildDockedStructureSession(overrides = {}) {
  return {
    clientID: 65450,
    characterID: 140000002,
    charid: 140000002,
    corporationID: 1000009,
    corpid: 1000009,
    allianceID: 0,
    allianceid: 0,
    structureID: TEST_STRUCTURE_ID,
    structureid: TEST_STRUCTURE_ID,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    shipID: 990112614,
    shipid: 990112614,
    socket: {
      destroyed: false,
    },
    sendNotification() {},
    sendServiceNotification() {},
    ...overrides,
  };
}

function buildSpaceSession(overrides = {}) {
  return {
    clientID: 65451,
    characterID: 140000003,
    charid: 140000003,
    socket: {
      destroyed: false,
    },
    _space: {
      systemID: TEST_SYSTEM_ID,
      shipID: 990112615,
      initialStateSent: false,
    },
    sendNotification() {},
    sendServiceNotification() {},
    ...overrides,
  };
}

test.afterEach(() => {
  spaceRuntime.prepareDockedStructureView = originalPrepareDockedStructureView;
  spaceRuntime.bootstrapDockedStructureView = originalBootstrapDockedStructureView;
  spaceRuntime.ensureInitialBallpark = originalEnsureInitialBallpark;
  spaceRuntime.markBeyonceBound = originalMarkBeyonceBound;
  spaceRuntime.ensureScene = originalEnsureScene;
});

test("beyonce GetFormations prepares a fresh docked structure exterior bootstrap without sending ballpark state yet", () => {
  const service = new BeyonceService();
  const session = buildDockedStructureSession();
  let prepareCalls = 0;
  let bootstrapCalls = 0;
  let ensureCalls = 0;
  let markCalls = 0;

  spaceRuntime.prepareDockedStructureView = (receivedSession) => {
    prepareCalls += 1;
    assert.equal(receivedSession, session);
    return true;
  };
  spaceRuntime.bootstrapDockedStructureView = () => {
    bootstrapCalls += 1;
    return true;
  };
  spaceRuntime.ensureInitialBallpark = () => {
    ensureCalls += 1;
    return true;
  };
  spaceRuntime.markBeyonceBound = () => {
    markCalls += 1;
  };

  const formations = service.Handle_GetFormations([], session, null);

  assert.equal(Array.isArray(formations), true);
  assert.equal(prepareCalls, 1);
  assert.equal(bootstrapCalls, 0);
  assert.equal(ensureCalls, 0);
  assert.equal(markCalls, 0);
});

test("beyonce MachoBindObject routes docked structure sessions into the structure exterior bootstrap path", () => {
  const service = new BeyonceService();
  const session = buildDockedStructureSession();
  let bootstrapCalls = 0;
  let ensureCalls = 0;

  spaceRuntime.bootstrapDockedStructureView = (receivedSession, options = {}) => {
    bootstrapCalls += 1;
    assert.equal(receivedSession, session);
    assert.equal(options.force, true);
    assert.equal(options.reset, false);
    return true;
  };
  spaceRuntime.ensureInitialBallpark = () => {
    ensureCalls += 1;
    return true;
  };

  const response = service.Handle_MachoBindObject([TEST_SYSTEM_ID, null], session, null);

  assert.ok(Array.isArray(response), "Expected a bound-object response");
  assert.equal(bootstrapCalls, 1);
  assert.equal(ensureCalls, 0);
});

test("beyonce keeps normal in-space sessions on the existing space bootstrap path", () => {
  const service = new BeyonceService();
  const session = buildSpaceSession();
  let bootstrapCalls = 0;
  let ensureCalls = 0;
  let markCalls = 0;

  spaceRuntime.bootstrapDockedStructureView = () => {
    bootstrapCalls += 1;
    return true;
  };
  spaceRuntime.ensureInitialBallpark = (receivedSession, options = {}) => {
    ensureCalls += 1;
    assert.equal(receivedSession, session);
    assert.equal(options.allowDeferredJumpBootstrapVisuals, true);
    return true;
  };
  spaceRuntime.markBeyonceBound = (receivedSession) => {
    markCalls += 1;
    assert.equal(receivedSession, session);
  };

  service.Handle_GetFormations([], session, null);

  assert.equal(bootstrapCalls, 0);
  assert.equal(ensureCalls, 1);
  assert.equal(markCalls, 1);
});

test("spaceRuntime bootstrapDockedStructureView preserves observer state without leaving the session attached to space", () => {
  const session = buildDockedStructureSession();
  const observerEntity = {
    itemID: TEST_STRUCTURE_ID,
    kind: "structure",
  };
  let syncedStructures = 0;
  let ensuredBallpark = 0;

  spaceRuntime.ensureScene = (systemID) => {
    assert.equal(systemID, TEST_SYSTEM_ID);
    return {
      systemID,
      getTimeDilation() {
        return 1;
      },
      getCurrentSimTimeMs() {
        return 123456;
      },
      getCurrentFileTime() {
        return 1234560000n;
      },
      syncStructureEntitiesFromState(options = {}) {
        syncedStructures += 1;
        assert.equal(options.broadcast, false);
      },
      getEntityByID(entityID) {
        return Number(entityID) === TEST_STRUCTURE_ID ? observerEntity : null;
      },
      ensureInitialBallpark(receivedSession, options = {}) {
        ensuredBallpark += 1;
        assert.equal(receivedSession, session);
        assert.equal(receivedSession._space.observerKind, "structure");
        assert.equal(receivedSession._space.shipID, TEST_STRUCTURE_ID);
        assert.equal(options.force, false);
        receivedSession._space.initialStateSent = true;
        return true;
      },
    };
  };

  const result = spaceRuntime.bootstrapDockedStructureView(session);

  assert.equal(result, true);
  assert.equal(syncedStructures, 1);
  assert.equal(ensuredBallpark, 1);
  assert.equal(session._space, null);
  assert.ok(session._structureViewSpace);
  assert.equal(session._structureViewSpace.observerKind, "structure");
  assert.equal(session._structureViewSpace.shipID, TEST_STRUCTURE_ID);
  assert.equal(session._structureViewSpace.initialStateSent, true);
  assert.equal(session._structureViewSpace.pendingBallparkBind, false);
});

test("spaceRuntime prepareDockedStructureView resets stale cached observer bootstrap state", () => {
  const session = buildDockedStructureSession({
    _structureViewSpace: {
      initialStateSent: true,
      initialBallparkVisualsSent: true,
      initialBallparkClockSynced: true,
      pendingBallparkBind: false,
      visibleDynamicEntityIDs: new Set([980000000151]),
    },
  });

  spaceRuntime.ensureScene = (systemID) => {
    assert.equal(systemID, TEST_SYSTEM_ID);
    return {
      systemID,
      getTimeDilation() {
        return 1;
      },
      getCurrentSimTimeMs() {
        return 123456;
      },
      getCurrentFileTime() {
        return 1234560000n;
      },
      syncStructureEntitiesFromState(options = {}) {
        assert.equal(options.broadcast, false);
      },
      getEntityByID(entityID) {
        return Number(entityID) === TEST_STRUCTURE_ID
          ? { itemID: TEST_STRUCTURE_ID, kind: "structure" }
          : null;
      },
    };
  };

  const result = spaceRuntime.prepareDockedStructureView(session);

  assert.equal(result, true);
  assert.ok(session._structureViewSpace);
  assert.equal(session._structureViewSpace.shipID, TEST_STRUCTURE_ID);
  assert.equal(session._structureViewSpace.initialStateSent, false);
  assert.equal(session._structureViewSpace.initialBallparkVisualsSent, false);
  assert.equal(session._structureViewSpace.initialBallparkClockSynced, false);
  assert.equal(session._structureViewSpace.pendingBallparkBind, true);
  assert.deepEqual(
    [...session._structureViewSpace.visibleDynamicEntityIDs],
    [],
  );
});
