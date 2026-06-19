const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const StructureDockingService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureDockingService",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const transitions = require(path.join(repoRoot, "server/src/space/transitions"));

const originalFns = {
  getStructureByID: structureState.getStructureByID,
  canCharacterDockAtStructure: structureState.canCharacterDockAtStructure,
  canDockAtStation: spaceRuntime.canDockAtStation,
  acceptDocking: spaceRuntime.acceptDocking,
  followBall: spaceRuntime.followBall,
  undockSession: transitions.undockSession,
};

function buildSession() {
  return {
    characterID: 140000002,
    charid: 140000002,
    shipTypeID: 606,
    activeShipID: 990112614,
    shipID: 990112614,
    shipid: 990112614,
    structureID: 1030000000000,
    structureid: 1030000000000,
    _space: {
      shipID: 990112614,
    },
  };
}

function buildStructure() {
  return {
    structureID: 1030000000000,
    typeID: 35832,
    dockable: true,
  };
}

function getWrappedUserErrorMessage(error) {
  return error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1])
      ? error.machoErrorResponse.payload.header[1][0]
      : null;
}

test.afterEach(() => {
  structureState.getStructureByID = originalFns.getStructureByID;
  structureState.canCharacterDockAtStructure = originalFns.canCharacterDockAtStructure;
  spaceRuntime.canDockAtStation = originalFns.canDockAtStation;
  spaceRuntime.acceptDocking = originalFns.acceptDocking;
  spaceRuntime.followBall = originalFns.followBall;
  transitions.undockSession = originalFns.undockSession;
});

test("structureDocking service forwards successful dock requests into runtime docking", () => {
  const service = new StructureDockingService();
  const session = buildSession();
  const structure = buildStructure();

  let accepted = 0;

  structureState.getStructureByID = (structureID) => {
    assert.equal(Number(structureID), structure.structureID);
    return structure;
  };
  structureState.canCharacterDockAtStructure = (actualSession, actualStructure, options) => {
    assert.equal(actualSession, session);
    assert.equal(actualStructure, structure);
    assert.equal(options.shipTypeID, session.shipTypeID);
    return { success: true };
  };
  spaceRuntime.canDockAtStation = (actualSession, structureID) => {
    assert.equal(actualSession, session);
    assert.equal(Number(structureID), structure.structureID);
    return true;
  };
  spaceRuntime.acceptDocking = (actualSession, structureID) => {
    accepted += 1;
    assert.equal(actualSession, session);
    assert.equal(Number(structureID), structure.structureID);
    return {
      success: true,
      data: {
        acceptedAtFileTime: {
          type: "long",
          value: 123n,
        },
      },
    };
  };

  const result = service.Handle_Dock(
    [structure.structureID, session.shipID],
    session,
  );

  assert.deepEqual(result, {
    type: "long",
    value: 123n,
  });
  assert.equal(accepted, 1);
});

test("structureDocking service preserves the client docking-approach contract when still out of range", () => {
  const service = new StructureDockingService();
  const session = buildSession();
  const structure = buildStructure();

  let followArgs = null;

  structureState.getStructureByID = () => structure;
  structureState.canCharacterDockAtStructure = () => ({ success: true });
  spaceRuntime.canDockAtStation = () => false;
  spaceRuntime.followBall = (actualSession, targetID, range, options) => {
    followArgs = {
      actualSession,
      targetID,
      range,
      options,
    };
    return true;
  };

  assert.throws(
    () => service.Handle_Dock([structure.structureID, session.shipID], session),
    (error) => {
      assert.equal(error && error.name, "MachoWrappedException");
      assert.equal(getWrappedUserErrorMessage(error), "DockingApproach");
      return true;
    },
  );

  assert.deepEqual(followArgs, {
    actualSession: session,
    targetID: structure.structureID,
    range: 2500,
    options: {
      dockingTargetID: structure.structureID,
    },
  });
});

test("structureDocking service forwards undock requests into the shared transition path", () => {
  const service = new StructureDockingService();
  const session = buildSession();

  let undockCalls = 0;

  transitions.undockSession = (actualSession) => {
    undockCalls += 1;
    assert.equal(actualSession, session);
    return {
      success: true,
      data: {
        boundResult: {
          shipID: session.shipID,
          structureID: 0,
        },
      },
    };
  };

  const result = service.Handle_Undock(
    [session.structureID, session.shipID],
    session,
  );

  assert.deepEqual(result, {
    shipID: session.shipID,
    structureID: 0,
  });
  assert.equal(undockCalls, 1);
});
