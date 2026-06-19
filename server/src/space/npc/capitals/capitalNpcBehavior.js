const path = require("path");

const {
  getCapitalControllerState,
  listControlledNpcFighters,
  toFiniteNumber,
  toPositiveInt,
} = require("./capitalNpcState");
const {
  launchNpcFighterWing,
  syncNpcSupercarrierSystems,
} = require(path.join(
  __dirname,
  "../../../services/fighter/npc/npcSupercarrierDirector",
));
const {
  syncNpcTitanSuperweapon,
} = require(path.join(
  __dirname,
  "../../../services/superweapons/npc/npcTitanSuperweaponRuntime",
));

function syncCapitalNpcSystems(scene, entity, controller, behaviorProfile, targetEntity, options = {}) {
  if (!scene || !entity || !controller || !behaviorProfile) {
    return false;
  }

  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  let changed = false;

  if (Array.isArray(behaviorProfile.capitalFighterWingTypeIDs)) {
    changed = syncNpcSupercarrierSystems(
      scene,
      entity,
      controller,
      behaviorProfile,
      targetEntity,
      { nowMs },
    ) || changed;
  }

  if (targetEntity && toPositiveInt(behaviorProfile.capitalSuperweaponModuleTypeID, 0) > 0) {
    changed = syncNpcTitanSuperweapon(
      scene,
      entity,
      controller,
      behaviorProfile,
      targetEntity,
      { nowMs },
    ) || changed;
  }

  return changed;
}

module.exports = {
  syncCapitalNpcSystems,
  __testing: {
    getCapitalControllerState,
    launchNpcFighterWing,
    listControlledNpcFighters,
    syncNpcCapitalSuperweapon: syncNpcTitanSuperweapon,
  },
};
