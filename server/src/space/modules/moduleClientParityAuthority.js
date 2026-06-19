const path = require("path");

const {
  getFittedModuleItems,
  getLoadedChargeItems,
  typeHasEffectName,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  resolveWeaponFamily,
} = require(path.join(__dirname, "../combat/weaponDogma"));

const GROUP_SCAN_PROBE_LAUNCHER = 481;

const MODULE_CLIENT_PARITY_FAMILIES = Object.freeze({
  generic: Object.freeze({
    familyID: "generic",
    hardpointBound: false,
    requiresOnlineEffectBootstrap: false,
  }),
  turretWeapon: Object.freeze({
    familyID: "turretWeapon",
    hardpointBound: true,
    requiresOnlineEffectBootstrap: true,
  }),
  missileLauncher: Object.freeze({
    familyID: "missileLauncher",
    hardpointBound: true,
    requiresOnlineEffectBootstrap: true,
  }),
  probeLauncher: Object.freeze({
    familyID: "probeLauncher",
    hardpointBound: true,
    requiresOnlineEffectBootstrap: true,
  }),
  precursorTurret: Object.freeze({
    familyID: "precursorTurret",
    hardpointBound: true,
    requiresOnlineEffectBootstrap: true,
  }),
});

const SPACE_ATTACH_MODULE_PARITY_POLICIES = Object.freeze({
  login: Object.freeze({ profileID: "login" }),
  stargate: Object.freeze({ profileID: "stargate" }),
  solar: Object.freeze({ profileID: "solar" }),
  solarWarm: Object.freeze({ profileID: "solarWarm" }),
  transition: Object.freeze({ profileID: "transition" }),
  undock: Object.freeze({ profileID: "undock" }),
  capsule: Object.freeze({ profileID: "capsule" }),
});

const moduleFamilyCache = new Map();
function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function buildModuleFamilyCacheKey(moduleItem) {
  return [
    toInt(moduleItem && moduleItem.typeID, 0),
    toInt(moduleItem && moduleItem.groupID, 0),
  ].join(":");
}

function resolveModuleParityFamily(moduleItem, chargeItem = null) {
  const moduleTypeID = toInt(moduleItem && moduleItem.typeID, 0);
  if (moduleTypeID <= 0) {
    return MODULE_CLIENT_PARITY_FAMILIES.generic;
  }

  const chargeTypeID = toInt(chargeItem && chargeItem.typeID, 0);
  const cacheKey = `${buildModuleFamilyCacheKey(moduleItem)}:${chargeTypeID}`;
  if (moduleFamilyCache.has(cacheKey)) {
    return moduleFamilyCache.get(cacheKey);
  }

  let family = MODULE_CLIENT_PARITY_FAMILIES.generic;
  const moduleGroupID = toInt(moduleItem && moduleItem.groupID, 0);
  if (moduleGroupID === GROUP_SCAN_PROBE_LAUNCHER) {
    family = MODULE_CLIENT_PARITY_FAMILIES.probeLauncher;
  } else {
    const weaponFamily = resolveWeaponFamily(moduleItem, chargeItem);
    if (weaponFamily === "precursorTurret") {
      family = MODULE_CLIENT_PARITY_FAMILIES.precursorTurret;
    } else if (weaponFamily === "missileLauncher") {
      family = MODULE_CLIENT_PARITY_FAMILIES.missileLauncher;
    } else if (
      weaponFamily === "laserTurret" ||
      weaponFamily === "hybridTurret" ||
      weaponFamily === "projectileTurret"
    ) {
      family = MODULE_CLIENT_PARITY_FAMILIES.turretWeapon;
    } else if (
      typeHasEffectName(moduleTypeID, "turretFitted") ||
      typeHasEffectName(moduleTypeID, "launcherFitted")
    ) {
      family = MODULE_CLIENT_PARITY_FAMILIES.turretWeapon;
    }
  }

  moduleFamilyCache.set(cacheKey, family);
  return family;
}

function getSpaceAttachModuleParityPolicy(profileID = "transition") {
  return (
    SPACE_ATTACH_MODULE_PARITY_POLICIES[String(profileID || "transition")] ||
    SPACE_ATTACH_MODULE_PARITY_POLICIES.transition
  );
}

function buildShipModuleParityManifest(characterID, shipID, options = {}) {
  const fittedModules = getFittedModuleItems(characterID, shipID);
  const loadedCharges = getLoadedChargeItems(characterID, shipID);
  const chargeByFlag = new Map(
    loadedCharges.map((chargeItem) => [toInt(chargeItem && chargeItem.flagID, 0), chargeItem]),
  );

  const familyCounts = new Map();
  const familyIDsByModuleID = {};
  let requiresOnlineEffectBootstrap = false;

  for (const moduleItem of fittedModules) {
    const family = resolveModuleParityFamily(
      moduleItem,
      chargeByFlag.get(toInt(moduleItem && moduleItem.flagID, 0)) || null,
    );
    familyIDsByModuleID[String(toInt(moduleItem && moduleItem.itemID, 0))] =
      family.familyID;
    familyCounts.set(
      family.familyID,
      (familyCounts.get(family.familyID) || 0) + 1,
    );
    if (family.requiresOnlineEffectBootstrap === true) {
      requiresOnlineEffectBootstrap = true;
    }
  }

  return Object.freeze({
    characterID: toInt(characterID, 0),
    shipID: toInt(shipID, 0),
    moduleCount: fittedModules.length,
    loadedChargeCount: loadedCharges.length,
    requiresOnlineEffectBootstrap,
    familyCounts: Object.freeze(Object.fromEntries(familyCounts)),
    familyIDsByModuleID: Object.freeze(familyIDsByModuleID),
    profileHints: Object.freeze({
      attachProfileID: String(options.attachProfileID || ""),
    }),
  });
}

module.exports = {
  GROUP_SCAN_PROBE_LAUNCHER,
  MODULE_CLIENT_PARITY_FAMILIES,
  SPACE_ATTACH_MODULE_PARITY_POLICIES,
  buildShipModuleParityManifest,
  getSpaceAttachModuleParityPolicy,
  resolveModuleParityFamily,
};
