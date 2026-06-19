const {
  resolveItemByTypeID,
} = require("../inventory/itemTypeRegistry");
const {
  getTypeAttributeValue,
} = require("../fitting/liveFittingState");

const TITAN_SUPERWEAPON_PROFILES = Object.freeze([
  {
    hullTypeID: 11567,
    doomsdayTypeID: 24550,
    doomsdayFxGuid: "effects.SuperWeaponAmarr",
    lanceTypeID: 40631,
    lanceFxGuid: "effects.SuperWeaponLanceAmarr",
    fuelTypeID: 16274,
    fuelName: "Helium Isotopes",
  },
  {
    hullTypeID: 3764,
    doomsdayTypeID: 24552,
    doomsdayFxGuid: "effects.SuperWeaponCaldari",
    lanceTypeID: 41439,
    lanceFxGuid: "effects.SuperWeaponLanceCaldari",
    fuelTypeID: 17888,
    fuelName: "Nitrogen Isotopes",
  },
  {
    hullTypeID: 671,
    doomsdayTypeID: 24554,
    doomsdayFxGuid: "effects.SuperWeaponGallente",
    lanceTypeID: 41440,
    lanceFxGuid: "effects.SuperWeaponLanceGallente",
    fuelTypeID: 17887,
    fuelName: "Oxygen Isotopes",
  },
  {
    hullTypeID: 23773,
    doomsdayTypeID: 23674,
    doomsdayFxGuid: "effects.SuperWeaponMinmatar",
    lanceTypeID: 41441,
    lanceFxGuid: "effects.SuperWeaponLanceMinmatar",
    fuelTypeID: 17889,
    fuelName: "Hydrogen Isotopes",
  },
]);

function resolveType(typeID) {
  const itemType = resolveItemByTypeID(Number(typeID) || 0);
  return itemType || null;
}

function resolveFuelTypeID(moduleTypeID) {
  return Number(getTypeAttributeValue(moduleTypeID, "consumptionType")) || 0;
}

function resolveFuelPerActivation(moduleTypeID) {
  return Number(getTypeAttributeValue(moduleTypeID, "consumptionQuantity")) || 0;
}

function hydrateProfile(baseProfile) {
  if (!baseProfile) {
    return null;
  }

  const hullType = resolveType(baseProfile.hullTypeID);
  const doomsdayType = resolveType(baseProfile.doomsdayTypeID);
  const lanceType = resolveType(baseProfile.lanceTypeID);
  const fuelType = resolveType(baseProfile.fuelTypeID);
  if (!hullType || !doomsdayType || !lanceType || !fuelType) {
    return null;
  }

  const doomsdayFuelTypeID = resolveFuelTypeID(baseProfile.doomsdayTypeID);
  const lanceFuelTypeID = resolveFuelTypeID(baseProfile.lanceTypeID);
  const doomsdayFuelPerActivation = resolveFuelPerActivation(baseProfile.doomsdayTypeID);
  const lanceFuelPerActivation = resolveFuelPerActivation(baseProfile.lanceTypeID);

  return Object.freeze({
    ...baseProfile,
    hullType,
    doomsdayType,
    lanceType,
    fuelType,
    doomsdayFuelTypeID,
    lanceFuelTypeID,
    doomsdayFuelPerActivation,
    lanceFuelPerActivation,
  });
}

function listTitanSuperweaponProfiles() {
  return TITAN_SUPERWEAPON_PROFILES.map(hydrateProfile).filter(Boolean);
}

function resolveTitanSuperweaponProfileByHullTypeID(hullTypeID) {
  const normalizedHullTypeID = Number(hullTypeID) || 0;
  return listTitanSuperweaponProfiles().find((profile) => (
    Number(profile.hullTypeID) === normalizedHullTypeID
  )) || null;
}

function resolveTitanSuperweaponProfileByModuleTypeID(moduleTypeID) {
  const normalizedModuleTypeID = Number(moduleTypeID) || 0;
  return listTitanSuperweaponProfiles().find((profile) => (
    Number(profile.doomsdayTypeID) === normalizedModuleTypeID ||
    Number(profile.lanceTypeID) === normalizedModuleTypeID
  )) || null;
}

function pickRandomTitanSuperweaponProfile(options = {}) {
  const random =
    typeof options.random === "function"
      ? options.random
      : Math.random;
  const profiles = listTitanSuperweaponProfiles();
  if (profiles.length === 0) {
    return null;
  }

  const boundedRandom = Math.min(0.999999, Math.max(0, Number(random()) || 0));
  return profiles[Math.floor(boundedRandom * profiles.length)] || profiles[0];
}

function listTitanSuperweaponLoadouts(options = {}) {
  const family = String(options.family || "").trim().toLowerCase();
  return listTitanSuperweaponProfiles().flatMap((profile) => {
    const loadouts = [
      {
        hullTypeID: profile.hullTypeID,
        hullType: profile.hullType,
        moduleTypeID: profile.doomsdayTypeID,
        moduleType: profile.doomsdayType,
        fxGuid: profile.doomsdayFxGuid,
        family: "doomsday",
        fuelTypeID: profile.fuelTypeID,
        fuelType: profile.fuelType,
        fuelPerActivation: profile.doomsdayFuelPerActivation,
      },
      {
        hullTypeID: profile.hullTypeID,
        hullType: profile.hullType,
        moduleTypeID: profile.lanceTypeID,
        moduleType: profile.lanceType,
        fxGuid: profile.lanceFxGuid,
        family: "lance",
        fuelTypeID: profile.fuelTypeID,
        fuelType: profile.fuelType,
        fuelPerActivation: profile.lanceFuelPerActivation,
      },
    ];
    return family
      ? loadouts.filter((loadout) => loadout.family === family)
      : loadouts;
  });
}

function pickRandomTitanSuperweaponLoadout(options = {}) {
  const random =
    typeof options.random === "function"
      ? options.random
      : Math.random;
  const loadouts = listTitanSuperweaponLoadouts(options);
  if (loadouts.length === 0) {
    return null;
  }

  const boundedRandom = Math.min(0.999999, Math.max(0, Number(random()) || 0));
  return loadouts[Math.floor(boundedRandom * loadouts.length)] || loadouts[0];
}

module.exports = {
  TITAN_SUPERWEAPON_PROFILES,
  listTitanSuperweaponProfiles,
  resolveTitanSuperweaponProfileByHullTypeID,
  resolveTitanSuperweaponProfileByModuleTypeID,
  pickRandomTitanSuperweaponProfile,
  listTitanSuperweaponLoadouts,
  pickRandomTitanSuperweaponLoadout,
  resolveFuelTypeID,
  resolveFuelPerActivation,
};
