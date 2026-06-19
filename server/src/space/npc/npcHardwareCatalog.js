const path = require("path");

const {
  getAttributeIDByNames,
  getTypeAttributeMap,
  typeHasEffectName,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../../services/_shared/referenceData"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
const {
  getNpcCapabilityTypeID,
  isNpcChargeCompatibleWithModule,
  resolveNpcPropulsionEffectName,
} = require(path.join(__dirname, "./npcCapabilityResolver"));

const CONCORD_STANDARD_CRYSTAL_TYPE_IDS = Object.freeze({
  multifrequencyS: 246,
  multifrequencyM: 254,
  multifrequencyXL: 17686,
});
const PRECURSOR_WEAPON_GROUP_ID = 1986;
const EXOTIC_PLASMA_CHARGE_GROUP_ID = 1987;
const ADVANCED_EXOTIC_PLASMA_CHARGE_GROUP_ID = 1989;
const MODULE_WARP_SCRAMBLER_II = 448;
const MODULE_STASIS_WEBIFIER_II = 527;
const MODULE_SMALL_ENERGY_NEUTRALIZER_II = 13003;
const MODULE_MEDIUM_ENERGY_NEUTRALIZER_II = 12267;
const MODULE_HEAVY_ENERGY_NEUTRALIZER_II = 12271;
const MODULE_SMALL_ENERGY_NOSFERATU_II = 13001;
const MODULE_MEDIUM_ENERGY_NOSFERATU_II = 12259;
const MODULE_HEAVY_ENERGY_NOSFERATU_II = 12263;

function buildPublishedTypeIDsForGroups(groupIDs = []) {
  const allowedGroups = new Set(
    (Array.isArray(groupIDs) ? groupIDs : [groupIDs])
      .map((value) => toPositiveInt(value, 0))
      .filter((value) => value > 0),
  );
  if (allowedGroups.size <= 0) {
    return Object.freeze([]);
  }
  const rows = readStaticRows(TABLE.ITEM_TYPES);
  if (!Array.isArray(rows) || rows.length <= 0) {
    return Object.freeze([]);
  }
  return Object.freeze(
    rows
      .filter((row) => (
        allowedGroups.has(toPositiveInt(row && row.groupID, 0)) &&
        row &&
        row.published !== false
      ))
      .map((row) => toPositiveInt(row && row.typeID, 0))
      .filter((value) => value > 0),
  );
}

const TRIG_PRECURSOR_WEAPON_TYPE_IDS = buildPublishedTypeIDsForGroups(
  PRECURSOR_WEAPON_GROUP_ID,
);
const TRIG_PRECURSOR_CHARGE_TYPE_IDS = buildPublishedTypeIDsForGroups([
  EXOTIC_PLASMA_CHARGE_GROUP_ID,
  ADVANCED_EXOTIC_PLASMA_CHARGE_GROUP_ID,
]);

const NPC_HARDWARE_CATALOG = Object.freeze({
  bloodRaiders: Object.freeze({
    weaponTypeIDs: Object.freeze([
      13803,
      13811,
      13801,
      13807,
      13815,
      13809,
      13799,
      13805,
      13813,
      13817,
      13819,
      14421,
      14423,
      14425,
      14427,
      14437,
      14439,
      14441,
      14443,
      14453,
      14455,
      41103,
      41118,
      24550,
    ]),
    chargeTypeIDs: Object.freeze([
      21270,
      21286,
      21302,
      17680,
      17686,
    ]),
    utilityTypeIDs: Object.freeze([
      527,
      448,
      3244,
      13003,
      12267,
      12271,
      12263,
    ]),
  }),
  sanshasNation: Object.freeze({
    weaponTypeIDs: Object.freeze([
      13826,
      13830,
      13825,
      13828,
      13832,
      13829,
      13824,
      13827,
      13831,
      13833,
      13834,
      14417,
      14419,
      14429,
      14431,
      14433,
      14435,
      14445,
      14447,
      14449,
      14451,
      41104,
      41119,
    ]),
    chargeTypeIDs: Object.freeze([
      20863,
      20879,
      20895,
      17680,
      17686,
    ]),
    utilityTypeIDs: Object.freeze([
      527,
      448,
      3244,
    ]),
  }),
  serpentis: Object.freeze({
    weaponTypeIDs: Object.freeze([
      13888,
      13884,
      13892,
      13891,
      13894,
      13872,
      13874,
      13878,
      14383,
      14385,
      14389,
      14399,
      14401,
      41130,
      41142,
      24554,
    ]),
    chargeTypeIDs: Object.freeze([
      20040,
      20057,
      20927,
      17648,
      41328,
    ]),
    utilityTypeIDs: Object.freeze([
      527,
      448,
      3244,
    ]),
  }),
  angelCartel: Object.freeze({
    weaponTypeIDs: Object.freeze([
      13773,
      13776,
      13777,
      13778,
      13782,
      13786,
      13788,
      13779,
      13781,
      13783,
      13784,
      13785,
      13774,
      13775,
      14459,
      14461,
      14465,
      14467,
      14471,
      14475,
      41083,
      41160,
      23674,
    ]),
    chargeTypeIDs: Object.freeze([
      20767,
      20783,
      20799,
      17670,
      17678,
    ]),
    utilityTypeIDs: Object.freeze([
      527,
      448,
      3244,
      19806,
    ]),
  }),
  guristasLaunchers: Object.freeze({
    weaponTypeIDs: Object.freeze([
      13920,
      13922,
      13924,
      13926,
      13929,
      13865,
      13867,
      13873,
      13876,
      13879,
      14391,
      14395,
      14401,
      14403,
      14672,
      14674,
      14676,
      14678,
      14680,
      14681,
      14682,
      14683,
      41174,
      41182,
      24552,
    ]),
    chargeTypeIDs: Object.freeze([
      27347,
      27365,
      27399,
      27443,
      21398,
      21414,
      21430,
      17857,
      32442,
    ]),
    utilityTypeIDs: Object.freeze([
      3244,
      19806,
      2567,
      20199,
      20201,
      20203,
      20205,
      20207,
    ]),
  }),
  rogueDrones: Object.freeze({
    weaponTypeIDs: Object.freeze([]),
    chargeTypeIDs: Object.freeze([]),
  }),
  concord: Object.freeze({
    weaponTypeIDs: Object.freeze([
      16128,
      16129,
      16131,
      3559,
      3561,
    ]),
    tackleTypeIDs: Object.freeze([
      16140,
    ]),
    // Local static data does not expose dedicated CONCORD laser-crystal rows.
    // Standard Multifrequency remains the parity-safe authored ammo until CCP
    // data gives us real CONCORD charge types.
    chargeTypeIDs: Object.freeze([
      CONCORD_STANDARD_CRYSTAL_TYPE_IDS.multifrequencyS,
      CONCORD_STANDARD_CRYSTAL_TYPE_IDS.multifrequencyM,
      CONCORD_STANDARD_CRYSTAL_TYPE_IDS.multifrequencyXL,
    ]),
  }),
  triglavian: Object.freeze({
    weaponTypeIDs: TRIG_PRECURSOR_WEAPON_TYPE_IDS,
    chargeTypeIDs: TRIG_PRECURSOR_CHARGE_TYPE_IDS,
    tackleTypeIDs: Object.freeze([
      MODULE_WARP_SCRAMBLER_II,
    ]),
    utilityTypeIDs: Object.freeze([
      MODULE_STASIS_WEBIFIER_II,
      MODULE_SMALL_ENERGY_NEUTRALIZER_II,
      MODULE_MEDIUM_ENERGY_NEUTRALIZER_II,
      MODULE_HEAVY_ENERGY_NEUTRALIZER_II,
      MODULE_SMALL_ENERGY_NOSFERATU_II,
      MODULE_MEDIUM_ENERGY_NOSFERATU_II,
      MODULE_HEAVY_ENERGY_NOSFERATU_II,
    ]),
  }),
});

const NPC_SYNTHETIC_CHASE_PROPULSION_BY_TIER = Object.freeze({
  small: Object.freeze({
    effectName: "moduleBonusMicrowarpdrive",
    guid: "effects.MicroWarpDrive",
    speedFactor: 505,
    speedBoostFactor: 1_500_000,
    massAddition: 500_000,
    signatureRadiusBonus: 500,
  }),
  medium: Object.freeze({
    effectName: "moduleBonusMicrowarpdrive",
    guid: "effects.MicroWarpDrive",
    speedFactor: 505,
    speedBoostFactor: 15_000_000,
    massAddition: 5_000_000,
    signatureRadiusBonus: 500,
  }),
  large: Object.freeze({
    effectName: "moduleBonusMicrowarpdrive",
    guid: "effects.MicroWarpDrive",
    speedFactor: 505,
    speedBoostFactor: 150_000_000,
    massAddition: 50_000_000,
    signatureRadiusBonus: 500,
  }),
});

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeHardwareFamilyName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildAllowedTypeIDSet(entries = {}) {
  const values = Array.isArray(entries)
    ? entries
    : Object.values(entries);
  return new Set(
    values
      .map((value) => toPositiveInt(value, 0))
      .filter((value) => value > 0),
  );
}

const NPC_HARDWARE_POLICY_BY_FAMILY = Object.freeze(
  Object.fromEntries(
    Object.entries(NPC_HARDWARE_CATALOG).map(([familyName, entry]) => [
      normalizeHardwareFamilyName(familyName),
      Object.freeze({
        weaponTypeIDs: buildAllowedTypeIDSet(entry.weaponTypeIDs),
        chargeTypeIDs: buildAllowedTypeIDSet(entry.chargeTypeIDs),
        tackleTypeIDs: buildAllowedTypeIDSet(entry.tackleTypeIDs),
        utilityTypeIDs: buildAllowedTypeIDSet(entry.utilityTypeIDs),
      }),
    ]),
  ),
);
const ATTRIBUTE_ENTITY_MISSILE_TYPE_ID =
  getAttributeIDByNames("entityMissileTypeID") || 507;
const HARDWARE_FAMILY_CONCORD = normalizeHardwareFamilyName("concord");
const HARDWARE_FAMILY_MINING_OPS = normalizeHardwareFamilyName("miningOps");
const HARDWARE_FAMILY_ENTITY_MISSILE_NPC = normalizeHardwareFamilyName("entityMissileNpc");
const HARDWARE_FAMILY_DRIFTER_HARNESS = normalizeHardwareFamilyName("drifterHarness");
const GROUP_WARP_SCRAMBLER = 52;
const GROUP_STASIS_WEB = 65;
const GROUP_ENERGY_NOSFERATU = 68;
const GROUP_ENERGY_NEUTRALIZER = 71;
const GROUP_ECM = 201;
const GROUP_TARGET_PAINTER = 379;

const NPC_FACTION_HARDWARE_FAMILY = Object.freeze({
  500010: normalizeHardwareFamilyName("guristasLaunchers"),
  500011: normalizeHardwareFamilyName("angelCartel"),
  500012: normalizeHardwareFamilyName("bloodRaiders"),
  500019: normalizeHardwareFamilyName("sanshasNation"),
  500020: normalizeHardwareFamilyName("serpentis"),
});

function hasEntityMissileLaunchCapability(definition) {
  const profile = definition && definition.profile && typeof definition.profile === "object"
    ? definition.profile
    : {};
  const shipTypeID = toPositiveInt(profile.shipTypeID, 0);
  if (
    shipTypeID <= 0 ||
    !typeHasEffectName(shipTypeID, "missileLaunchingForEntity")
  ) {
    return false;
  }

  const attributes = getTypeAttributeMap(shipTypeID);
  return toPositiveInt(
    attributes && attributes[ATTRIBUTE_ENTITY_MISSILE_TYPE_ID],
    0,
  ) > 0;
}

function resolveNpcHardwareFamily(definition) {
  const profile = definition && definition.profile && typeof definition.profile === "object"
    ? definition.profile
    : {};
  const explicitHardwareFamily = normalizeHardwareFamilyName(profile.hardwareFamily);
  if (explicitHardwareFamily) {
    return explicitHardwareFamily;
  }
  const entityType = normalizeHardwareFamilyName(profile.entityType);
  const miningRole = normalizeHardwareFamilyName(
    profile.miningRole ||
    profile.role,
  );
  if (entityType === "concord") {
    return HARDWARE_FAMILY_CONCORD;
  }
  if (
    miningRole === "miner" ||
    miningRole === "hauler"
  ) {
    return HARDWARE_FAMILY_MINING_OPS;
  }
  if (entityType === "npc" && hasEntityMissileLaunchCapability(definition)) {
    return HARDWARE_FAMILY_ENTITY_MISSILE_NPC;
  }
  if (
    entityType === "npc" &&
    toPositiveInt(profile.factionID, 0) === 500014
  ) {
    return HARDWARE_FAMILY_MINING_OPS;
  }
  if (entityType === "npc") {
    return (
      NPC_FACTION_HARDWARE_FAMILY[toPositiveInt(profile.factionID, 0)] ||
      null
    );
  }
  return null;
}

function resolveSyntheticChasePropulsionTemplate(behaviorProfile) {
  const tier = normalizeHardwareFamilyName(
    behaviorProfile && behaviorProfile.syntheticChasePropulsionTier,
  );
  return NPC_SYNTHETIC_CHASE_PROPULSION_BY_TIER[tier] || null;
}

function resolveModuleRole(moduleEntry, chargeTypeIDs = []) {
  const explicitRole = normalizeHardwareFamilyName(moduleEntry && moduleEntry.moduleRole);
  if (
    explicitRole === "weapon" ||
    explicitRole === "tackle" ||
    explicitRole === "propulsion" ||
    explicitRole === "hostileutility"
  ) {
    return explicitRole;
  }
  const moduleItem = {
    typeID: toPositiveInt(moduleEntry && moduleEntry.typeID, 0),
    npcCapabilityTypeID: toPositiveInt(moduleEntry && moduleEntry.npcCapabilityTypeID, 0),
  };
  const actualType = resolveItemByTypeID(moduleItem.typeID);
  const actualGroupID = toPositiveInt(actualType && actualType.groupID, 0);
  const capabilityTypeID = getNpcCapabilityTypeID(moduleItem, 0);
  if (!capabilityTypeID) {
    return "other";
  }
  if (resolveNpcPropulsionEffectName(moduleItem)) {
    return "propulsion";
  }
  if (actualGroupID === GROUP_WARP_SCRAMBLER || typeHasEffectName(capabilityTypeID, "warpDisrupt")) {
    return "tackle";
  }
  if (
    actualGroupID === GROUP_STASIS_WEB ||
    actualGroupID === GROUP_ECM ||
    actualGroupID === GROUP_TARGET_PAINTER ||
    actualGroupID === GROUP_ENERGY_NOSFERATU ||
    actualGroupID === GROUP_ENERGY_NEUTRALIZER
  ) {
    return "hostileutility";
  }
  const isWeaponLike =
    typeHasEffectName(capabilityTypeID, "targetAttack") ||
    typeHasEffectName(capabilityTypeID, "turretFitted") ||
    typeHasEffectName(capabilityTypeID, "launcherFitted");
  if (!isWeaponLike) {
    return "other";
  }
  if (
    chargeTypeIDs.some((chargeTypeID) => (
      isNpcChargeCompatibleWithModule(moduleItem, chargeTypeID)
    ))
  ) {
    return "weapon";
  }
  return "weapon";
}

function validateWeaponCharges(family, weaponModules, chargeTypeIDs) {
  if (family === HARDWARE_FAMILY_ENTITY_MISSILE_NPC) {
    return {
      success: true,
    };
  }

  if (!Array.isArray(weaponModules) || weaponModules.length === 0) {
    return {
      success: true,
    };
  }

  const familyPolicy = NPC_HARDWARE_POLICY_BY_FAMILY[family] || null;
  const allowedChargeTypeIDs =
    familyPolicy && familyPolicy.chargeTypeIDs instanceof Set
      ? familyPolicy.chargeTypeIDs
      : null;
  if (!allowedChargeTypeIDs || allowedChargeTypeIDs.size === 0) {
    return {
      success: false,
      errorMsg: "NPC_NATIVE_HARDWARE_FAMILY_UNSUPPORTED",
    };
  }

  for (const weaponModule of weaponModules) {
    if (weaponModule && weaponModule.ignoreChargeValidation === true) {
      continue;
    }
    const compatibleChargeTypeIDs = chargeTypeIDs.filter((chargeTypeID) => (
      isNpcChargeCompatibleWithModule(weaponModule, chargeTypeID)
    ));
    if (compatibleChargeTypeIDs.length === 0) {
      return {
        success: false,
        errorMsg: "NPC_NATIVE_HARDWARE_AMMO_REQUIRED",
      };
    }
    if (
      compatibleChargeTypeIDs.some((chargeTypeID) => !allowedChargeTypeIDs.has(chargeTypeID))
    ) {
      return {
        success: false,
        errorMsg: "NPC_NATIVE_HARDWARE_CHARGE_POLICY_VIOLATION",
      };
    }
  }

  return {
    success: true,
  };
}

function validateNpcHardwareDefinition(definition) {
  const family = resolveNpcHardwareFamily(definition);
  if (!family) {
    return {
      success: false,
      errorMsg: "NPC_NATIVE_HARDWARE_FAMILY_UNSUPPORTED",
    };
  }
  if (family === HARDWARE_FAMILY_MINING_OPS) {
    // Mining fleets are driven by the mining runtime rather than the combat AI.
    // Allow authored miner/hauler hulls through without forcing them into the
    // combat-only hardware policy used by Blood Raiders / CONCORD.
    return {
      success: true,
      data: {
        family,
      },
    };
  }
  if (family === HARDWARE_FAMILY_DRIFTER_HARNESS) {
    return {
      success: true,
      data: {
        family,
      },
    };
  }

  const loadout = definition && definition.loadout && typeof definition.loadout === "object"
    ? definition.loadout
    : {};
  const behaviorProfile = definition && definition.behaviorProfile &&
    typeof definition.behaviorProfile === "object"
    ? definition.behaviorProfile
    : {};
  const modules = Array.isArray(loadout.modules) ? loadout.modules : [];
  const chargeTypeIDs = (Array.isArray(loadout.charges) ? loadout.charges : [])
    .map((entry) => toPositiveInt(entry && entry.typeID, 0))
    .filter((typeID) => typeID > 0);
  if (family === HARDWARE_FAMILY_ENTITY_MISSILE_NPC) {
    return {
      success: true,
    };
  }
  const familyPolicy = NPC_HARDWARE_POLICY_BY_FAMILY[family] || null;
  if (!familyPolicy) {
    return {
      success: false,
      errorMsg: "NPC_NATIVE_HARDWARE_FAMILY_UNSUPPORTED",
    };
  }
  const weaponModules = [];
  let sawPropulsionModule = false;

  for (const moduleEntry of modules) {
    const actualTypeID = toPositiveInt(moduleEntry && moduleEntry.typeID, 0);
    if (!actualTypeID) {
      continue;
    }

    const role = resolveModuleRole(moduleEntry, chargeTypeIDs);
    if (role === "weapon") {
      weaponModules.push(moduleEntry);
      if (
        !(familyPolicy.weaponTypeIDs instanceof Set) ||
        !familyPolicy.weaponTypeIDs.has(actualTypeID)
      ) {
        return {
          success: false,
          errorMsg: "NPC_NATIVE_HARDWARE_POLICY_VIOLATION",
        };
      }
      continue;
    }

    if (role === "tackle") {
      if (
        !(familyPolicy.tackleTypeIDs instanceof Set) ||
        !familyPolicy.tackleTypeIDs.has(actualTypeID)
      ) {
        return {
          success: false,
          errorMsg: "NPC_NATIVE_HARDWARE_POLICY_VIOLATION",
        };
      }
      continue;
    }

    if (role === "hostileutility") {
      if (
        !(familyPolicy.utilityTypeIDs instanceof Set) ||
        !familyPolicy.utilityTypeIDs.has(actualTypeID)
      ) {
        return {
          success: false,
          errorMsg: "NPC_NATIVE_HARDWARE_POLICY_VIOLATION",
        };
      }
      continue;
    }

    if (role === "propulsion") {
      sawPropulsionModule = true;
      return {
        success: false,
        errorMsg: "NPC_NATIVE_HARDWARE_POLICY_VIOLATION",
      };
    }
  }

  const chargeValidation = validateWeaponCharges(family, weaponModules, chargeTypeIDs);
  if (!chargeValidation.success) {
    return chargeValidation;
  }

  if (
    behaviorProfile.useChasePropulsion === true &&
    sawPropulsionModule === false &&
    !resolveSyntheticChasePropulsionTemplate(behaviorProfile)
  ) {
    return {
      success: false,
      errorMsg: "NPC_NATIVE_SYNTHETIC_PROPULSION_REQUIRED",
    };
  }

  return {
    success: true,
    data: {
      family,
    },
  };
}

module.exports = {
  NPC_HARDWARE_CATALOG,
  NPC_SYNTHETIC_CHASE_PROPULSION_BY_TIER,
  CONCORD_STANDARD_CRYSTAL_TYPE_IDS,
  resolveNpcHardwareFamily,
  resolveSyntheticChasePropulsionTemplate,
  validateNpcHardwareDefinition,
};
