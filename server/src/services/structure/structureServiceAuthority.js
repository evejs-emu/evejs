const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
} = require("./structureConstants");

const STRUCTURE_SETTING_ID = Object.freeze({
  NONE: 0,
  REPROCESSING_TAX: 3,
  MARKET_TAX: 4,
  DEFENSE_CAN_CONTROL_STRUCTURE: 17,
  HOUSING_CAN_DOCK: 19,
  CORP_RENT_OFFICE: 20,
  CLONINGBAY_TAX: 23,
  INDUSTRY_TAX: 24,
  REACTION_BIOCHEMICAL_TAX: 26,
  REACTION_HYBRID_TAX: 27,
  REACTION_COMPOSITE_TAX: 28,
  MANUFACTURING_TAX: 29,
  MANUFACTURING_CAPITAL_TAX: 30,
  MANUFACTURING_SUPERCAPITAL_TAX: 31,
  RESEARCH_TAX: 32,
  INVENTION_TAX: 33,
  JUMP_BRIDGE_ACTIVATION: 34,
  CYNO_BEACON: 35,
  AUTOMOONMINING: 36,
});

const STRUCTURE_SETTING_ACCESS_KIND = Object.freeze({
  ALWAYS: "always",
  DOCK_ACCESS: "dockAccess",
  OWNER_ACCESS: "ownerAccess",
  OWNER_OR_DOCK_ACCESS: "ownerOrDockAccess",
});

const STRUCTURE_SETTING_ACCESS_KIND_BY_ID = Object.freeze({
  [STRUCTURE_SETTING_ID.NONE]: STRUCTURE_SETTING_ACCESS_KIND.ALWAYS,
  [STRUCTURE_SETTING_ID.REPROCESSING_TAX]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.MARKET_TAX]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.DEFENSE_CAN_CONTROL_STRUCTURE]: STRUCTURE_SETTING_ACCESS_KIND.OWNER_ACCESS,
  [STRUCTURE_SETTING_ID.HOUSING_CAN_DOCK]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.CORP_RENT_OFFICE]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.CLONINGBAY_TAX]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.INDUSTRY_TAX]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.REACTION_BIOCHEMICAL_TAX]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.REACTION_HYBRID_TAX]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.REACTION_COMPOSITE_TAX]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.MANUFACTURING_TAX]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.MANUFACTURING_CAPITAL_TAX]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.MANUFACTURING_SUPERCAPITAL_TAX]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.RESEARCH_TAX]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.INVENTION_TAX]: STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.JUMP_BRIDGE_ACTIVATION]: STRUCTURE_SETTING_ACCESS_KIND.OWNER_OR_DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.CYNO_BEACON]: STRUCTURE_SETTING_ACCESS_KIND.OWNER_OR_DOCK_ACCESS,
  [STRUCTURE_SETTING_ID.AUTOMOONMINING]: STRUCTURE_SETTING_ACCESS_KIND.OWNER_ACCESS,
});

const MANUFACTURING_SERVICES = Object.freeze([
  STRUCTURE_SERVICE_ID.MANUFACTURING,
  STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC,
  STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL,
  STRUCTURE_SERVICE_ID.MANUFACTURING_SUPERCAPITAL,
]);

const LABORATORY_SERVICES = Object.freeze([
  STRUCTURE_SERVICE_ID.LABORATORY,
  STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME,
  STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL,
  STRUCTURE_SERVICE_ID.LABORATORY_COPYING,
  STRUCTURE_SERVICE_ID.LABORATORY_INVENTION,
]);

const REACTION_SERVICES = Object.freeze([
  STRUCTURE_SERVICE_ID.REACTIONS,
  STRUCTURE_SERVICE_ID.REACTIONS_COMPOSITE,
  STRUCTURE_SERVICE_ID.REACTIONS_BIOCHEMICAL,
  STRUCTURE_SERVICE_ID.REACTIONS_HYBRID,
]);

const INDUSTRY_SERVICES = Object.freeze([
  STRUCTURE_SERVICE_ID.INDUSTRY,
  ...MANUFACTURING_SERVICES,
  ...LABORATORY_SERVICES,
  ...REACTION_SERVICES,
]);

