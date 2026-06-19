const assert = require("assert");
const path = require("path");
const test = require("node:test");

const spaceRuntime = require(path.join(__dirname, "../src/space/runtime"));
const structureState = require(path.join(
  __dirname,
  "../src/services/structure/structureState",
));
const {
  executeStructureGmCommand,
} = require(path.join(__dirname, "../src/services/structure/structureChatCommands"));

function withPatchedStructureRuntime(run) {
  const originals = {
    getStructureByID: structureState.getStructureByID,
    setStructureState: structureState.setStructureState,
    setStructureStateTimerRemaining: structureState.setStructureStateTimerRemaining,
    setStructureDeployTimerRemaining: structureState.setStructureDeployTimerRemaining,
    setStructureUnanchoringRemaining: structureState.setStructureUnanchoringRemaining,
    startStructureUnanchoring: structureState.startStructureUnanchoring,
    cancelStructureUnanchoring: structureState.cancelStructureUnanchoring,
    setStructureAbandonTimerRemaining: structureState.setStructureAbandonTimerRemaining,
    tickStructures: structureState.tickStructures,
    syncStructureSceneState: spaceRuntime.syncStructureSceneState,
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      Object.assign(structureState, {
        getStructureByID: originals.getStructureByID,
        setStructureState: originals.setStructureState,
        setStructureStateTimerRemaining: originals.setStructureStateTimerRemaining,
        setStructureDeployTimerRemaining: originals.setStructureDeployTimerRemaining,
        setStructureUnanchoringRemaining: originals.setStructureUnanchoringRemaining,
        startStructureUnanchoring: originals.startStructureUnanchoring,
        cancelStructureUnanchoring: originals.cancelStructureUnanchoring,
        setStructureAbandonTimerRemaining: originals.setStructureAbandonTimerRemaining,
        tickStructures: originals.tickStructures,
      });
      spaceRuntime.syncStructureSceneState = originals.syncStructureSceneState;
    });
}

test("CCP GM /structure state uses structure state setter and clears stale timers", async () => {
  await withPatchedStructureRuntime(async () => {
    const calls = [];
    const structure = {
      structureID: 1030000000001,
      typeID: 35834,
      itemName: "GM Keepstar",
      ownerCorpID: 98000000,
      solarSystemID: 30000142,
      state: 110,
      upkeepState: 1,
      hasQuantumCore: true,
    };

    structureState.getStructureByID = () => structure;
    structureState.setStructureState = (structureID, state, options) => {
      calls.push({ fn: "setStructureState", structureID, state, options });
      return {
        success: true,
        data: {
          ...structure,
          state: Number(state),
        },
      };
    };
    spaceRuntime.syncStructureSceneState = (systemID) => {
      calls.push({ fn: "sync", systemID });
    };

    const result = executeStructureGmCommand(null, "state 1030000000001 115");

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(calls[0], {
      fn: "setStructureState",
      structureID: 1030000000001,
      state: "115",
      options: { clearTimer: true },
    });
    assert.deepStrictEqual(calls[1], { fn: "sync", systemID: 30000142 });
  });
});

test("CCP GM /structure timer commands set countdowns instead of requiring /upwell ff", async () => {
  await withPatchedStructureRuntime(async () => {
    const calls = [];
    const structure = {
      structureID: 1030000000002,
      typeID: 35834,
      itemName: "Timer Keepstar",
      ownerCorpID: 98000000,
      solarSystemID: 30000142,
      state: 115,
      upkeepState: 2,
      hasQuantumCore: true,
    };

    structureState.getStructureByID = () => structure;
    structureState.tickStructures = () => [];
    spaceRuntime.syncStructureSceneState = (systemID) => {
      calls.push({ fn: "sync", systemID });
    };
    structureState.setStructureStateTimerRemaining = (structureID, seconds) => {
      calls.push({ fn: "timer", structureID, seconds });
      return { success: true, data: structure };
    };
    structureState.setStructureDeployTimerRemaining = (structureID, seconds) => {
      calls.push({ fn: "deploytimer", structureID, seconds });
      return { success: true, data: structure };
    };
    structureState.setStructureUnanchoringRemaining = (structureID, seconds) => {
      calls.push({ fn: "unanchor", structureID, seconds });
      return { success: true, data: structure };
    };
    structureState.setStructureAbandonTimerRemaining = (structureID, seconds) => {
      calls.push({ fn: "abandontimer", structureID, seconds });
      return { success: true, data: structure };
    };

    assert.strictEqual(
      executeStructureGmCommand(null, "timer 1030000000002 5").success,
      true,
    );
    assert.strictEqual(
      executeStructureGmCommand(null, "deploytimer 1030000000002 15").success,
      true,
    );
    assert.strictEqual(
      executeStructureGmCommand(null, "unanchor 1030000000002 60").success,
      true,
    );
    assert.strictEqual(
      executeStructureGmCommand(null, "abandontimer 1030000000002 600").success,
      true,
    );

    assert.deepStrictEqual(
      calls.filter((call) => call.fn !== "sync"),
      [
        { fn: "timer", structureID: 1030000000002, seconds: 5 },
        { fn: "deploytimer", structureID: 1030000000002, seconds: 15 },
        { fn: "unanchor", structureID: 1030000000002, seconds: 60 },
        { fn: "abandontimer", structureID: 1030000000002, seconds: 600 },
      ],
    );
  });
});

test("CCP GM /structure unanchor supports start and cancel actions", async () => {
  await withPatchedStructureRuntime(async () => {
    const calls = [];
    const structure = {
      structureID: 1030000000003,
      typeID: 35834,
      itemName: "Unanchor Keepstar",
      ownerCorpID: 98000000,
      solarSystemID: 30000142,
      state: 110,
      upkeepState: 1,
      hasQuantumCore: true,
    };

    structureState.getStructureByID = () => structure;
    structureState.tickStructures = () => [];
    spaceRuntime.syncStructureSceneState = () => {};
    structureState.startStructureUnanchoring = (structureID) => {
      calls.push({ fn: "start", structureID });
      return { success: true, data: structure };
    };
    structureState.cancelStructureUnanchoring = (structureID) => {
      calls.push({ fn: "cancel", structureID });
      return { success: true, data: structure };
    };

    assert.strictEqual(
      executeStructureGmCommand(null, "unanchor 1030000000003").success,
      true,
    );
    assert.strictEqual(
      executeStructureGmCommand(null, "unanchor 1030000000003 cancel").success,
      true,
    );
    assert.deepStrictEqual(calls, [
      { fn: "start", structureID: 1030000000003 },
      { fn: "cancel", structureID: 1030000000003 },
    ]);
  });
});
