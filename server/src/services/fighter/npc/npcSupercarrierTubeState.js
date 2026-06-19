const path = require("path");

const {
  getCapitalControllerState,
  listControlledNpcFighters,
  toPositiveInt,
} = require(path.join(__dirname, "../../../space/npc/capitals/capitalNpcState"));

function buildTrackedTubeFlagSet(scene, controllerEntity, controller) {
  const state = getCapitalControllerState(controller);
  const tracked = new Set();
  if (scene && controllerEntity) {
    for (const fighterEntity of listControlledNpcFighters(scene, controllerEntity.itemID)) {
      const tubeFlagID = toPositiveInt(fighterEntity && fighterEntity.tubeFlagID, 0);
      if (tubeFlagID > 0) {
        tracked.add(tubeFlagID);
      }
    }
  } else if (state && Array.isArray(state.launchedTubeFlagIDs)) {
    for (const flagID of state.launchedTubeFlagIDs) {
      const normalizedFlagID = toPositiveInt(flagID, 0);
      if (normalizedFlagID > 0) {
        tracked.add(normalizedFlagID);
      }
    }
  }
  if (state) {
    // Keep only live tube occupancy so destroyed squadrons can be relaunched.
    state.launchedTubeFlagIDs = [...tracked];
  }
  return tracked;
}

function resetNpcSupercarrierTubeState(controller) {
  const state = getCapitalControllerState(controller);
  if (!state) {
    return null;
  }
  state.launchedTubeFlagIDs = [];
  state.nextFighterLaunchAtMs = 0;
  state.nextFighterAbilitySyncAtMs = 0;
  if (controller && typeof controller === "object") {
    controller.capitalNpcFighterWingLaunched = false;
  }
  return state;
}

module.exports = {
  buildTrackedTubeFlagSet,
  resetNpcSupercarrierTubeState,
};