const META_SERVICES = Object.freeze([
  STRUCTURE_SERVICE_ID.INDUSTRY,
  STRUCTURE_SERVICE_ID.MANUFACTURING,
  STRUCTURE_SERVICE_ID.LABORATORY,
  STRUCTURE_SERVICE_ID.REACTIONS,
]);

const ONLINE_SERVICES_UNRESTRICTED_ACCESS = Object.freeze([
  STRUCTURE_SERVICE_ID.FITTING,
  STRUCTURE_SERVICE_ID.DOCKING,
]);

const ONLINE_SERVICES = Object.freeze([
  ...ONLINE_SERVICES_UNRESTRICTED_ACCESS,
  STRUCTURE_SERVICE_ID.REPAIR,
  STRUCTURE_SERVICE_ID.INSURANCE,
  STRUCTURE_SERVICE_ID.OFFICES,
]);

const STRUCTURES_WITHOUT_ONLINE_SERVICES = Object.freeze([
  35841, // typeUpwellSmallStargate
  37534, // typeUpwellCynosuralSystemJammer
  35840, // typeUpwellCynosuralBeacon
  81826, // typeUpwellAutoMoonMiner
]);

const SERVICES_THAT_OFFLINE_IF_STRUCTURE_TOO_CLOSE = Object.freeze([
  STRUCTURE_SERVICE_ID.JUMP_BRIDGE,
  STRUCTURE_SERVICE_ID.CYNO_JAMMER,
]);

const SERVICE_ACCESS_SETTING_BY_ID = Object.freeze({
  [STRUCTURE_SERVICE_ID.FITTING]: STRUCTURE_SETTING_ID.HOUSING_CAN_DOCK,
  [STRUCTURE_SERVICE_ID.DOCKING]: STRUCTURE_SETTING_ID.HOUSING_CAN_DOCK,
  [STRUCTURE_SERVICE_ID.OFFICES]: STRUCTURE_SETTING_ID.CORP_RENT_OFFICE,
  [STRUCTURE_SERVICE_ID.REPROCESSING]: STRUCTURE_SETTING_ID.REPROCESSING_TAX,
  [STRUCTURE_SERVICE_ID.MARKET]: STRUCTURE_SETTING_ID.MARKET_TAX,
  [STRUCTURE_SERVICE_ID.MEDICAL]: STRUCTURE_SETTING_ID.CLONINGBAY_TAX,
  [STRUCTURE_SERVICE_ID.INDUSTRY]: STRUCTURE_SETTING_ID.NONE,
  [STRUCTURE_SERVICE_ID.INSURANCE]: STRUCTURE_SETTING_ID.HOUSING_CAN_DOCK,
  [STRUCTURE_SERVICE_ID.REPAIR]: STRUCTURE_SETTING_ID.HOUSING_CAN_DOCK,
  [STRUCTURE_SERVICE_ID.MOON_MINING]: STRUCTURE_SETTING_ID.DEFENSE_CAN_CONTROL_STRUCTURE,
  [STRUCTURE_SERVICE_ID.JUMP_BRIDGE]: STRUCTURE_SETTING_ID.JUMP_BRIDGE_ACTIVATION,
  [STRUCTURE_SERVICE_ID.CYNO_BEACON]: STRUCTURE_SETTING_ID.CYNO_BEACON,
  [STRUCTURE_SERVICE_ID.MANUFACTURING]: STRUCTURE_SETTING_ID.NONE,
  [STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC]: STRUCTURE_SETTING_ID.MANUFACTURING_TAX,
  [STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL]: STRUCTURE_SETTING_ID.MANUFACTURING_CAPITAL_TAX,
  [STRUCTURE_SERVICE_ID.MANUFACTURING_SUPERCAPITAL]: STRUCTURE_SETTING_ID.MANUFACTURING_SUPERCAPITAL_TAX,
  [STRUCTURE_SERVICE_ID.LABORATORY]: STRUCTURE_SETTING_ID.NONE,
  [STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME]: STRUCTURE_SETTING_ID.RESEARCH_TAX,
  [STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL]: STRUCTURE_SETTING_ID.RESEARCH_TAX,
  [STRUCTURE_SERVICE_ID.LABORATORY_COPYING]: STRUCTURE_SETTING_ID.RESEARCH_TAX,
  [STRUCTURE_SERVICE_ID.LABORATORY_INVENTION]: STRUCTURE_SETTING_ID.INVENTION_TAX,
  [STRUCTURE_SERVICE_ID.REACTIONS]: STRUCTURE_SETTING_ID.NONE,
  [STRUCTURE_SERVICE_ID.REACTIONS_COMPOSITE]: STRUCTURE_SETTING_ID.REACTION_COMPOSITE_TAX,
  [STRUCTURE_SERVICE_ID.REACTIONS_BIOCHEMICAL]: STRUCTURE_SETTING_ID.REACTION_BIOCHEMICAL_TAX,
  [STRUCTURE_SERVICE_ID.REACTIONS_HYBRID]: STRUCTURE_SETTING_ID.REACTION_HYBRID_TAX,
  [STRUCTURE_SERVICE_ID.LOYALTY_STORE]: STRUCTURE_SETTING_ID.HOUSING_CAN_DOCK,
  [STRUCTURE_SERVICE_ID.AUTOMOONMINING]: STRUCTURE_SETTING_ID.AUTOMOONMINING,
});

