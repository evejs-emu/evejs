const path = require("path");

const {
  typeHasEffectName,
  isChargeCompatibleWithModule,
  selectAutoFitFlagForType,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));

const PROPULSION_EFFECT_AFTERBURNER = "moduleBonusAfterburner";
const PROPULSION_EFFECT_MICROWARPDRIVE = "moduleBonusMicrowarpdrive";
const NPC_ENABLE_FITTED_PROPULSION_MODULES = false;

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function getNpcCapabilityTypeID(moduleItemOrTypeID, fallback = 0) {
  if (moduleItemOrTypeID && typeof moduleItemOrTypeID === "object") {
    const explicitCapabilityTypeID = toPositiveInt(
      moduleItemOrTypeID.npcCapabilityTypeID,
      0,
    );
    if (explicitCapabilityTypeID > 0) {
      return explicitCapabilityTypeID;
    }
    return toPositiveInt(moduleItemOrTypeID.typeID, fallback);
  }

  return toPositiveInt(moduleItemOrTypeID, fallback);
}

function buildNpcEffectiveModuleItem(moduleItem) {
  if (!moduleItem || typeof moduleItem !== "object") {
    return moduleItem;
  }

  const actualTypeID = toPositiveInt(moduleItem.typeID, 0);
  const capabilityTypeID = getNpcCapabilityTypeID(moduleItem, 0);
  if (!actualTypeID || !capabilityTypeID || capabilityTypeID === actualTypeID) {
    return moduleItem;
  }

  return {
    ...moduleItem,
    typeID: capabilityTypeID,
  };
}

function isNpcChargeCompatibleWithModule(moduleItemOrTypeID, chargeTypeID) {
  const capabilityTypeID = getNpcCapabilityTypeID(moduleItemOrTypeID, 0);
  if (!capabilityTypeID) {
    return false;
  }
  return isChargeCompatibleWithModule(capabilityTypeID, chargeTypeID);
}

function selectAutoFitFlagForNpcModuleType(shipItem, fittedItems, moduleItemOrTypeID) {
  const capabilityTypeID = getNpcCapabilityTypeID(moduleItemOrTypeID, 0);
  if (!capabilityTypeID) {
    return null;
  }
  return selectAutoFitFlagForType(shipItem, fittedItems, capabilityTypeID);
}

function resolveNpcPropulsionEffectName(moduleItem) {
  const capabilityTypeID = getNpcCapabilityTypeID(moduleItem, 0);
  if (!capabilityTypeID) {
    return null;
  }
  if (typeHasEffectName(capabilityTypeID, PROPULSION_EFFECT_MICROWARPDRIVE)) {
    return PROPULSION_EFFECT_MICROWARPDRIVE;
  }
  if (typeHasEffectName(capabilityTypeID, PROPULSION_EFFECT_AFTERBURNER)) {
    return PROPULSION_EFFECT_AFTERBURNER;
  }
  return null;
}

module.exports = {
  PROPULSION_EFFECT_AFTERBURNER,
  PROPULSION_EFFECT_MICROWARPDRIVE,
  NPC_ENABLE_FITTED_PROPULSION_MODULES,
  getNpcCapabilityTypeID,
  buildNpcEffectiveModuleItem,
  isNpcChargeCompatibleWithModule,
  selectAutoFitFlagForNpcModuleType,
  resolveNpcPropulsionEffectName,
};
