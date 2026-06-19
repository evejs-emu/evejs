const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.ELYSIAN_EVE_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const StructureControlService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureControlService",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));

const originalGetStructureByID = structureState.getStructureByID;

function buildStructure() {
  return {
    structureID: 1030000000000,
    ownerCorpID: 1000044,
    ownerID: 1000044,
    allianceID: null,
    solarSystemID: 30002187,
  };
}

function buildSession(overrides = {}) {
  const sentChanges = [];
  const session = {
    characterID: 140000002,
    charid: 140000002,
    corporationID: 1000044,
    corpid: 1000044,
    allianceID: 0,
    allianceid: 0,
    activeShipID: 990112614,
    shipID: 990112614,
    shipid: 990112614,
    structureID: 1030000000000,
    structureid: 1030000000000,
    locationID: 1030000000000,
    locationid: 1030000000000,
    solarsystemid: 30002187,
    solarsystemid2: 30002187,
    socket: {
      destroyed: false,
    },
    sendSessionChange(changes) {
      sentChanges.push(changes);
    },
    ...overrides,
  };
  session._sentChanges = sentChanges;
  return session;
}

test.afterEach(() => {
  structureState.getStructureByID = originalGetStructureByID;
});

test.afterEach(() => {
  for (const session of sessionRegistry.getSessions()) {
    sessionRegistry.unregister(session);
  }
});

test("structureControl TakeControl switches shipid to structureid and advertises the pilot", () => {
  const service = new StructureControlService();
  const session = buildSession({
    _deferredDockedShipSessionChange: {
      shipID: 990112614,
      selfFlushTimer: setTimeout(() => {}, 60_000),
    },
    _pendingDockedFittingBootstrap: {
      shipID: 990112614,
    },
  });
  const structure = buildStructure();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  sessionRegistry.register(session);

  const result = service.Handle_TakeControl([structure.structureID], session);

  assert.equal(result, null);
  assert.equal(session.shipID, structure.structureID);
  assert.equal(session.shipid, structure.structureID);
  assert.equal(session.locationID, structure.solarSystemID);
  assert.equal(session.locationid, structure.solarSystemID);
  assert.equal(session._structureControlPreviousShipID, 990112614);
  assert.equal(
    session._structureControlPreviousLocationID,
    structure.structureID,
  );
  assert.deepEqual(session._sentChanges, [
    {
      shipid: [990112614, structure.structureID],
      locationid: [structure.structureID, structure.solarSystemID],
    },
  ]);
  assert.equal(session._deferredDockedShipSessionChange, null);
  assert.equal(session._pendingDockedFittingBootstrap, null);
  assert.equal(
    service.Handle_GetStructurePilot([structure.structureID], session),
    session.characterID,
  );
});

test("structureControl TakeControl overrides an existing controller and restores their previous ship", () => {
  const service = new StructureControlService();
  const structure = buildStructure();
  const previousController = buildSession({
    characterID: 140000010,
    charid: 140000010,
    activeShipID: 990112610,
    shipID: structure.structureID,
    shipid: structure.structureID,
    locationID: structure.solarSystemID,
    locationid: structure.solarSystemID,
    _structureControlPreviousShipID: 990112610,
    _structureControlPreviousLocationID: structure.structureID,
  });
  const session = buildSession({
    characterID: 140000011,
    charid: 140000011,
    activeShipID: 990112611,
    shipID: 990112611,
    shipid: 990112611,
  });

  structureState.getStructureByID = () => structure;

  sessionRegistry.register(previousController);
  sessionRegistry.register(session);

  service.Handle_TakeControl([structure.structureID], session);

  assert.equal(previousController.shipID, 990112610);
  assert.equal(previousController.shipid, 990112610);
  assert.equal(previousController.locationid, structure.structureID);
  assert.deepEqual(previousController._sentChanges, [
    {
      shipid: [structure.structureID, 990112610],
      locationid: [structure.solarSystemID, structure.structureID],
    },
  ]);
  assert.equal(session.shipID, structure.structureID);
  assert.equal(session.locationid, structure.solarSystemID);
  assert.equal(
    service.Handle_GetStructurePilot([structure.structureID], session),
    session.characterID,
  );
});

test("structureControl ReleaseControl restores the previously boarded ship", () => {
  const service = new StructureControlService();
  const session = buildSession({
    shipID: 1030000000000,
    shipid: 1030000000000,
    locationID: 30002187,
    locationid: 30002187,
    _structureControlPreviousShipID: 990112614,
    _structureControlPreviousLocationID: 1030000000000,
    _deferredDockedShipSessionChange: {
      shipID: 990112614,
      selfFlushTimer: setTimeout(() => {}, 60_000),
    },
    _pendingDockedFittingBootstrap: {
      shipID: 990112614,
    },
    _structureViewSpace: {
      initialStateSent: true,
      shipID: 1030000000000,
    },
  });

  const result = service.Handle_ReleaseControl([], session);

  assert.equal(result, null);
  assert.equal(session.shipID, 990112614);
  assert.equal(session.shipid, 990112614);
  assert.equal(session.locationID, 1030000000000);
  assert.equal(session.locationid, 1030000000000);
  assert.equal(session._structureControlPreviousShipID, undefined);
  assert.equal(session._structureControlPreviousLocationID, undefined);
  assert.deepEqual(session._sentChanges, [
    {
      shipid: [1030000000000, 990112614],
      locationid: [30002187, 1030000000000],
    },
  ]);
  assert.equal(session._structureViewSpace, null);
  assert.equal(session._deferredDockedShipSessionChange, null);
  assert.equal(session._pendingDockedFittingBootstrap, null);
});

test("structureControl denies TakeControl when the pilot is not docked in the requested structure", () => {
  const service = new StructureControlService();
  const structure = buildStructure();
  const session = buildSession({
    structureID: 1030000000001,
    structureid: 1030000000001,
  });

  structureState.getStructureByID = () => structure;

  assert.throws(
    () => service.Handle_TakeControl([structure.structureID], session),
    (error) => {
      const payload = error && error.machoErrorResponse && error.machoErrorResponse.payload;
      const header = payload && Array.isArray(payload.header) ? payload.header : [];
      assert.equal(header[1] && header[1][0], "CustomNotify");
      return true;
    },
  );
});

test("machoNet service info advertises structureControl for client routing", () => {
  const service = new MachoNetService();
  const infoDict = service.getServiceInfoDict();
  const serviceInfo = new Map(infoDict.entries);

  assert.equal(serviceInfo.has("structureControl"), true);
  assert.equal(serviceInfo.get("structureControl"), null);
});