function buildServicesFromAccessSettings() {
  const bySettingID = {};
  for (const [serviceID, settingID] of Object.entries(SERVICE_ACCESS_SETTING_BY_ID)) {
    const key = String(settingID);
    if (!bySettingID[key]) {
      bySettingID[key] = [];
    }
    bySettingID[key].push(Number(serviceID));
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(bySettingID).map(([settingID, serviceIDs]) => [
        settingID,
        Object.freeze([...serviceIDs].sort((left, right) => left - right)),
      ]),
    ),
  );
}

const SERVICES_FROM_ACCESS_SETTINGS = buildServicesFromAccessSettings();

const SERVICE_IDS_BY_MODULE_TYPE_ID = Object.freeze({
  35892: Object.freeze([STRUCTURE_SERVICE_ID.MARKET]),
  35894: Object.freeze([STRUCTURE_SERVICE_ID.MEDICAL]),
  35899: Object.freeze([STRUCTURE_SERVICE_ID.REPROCESSING]),
  35891: Object.freeze([
    STRUCTURE_SERVICE_ID.LABORATORY_COPYING,
    STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL,
    STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME,
  ]),
  35886: Object.freeze([STRUCTURE_SERVICE_ID.LABORATORY_INVENTION]),
  35878: Object.freeze([STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC]),
  35881: Object.freeze([STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL]),
  35877: Object.freeze([
    STRUCTURE_SERVICE_ID.MANUFACTURING_SUPERCAPITAL,
    STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL,
  ]),
  45550: Object.freeze([
    STRUCTURE_SERVICE_ID.LABORATORY_COPYING,
    STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL,
    STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME,
  ]),
  45538: Object.freeze([STRUCTURE_SERVICE_ID.REACTIONS_HYBRID]),
  45537: Object.freeze([STRUCTURE_SERVICE_ID.REACTIONS_COMPOSITE]),
  45539: Object.freeze([STRUCTURE_SERVICE_ID.REACTIONS_BIOCHEMICAL]),
  45009: Object.freeze([STRUCTURE_SERVICE_ID.MOON_MINING]),
  35913: Object.freeze([STRUCTURE_SERVICE_ID.JUMP_BRIDGE]),
  35912: Object.freeze([STRUCTURE_SERVICE_ID.CYNO_BEACON]),
  35914: Object.freeze([STRUCTURE_SERVICE_ID.CYNO_JAMMER]),
  78330: Object.freeze([STRUCTURE_SERVICE_ID.LOYALTY_STORE]),
  82941: Object.freeze([STRUCTURE_SERVICE_ID.AUTOMOONMINING]),
});

const MANAGED_SERVICE_IDS = Object.freeze([
  ...new Set(Object.values(SERVICE_IDS_BY_MODULE_TYPE_ID).flat()),
]);

