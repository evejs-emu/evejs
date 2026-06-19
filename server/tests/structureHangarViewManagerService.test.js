const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const StructureHangarViewManagerService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureHangarViewManagerService",
));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const {
  STRUCTURE_STATE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureConstants",
));

const originalGetStructureByID = structureState.getStructureByID;

test.afterEach(() => {
  structureState.getStructureByID = originalGetStructureByID;
});

function buildSession() {
  return {
    characterID: 140000002,
    charid: 140000002,
    structureID: 1030000000000,
    structureid: 1030000000000,
  };
}

test("structureHangarViewMgr returns CCP-shaped StructureHangarViewState for a docked structure session", () => {
  const service = new StructureHangarViewManagerService();
  const session = {
    ...buildSession(),
    _structureViewSpace: {
      initialStateSent: true,
      shipID: 1030000000000,
    },
  };
  const nowMs = Date.now();
  const structure = {
    structureID: 1030000000000,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
    stateStartedAt: nowMs - 30000,
    stateEndsAt: nowMs + 30000,
    conditionState: {
      shieldCharge: 0.75,
      armorDamage: 0.5,
      damage: 0.25,
    },
  };

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  const result = service.Handle_GetMyHangarViewState([], session);

  assert.equal(result && result.name, "util.KeyVal");
  const entries = new Map(result.args.entries);
  assert.equal(entries.get("operatingState"), STRUCTURE_STATE.SHIELD_VULNERABLE);
  assert.equal(entries.get("upkeepState"), STRUCTURE_UPKEEP_STATE.FULL_POWER);
  assert.deepEqual(entries.get("damageState"), [0.75, 0.5, 0.75]);
  assert.deepEqual(entries.get("timerStartAt"), {
    type: "long",
    value: structureState.toFileTimeLongFromMs(structure.stateStartedAt),
  });
  assert.deepEqual(entries.get("timerEndAt"), {
    type: "long",
    value: structureState.toFileTimeLongFromMs(structure.stateEndsAt),
  });
  assert.equal(entries.get("timerPauseAt"), null);
  assert.equal(entries.get("timerIsProgressing"), true);
  assert.equal(entries.get("timerIsPaused"), false);
  assert.equal(entries.get("timerProgress").type, "real");
  assert.ok(entries.get("timerProgress").value > 0.25);
  assert.ok(entries.get("timerProgress").value < 0.75);
  assert.equal(
    session._structureViewSpace,
    null,
    "Expected loading the docked hangar view to clear any stale exterior-view observer state",
  );
});

test("structureHangarViewMgr returns null when the session is not docked in a structure", () => {
  const service = new StructureHangarViewManagerService();
  const session = {
    characterID: 140000002,
    charid: 140000002,
    structureID: 0,
    structureid: 0,
  };

  const result = service.Handle_GetMyHangarViewState([], session);

  assert.equal(result, null);
});

test("machoNet service info advertises structureHangarViewMgr for client routing", () => {
  const service = new MachoNetService();
  const infoDict = service.getServiceInfoDict();
  const serviceInfo = new Map(infoDict.entries);

  assert.equal(serviceInfo.has("structureHangarViewMgr"), true);
  assert.equal(serviceInfo.get("structureHangarViewMgr"), null);
});

test("structure state changes push docked hangar view updates through the client service", (t) => {
  const notifications = [];
  const session = {
    characterID: 140000002,
    charid: 140000002,
    structureID: 1030000000000,
    structureid: 1030000000000,
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  t.after(() => sessionRegistry.unregister(session));
  sessionRegistry.register(session);

  const nowMs = Date.now();
  const previous = {
    structureID: 1030000000000,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.ONLINING_VULNERABLE,
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
    stateStartedAt: nowMs,
    stateEndsAt: nowMs + 900000,
    conditionState: {
      shieldCharge: 0,
      armorDamage: 0,
      damage: 0,
    },
  };
  const next = {
    ...previous,
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    stateEndsAt: null,
    conditionState: {
      shieldCharge: 1,
      armorDamage: 0,
      damage: 0,
    },
  };

  const result = spaceRuntime._testing.syncRuntimeStructureStateChangesForTesting({
    scenes: new Map(),
    syncStructureSceneState() {
      throw new Error("No scene sync should run when no live scene exists");
    },
  }, {
    systemIDs: [30000142],
    previousRows: [previous],
    nextRows: [next],
  });

  assert.equal(result.syncedSystemCount, 0);
  assert.equal(result.dockedHangarDeliveryCount, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].name, "OnHangarViewStateUpdated");
  assert.equal(notifications[0].idType, "clientID");
  assert.equal(notifications[0].payload[0], next.structureID);

  const stateEntries = new Map(notifications[0].payload[1].args.entries);
  assert.equal(stateEntries.get("operatingState"), STRUCTURE_STATE.SHIELD_VULNERABLE);
  assert.deepEqual(stateEntries.get("damageState"), [1, 1, 1]);
  assert.equal(stateEntries.get("timerEndAt"), null);
});