const SUPERCAPITAL_MANUFACTURING_GROUP_IDS = Object.freeze([
  659, // groupSupercarrier
  30, // groupTitan
]);

const CAPITAL_MANUFACTURING_GROUP_IDS = Object.freeze([
  1538, // groupForceAux
  547, // groupCarrier
  485, // groupDreadnought
  883, // groupCapitalIndustrialShip
  4594, // groupLancerDreadnought
]);

const COMPOSITE_REACTION_GROUP_IDS = Object.freeze([
  428, // groupIntermediateMaterials
  429, // groupComposite
  4932, // groupUnrefinedMinerals
]);

const BIOCHEMICAL_REACTION_GROUP_IDS = Object.freeze([
  712, // groupBiochemicalMaterial
  4096, // groupMolecularForgedMaterials
]);

const HYBRID_REACTION_GROUP_IDS = Object.freeze([
  974, // groupHybridPolymers
]);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function asNumberSet(values) {
  return new Set((Array.isArray(values) ? values : []).map((value) => toPositiveInt(value, 0)).filter(Boolean));
}

const MANUFACTURING_SERVICE_SET = asNumberSet(MANUFACTURING_SERVICES);
const LABORATORY_SERVICE_SET = asNumberSet(LABORATORY_SERVICES);
const REACTION_SERVICE_SET = asNumberSet(REACTION_SERVICES);
const INDUSTRY_SERVICE_SET = asNumberSet(INDUSTRY_SERVICES);
const META_SERVICE_SET = asNumberSet(META_SERVICES);
const ONLINE_SERVICE_UNRESTRICTED_ACCESS_SET = asNumberSet(ONLINE_SERVICES_UNRESTRICTED_ACCESS);
const STRUCTURES_WITHOUT_ONLINE_SERVICES_SET = asNumberSet(STRUCTURES_WITHOUT_ONLINE_SERVICES);
const SERVICES_THAT_OFFLINE_IF_STRUCTURE_TOO_CLOSE_SET = asNumberSet(SERVICES_THAT_OFFLINE_IF_STRUCTURE_TOO_CLOSE);
const SUPERCAPITAL_MANUFACTURING_GROUP_SET = asNumberSet(SUPERCAPITAL_MANUFACTURING_GROUP_IDS);
const CAPITAL_MANUFACTURING_GROUP_SET = asNumberSet(CAPITAL_MANUFACTURING_GROUP_IDS);
const COMPOSITE_REACTION_GROUP_SET = asNumberSet(COMPOSITE_REACTION_GROUP_IDS);
const BIOCHEMICAL_REACTION_GROUP_SET = asNumberSet(BIOCHEMICAL_REACTION_GROUP_IDS);
const HYBRID_REACTION_GROUP_SET = asNumberSet(HYBRID_REACTION_GROUP_IDS);

function getStructureServiceIDsForModuleType(typeID) {
  return [...(SERVICE_IDS_BY_MODULE_TYPE_ID[toPositiveInt(typeID, 0)] || [])];
}

function isStructureServiceModuleType(typeID) {
  return getStructureServiceIDsForModuleType(typeID).length > 0;
}

function getStructureServiceAccessSettingID(serviceID) {
  return toInt(
    SERVICE_ACCESS_SETTING_BY_ID[toPositiveInt(serviceID, 0)],
    STRUCTURE_SETTING_ID.NONE,
  );
}

function getStructureSettingAccessKind(settingID) {
  return (
    STRUCTURE_SETTING_ACCESS_KIND_BY_ID[toInt(settingID, 0)] ||
    STRUCTURE_SETTING_ACCESS_KIND.DOCK_ACCESS
  );
}

function isOnlineServiceUnrestrictedAccess(serviceID) {
  return ONLINE_SERVICE_UNRESTRICTED_ACCESS_SET.has(toPositiveInt(serviceID, 0));
}

function isMetaStructureService(serviceID) {
  return META_SERVICE_SET.has(toPositiveInt(serviceID, 0));
}

function isManufacturingStructureService(serviceID) {
  return MANUFACTURING_SERVICE_SET.has(toPositiveInt(serviceID, 0));
}

function isLaboratoryStructureService(serviceID) {
  return LABORATORY_SERVICE_SET.has(toPositiveInt(serviceID, 0));
}

function isReactionStructureService(serviceID) {
  return REACTION_SERVICE_SET.has(toPositiveInt(serviceID, 0));
}

function isIndustryStructureService(serviceID) {
  return INDUSTRY_SERVICE_SET.has(toPositiveInt(serviceID, 0));
}

function structureTypeHasOnlineServices(typeID) {
  return !STRUCTURES_WITHOUT_ONLINE_SERVICES_SET.has(toPositiveInt(typeID, 0));
}

function serviceOfflinesIfStructureTooClose(serviceID) {
  return SERVICES_THAT_OFFLINE_IF_STRUCTURE_TOO_CLOSE_SET.has(toPositiveInt(serviceID, 0));
}

function getActivityIDForStructureService(serviceID, industryActivity = {}) {
  const normalizedServiceID = toPositiveInt(serviceID, 0);
  if (isManufacturingStructureService(normalizedServiceID)) {
    return toPositiveInt(industryActivity.MANUFACTURING, 1);
  }
  if (isReactionStructureService(normalizedServiceID)) {
    return toPositiveInt(industryActivity.REACTION, 9);
  }
  if (normalizedServiceID === STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL) {
    return toPositiveInt(industryActivity.RESEARCH_MATERIAL, 4);
  }
  if (normalizedServiceID === STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME) {
    return toPositiveInt(industryActivity.RESEARCH_TIME, 3);
  }
  if (normalizedServiceID === STRUCTURE_SERVICE_ID.LABORATORY_COPYING) {
    return toPositiveInt(industryActivity.COPYING, 5);
  }
  if (normalizedServiceID === STRUCTURE_SERVICE_ID.LABORATORY_INVENTION) {
    return toPositiveInt(industryActivity.INVENTION, 8);
  }
  return null;
}

function getIndustryActivityServiceIDs(activityID, industryActivity = {}) {
  const normalizedActivityID = toPositiveInt(activityID, 0);
  const manufacturingActivityID = toPositiveInt(industryActivity.MANUFACTURING, 1);
  const researchTimeActivityID = toPositiveInt(industryActivity.RESEARCH_TIME, 3);
  const researchMaterialActivityID = toPositiveInt(industryActivity.RESEARCH_MATERIAL, 4);
  const copyingActivityID = toPositiveInt(industryActivity.COPYING, 5);
  const inventionActivityID = toPositiveInt(industryActivity.INVENTION, 8);
  const reactionActivityID = toPositiveInt(industryActivity.REACTION, 9);

  if (normalizedActivityID === manufacturingActivityID) {
    return [...MANUFACTURING_SERVICES];
  }
  if (normalizedActivityID === researchTimeActivityID) {
    return [
      STRUCTURE_SERVICE_ID.LABORATORY,
      STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME,
    ];
  }
  if (normalizedActivityID === researchMaterialActivityID) {
    return [
      STRUCTURE_SERVICE_ID.LABORATORY,
      STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL,
    ];
  }
  if (normalizedActivityID === copyingActivityID) {
    return [
      STRUCTURE_SERVICE_ID.LABORATORY,
      STRUCTURE_SERVICE_ID.LABORATORY_COPYING,
    ];
  }
  if (normalizedActivityID === inventionActivityID) {
    return [
      STRUCTURE_SERVICE_ID.LABORATORY,
      STRUCTURE_SERVICE_ID.LABORATORY_INVENTION,
    ];
  }
  if (normalizedActivityID === reactionActivityID) {
    return [...REACTION_SERVICES];
  }
  return [];
}

function getIndustryServiceID(activityID, productGroupID, industryActivity = {}) {
  const normalizedActivityID = toPositiveInt(activityID, 0);
  const normalizedGroupID = toPositiveInt(productGroupID, 0);
  const manufacturingActivityID = toPositiveInt(industryActivity.MANUFACTURING, 1);
  const researchTimeActivityID = toPositiveInt(industryActivity.RESEARCH_TIME, 3);
  const researchMaterialActivityID = toPositiveInt(industryActivity.RESEARCH_MATERIAL, 4);
  const copyingActivityID = toPositiveInt(industryActivity.COPYING, 5);
  const inventionActivityID = toPositiveInt(industryActivity.INVENTION, 8);
  const reactionActivityID = toPositiveInt(industryActivity.REACTION, 9);

  if (normalizedActivityID === manufacturingActivityID) {
    if (SUPERCAPITAL_MANUFACTURING_GROUP_SET.has(normalizedGroupID)) {
      return STRUCTURE_SERVICE_ID.MANUFACTURING_SUPERCAPITAL;
    }
    if (CAPITAL_MANUFACTURING_GROUP_SET.has(normalizedGroupID)) {
      return STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL;
    }
    return STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC;
  }
  if (normalizedActivityID === reactionActivityID) {
    if (BIOCHEMICAL_REACTION_GROUP_SET.has(normalizedGroupID)) {
      return STRUCTURE_SERVICE_ID.REACTIONS_BIOCHEMICAL;
    }
    if (HYBRID_REACTION_GROUP_SET.has(normalizedGroupID)) {
      return STRUCTURE_SERVICE_ID.REACTIONS_HYBRID;
    }
    if (COMPOSITE_REACTION_GROUP_SET.has(normalizedGroupID)) {
      return STRUCTURE_SERVICE_ID.REACTIONS_COMPOSITE;
    }
    return STRUCTURE_SERVICE_ID.REACTIONS;
  }
  if (normalizedActivityID === researchMaterialActivityID) {
    return STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL;
  }
  if (normalizedActivityID === researchTimeActivityID) {
    return STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME;
  }
  if (normalizedActivityID === copyingActivityID) {
    return STRUCTURE_SERVICE_ID.LABORATORY_COPYING;
  }
  if (normalizedActivityID === inventionActivityID) {
    return STRUCTURE_SERVICE_ID.LABORATORY_INVENTION;
  }
  return null;
}

function structureHasOnlineService(structure, serviceID) {
  const normalizedServiceID = toPositiveInt(serviceID, 0);
  if (!structure || normalizedServiceID <= 0) {
    return false;
  }
  const stateID = toInt(
    structure.serviceStates && structure.serviceStates[String(normalizedServiceID)],
    STRUCTURE_SERVICE_STATE.OFFLINE,
  );
  return stateID === STRUCTURE_SERVICE_STATE.ONLINE;
}

module.exports = {
  BIOCHEMICAL_REACTION_GROUP_IDS,
  CAPITAL_MANUFACTURING_GROUP_IDS,
  COMPOSITE_REACTION_GROUP_IDS,
  HYBRID_REACTION_GROUP_IDS,
  INDUSTRY_SERVICES,
  LABORATORY_SERVICES,
  MANAGED_SERVICE_IDS,
  MANUFACTURING_SERVICES,
  META_SERVICES,
  ONLINE_SERVICES,
  ONLINE_SERVICES_UNRESTRICTED_ACCESS,
  REACTION_SERVICES,
  SERVICE_ACCESS_SETTING_BY_ID,
  SERVICE_IDS_BY_MODULE_TYPE_ID,
  SERVICES_FROM_ACCESS_SETTINGS,
  SERVICES_THAT_OFFLINE_IF_STRUCTURE_TOO_CLOSE,
  STRUCTURES_WITHOUT_ONLINE_SERVICES,
  STRUCTURE_SETTING_ACCESS_KIND,
  STRUCTURE_SETTING_ACCESS_KIND_BY_ID,
  STRUCTURE_SETTING_ID,
  SUPERCAPITAL_MANUFACTURING_GROUP_IDS,
  getActivityIDForStructureService,
  getIndustryActivityServiceIDs,
  getIndustryServiceID,
  getStructureServiceAccessSettingID,
  getStructureServiceIDsForModuleType,
  getStructureSettingAccessKind,
  isIndustryStructureService,
  isLaboratoryStructureService,
  isManufacturingStructureService,
  isMetaStructureService,
  isOnlineServiceUnrestrictedAccess,
  isReactionStructureService,
  isStructureServiceModuleType,
  serviceOfflinesIfStructureTooClose,
  structureHasOnlineService,
  structureTypeHasOnlineServices,
};
